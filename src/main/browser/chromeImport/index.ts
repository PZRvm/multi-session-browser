// Chrome 浏览数据导入编排与 IPC（导入专项 20260930133553；2026-10-28 站点数据专项
// 步骤 6 扩四类型，计划 20261028112040 第 3/5 节契约）：
// list-profiles 现取探测；dry-run 守卫 → 源快照（sourceSnapshot 固定副本：勾选 scope
// 所需数据一次性复制，Cookie/IndexedDB 要求源一致性证据）→ 四类型只读探测
// （historySource/siteData 直读副本 + cookies/indexedDb 引擎 prepare）→ 暂存
// （planId + 60s TTL，TTL 从准备完成后起算——不含钥匙串授权等待）→ 计划载荷；
// execute 取暂存 → registry.runImportQuiesced 静默窗口内逐类型写入（引擎 apply +
// 既有 history/LS 写入；目标冲突在窗口内按真值重核，漂移不扩大写入）→ 逐类型结果
// 汇总（分项独立：一类失败不中断另一类，部分成功/不支持/还原失败如实呈现）。
// cancel 清尚未执行的暂存并释放快照（写盘中的 execute 不可取消）；TTL 过期/失败/
// 应用退出统一走 dispose。会话隔离不变量：写路径只经 registry 的 partitionDir 单源
// 与静默窗口原语触达目标分区，本文件不自行拼分区路径；Electron Session 经
// partitionFor 单源解析。全部通道 invoke 零推送；载荷跨 IPC 边界一律先过运行时守卫
// （profileDir 白名单 = 探测枚举成员 + 路径分隔符拒绝的纵深防御）。同会话在途
// dry-run/execute 单飞拒绝。

import { app, dialog, ipcMain, session } from 'electron'
import type { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { mkdtemp } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { isRecord } from '../../../shared/guards'
import {
  CHROME_IMPORT_CHANNELS,
  CHROME_IMPORT_POLICIES,
  type ChromeImportCancelResult,
  type ChromeImportOptions,
  type ChromeImportPlan,
  type ChromeImportPolicy,
  type ChromeImportResult,
  chromeImportScopeLabelKey,
  type ChromeImportScope,
  type ChromeImportScopePlan,
  type ChromeImportScopeResult,
  type ChromeProfilesPayload
} from '../../../shared/chromeImport'
import { HISTORY_MAX_ENTRIES, type HistoryEntry } from '../../../shared/history'
import { SESSION_ID_RE } from '../../../shared/sessions'
import { t } from '../../i18n'
import { dialogIconForDarwin } from '../../dialogs'
import { loadSnapshot } from '../../store'
import { logFailure } from '../../ipc-utils'
import { partitionFor, type SessionBrowserRegistry } from '../registry'
import type { ChromeSiteDataStats } from './siteData'
import { createChromeDetector, defaultChromeRootDir } from './detect'
import { createChromeHistorySource } from './historySource'
import { createChromeSiteDataMerge } from './siteData'
import { createChromeSourceSnapshot, type ChromeSourceSnapshot } from './sourceSnapshot'
import { createCookieSource } from './cookieSource'
import { createCookieImportEngine, type CookieImportArtifacts } from './cookies'
import { createIndexedDbEngine, type IdbImportArtifacts } from './indexedDb'
import { ImportEngineError } from './types'
import type { ImportEngineContext } from './types'

/** 暂存 TTL（计划 5.1）：过期 execute 报「导入准备已过期，请重新发起导入」。从准备
 *  完成后起算（putStaged 时挂表）——钥匙串授权等待发生在 prepare 内、完成前，不占 TTL */
const STAGE_TTL_MS = 60_000

/**
 * 当前可选 scope 集（引擎就绪度单源，导出供 workspacePickerWindow 组装选择 sheet
 * 上下文）：四类型引擎已随 2026-10-28 专项全部装配，选择界面（picker 上下文
 * chromeScopes）与 dry-run/execute 运行时守卫同源取此表
 */
export const AVAILABLE_IMPORT_SCOPES: readonly ChromeImportScope[] = [
  'history',
  'localStorage',
  'cookies',
  'indexedDB'
]

/**
 * 显示面 clamp：结果框正文截断上限（审查低-4）。正文来源为 t() 计数插值（定长）或
 * 错误 message（fs 错误可能携带长路径），超限截断防极端文本撑高弹框——dialogs.ts
 * DISPLAY_NAME_MAX 同款显示面兜底口径，非落盘面
 */
const DIALOG_BODY_MAX = 800

/**
 * detect/historySource/siteData/引擎装配（模块级单例，零状态或自持状态，通道层无感）。
 * chromeDetector 导出（审查低-3 收敛）：与 workspacePickerWindow 的探测入口共享同一
 * 实例，避免 createChromeDetector 工厂被两模块各自实例化
 */
export const chromeDetector = createChromeDetector({ getRootDir: defaultChromeRootDir })
const makeImportTempDir = (): Promise<string> => mkdtemp(join(tmpdir(), 'msb-chrome-import-'))
const historySource = createChromeHistorySource({ makeTempDir: makeImportTempDir })
const siteData = createChromeSiteDataMerge({ makeTempDir: makeImportTempDir })
const sourceSnapshot = createChromeSourceSnapshot({})
const cookieEngine = createCookieImportEngine({
  source: createCookieSource({ makeTempDir: makeImportTempDir })
})
const idbEngine = createIndexedDbEngine({ makeTempDir: makeImportTempDir })

/** dry-run 暂存：execute 的唯一合法输入（防陈旧导入——探测与写入之间的会话/profile 漂移）。
 *  scopePlans 为 dry-run 实测的按类型/单位摘要（权威制：冲突裁决 sheet 经 peekStagedScopes
 *  只读取此份数据，renderer 不自报计数）；sourceSnapshot 为固定源副本（执行只消费这同一
 *  份）；cookieArtifacts/idbArtifacts 为引擎执行工件（dispose 与引擎约定一致） */
interface StagedImport {
  sessionId: string
  scopes: ChromeImportScope[]
  scopePlans: ChromeImportScopePlan[]
  sourceSnapshot: ChromeSourceSnapshot
  historyEntries: HistoryEntry[]
  /** localStorage scope 未勾选时为 null（勾选时恒有——dry-run 已算好冲突摘要） */
  lsStats: ChromeSiteDataStats | null
  cookieArtifacts: CookieImportArtifacts | null
  idbArtifacts: IdbImportArtifacts | null
}

const staged = new Map<string, StagedImport>()
const stageTimers = new Map<string, ReturnType<typeof setTimeout>>()
/** 同会话在途单飞（dry-run 与 execute 共用判据）：对话框层有锁定，此处兜底防绕过 */
const inFlight = new Set<string>()

/** 释放暂存资源（快照整树 + 引擎工件）：TTL 过期 / cancel / execute 收尾 / 退出清理共用 */
async function disposeStaged(entry: StagedImport): Promise<void> {
  if (entry.cookieArtifacts !== null) {
    await cookieEngine.dispose(entry.cookieArtifacts).catch(() => {})
  }
  if (entry.idbArtifacts !== null) {
    await idbEngine.dispose(entry.idbArtifacts).catch(() => {})
  }
  await entry.sourceSnapshot.dispose()
}

/** TTL 定时器装配（putStaged 与 rearmStaged 共用——审查 20261028170000 低-1 收敛）：
 *  到点整包作废并释放快照/工件；unref 防退出被纯清理定时器拖住 */
function armStagedTimer(planId: string): void {
  const timer = setTimeout(() => {
    stageTimers.delete(planId)
    const expired = staged.get(planId)
    staged.delete(planId)
    if (expired) void disposeStaged(expired)
  }, STAGE_TTL_MS)
  timer.unref?.()
  stageTimers.set(planId, timer)
}

function putStaged(entry: StagedImport): string {
  const planId = randomUUID()
  staged.set(planId, entry)
  armStagedTimer(planId)
  return planId
}

/** busy 拒绝时归还原 planId 的暂存并重挂 TTL（审查低-2）：拒绝不白耗一次探测 */
function rearmStaged(planId: string, entry: StagedImport): void {
  staged.set(planId, entry)
  armStagedTimer(planId)
}

/** 取暂存（取出即销毁：一次 execute 消费一次探测）+ TTL 定时器同步清理；未知/过期一律同文案 */
function takeStaged(planId: string): StagedImport {
  const timer = stageTimers.get(planId)
  if (timer !== undefined) {
    clearTimeout(timer)
    stageTimers.delete(planId)
  }
  const entry = staged.get(planId)
  staged.delete(planId)
  if (entry === undefined) throw new Error(t('chromeImport.errors.planExpired'))
  return entry
}

/** 取暂存计划（保留不动，供冲突裁决 sheet 按计划取权威摘要——权威制后 picker 上下文
 *  经此只读查询，不消费）：未知计划返回 null（show 载荷守卫拒绝） */
export function peekStagedScopes(planId: string): ChromeImportScopePlan[] | null {
  return staged.get(planId)?.scopePlans ?? null
}

/** 入参守卫统一错误（审查低-4 收敛两处同形闭包）：i18n 中文，跨 IPC 上浮 renderer */
function invalidImportParams(): Error {
  return new Error(t('chromeImport.errors.invalidParams'))
}

/** 入参守卫（跨 IPC 边界不可信任）：sessionId 过格式单源、profileDir 拒路径分隔符、scopes 闭集去重保序 */
function parseOptions(payload: unknown): ChromeImportOptions {
  if (!isRecord(payload)) throw invalidImportParams()
  if (typeof payload.sessionId !== 'string' || !SESSION_ID_RE.test(payload.sessionId)) {
    throw invalidImportParams()
  }
  if (
    typeof payload.profileDir !== 'string' ||
    payload.profileDir.trim() === '' ||
    profileHasSeparator(payload.profileDir)
  ) {
    throw invalidImportParams()
  }
  if (!Array.isArray(payload.scopes) || payload.scopes.length === 0) throw invalidImportParams()
  const selected = new Set<string>()
  for (const scope of payload.scopes) {
    // 运行时可用性门：类型层四值（CHROME_IMPORT_SCOPES），运行时按引擎就绪度收口
    // （AVAILABLE_SCOPES）——未就绪类型直呼通道也整单拒绝
    if (
      typeof scope !== 'string' ||
      !(AVAILABLE_IMPORT_SCOPES as readonly string[]).includes(scope)
    ) {
      throw invalidImportParams()
    }
    selected.add(scope)
  }
  return {
    sessionId: payload.sessionId,
    profileDir: payload.profileDir.trim(),
    scopes: AVAILABLE_IMPORT_SCOPES.filter((scope) => selected.has(scope))
  }
}

/** profileDir 分隔符/逃逸防御（parseOptions 内联判据收敛） */
function profileHasSeparator(dir: string): boolean {
  return dir.includes('/') || dir.includes('\\') || dir.includes('..')
}

/**
 * 历史并入预演计数（dry-run 摘要用）：url 是否已存在为唯一判据，与 history.importEntries
 * 的 added/merged 判据同口径（审查低-4）——合并语义变更须两处同步（dry-run 预演若与
 * execute 实际计数漂移，对话框反馈将前后矛盾）
 */
function previewHistoryMerge(
  existing: HistoryEntry[],
  incoming: HistoryEntry[]
): { total: number; added: number; merged: number } {
  const byUrl = new Map(existing.map((entry) => [entry.url, entry]))
  let added = 0
  let merged = 0
  for (const entry of incoming) {
    if (byUrl.has(entry.url)) merged += 1
    else added += 1
  }
  return { total: incoming.length, added, merged }
}

/** 引擎执行上下文（快照 + 目标；Cookie 引擎的目标 Session 经 partitionFor 单源解析——
 *  导入目标为激活会话，分区 Session 已由 registry 建立或由此幂等取得同实例） */
function engineContext(
  sessionId: string,
  snapshot: ChromeSourceSnapshot,
  partitionDir: string
): ImportEngineContext {
  return {
    sessionId,
    profileDir: snapshot.profileDir,
    snapshotRoot: snapshot.root,
    session: session.fromPartition(partitionFor(sessionId)),
    partitionDir
  }
}

export function registerChromeImportIpc(deps: {
  registry: SessionBrowserRegistry
  getPartitionDir: (sessionId: string) => string
  /** 主窗口解析（导入结果/错误的原生 information 框宿主，反馈轮改原生——渲染层 antd message 退役） */
  getMainWindow: () => BrowserWindow | null
}): void {
  // 应用退出兜底清理：尚在暂存的快照/工件整树释放（正常路径早已 dispose，此处只兜
  // 异常退出窗口；同步等待尽力而为，不阻塞退出）
  app.on('will-quit', () => {
    for (const entry of staged.values()) void disposeStaged(entry)
    staged.clear()
    for (const timer of stageTimers.values()) clearTimeout(timer)
    stageTimers.clear()
  })

  // list-profiles：探测现取（毫秒级 fs 操作）；失败上抛（renderer 显示检测失败）
  ipcMain.handle(CHROME_IMPORT_CHANNELS.listProfiles, async (): Promise<ChromeProfilesPayload> =>
    logFailure(CHROME_IMPORT_CHANNELS.listProfiles, undefined, async () =>
      chromeDetector.listProfiles()
    )
  )

  // dry-run：会话存在性（读盘）→ profileDir 白名单复核（防探针绕过对话框直呼通道）→
  // 源快照（固定副本；Cookie/IndexedDB 一致性证据）→ 四类型只读探测 → 暂存 → 计划载荷。
  // 全程零写入（Chrome 侧与目标分区两不在话下；引擎 prepare 对目标只读查询）
  ipcMain.handle(
    CHROME_IMPORT_CHANNELS.dryRun,
    async (_event, payload: unknown): Promise<ChromeImportPlan> =>
      logFailure(CHROME_IMPORT_CHANNELS.dryRun, payload, async () => {
        const options = parseOptions(payload)
        // 单飞判据与登记相邻同步（审查中-3）：判据与 add 之间隔 await 可被并发穿过
        if (inFlight.has(options.sessionId)) throw new Error(t('chromeImport.errors.busy'))
        inFlight.add(options.sessionId)
        let captured: ChromeSourceSnapshot | null = null
        // 半途失败路径的工件释放凭据（catch 内对已产出工件补 dispose——审查
        // 20261028170000 低-7，对齐 types.ts 生命周期契约）
        let cookieArtifacts: CookieImportArtifacts | null = null
        let idbArtifacts: IdbImportArtifacts | null = null
        try {
          const snapshot = await loadSnapshot()
          if (!snapshot.sessions.some((session) => session.id === options.sessionId)) {
            throw new Error(t('errors.sessionNotFound'))
          }
          const { profiles } = await chromeDetector.listProfiles()
          if (!profiles.some((profile) => profile.dir === options.profileDir)) {
            throw new Error(t('chromeImport.errors.profileNotFound'))
          }
          const sourceProfilePath = join(defaultChromeRootDir(), options.profileDir)
          captured = await sourceSnapshot.capture(
            sourceProfilePath,
            options.profileDir,
            options.scopes
          )
          const snapshotProfile = captured.profilePath
          const scopePlans: ChromeImportScopePlan[] = []
          let historyEntries: HistoryEntry[] = []
          let lsStats: ChromeSiteDataStats | null = null
          if (options.scopes.includes('history')) {
            historyEntries = await historySource.read(snapshotProfile, HISTORY_MAX_ENTRIES)
            const existing = await deps.registry.history.getEntries(options.sessionId)
            const preview = previewHistoryMerge(existing, historyEntries)
            scopePlans.push({
              scope: 'history',
              unit: 'records',
              total: preview.total,
              added: preview.added,
              merged: preview.merged,
              // 历史无冲突概念（静默 upsert，调研报告 5.1 定案）
              conflicts: 0,
              conflictSites: 0,
              unsupported: 0,
              notes: []
            })
          }
          if (options.scopes.includes('localStorage')) {
            lsStats = await siteData.dryRun(
              snapshotProfile,
              deps.getPartitionDir(options.sessionId)
            )
            scopePlans.push({
              scope: 'localStorage',
              unit: 'records',
              total: lsStats.total,
              added: lsStats.added,
              merged: lsStats.merged,
              conflicts: lsStats.conflictKeys,
              conflictSites: lsStats.conflictOrigins,
              unsupported: 0,
              notes: []
            })
          }
          if (options.scopes.includes('cookies')) {
            const context = engineContext(
              options.sessionId,
              captured,
              deps.getPartitionDir(options.sessionId)
            )
            const prepared = await cookieEngine.prepare(context)
            cookieArtifacts = prepared.artifacts
            scopePlans.push(prepared.plan)
          }
          if (options.scopes.includes('indexedDB')) {
            const context = engineContext(
              options.sessionId,
              captured,
              deps.getPartitionDir(options.sessionId)
            )
            const prepared = await idbEngine.prepare(context)
            idbArtifacts = prepared.artifacts
            scopePlans.push(prepared.plan)
          }
          const planId = putStaged({
            sessionId: options.sessionId,
            scopes: options.scopes,
            scopePlans,
            sourceSnapshot: captured,
            historyEntries,
            lsStats,
            cookieArtifacts,
            idbArtifacts
          })
          return { planId, scopes: scopePlans }
        } catch (error) {
          // 快照已建但未入暂存（prepare 半途失败）：立即释放快照与已产出引擎工件
          //（Cookie 明文表等内存面不待 GC——types.ts「失败统一走 dispose」契约）
          if (cookieArtifacts !== null) void cookieEngine.dispose(cookieArtifacts).catch(() => {})
          if (idbArtifacts !== null) void idbEngine.dispose(idbArtifacts).catch(() => {})
          if (captured !== null) await captured.dispose()
          // 失败原生框（反馈轮改原生）：正文经兜底映射（审查中-1）防 fs 英文直出，
          // 原始错误仍原样 rethrow（renderer 消化 + logFailure 留痕不受影响）
          showResultDialog(deps.getMainWindow, resolveDialogBody(error))
          throw error
        } finally {
          inFlight.delete(options.sessionId)
        }
      })
  )

  // execute：暂存消费（未知/过期一律 planExpired）→ 静默窗口内逐 scope 写入（分项独立
  // try/catch：一类失败不中断另一类）→ 未勾选 scope 补 skipped 行（renderer 反馈完整）→
  // 资源统一释放（finally：快照整树 + 引擎工件）
  ipcMain.handle(
    CHROME_IMPORT_CHANNELS.execute,
    async (_event, payload: unknown): Promise<ChromeImportResult> =>
      logFailure(CHROME_IMPORT_CHANNELS.execute, payload, async () => {
        if (!isRecord(payload) || typeof payload.planId !== 'string') throw invalidImportParams()
        if (
          typeof payload.policy !== 'string' ||
          !(CHROME_IMPORT_POLICIES as readonly string[]).includes(payload.policy)
        ) {
          throw invalidImportParams()
        }
        const entry = takeStaged(payload.planId)
        // 单飞判据与登记相邻同步（审查中-3 同款）；busy 拒绝归还暂存，拒绝不白耗探测
        if (inFlight.has(entry.sessionId)) {
          rearmStaged(payload.planId, entry)
          throw new Error(t('chromeImport.errors.busy'))
        }
        inFlight.add(entry.sessionId)
        try {
          // 暂存窗口期（≤60s）会话可能已被删除——删除不受导入窗口守卫（守卫只在写入
          // 窗口生效），execute 入口复核存在性：已删会话的暂存一律拒绝，杜绝历史 JSON
          // 与分区存储半截目录的僵尸数据复活 + 对已删会话报成功（审查中-2）
          const snapshot = await loadSnapshot()
          if (!snapshot.sessions.some((session) => session.id === entry.sessionId)) {
            throw new Error(t('errors.sessionNotFound'))
          }
          const policy = payload.policy as ChromeImportPolicy
          const partitionDir = deps.getPartitionDir(entry.sessionId)
          const context = engineContext(entry.sessionId, entry.sourceSnapshot, partitionDir)
          const written: ChromeImportScopeResult[] = await deps.registry.runImportQuiesced(
            entry.sessionId,
            async () => {
              const out: ChromeImportScopeResult[] = []
              if (entry.scopes.includes('history')) {
                try {
                  const { added, merged } = await deps.registry.history.importEntries(
                    entry.sessionId,
                    entry.historyEntries
                  )
                  out.push({
                    scope: 'history',
                    unit: 'records',
                    status: 'done',
                    added,
                    merged,
                    conflictsResolved: 0,
                    unsupported: 0,
                    skipped: 0
                  })
                } catch (error) {
                  out.push(failedResult('history', error))
                }
              }
              if (entry.scopes.includes('localStorage') && entry.lsStats !== null) {
                try {
                  // 消费固定源副本（快照 profilePath）——与 dry-run 同一份数据，不回读
                  // 用户 Chrome 原目录（计划 2.3：执行只消费主进程暂存的同一份数据）
                  const applied = await siteData.execute(
                    entry.sourceSnapshot.profilePath,
                    partitionDir,
                    policy
                  )
                  out.push({
                    scope: 'localStorage',
                    unit: 'records',
                    status: 'done',
                    added: applied.added,
                    merged: applied.merged,
                    conflictsResolved: applied.conflictsResolved,
                    unsupported: 0,
                    skipped: 0
                  })
                } catch (error) {
                  out.push(failedResult('localStorage', error))
                }
              }
              if (entry.scopes.includes('cookies') && entry.cookieArtifacts !== null) {
                try {
                  out.push(await cookieEngine.apply(context, entry.cookieArtifacts, policy))
                } catch (error) {
                  out.push(failedResult('cookies', error))
                }
              }
              if (entry.scopes.includes('indexedDB') && entry.idbArtifacts !== null) {
                try {
                  out.push(await idbEngine.apply(context, entry.idbArtifacts, policy))
                } catch (error) {
                  out.push(failedResult('indexedDB', error))
                }
              }
              return out
            }
          )
          const results = [...written]
          // 未勾选 scope 补 skipped 行（以可用 scope 集为准，反馈完整）
          for (const scope of AVAILABLE_IMPORT_SCOPES) {
            if (entry.scopes.includes(scope)) continue
            results.push({
              scope,
              unit: scope === 'indexedDB' ? 'sites' : 'records',
              status: 'skipped',
              added: 0,
              merged: 0,
              conflictsResolved: 0,
              unsupported: 0,
              skipped: 0
            })
          }
          // 成功原生结果框：按类型/单位/状态汇总多行正文
          showResultDialog(deps.getMainWindow, summarizeResults(results))
          return { results }
        } catch (error) {
          // 失败原生框正文经兜底映射（审查中-1，同 dry-run 口径）；原始错误原样 rethrow
          showResultDialog(deps.getMainWindow, resolveDialogBody(error))
          throw error
        } finally {
          void disposeStaged(entry)
          inFlight.delete(entry.sessionId)
        }
      })
  )

  // cancel（四类型契约）：清尚未执行的暂存计划并释放资源（TTL 定时器同步撤销、快照
  // 整树删除、引擎工件 dispose）；写盘中的 execute 不受影响（其暂存已被消费移出——
  // cancel 只清尚未执行的计划，不在写盘中途制造假取消）。未命中 cancelled:false
  // （幂等非错误——重复取消/已过期/已执行同语义）
  ipcMain.handle(
    CHROME_IMPORT_CHANNELS.cancel,
    (_event, payload: unknown): ChromeImportCancelResult =>
      logFailure(CHROME_IMPORT_CHANNELS.cancel, payload, () => {
        if (!isRecord(payload) || typeof payload.planId !== 'string') throw invalidImportParams()
        const timer = stageTimers.get(payload.planId)
        if (timer !== undefined) {
          clearTimeout(timer)
          stageTimers.delete(payload.planId)
        }
        const entry = staged.get(payload.planId)
        staged.delete(payload.planId)
        if (entry !== undefined) void disposeStaged(entry)
        return { cancelled: entry !== undefined }
      })
  )

  console.log('[chrome-import] IPC handlers 已注册（4 条通道）')
}

/** scope 级失败收敛：ImportEngineError 携带闭集原因码与已本地化文案（reason 进结果行，
 *  错误原文留 error 供日志）；其他错误文案原样上浮（t() 中文错误或模块透传的 fs 错误，
 *  不静默不伪造） */
function failedResult(scope: ChromeImportScope, error: unknown): ChromeImportScopeResult {
  return {
    scope,
    unit: scope === 'indexedDB' ? 'sites' : 'records',
    status: 'failed',
    added: 0,
    merged: 0,
    conflictsResolved: 0,
    unsupported: 0,
    skipped: 0,
    ...(error instanceof ImportEngineError ? { reason: error.reason } : {}),
    error: error instanceof Error ? error.message : String(error)
  }
}

/** scope 显示名（结果框/摘要共用，随界面语言；键名经 shared 单源映射——审查
 *  20261028170000 低-4，与 sheet 页面 scopeLabel 同源） */
function scopeName(scope: ChromeImportScope): string {
  return t(chromeImportScopeLabelKey(scope) as Parameters<typeof t>[0])
}

/** 结果原因码 → 短句（闭集映射，随界面语言；未知码回退通用句） */
function reasonText(reason: string | undefined): string {
  switch (reason) {
    case 'source-version-newer':
      return t('chromeImport.result.reasonSourceVersionNewer')
    case 'source-busy':
      return t('chromeImport.errors.chromeLocked')
    case 'auth-denied':
    case 'auth-timeout':
      return t('chromeImport.result.reasonAuth')
    case 'target-changed':
      return t('chromeImport.result.reasonTargetChanged')
    case 'io-error':
      return t('chromeImport.result.reasonIo')
    case 'rollback-failed':
      return t('chromeImport.result.reasonRollback')
    default:
      return t('chromeImport.result.reasonUnsupported')
  }
}

/** 按 scope 汇总导入结果为多行正文（主进程 t() 组装，随界面语言；完整成功/部分成功/
 *  不支持/失败/还原失败分别呈现，部分完成不伪装成功） */
function summarizeResults(results: ChromeImportScopeResult[]): string {
  const lines: string[] = []
  for (const item of results) {
    const name = scopeName(item.scope)
    if (item.status === 'done') {
      switch (item.scope) {
        case 'history':
          lines.push(
            t('chromeImport.result.historyDone', { added: item.added, merged: item.merged })
          )
          break
        case 'localStorage':
          lines.push(
            t('chromeImport.result.localStorageDone', {
              added: item.added,
              merged: item.merged,
              conflicts: item.conflictsResolved
            })
          )
          break
        case 'cookies':
          lines.push(
            t('chromeImport.result.cookiesDone', {
              added: item.added,
              merged: item.merged,
              conflicts: item.conflictsResolved,
              unsupported: item.unsupported,
              skipped: item.skipped
            })
          )
          break
        case 'indexedDB':
          lines.push(
            t('chromeImport.result.indexedDbDone', {
              added: item.added,
              conflicts: item.conflictsResolved,
              unsupported: item.unsupported,
              skipped: item.skipped
            })
          )
          break
      }
    } else if (item.status === 'partial') {
      lines.push(
        t('chromeImport.result.partial', { scope: name, added: item.added, skipped: item.skipped })
      )
    } else if (item.status === 'unsupported') {
      lines.push(t('chromeImport.result.unsupported', { scope: name }))
    } else if (item.status === 'skipped') {
      lines.push(t('chromeImport.result.skipped', { scope: name }))
    } else if (item.reason === 'rollback-failed') {
      // 还原失败独立呈现（不与普通失败混同）：目标可能停在部分写入态，交人工核查
      lines.push(t('chromeImport.result.rollbackFailed', { scope: name }))
    } else {
      lines.push(
        item.reason !== undefined
          ? `${t('chromeImport.result.failedReason', { scope: name })}${reasonText(item.reason)}`
          : t('chromeImport.result.failed', { scope: name, error: item.error ?? '' })
      )
    }
  }
  return lines.join('\n')
}

/**
 * 失败弹框正文兜底映射（审查中-1）：域内自产错误（主进程 t() 产出的用户可见文案，
 * 以已知文案开头即认定——wrapLock 等包装层可携带后缀）原样透出；引擎错误
 * （ImportEngineError，含 sourceSnapshot/source-busy 等）为已本地化中文，原样透出；
 * 裸 fs 错误（EACCES/ENOSPC/EMFILE 等英文系统 message）统一替换为通用失败文案，避免
 * 英文直出弹框。原始错误留痕不受影响：调用方 rethrow 上浮 renderer、logFailure 主进程
 * 留痕均携带完整原始错误，本函数只影响弹框正文
 */
export function resolveDialogBody(error: unknown): string {
  if (error instanceof ImportEngineError) return error.message
  const raw = error instanceof Error ? error.message : String(error)
  // 已知文案集合 = 本文件 handler 与调用链（historySource/siteData/registry 静默窗口）
  // 实际会抛出的 t() 文案；failed 自身入集保持映射幂等。集合随语言现取（语言可切）
  const known = [
    t('chromeImport.errors.chromeLocked'),
    t('chromeImport.errors.planExpired'),
    t('chromeImport.errors.busy'),
    t('chromeImport.errors.invalidParams'),
    t('chromeImport.errors.profileNotFound'),
    t('chromeImport.errors.failed'),
    t('errors.sessionNotFound'),
    t('errors.sessionBusy')
  ]
  return known.some((message) => raw.startsWith(message)) ? raw : t('chromeImport.errors.failed')
}

/**
 * 原生结果/错误框（导入专项反馈轮改原生，渲染层 antd message 退役）：information 型
 * showMessageBox 单「确认」钮（common.confirm）、主窗窗口模态（主窗缺席静默跳过——macOS 关窗期间导入
 * 流程本就不可达，防御面）
 */
function showResultDialog(getMainWindow: () => BrowserWindow | null, body: string): void {
  const win = getMainWindow()
  if (!win || win.isDestroyed()) return
  void dialog
    .showMessageBox(win, {
      type: 'info',
      // 项目图标：darwin 原生框不传即显示 Electron 包角标（PRD 4.10 同款处置）
      icon: dialogIconForDarwin(),
      message: t('chromeImport.dialog.title'),
      // 显示面 clamp（审查低-4）：失败正文可能携带 fs 长路径，超限截断防弹框撑高
      detail: body.slice(0, DIALOG_BODY_MAX),
      buttons: [t('common.confirm')],
      noLink: true,
      cancelId: 0
    })
    .catch(() => undefined)
}
