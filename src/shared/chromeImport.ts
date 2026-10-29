// Chrome 浏览数据导入共享契约（主进程 / preload / renderer 三方共用）。
// 契约冻结于 notes/plans/20260930133553-导入Chrome浏览数据开发计划.md 第 3 节；
// 2026-10-28 站点数据导入专项（notes/plans/20261028112040）第 3 节冻结四类型契约：
// scopes 扩为 history / localStorage / cookies / indexedDB，冲突裁决收敛为同次导入
// 单一 policy（原 localStoragePolicy 退役），计数带单位（records / sites），新增
// cancel 通道与闭集原因码。数据格式与可行性依据见
// notes/think-report/20261028105514-Chrome登录态与站点存储导入可行性.md 及其步骤 1
// 证据节（notes/accept/20261028112040-…/20261028123936-步骤1技术验证记录.md）。
//
// 语义（用户裁决 2026-09-30 / 2026-10-28）：会话级一次性导入本机 Chrome 所选 profile
// 的勾选内容。历史静默 upsert 不弹窗（同 url 访问数取大、时间取新）；localStorage /
// cookies 按受支持记录处置冲突；indexedDB 以站点存储完整快照为裁决单位。冲突时弹窗
// 按会话一次二选一（以 Chrome 为准 / 以当前会话为准，policy 作用于同次导入全部冲突
// 类型）。两段式导入：dry-run 只读探测 + 暂存（planId + TTL），execute 消费暂存写入；
// cancel 清尚未执行的暂存。新类型（cookies / indexedDB）在对应引擎接入前不在选择
// 界面出现（可用 scope 集由主进程按引擎就绪度给出），不占位宣称成功。
// 会话隔离不变量：导入只写目标会话分区，零跨会话触达；导入窗口期由 registry
// runImportQuiesced 拦截切换/克隆/删除。
// 类型只是编译期约定——跨 IPC 边界的运行时守卫在 main 侧落实（chromeImport/index.ts）。

/** 导入域通道（浏览器域语系的独立常量对象，不并入 BROWSER_CHANNELS 本体——shared/history.ts 先例） */
export const CHROME_IMPORT_CHANNELS = {
  /** 枚举本机 Chrome（默认用户数据目录）的 profile 列表 */
  listProfiles: 'chrome-import:list-profiles',
  /** 只读探测：按所选 profile 与内容勾选读取 Chrome 数据，返回按类型/单位的摘要并暂存 */
  dryRun: 'chrome-import:dry-run',
  /** 执行导入：消费暂存 + 冲突裁决，真正写入目标会话分区 */
  execute: 'chrome-import:execute',
  /** 取消：清尚未执行的暂存计划（释放快照等暂存资源）；写盘中的 execute 不可被取消 */
  cancel: 'chrome-import:cancel'
} as const

/**
 * 单个 Chrome profile：dir 为用户数据目录下的子目录名（'Default' / 'Profile N'），
 * name 为 Local State `profile.info_cache` 的显示名（解析失败回退目录名）
 */
export interface ChromeProfileInfo {
  dir: string
  name: string
}

/** list-profiles 载荷：detected=false 表示默认目录未找到 Chrome（含已安装但从未运行/无任何 profile） */
export interface ChromeProfilesPayload {
  detected: boolean
  profiles: ChromeProfileInfo[]
}

/**
 * 导入内容闭集（2026-10-28 扩为四值）：
 * - history / localStorage：既有语义（记录级合并，冲突仅 localStorage）
 * - cookies：源库受支持记录（Mac 经系统授权解密；不支持/解密失败如实计数）
 * - indexedDB：站点存储完整快照（.leveldb + .blob 成对目录，schema 版本兼容门禁）
 * 冲突概念：localStorage/cookies 为记录冲突，indexedDB 为目标已有同名站点快照
 */
export const CHROME_IMPORT_SCOPES = ['history', 'localStorage', 'cookies', 'indexedDB'] as const
export type ChromeImportScope = (typeof CHROME_IMPORT_SCOPES)[number]

/** scope → 展示文案字典键的单源映射（主进程结果框与 sheet 页面各自用本侧 t() 取词，
 *  新增 scope 只改这里 + 字典——审查 20261028170000 低-4） */
export function chromeImportScopeLabelKey(scope: ChromeImportScope): string {
  switch (scope) {
    case 'history':
      return 'chromeImport.dialog.scopeHistory'
    case 'localStorage':
      return 'chromeImport.dialog.scopeLocalStorage'
    case 'cookies':
      return 'chromeImport.dialog.scopeCookies'
    case 'indexedDB':
      return 'chromeImport.dialog.scopeIndexedDB'
  }
}

/** dry-run 载荷（renderer → main）：sessionId 必过 SESSION_ID_RE，profileDir 必须出自 list-profiles 枚举 */
export interface ChromeImportOptions {
  sessionId: string
  profileDir: string
  scopes: ChromeImportScope[]
}

/**
 * 计数单位（统计只反映真正结果，单位不可混用）：
 * - records：history / localStorage / cookies 的记录条数
 * - sites：indexedDB 的站点快照数（站点数不得冒充记录数）
 */
export type ChromeImportCountUnit = 'records' | 'sites'

/**
 * 闭集原因码（dry-run 摘要与 execute 结果共用；主进程按码组装既有语言的结果文案，
 * 不新造自由文本）：
 * - expired：源记录已过期（如过期 Cookie）
 * - encrypted-unsupported：源加密格式不支持（非 Mac 平台应用绑定加密 / 未知密文前缀）
 * - auth-denied / auth-timeout：系统钥匙串授权被拒 / 等待授权超时
 * - chips-partitioned：CHIPS 分区 Cookie（不能降级为普通 Cookie）
 * - source-version-newer：源 IndexedDB schema 版本新于目标引擎支持（整站点拒绝）
 * - source-layout-unknown：源布局/格式无法识别
 * - source-busy：源 Chrome 数据未处可靠快照态（文件占用/不一致）
 * - target-locked：目标静默窗口无法建立（会话被占用）
 * - target-changed：确认后目标已漂移，须重新探测
 * - io-error：文件系统错误
 * - cancelled：用户取消
 * - ttl-expired / plan-unknown：暂存过期 / planId 未知
 * - rollback-failed：失败还原未成功（独立报告，不得与普通失败混同）
 */
export const CHROME_IMPORT_REASONS = [
  'expired',
  'encrypted-unsupported',
  'auth-denied',
  'auth-timeout',
  'chips-partitioned',
  'source-version-newer',
  'source-layout-unknown',
  'source-busy',
  'target-locked',
  'target-changed',
  'io-error',
  'cancelled',
  'ttl-expired',
  'plan-unknown',
  'rollback-failed'
] as const
export type ChromeImportReason = (typeof CHROME_IMPORT_REASONS)[number]

/**
 * 单 scope 探测摘要（dry-run 产出，冲突裁决 sheet 的权威数据源——由主进程按 planId
 * 从暂存现取，renderer 不自报破坏范围）：total = 读到的源条目/站点数；added/merged =
 * 预计新增/合并数（按目标侧现状归并口径计算）；conflicts = 该 scope 单位下的冲突数
 * （localStorage/cookies 记录数、indexedDB 站点数）；conflictSites = 冲突涉及的
 * 站点/域数（冲突 >0 时有意义）；unsupported = 源侧已知不支持/将跳过的条目或站点数
 * （如 CHIPS、非 Mac 加密记录、schema 过新站点）；notes = 该 scope 的提示性原因码
 * （能力事实，如 mac-auth-required 场景由 unsupported + notes 组合表达）
 */
export interface ChromeImportScopePlan {
  scope: ChromeImportScope
  unit: ChromeImportCountUnit
  total: number
  added: number
  merged: number
  conflicts: number
  conflictSites: number
  unsupported: number
  notes: ChromeImportReason[]
}

/** dry-run 返回：planId 供 execute/cancel 消费（主进程内存暂存 60s TTL，过期/未知一律拒绝） */
export interface ChromeImportPlan {
  planId: string
  scopes: ChromeImportScopePlan[]
}

/** 冲突裁决闭集（会话级一次二选一——同次导入全部冲突类型共用，2026-10-28 由
 * localStoragePolicy 收敛为 policy：'chrome' = 冲突以源为准覆盖 / 'session' = 保留目标现值） */
export const CHROME_IMPORT_POLICIES = ['chrome', 'session'] as const
export type ChromeImportPolicy = (typeof CHROME_IMPORT_POLICIES)[number]

/** execute 载荷：policy = 同次导入全部冲突类型的统一裁决 */
export interface ChromeImportResolution {
  planId: string
  policy: ChromeImportPolicy
}

/** cancel 载荷与返回 */
export interface ChromeImportCancelPayload {
  planId: string
}
export interface ChromeImportCancelResult {
  /** true = 命中并清除了暂存计划；false = 无此计划（已消费/已过期/已取消），非错误 */
  cancelled: boolean
}

/** 单 scope 执行结果状态闭集：done 全部成功 / partial 部分成功（类型内失败已还原，
 * 计数如实）/ skipped 未勾选或整体未执行 / failed 整类失败（已还原时计数为 0 并附
 * rolledBack）/ unsupported 整类不支持（引擎未接入或源格式全不支持） */
export type ChromeImportScopeResultStatus =
  'done' | 'partial' | 'skipped' | 'failed' | 'unsupported'

/**
 * 单 scope 执行结果：计数与 dry-run 摘要同单位；conflictsResolved = 按所选 policy
 * 实际处置的冲突数；unsupported/skipped = 不支持与跳过数（不得计入成功）；reason =
 * status 非 done 时的主因（闭集原因码）；rolledBack = 失败/部分失败后类型内还原
 * 是否成功（false 时 rollbackFailed 语义独立上浮，不得伪装成功）；error 仅调试留痕
 * （主进程日志），用户可见反馈经 reason 组装
 */
export interface ChromeImportScopeResult {
  scope: ChromeImportScope
  unit: ChromeImportCountUnit
  status: ChromeImportScopeResultStatus
  added: number
  merged: number
  conflictsResolved: number
  unsupported: number
  skipped: number
  reason?: ChromeImportReason
  rolledBack?: boolean
  error?: string
}

/** execute 返回（逐 scope 汇总，原生结果框按类型/单位组装） */
export interface ChromeImportResult {
  results: ChromeImportScopeResult[]
}
