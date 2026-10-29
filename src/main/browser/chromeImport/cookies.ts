// Cookie 导入引擎（导入专项步骤 4，按 types.ts 冻结的 ImportEngine 三段契约实现）：
// prepare 在固定源副本上读库分类 + 口令解密，产出 ChromeImportScopePlan 与待写记录表
// 工件（明文只在主进程内存）；apply 经 Session.cookies 逐条写入并支持类型内精确回滚；
// dispose 清理工件（幂等）。
//
// 源侧（cookieSource/cookieCrypto 承担）：明文直入、v10 解密（Mac）、CHIPS/过期/未知
// 格式如实分类计数；授权拒绝/超时不拦整个导入（密文记录计入 unsupported，notes 携带
// auth-denied / auth-timeout——shared 契约「unsupported + notes 组合表达」口径）。
// 非 Mac 平台密文一律 encrypted-unsupported（计划 2.2：非 Mac 只支持有效明文）。
//
// 目标侧写入语义（计划契约 6 / 步骤 4 第 2 条）：
// - 身份 = (name, domain 形态, path, secure)——同名不同 path / host-only 与 domain 不混淆；
// - url 由 host_key + is_secure 推导（Secure 记录用 https，规避 Chromium 拒收「非安全源
//   设 Secure」）；host-only 不带 domain 字段、domain cookie 配 domain 字段（带前导点）；
// - 会话 Cookie 不设 expirationDate（不伪造持久期限）；samesite 显式映射（-1/0/1/2 →
//   unspecified/no_restriction/lax/strict）；
// - 冲突（同身份且值/属性不同）按 policy：'chrome' 覆盖 / 'session' 保留现值。
//
// 回滚（步骤 4 第 3 条）：apply 前对全部受影响 (url, name) 作用域组现取快照；任一写入
// 或 flush 失败 → 先排空已写组的现存成员（Session.cookies.remove 按 url+name 单删，
// 循环排空），再按快照逐条重设（只重设属于已写组的成员——未写组零触碰），最后对拍
// 每组现成员指纹与快照一致。绝不通过清空目标全部 Cookie 达成还原；还原结果如实进
// result.rolledBack（false = rollback-failed 语义独立上浮，不伪装成功）。
//
// prepare 对目标只做只读 get（计算 added/merged/conflicts 摘要——shared 契约要求按
// 目标现状归并口径），零写入零句柄落盘；真正写目标只发生在 apply（编排层静默窗口内）。
// 本模块依赖 Electron 仅限 Session / Cookie 类型（type-only import）。

import { join } from 'path'
import type { Cookie, CookiesSetDetails, Session } from 'electron'
import { rm } from 'fs/promises'
import type {
  ChromeImportReason,
  ChromeImportScopePlan,
  ChromeImportScopeResult
} from '../../../shared/chromeImport'
import type { ImportEngine, ImportEnginePrepare } from './types'
import { ImportEngineError } from './types'
import {
  CookieSourceError,
  createCookieSource,
  type ChromeCookieRow,
  type SourceCookieClassification,
  type WritableCookieRecord
} from './cookieSource'
import {
  KeychainAuthError,
  createMacKeychainPasswordGetter,
  deriveMacOsCryptKey,
  decryptV10Value,
  type SafeStoragePasswordGetter
} from './cookieCrypto'

/** cookieSource 读取器形态（默认实现为真实读取；测试可注入副本） */
export type CookieSourceReader = ReturnType<typeof createCookieSource>

/**
 * Cookie 引擎执行工件：records 为已解密的待写记录表（prepare 产出、apply 消费）；
 * unsupported/skipped/notes 为分类计数（apply 结果如实回填，不重复分类）。
 * tempDir 预留清理锚点（现行 readRows 用后即清，恒 null；dispose 防御性兜底）
 */
export interface CookieImportArtifacts {
  records: WritableCookieRecord[]
  /** 能力不支持数（CHIPS / 加密格式 / 解密失败 / 授权未获 / 属性行不可保真——不含过期） */
  unsupported: number
  /** 过期跳过数 */
  skipped: number
  notes: ChromeImportReason[]
  tempDir: string | null
}

/** 作用域组：一次 set 的 url + name——回滚排空/对拍的最小单位 */
interface CookieGroup {
  url: string
  name: string
}

/** 快照成员：Electron Cookie 原值 + 归一视图 + 所属作用域组（身份去重，跨组重叠共享） */
interface SnapshotEntry {
  cookie: Cookie
  view: CookieView
  groupKeys: Set<string>
}

/** 归一比较视图：身份键 + 语义属性（不含创建时间等 Electron API 不暴露的元数据） */
interface CookieView {
  identity: string
  value: string
  httpOnly: boolean
  sameSite: Cookie['sameSite']
  session: boolean
  expirationDate?: number
}

/** 回滚排空的单组上限（同 name 多 path/多 secure 形态的防御界，正常 ≤ 个位数） */
const DRAIN_LIMIT = 64
/** 过期时间比对容差（秒）：Electron 秒级浮点往返的舍入余量 */
const EXPIRY_TOLERANCE_SECONDS = 2

export function createCookieImportEngine(deps: {
  source: CookieSourceReader
  /** 口令获取器（Mac v10 解密用）；缺省用真实钥匙串获取器——测试注入已知口令的
   *  假实现，真实 Keychain 授权正例标注待操作 */
  getPassword?: SafeStoragePasswordGetter
  now?: () => number
}): ImportEngine<CookieImportArtifacts> {
  const now = deps.now ?? Date.now
  const getPassword = deps.getPassword ?? createMacKeychainPasswordGetter({})

  return {
    async prepare(context): Promise<ImportEnginePrepare<CookieImportArtifacts>> {
      let rows: ChromeCookieRow[] | null
      try {
        // 快照布局 = <snapshotRoot>/<profileDir>/（Cookies 或 Network/Cookies）——与
        // historySource/siteData/indexedDb 引擎同口径（2026-10-28 步骤 6 集成对齐）
        rows = await deps.source.readRows(join(context.snapshotRoot, context.profileDir))
      } catch (err) {
        if (err instanceof CookieSourceError) {
          throw new ImportEngineError(err.reason, err.message)
        }
        throw new ImportEngineError('io-error', `读取源 Cookie 库失败: ${describe(err)}`)
      }
      const nowMs = now()
      const records: WritableCookieRecord[] = []
      const recordByIdentity = new Map<string, WritableCookieRecord>()
      let unsupported = 0
      let skipped = 0
      const notes = new Set<ChromeImportReason>()
      const pendingEncrypted: Extract<SourceCookieClassification, { kind: 'v10-encrypted' }>[] = []
      if (rows !== null) {
        for (const row of rows) {
          const classified = deps.source.classifyRow(row, nowMs)
          switch (classified.kind) {
            case 'writable':
              putRecord(recordByIdentity, records, classified.record)
              break
            case 'v10-encrypted':
              pendingEncrypted.push(classified)
              break
            case 'expired':
              skipped += 1
              notes.add('expired')
              break
            case 'chips-partitioned':
              unsupported += 1
              notes.add('chips-partitioned')
              break
            case 'unsupported':
              unsupported += 1
              notes.add(
                classified.detail === 'encrypted-unsupported'
                  ? 'encrypted-unsupported'
                  : 'source-layout-unknown'
              )
              break
          }
        }
      }
      // 密文处置：Mac 解密 v10（口令获取失败 → 全部计入 unsupported + 授权原因码）；
      // 非 Mac 密文一律不支持（有效明文分支已在分类完成）
      if (pendingEncrypted.length > 0) {
        if (process.platform === 'darwin') {
          // 口令为钥匙串条目的原始字节（不必然是文本，字节直传 KDF——与 Chromium 语义
          // 一致；按文本解码会损坏密钥材料）
          let password: Uint8Array | null
          try {
            password = await getPassword()
          } catch (err) {
            if (err instanceof KeychainAuthError) {
              unsupported += pendingEncrypted.length
              notes.add(err.kind === 'timeout' ? 'auth-timeout' : 'auth-denied')
              password = null
            } else {
              throw new ImportEngineError('io-error', `获取钥匙串口令失败: ${describe(err)}`)
            }
          }
          if (password !== null) {
            let key: Uint8Array
            try {
              key = await deriveMacOsCryptKey(password)
            } catch (err) {
              throw new ImportEngineError('io-error', `派生解密密钥失败: ${describe(err)}`)
            }
            for (const item of pendingEncrypted) {
              try {
                const value = await decryptV10Value(item.encrypted, key, item.record.hostKey)
                putRecord(recordByIdentity, records, { ...item.record, value })
              } catch (err) {
                // 解密失败（填充校验未过——密钥不符或密文损坏）：如实计入不支持，不写密文
                unsupported += 1
                notes.add('encrypted-unsupported')
                console.warn(
                  `[chromeImport] Cookie 密文解密失败（host=${item.record.hostKey}），按不支持计数:`,
                  describe(err)
                )
              }
            }
          }
        } else {
          unsupported += pendingEncrypted.length
          notes.add('encrypted-unsupported')
        }
      }
      // 目标现状只读比对（plan 的 added/merged/conflicts 按目标现状归并口径）
      let added = 0
      let merged = 0
      let conflicts = 0
      const conflictHosts = new Set<string>()
      if (records.length > 0) {
        const targetCookies = await context.session.cookies.get({})
        const targetByIdentity = new Map<string, CookieView>()
        for (const cookie of targetCookies) {
          const view = cookieView(cookie)
          targetByIdentity.set(view.identity, view)
        }
        for (const record of records) {
          const view = recordView(record)
          const existing = targetByIdentity.get(view.identity)
          if (existing === undefined) added += 1
          else if (viewsEqual(existing, view)) merged += 1
          else {
            conflicts += 1
            conflictHosts.add(normalizeHost(record.hostKey))
          }
        }
      }
      const plan: ChromeImportScopePlan = {
        scope: 'cookies',
        unit: 'records',
        total: rows?.length ?? 0,
        added,
        merged,
        conflicts,
        conflictSites: conflictHosts.size,
        // plan 无 skipped 字段：过期与能力不支持同入 unsupported（shared 注释「已知不
        // 支持/将跳过」口径），execute 结果行再拆 unsupported / skipped
        unsupported: unsupported + skipped,
        notes: [...notes]
      }
      return {
        plan,
        artifacts: { records, unsupported, skipped, notes: [...notes], tempDir: null }
      }
    },

    async apply(context, artifacts, policy): Promise<ChromeImportScopeResult> {
      const session = context.session
      if (artifacts.records.length === 0) {
        return {
          scope: 'cookies',
          unit: 'records',
          status: artifacts.unsupported > 0 ? 'unsupported' : 'done',
          added: 0,
          merged: 0,
          conflictsResolved: 0,
          unsupported: artifacts.unsupported,
          skipped: artifacts.skipped
        }
      }
      // 1) 受影响作用域组与快照（apply 时点现取——不沿用 prepare 旧读数，目标漂移按
      //    当前真值处置；快照即回滚基线）
      const groups = new Map<string, CookieGroup>()
      for (const record of artifacts.records) {
        const group = groupOfRecord(record)
        groups.set(groupKeyOf(group), group)
      }
      let snapshotByIdentity: Map<string, SnapshotEntry>
      try {
        snapshotByIdentity = await collectSnapshot(session, groups)
      } catch (err) {
        return writeFailure(artifacts, true, `读取目标 Cookie 失败: ${describe(err)}`)
      }
      // 2) 逐条判定：缺失新增 / 语义相同合并不重写 / 冲突按 policy 覆盖或保留
      const plannedWrites: {
        details: CookiesSetDetails
        groupKey: string
        host: string
        name: string
        /** 计数归属（失败时按此扣减——add 失败扣 added、冲突覆盖失败扣 conflictsResolved） */
        intent: 'add' | 'conflict'
      }[] = []
      let added = 0
      let merged = 0
      let conflictsResolved = 0
      for (const record of artifacts.records) {
        const identity = identityOfParts(record.hostKey, record.path, record.name, record.secure)
        const existing = snapshotByIdentity.get(identity)
        if (existing === undefined) {
          plannedWrites.push({ ...toPlannedWrite(record), intent: 'add' })
          added += 1
        } else if (viewsEqual(existing.view, recordView(record))) {
          merged += 1
        } else {
          if (policy === 'chrome')
            plannedWrites.push({ ...toPlannedWrite(record), intent: 'conflict' })
          conflictsResolved += 1
        }
      }
      // 3) 执行写入 + 落盘冲刷。单条 set 失败按记录级如实计数后继续（2026-10-28 真实
      //    profile 实测修正：源库合法存在「同名同域同路径 Secure/非 Secure 并存」形态，
      //    Chromium cookie store 以 name+domain+path 为身份（secure 是属性），后写的非
      //    Secure 版会触发 EXCLUDE_OVERWRITE_SECURE 拒绝——此类形态按 unsupported 计
      //    数继续，不终止整类不回滚已写记录）；仅 flush（落盘）失败才类型内精确还原
      const writtenGroups = new Set<string>()
      const recordFailures: string[] = []
      let failedAdds = 0
      let failedConflicts = 0
      for (const write of plannedWrites) {
        try {
          await session.cookies.set(write.details)
          writtenGroups.add(write.groupKey)
        } catch (err) {
          recordFailures.push(`${write.host} ${write.name}: ${describe(err)}`)
          if (write.intent === 'add') failedAdds += 1
          else failedConflicts += 1
          console.warn(
            '[chromeImport] 单条 Cookie 写入失败，按不支持计数继续:',
            recordFailures.at(-1)
          )
        }
      }
      try {
        if (plannedWrites.length > 0 && writtenGroups.size > 0) await session.cookies.flushStore()
      } catch (err) {
        // 失败点定位：writtenGroups.size = 已成功写入条数，即失败条下标；全写完后
        // flush 失败时回退末条（消息仅用于诊断，不构成回滚依据）
        const failedIndex = Math.min(writtenGroups.size, plannedWrites.length - 1)
        const failedWrite = plannedWrites[failedIndex]
        const rolledBack = await rollbackWrites(session, groups, writtenGroups, snapshotByIdentity)
        return writeFailure(
          artifacts,
          rolledBack,
          `写入 Cookie 失败（host=${failedWrite?.host ?? '?'} name=${failedWrite?.name ?? '?'}）: ${describe(err)}`
        )
      }
      // 记录级失败计数：部分失败 → partial（added/conflicts 按意图扣减、失败条计入
      // unsupported，不伪装全成功也不回滚已写记录——「一条失败不中断另一条」分项独立）
      const failedCount = recordFailures.length
      const successWrites = plannedWrites.length - failedCount
      return {
        scope: 'cookies',
        unit: 'records',
        status:
          failedCount > 0 && successWrites > 0 ? 'partial' : failedCount > 0 ? 'failed' : 'done',
        added: added - failedAdds,
        merged,
        conflictsResolved: conflictsResolved - failedConflicts,
        unsupported: artifacts.unsupported + failedCount,
        skipped: artifacts.skipped
      }
    },

    async dispose(artifacts): Promise<void> {
      // 幂等：清空明文记录表（值只留内存的原则在生命周期终点兑现）；tempDir 防御性
      // 兜底清理（现行 readRows 用后即清，恒 null）
      artifacts.records.length = 0
      artifacts.notes.length = 0
      if (artifacts.tempDir !== null) {
        await rm(artifacts.tempDir, { recursive: true, force: true })
        artifacts.tempDir = null
      }
    }
  }
}

// —— 以下为模块内共享纯函数 ——

/** 记录入表（同身份重复行以后者为准——源库罕见形态，去重防双写） */
function putRecord(
  byIdentity: Map<string, WritableCookieRecord>,
  records: WritableCookieRecord[],
  record: WritableCookieRecord
): void {
  const identity = identityOfParts(record.hostKey, record.path, record.name, record.secure)
  const existing = byIdentity.get(identity)
  if (existing !== undefined) {
    const index = records.indexOf(existing)
    if (index >= 0) records.splice(index, 1)
  }
  byIdentity.set(identity, record)
  records.push(record)
}

/** hostKey → 无点 host（domain 形态剥前导点） */
function normalizeHost(hostKey: string): string {
  return hostKey.replace(/^\./, '')
}

/** 身份键：name | 域形态（=host 表示 host-only，.host 表示 domain）| path | secure */
function identityOfParts(hostKey: string, path: string, name: string, secure: boolean): string {
  const host = normalizeHost(hostKey)
  const domainForm = hostKey.startsWith('.') ? `.${host}` : `=${host}`
  return `${name}\u0000${domainForm}\u0000${path}\u0000${secure ? 's' : 'n'}`
}

/** Electron Cookie → 身份键（hostOnly 标记为 host-only 判据，前导点只作展示形态） */
function identityOfCookie(cookie: Cookie): string {
  const host = normalizeHost(cookie.domain ?? '')
  const domainForm = cookie.hostOnly === true ? `=${host}` : `.${host}`
  return `${cookie.name}\u0000${domainForm}\u0000${cookie.path ?? '/'}\u0000${cookie.secure === true ? 's' : 'n'}`
}

function cookieView(cookie: Cookie): CookieView {
  return {
    identity: identityOfCookie(cookie),
    value: cookie.value,
    httpOnly: cookie.httpOnly === true,
    sameSite: cookie.sameSite,
    session: cookie.session === true,
    expirationDate: cookie.expirationDate
  }
}

function recordView(record: WritableCookieRecord): CookieView {
  return {
    identity: identityOfParts(record.hostKey, record.path, record.name, record.secure),
    value: record.value,
    httpOnly: record.httpOnly,
    sameSite: record.sameSite,
    session: record.expirationDate === undefined,
    expirationDate: record.expirationDate
  }
}

/** 语义等价判定（值 + httpOnly + sameSite + 会话性 + 过期时间容差内） */
function viewsEqual(a: CookieView, b: CookieView): boolean {
  if (a.value !== b.value) return false
  if (a.httpOnly !== b.httpOnly) return false
  if (a.sameSite !== b.sameSite) return false
  if (a.session !== b.session) return false
  if (!a.session) {
    const diff = Math.abs((a.expirationDate ?? 0) - (b.expirationDate ?? 0))
    if (diff > EXPIRY_TOLERANCE_SECONDS) return false
  }
  return true
}

/**
 * 记录 → set 作用域组（url 推导：Secure 用 https；domain cookie 的 host 取无点域）。
 * url 必须携带记录 path：get/remove 按 url 匹配时 Cookie 只在「会被发给该 url」时
 * 可见（path 前缀匹配）——不带 path 的 url 漏看非根 path 的同名 Cookie（端到端
 * T14 实测踩坑：/sub Cookie 在自身组内被判缺失而误判新增）
 */
function groupOfRecord(record: WritableCookieRecord): CookieGroup {
  const scheme = record.secure ? 'https' : 'http'
  const host = normalizeHost(record.hostKey)
  const path = record.path.startsWith('/') ? record.path : '/'
  return { url: `${scheme}://${host}${path}`, name: record.name }
}

function groupKeyOf(group: CookieGroup): string {
  return `${group.url}\u0000${group.name}`
}

/** 记录 → set 参数（host-only 不带 domain；domain cookie 配带点 domain；会话不带过期） */
function toPlannedWrite(record: WritableCookieRecord): {
  details: CookiesSetDetails
  groupKey: string
  host: string
  name: string
} {
  const group = groupOfRecord(record)
  const details: CookiesSetDetails = {
    url: group.url,
    name: record.name,
    value: record.value,
    path: record.path,
    secure: record.secure,
    httpOnly: record.httpOnly,
    sameSite: record.sameSite,
    domain: record.hostKey.startsWith('.') ? record.hostKey : undefined,
    expirationDate: record.expirationDate
  }
  return {
    details,
    groupKey: groupKeyOf(group),
    host: normalizeHost(record.hostKey),
    name: record.name
  }
}

/** 快照 Cookie → 重设参数（回滚恢复用——属性按快照原值，不猜不补） */
function cookieToSetDetails(cookie: Cookie): CookiesSetDetails {
  const host = normalizeHost(cookie.domain ?? '')
  const scheme = cookie.secure === true ? 'https' : 'http'
  return {
    url: `${scheme}://${host}`,
    name: cookie.name,
    value: cookie.value,
    path: cookie.path ?? '/',
    secure: cookie.secure === true,
    httpOnly: cookie.httpOnly === true,
    sameSite: cookie.sameSite,
    domain: cookie.hostOnly === true ? undefined : `.${host}`,
    expirationDate: cookie.session === true ? undefined : cookie.expirationDate
  }
}

/** 现取全部受影响作用域组的快照（按身份去重；跨组重叠成员共享条目并记组归属） */
async function collectSnapshot(
  session: Session,
  groups: Map<string, CookieGroup>
): Promise<Map<string, SnapshotEntry>> {
  const snapshot = new Map<string, SnapshotEntry>()
  for (const [key, group] of groups) {
    const found = await session.cookies.get({ url: group.url, name: group.name })
    for (const cookie of found) {
      const identity = identityOfCookie(cookie)
      const entry = snapshot.get(identity)
      if (entry === undefined) {
        snapshot.set(identity, { cookie, view: cookieView(cookie), groupKeys: new Set([key]) })
      } else {
        entry.groupKeys.add(key)
      }
    }
  }
  return snapshot
}

/**
 * 精确回滚：排空已写组 → 重设快照中属于已写组的成员 → 对拍每组指纹。返回是否还原
 * 成功（false = rollback-failed 语义，独立上浮）。未写任何组时目标即原状，恒 true。
 */
async function rollbackWrites(
  session: Session,
  groups: Map<string, CookieGroup>,
  writtenGroups: Set<string>,
  snapshotByIdentity: Map<string, SnapshotEntry>
): Promise<boolean> {
  if (writtenGroups.size === 0) return true
  try {
    for (const key of writtenGroups) {
      const group = groups.get(key)
      if (group === undefined) return false
      for (let round = 0; round < DRAIN_LIMIT; round += 1) {
        const found = await session.cookies.get({ url: group.url, name: group.name })
        if (found.length === 0) break
        await session.cookies.remove(group.url, group.name)
      }
      const after = await session.cookies.get({ url: group.url, name: group.name })
      if (after.length > 0) return false
    }
    for (const entry of snapshotByIdentity.values()) {
      let belongs = false
      for (const key of entry.groupKeys) {
        if (writtenGroups.has(key)) {
          belongs = true
          break
        }
      }
      if (!belongs) continue
      await session.cookies.set(cookieToSetDetails(entry.cookie))
    }
    // 对拍：已写组现成员指纹集 == 该组快照成员指纹集
    for (const key of writtenGroups) {
      const group = groups.get(key)
      if (group === undefined) return false
      const found = await session.cookies.get({ url: group.url, name: group.name })
      const current = new Set(found.map(fingerprintOfCookie))
      const expected = new Set<string>()
      for (const entry of snapshotByIdentity.values()) {
        if (entry.groupKeys.has(key)) expected.add(fingerprintOfCookie(entry.cookie))
      }
      if (current.size !== expected.size) return false
      for (const item of current) {
        if (!expected.has(item)) return false
      }
    }
    // 还原后尽力冲刷（失败不改变内存态还原事实，仅告警——磁盘态交由后续冲刷收敛）
    try {
      await session.cookies.flushStore()
    } catch (err) {
      console.warn('[chromeImport] 回滚后冲刷 Cookie 存储失败（内存态已还原）:', err)
    }
    return true
  } catch (err) {
    console.warn('[chromeImport] Cookie 回滚过程出错（还原未完成）:', err)
    return false
  }
}

/** 对拍指纹：身份 + 值 + 语义属性（秒级过期容差取整） */
function fingerprintOfCookie(cookie: Cookie): string {
  const identity = identityOfCookie(cookie)
  const expiry = cookie.session === true ? '-' : String(Math.round(cookie.expirationDate ?? 0))
  return `${identity}\u0001${cookie.value}\u0001${cookie.httpOnly === true}\u0001${cookie.sameSite}\u0001${cookie.session === true}\u0001${expiry}`
}

/** 写入失败结果行（计数清零——已还原时成功计数不得残留；rolledBack 如实回报） */
function writeFailure(
  artifacts: CookieImportArtifacts,
  rolledBack: boolean,
  message: string
): ChromeImportScopeResult {
  return {
    scope: 'cookies',
    unit: 'records',
    status: 'failed',
    added: 0,
    merged: 0,
    conflictsResolved: 0,
    unsupported: artifacts.unsupported,
    skipped: artifacts.skipped,
    reason: 'io-error',
    rolledBack,
    error: message
  }
}

/** 错误描述脱敏：只留错误名与消息（本链路错误源不含 Cookie 值/密钥/密文，防御性截断） */
function describe(err: unknown): string {
  const raw = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
  return raw.slice(0, 200)
}
