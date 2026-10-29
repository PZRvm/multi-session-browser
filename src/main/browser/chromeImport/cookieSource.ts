// Chrome Cookie 源读取与行级分类（导入专项步骤 4，契约 src/main/browser/chromeImport/
// types.ts 与 src/shared/chromeImport.ts；格式事实出自步骤 1 技术验证 §2——
// notes/accept/20261028112040-…/20261028123936-步骤1技术验证记录.md）：
// 把 profile 下的 Cookies SQLite 拷贝到临时区只读打开（historySource.ts 先例：Chrome
// 运行中直连撞锁、边读边变更撕裂，拷贝副本读快照），映射为行对象并做零副作用分类
// （CHIPS 分区 / 已过期 / 加密格式 / 可写记录）。
//
// 布局兼容：Cookies 库在 `<profile>/Cookies`（本机 Chrome 156 实测）或
// `<profile>/Network/Cookies`（部分版本），二者择一存在即用；两处都缺 = 该 profile
// 无 Cookie 库（Guest 等衍生形态），按空源返回 null 不拦整体导入（historySource
// ENOENT 同口径）。本模块只识别格式不做解密（解密与口令获取在 cookieCrypto.ts /
// cookies.ts 组合）。
//
// 时间戳为 1601 元年微秒、超 JS 安全整数：node:sqlite 以 readBigInts 打开后整列
// bigint，先整除到毫秒再转 Number（historySource.webkitToUnixMs 同坑同解）。
//
// 本模块不 import electron（纯 Node 可测，临时目录经 deps 注入——history.ts 先例；
// 副本用后即清，临时区不留含密文的源库拷贝）。异常脱敏：错误信息只含路径与原因，
// 不含 Cookie 值 / 密文 / 密钥。

import { copyFile, rm, stat } from 'fs/promises'
import { hasV10Prefix } from './cookieCrypto'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'path'

/** Cookie 引擎可写入目标的记录形态（value 为明文——待写记录表工件的最小单元）。
 *  hostKey 原样保留源库形态：host-only 无前导点、domain cookie 带前导点（步骤 1 §2.1
 *  实测编码）；expirationDate 为 Unix 秒，缺省 = 会话 Cookie（不伪造过期时间） */
export interface WritableCookieRecord {
  name: string
  value: string
  hostKey: string
  path: string
  secure: boolean
  httpOnly: boolean
  sameSite: 'unspecified' | 'no_restriction' | 'lax' | 'strict'
  expirationDate?: number
}

/** 行级分类结果（零副作用纯数据；解密在 cookies.ts 编排，此处只识别格式） */
export type SourceCookieClassification =
  /** 有效明文（value 列直填，含空串值），属性可保真，直接可写 */
  | { kind: 'writable'; record: WritableCookieRecord }
  /** v10 密文（Mac os_crypt 已验证格式），待 cookies.ts 取密钥解密成 writable */
  | { kind: 'v10-encrypted'; encrypted: Uint8Array; record: Omit<WritableCookieRecord, 'value'> }
  /** expires_utc 已过（has_expires=1 且换算已过当前时刻）——跳过计数 */
  | { kind: 'expired' }
  /** top_frame_site_key 非空（CHIPS 分区 Cookie）——不能降级为普通 Cookie */
  | { kind: 'chips-partitioned' }
  /** 不支持：加密格式非受支持格式（未知前缀——非 Mac 平台的密文由调用方按平台判），
   *  或单行属性无法保真（未知 samesite 值、SameSite=None 非 Secure、host 非法） */
  | { kind: 'unsupported'; detail: 'encrypted-unsupported' | 'unrepresentable' }

/** 源库单行（node:sqlite 读取后的归一形态；expiresUsec 恒 bigint） */
export interface ChromeCookieRow {
  hostKey: string
  topFrameSiteKey: string
  name: string
  value: string
  encryptedValue: Uint8Array
  path: string
  expiresUsec: bigint
  isSecure: boolean
  isHttpOnly: boolean
  hasExpires: boolean
  isPersistent: boolean
  sameSiteInt: number
}

/** 源侧错误（cookies.ts 捕获后映射为 ImportEngineError 的同码原因）：
 *  - source-busy：拷贝遇文件锁（EBUSY/EPERM）——源 Chrome 未处可靠快照态
 *  - io-error：其他文件系统错误
 *  - source-layout-unknown：库存在但 cookies 表/必需列缺失、schema 版本新于已验证
 *    格式、或库文件按 SQLite 无法打开 */
export class CookieSourceError extends Error {
  constructor(
    public readonly reason: 'source-busy' | 'io-error' | 'source-layout-unknown',
    message: string
  ) {
    super(message)
    this.name = 'CookieSourceError'
  }
}

/** Cookies 库候选布局（根目录优先、Network/ 兜底；常态只有一处存在） */
const COOKIE_DB_REL_PATHS = ['Cookies', join('Network', 'Cookies')] as const

/** 本实现已验证的 schema 版本上限（步骤 1 实测 meta.version=24；更高版本的格式变更
 *  未经验证，整源拒绝不赌兼容——IndexedDB 步骤 1 同款版本门禁逻辑） */
const KNOWN_SCHEMA_VERSION_MAX = 24

/** 分类所需列的闭集（缺失即 source-layout-unknown；非全列清单——其余列不消费） */
const REQUIRED_COLUMNS = [
  'host_key',
  'top_frame_site_key',
  'name',
  'value',
  'encrypted_value',
  'path',
  'expires_utc',
  'is_secure',
  'is_httponly',
  'has_expires',
  'is_persistent',
  'samesite'
]

/** samesite 整数 → Electron sameSite 语汇（§2.1 实测：-1 未指定 / 0 None / 1 Lax /
 *  2 Strict）；null = 未知值，无法保真 */
function mapSameSiteInt(value: number): WritableCookieRecord['sameSite'] | null {
  switch (value) {
    case -1:
      return 'unspecified'
    case 0:
      return 'no_restriction'
    case 1:
      return 'lax'
    case 2:
      return 'strict'
    default:
      return null
  }
}

/** 1601 元年微秒 → Unix 毫秒（historySource.webkitToUnixMs 同款换算，bigint 输入版） */
function webkitUsecToUnixMs(usec: bigint): number {
  return Number(usec / 1000n) - 11644473600000
}

/** 行是否已过期：仅持久 Cookie（has_expires=1 且 is_persistent=1）参与判定；会话
 *  Cookie（§2.4 落盘形态 has_expires=0 / is_persistent=0）无过期语义，永不判过期 */
function isExpiredRow(row: ChromeCookieRow, nowMs: number): boolean {
  if (!row.hasExpires || !row.isPersistent) return false
  return webkitUsecToUnixMs(row.expiresUsec) <= nowMs
}

/**
 * host 校验：以「构不成 scheme://host URL」为唯一判据（不引入域名白名单语义——
 * host_key 由 Chrome 写入，常规必然合法，此处只挡损坏行）。host-only 无前导点 /
 * domain 带前导点两种形态均可（前导点仅作 cookie 形态标记，剥除后校验）。
 */
function isValidHostKey(hostKey: string): boolean {
  if (hostKey === '' || hostKey === '.') return false
  const host = hostKey.replace(/^\./, '')
  try {
    return new URL(`https://${host}`).hostname === host.toLowerCase()
  } catch {
    return false
  }
}

/** 路径存在性（仅 ENOENT 视为不存在，其余错误如实上抛） */
async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw err
  }
}

/** 拷贝单文件：可选伴随文件缺位视为正常；文件锁（EBUSY/EPERM）按 source-busy 上浮 */
async function copyWithLockGuard(src: string, dst: string, optional: boolean): Promise<void> {
  try {
    await copyFile(src, dst)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (optional && code === 'ENOENT') return
    if (code === 'EBUSY' || code === 'EPERM') {
      throw new CookieSourceError('source-busy', `源 Cookie 库被占用，无法形成可靠快照: ${src}`)
    }
    throw new CookieSourceError('io-error', `拷贝源 Cookie 库失败（${code ?? '未知错误'}）: ${src}`)
  }
}

export function createCookieSource(deps: { makeTempDir: () => Promise<string> }): {
  /** 只读读取源目录的 Cookies 库全部行；两种布局都缺返回 null（空源） */
  readRows(sourceDir: string): Promise<ChromeCookieRow[] | null>
  /** 单行分类（纯函数）：CHIPS → 过期 → 属性可保真 → 明文/密文格式，不做解密 */
  classifyRow(row: ChromeCookieRow, nowMs: number): SourceCookieClassification
} {
  async function readRows(sourceDir: string): Promise<ChromeCookieRow[] | null> {
    let dbPath: string | null = null
    for (const rel of COOKIE_DB_REL_PATHS) {
      const candidate = join(sourceDir, rel)
      if (await pathExists(candidate)) {
        dbPath = candidate
        break
      }
    }
    if (dbPath === null) return null
    const tempDir = await deps.makeTempDir()
    try {
      const dbCopy = join(tempDir, 'Cookies')
      await copyWithLockGuard(dbPath, dbCopy, false)
      for (const suffix of ['-journal', '-wal', '-shm']) {
        await copyWithLockGuard(`${dbPath}${suffix}`, `${dbCopy}${suffix}`, true)
      }
      return readRowsFromCopy(dbCopy)
    } finally {
      // 副本含密文源数据，用后即清不留痕（historySource 同款）
      await rm(tempDir, { recursive: true, force: true })
    }
  }

  function classifyRow(row: ChromeCookieRow, nowMs: number): SourceCookieClassification {
    // CHIPS 分区 Cookie：Electron Cookie API 无分区维度，降级为普通 Cookie 会改写
    // 作用域语义——单列不支持（计划契约 6）
    if (row.topFrameSiteKey !== '') return { kind: 'chips-partitioned' }
    // 过期判定先于解密/明文分支（过期的密文记录不值得投入解密，也必须跳过计数）
    if (isExpiredRow(row, nowMs)) return { kind: 'expired' }
    // 属性可保真检查（明文与密文共用）：未知 samesite / None 非 Secure（Chromium
    // 拒收该组合）/ 损坏 host —— 如实计入 unsupported，不硬造近似值
    const sameSite = mapSameSiteInt(row.sameSiteInt)
    if (sameSite === null) return { kind: 'unsupported', detail: 'unrepresentable' }
    if (sameSite === 'no_restriction' && !row.isSecure) {
      return { kind: 'unsupported', detail: 'unrepresentable' }
    }
    if (!isValidHostKey(row.hostKey)) return { kind: 'unsupported', detail: 'unrepresentable' }
    const isSession = !row.hasExpires || !row.isPersistent
    const expiresMs = webkitUsecToUnixMs(row.expiresUsec)
    const base = {
      name: row.name,
      hostKey: row.hostKey,
      path: row.path === '' ? '/' : row.path,
      secure: row.isSecure,
      httpOnly: row.isHttpOnly,
      sameSite,
      // 会话 Cookie 不携带过期时间——不伪造持久期限（计划契约 6）
      expirationDate: isSession ? undefined : Math.floor(expiresMs / 1000)
    }
    // 加密记录：encrypted_value 非空即走密文分支（加密形态下 value 列恒空，§2.1；
    // 明文分支为非 Mac 平台/旧数据的兼容保留路径）
    if (row.encryptedValue.length > 0) {
      if (hasV10Prefix(row.encryptedValue)) {
        return { kind: 'v10-encrypted', encrypted: row.encryptedValue, record: base }
      }
      return { kind: 'unsupported', detail: 'encrypted-unsupported' }
    }
    // 有效明文（含空串值——明文 cookie 的合法形态）
    return { kind: 'writable', record: { ...base, value: row.value } }
  }

  return { readRows, classifyRow }
}

/** 从拷贝副本只读读取全部行（schema 门禁：必需列齐备 + meta.version ≤ 已验证版本） */
function readRowsFromCopy(dbCopy: string): ChromeCookieRow[] {
  let db: DatabaseSync
  try {
    db = new DatabaseSync(dbCopy, { readOnly: true, readBigInts: true })
  } catch (err) {
    if (err instanceof CookieSourceError) throw err
    throw new CookieSourceError(
      'source-layout-unknown',
      `源 Cookie 库无法按 SQLite 打开: ${dbCopy}`
    )
  }
  try {
    assertKnownSchema(db)
    const rows = db
      .prepare(
        `SELECT host_key, top_frame_site_key, name, value, encrypted_value, path,
                expires_utc, is_secure, is_httponly, has_expires, is_persistent, samesite
         FROM cookies`
      )
      .all() as Record<string, unknown>[]
    return rows.map(toRow)
  } catch (err) {
    if (err instanceof CookieSourceError) throw err
    // 查询/读取期错误（坏库、SQLite 异常）统一按格式无法识别拒绝，不猜格式
    throw new CookieSourceError(
      'source-layout-unknown',
      `源 Cookie 库无法按已验证格式读取: ${dbCopy}`
    )
  } finally {
    db.close()
  }
}

/** schema 门禁：meta.version 新于已验证版本（24）或必需列缺失 → 整源拒绝 */
function assertKnownSchema(db: DatabaseSync): void {
  let version: number | null = null
  try {
    const meta = db.prepare('SELECT value FROM meta WHERE key = ?').get('version') as
      { value: unknown } | undefined
    if (meta !== undefined) {
      const parsed = Number(meta.value)
      version = Number.isFinite(parsed) ? parsed : null
    }
  } catch {
    version = null // meta 表缺失（异常库）：仅靠列清单门禁兜底
  }
  if (version !== null && version > KNOWN_SCHEMA_VERSION_MAX) {
    throw new CookieSourceError(
      'source-layout-unknown',
      `源 Cookie 库 schema 版本 ${version} 新于已验证版本 ${KNOWN_SCHEMA_VERSION_MAX}`
    )
  }
  let columns: { name: unknown }[]
  try {
    columns = db.prepare('PRAGMA table_info(cookies)').all() as { name: unknown }[]
  } catch {
    columns = []
  }
  const present = new Set(columns.map((col) => String(col.name)))
  for (const column of REQUIRED_COLUMNS) {
    if (!present.has(column)) {
      throw new CookieSourceError(
        'source-layout-unknown',
        `源 Cookie 库缺必需列 ${column}，格式未经验证`
      )
    }
  }
}

/** SQLite 行 → 归一形态（防御性兜底：NULL/异型按空值/0 处理，不拦整体读取） */
function toRow(raw: Record<string, unknown>): ChromeCookieRow {
  const sameSiteRaw = Number(raw.samesite)
  return {
    hostKey: typeof raw.host_key === 'string' ? raw.host_key : '',
    topFrameSiteKey: typeof raw.top_frame_site_key === 'string' ? raw.top_frame_site_key : '',
    name: typeof raw.name === 'string' ? raw.name : '',
    value: typeof raw.value === 'string' ? raw.value : '',
    encryptedValue:
      raw.encrypted_value instanceof Uint8Array ? raw.encrypted_value : new Uint8Array(0),
    path: typeof raw.path === 'string' ? raw.path : '/',
    expiresUsec: typeof raw.expires_utc === 'bigint' ? raw.expires_utc : BigInt(0),
    isSecure: Number(raw.is_secure) !== 0,
    isHttpOnly: Number(raw.is_httponly) !== 0,
    hasExpires: Number(raw.has_expires) !== 0,
    isPersistent: Number(raw.is_persistent) !== 0,
    sameSiteInt: Number.isFinite(sameSiteRaw) ? sameSiteRaw : -1
  }
}
