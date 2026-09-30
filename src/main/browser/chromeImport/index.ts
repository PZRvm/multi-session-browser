// Chrome 浏览数据导入编排与 IPC（导入专项步骤 5，计划 20260930133553 第 3 节契约）：
// list-profiles 现取探测；dry-run 守卫 → 只读读取（historySource/siteData.dryRun）→
// 暂存（planId + 60s TTL 定时清理）→ 计划载荷；execute 取暂存 → registry.runImportQuiesced
// 静默窗口内写入（history.importEntries / siteData.execute）→ 逐 scope 汇总（分项独立：
// 一类失败不中断另一类，如实计数不伪造成功）。会话隔离不变量：写路径只经 registry 的
// partitionDir 单源与静默窗口原语触达目标分区，本文件不自行拼分区路径。
// 全部通道 invoke 零推送；载荷跨 IPC 边界一律先过运行时守卫（profileDir 白名单 =
// 探测枚举成员 + 路径分隔符拒绝的纵深防御）。同会话在途 dry-run/execute 单飞拒绝。

import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { mkdtemp } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { isRecord } from '../../../shared/guards'
import {
  CHROME_IMPORT_CHANNELS,
  CHROME_IMPORT_POLICIES,
  CHROME_IMPORT_SCOPES,
  type ChromeImportOptions,
  type ChromeImportPlan,
  type ChromeImportResult,
  type ChromeImportScope,
  type ChromeImportScopePlan,
  type ChromeImportScopeResult,
  type ChromeProfilesPayload
} from '../../../shared/chromeImport'
import { HISTORY_MAX_ENTRIES, type HistoryEntry } from '../../../shared/history'
import { SESSION_ID_RE } from '../../../shared/sessions'
import { t } from '../../i18n'
import { loadSnapshot } from '../../store'
import { logFailure } from '../../ipc-utils'
import type { SessionBrowserRegistry } from '../registry'
import type { ChromeSiteDataStats } from './siteData'
import { createChromeDetector, defaultChromeRootDir } from './detect'
import { createChromeHistorySource } from './historySource'
import { createChromeSiteDataMerge } from './siteData'

/** 暂存 TTL（计划 5.1）：过期 execute 报「导入准备已过期，请重新发起导入」 */
const STAGE_TTL_MS = 60_000

/** detect/historySource/siteData 装配（模块级单例，零状态或自持状态，通道层无感） */
const detector = createChromeDetector({ getRootDir: defaultChromeRootDir })
const historySource = createChromeHistorySource({
  makeTempDir: () => mkdtemp(join(tmpdir(), 'msb-chrome-import-'))
})
const siteData = createChromeSiteDataMerge({
  makeTempDir: () => mkdtemp(join(tmpdir(), 'msb-chrome-import-'))
})

/** dry-run 暂存：execute 的唯一合法输入（防陈旧导入——探测与写入之间的会话/profile 漂移） */
interface StagedImport {
  sessionId: string
  profileDir: string
  scopes: ChromeImportScope[]
  historyEntries: HistoryEntry[]
  /** localStorage scope 未勾选时为 null（勾选时恒有——dry-run 已算好冲突摘要） */
  lsStats: ChromeSiteDataStats | null
}

const staged = new Map<string, StagedImport>()
const stageTimers = new Map<string, ReturnType<typeof setTimeout>>()
/** 同会话在途单飞（dry-run 与 execute 共用判据）：对话框层有锁定，此处兜底防绕过 */
const inFlight = new Set<string>()

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

function armStagedTimer(planId: string): void {
  // TTL 到点整包作废；unref 防止退出被纯清理定时器拖住
  const timer = setTimeout(() => {
    stageTimers.delete(planId)
    staged.delete(planId)
  }, STAGE_TTL_MS)
  timer.unref?.()
  stageTimers.set(planId, timer)
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
    payload.profileDir.includes('/') ||
    payload.profileDir.includes('\\') ||
    payload.profileDir.includes('..')
  ) {
    throw invalidImportParams()
  }
  if (!Array.isArray(payload.scopes) || payload.scopes.length === 0) throw invalidImportParams()
  const selected = new Set<string>()
  for (const scope of payload.scopes) {
    if (typeof scope !== 'string' || !(CHROME_IMPORT_SCOPES as readonly string[]).includes(scope)) {
      throw invalidImportParams()
    }
    selected.add(scope)
  }
  return {
    sessionId: payload.sessionId,
    profileDir: payload.profileDir.trim(),
    scopes: CHROME_IMPORT_SCOPES.filter((scope) => selected.has(scope))
  }
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

export function registerChromeImportIpc(deps: {
  registry: SessionBrowserRegistry
  getPartitionDir: (sessionId: string) => string
}): void {
  // list-profiles：探测现取（毫秒级 fs 操作）；失败上抛（renderer 显示检测失败）
  ipcMain.handle(CHROME_IMPORT_CHANNELS.listProfiles, async (): Promise<ChromeProfilesPayload> =>
    logFailure(CHROME_IMPORT_CHANNELS.listProfiles, undefined, async () => detector.listProfiles())
  )

  // dry-run：会话存在性（读盘）→ profileDir 白名单复核（防探针绕过对话框直呼通道）→
  // 按 scopes 只读读取 → 暂存 → 计划载荷。全程零写入（Chrome 侧与目标分区两不在话下）
  ipcMain.handle(
    CHROME_IMPORT_CHANNELS.dryRun,
    async (_event, payload: unknown): Promise<ChromeImportPlan> =>
      logFailure(CHROME_IMPORT_CHANNELS.dryRun, payload, async () => {
        const options = parseOptions(payload)
        // 单飞判据与登记相邻同步（审查中-3）：判据与 add 之间隔 await 可被并发穿过
        if (inFlight.has(options.sessionId)) throw new Error(t('chromeImport.errors.busy'))
        inFlight.add(options.sessionId)
        try {
          const snapshot = await loadSnapshot()
          if (!snapshot.sessions.some((session) => session.id === options.sessionId)) {
            throw new Error(t('errors.sessionNotFound'))
          }
          const { profiles } = await detector.listProfiles()
          if (!profiles.some((profile) => profile.dir === options.profileDir)) {
            throw new Error(t('chromeImport.errors.profileNotFound'))
          }
          const profileDir = join(defaultChromeRootDir(), options.profileDir)
          const scopePlans: ChromeImportScopePlan[] = []
          let historyEntries: HistoryEntry[] = []
          let lsStats: ChromeSiteDataStats | null = null
          if (options.scopes.includes('history')) {
            historyEntries = await historySource.read(profileDir, HISTORY_MAX_ENTRIES)
            const existing = await deps.registry.history.getEntries(options.sessionId)
            const preview = previewHistoryMerge(existing, historyEntries)
            scopePlans.push({
              scope: 'history',
              total: preview.total,
              added: preview.added,
              merged: preview.merged,
              // 历史无冲突概念（静默 upsert，调研报告 5.1 定案）
              conflictKeys: 0,
              conflictOrigins: 0
            })
          }
          if (options.scopes.includes('localStorage')) {
            lsStats = await siteData.dryRun(profileDir, deps.getPartitionDir(options.sessionId))
            scopePlans.push({
              scope: 'localStorage',
              total: lsStats.total,
              added: lsStats.added,
              merged: lsStats.merged,
              conflictKeys: lsStats.conflictKeys,
              conflictOrigins: lsStats.conflictOrigins
            })
          }
          const planId = putStaged({
            sessionId: options.sessionId,
            profileDir,
            scopes: options.scopes,
            historyEntries,
            lsStats
          })
          return { planId, scopes: scopePlans }
        } finally {
          inFlight.delete(options.sessionId)
        }
      })
  )

  // execute：暂存消费（未知/过期一律 planExpired）→ 静默窗口内逐 scope 写入（分项独立
  // try/catch：一类失败不中断另一类）→ 未勾选 scope 补 skipped 行（renderer 反馈完整）
  ipcMain.handle(
    CHROME_IMPORT_CHANNELS.execute,
    async (_event, payload: unknown): Promise<ChromeImportResult> =>
      logFailure(CHROME_IMPORT_CHANNELS.execute, payload, async () => {
        if (!isRecord(payload) || typeof payload.planId !== 'string') throw invalidImportParams()
        if (
          typeof payload.localStoragePolicy !== 'string' ||
          !(CHROME_IMPORT_POLICIES as readonly string[]).includes(payload.localStoragePolicy)
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
          // 与分区 LS 半截目录的僵尸数据复活 + 对已删会话报成功（审查中-2）
          const snapshot = await loadSnapshot()
          if (!snapshot.sessions.some((session) => session.id === entry.sessionId)) {
            throw new Error(t('errors.sessionNotFound'))
          }
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
                    status: 'done',
                    added,
                    merged,
                    conflictsResolved: 0
                  })
                } catch (error) {
                  out.push(failedResult('history', error))
                }
              }
              if (entry.scopes.includes('localStorage') && entry.lsStats !== null) {
                try {
                  const applied = await siteData.execute(
                    entry.profileDir,
                    deps.getPartitionDir(entry.sessionId),
                    payload.localStoragePolicy as (typeof CHROME_IMPORT_POLICIES)[number]
                  )
                  out.push({
                    scope: 'localStorage',
                    status: 'done',
                    added: applied.added,
                    merged: applied.merged,
                    conflictsResolved: applied.conflictsResolved
                  })
                } catch (error) {
                  out.push(failedResult('localStorage', error))
                }
              }
              return out
            }
          )
          const results = [...written]
          for (const scope of CHROME_IMPORT_SCOPES) {
            if (entry.scopes.includes(scope)) continue
            results.push({
              scope,
              status: 'skipped',
              added: 0,
              merged: 0,
              conflictsResolved: 0
            })
          }
          return { results }
        } finally {
          inFlight.delete(entry.sessionId)
        }
      })
  )

  console.log('[chrome-import] IPC handlers 已注册（3 条通道）')
}

/** scope 级失败收敛：错误文案原样上浮（t() 中文错误或模块透传的 fs 错误，不静默不伪造） */
function failedResult(scope: ChromeImportScope, error: unknown): ChromeImportScopeResult {
  return {
    scope,
    status: 'failed',
    added: 0,
    merged: 0,
    conflictsResolved: 0,
    error: error instanceof Error ? error.message : String(error)
  }
}
