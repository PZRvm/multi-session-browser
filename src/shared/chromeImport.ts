// Chrome 浏览数据导入共享契约（主进程 / preload / renderer 三方共用）。
// 契约冻结于 notes/plans/20260930133553-导入Chrome浏览数据开发计划.md 第 3 节；
// 数据格式与可行性依据见 notes/think-report/20260930130104-导入Chrome浏览数据.md。
//
// 语义（用户 2026-09-30 批复）：会话级一次性导入本机 Chrome 的搜索历史与 localStorage，
// 合并语义——历史静默 upsert 不弹窗（同 url 访问数取大、时间取新），localStorage 冲突
// （同 origin 同 key 值不同）弹窗按会话一次二选一；Cookie 不在本期范围。两段式导入：
// dry-run 只读探测 + 冲突检测并暂存（planId + TTL），execute 消费暂存真正写入——暂存由
// 主进程持有，planId 过期即拒绝（防陈旧导入）。全部 invoke 零推送。
// 会话隔离不变量：导入只写目标会话分区（历史 JSON + 分区 Local Storage），零跨会话触达；
// 导入窗口期由 registry 静默窗口原语（runImportQuiesced）拦截切换/克隆/批量/销毁。
// 类型只是编译期约定——跨 IPC 边界的运行时守卫在 main 侧落实（chromeImport/index.ts）。

/** 导入域通道（浏览器域语系的独立常量对象，不并入 BROWSER_CHANNELS 本体——shared/history.ts 先例） */
export const CHROME_IMPORT_CHANNELS = {
  /** 枚举本机 Chrome（默认用户数据目录）的 profile 列表 */
  listProfiles: 'chrome-import:list-profiles',
  /** 只读探测：按所选 profile 与内容勾选读取 Chrome 数据，返回冲突摘要并暂存 */
  dryRun: 'chrome-import:dry-run',
  /** 执行导入：消费暂存 + 冲突裁决，真正写入目标会话分区 */
  execute: 'chrome-import:execute'
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

/** 导入内容闭集（本期两值；历史无冲突概念静默 upsert，冲突仅 localStorage 会有） */
export const CHROME_IMPORT_SCOPES = ['history', 'localStorage'] as const
export type ChromeImportScope = (typeof CHROME_IMPORT_SCOPES)[number]

/** dry-run 载荷（renderer → main）：sessionId 必过 SESSION_ID_RE，profileDir 必须出自 list-profiles 枚举 */
export interface ChromeImportOptions {
  sessionId: string
  profileDir: string
  scopes: ChromeImportScope[]
}

/**
 * 单 scope 探测摘要：total = 读到的源条目数；added/merged = 预计新增/合并数（按
 * 目标侧现状归并口径计算）；conflict 仅 localStorage 可能非零（同 origin 同 key 值不同）
 */
export interface ChromeImportScopePlan {
  scope: ChromeImportScope
  total: number
  added: number
  merged: number
  conflictKeys: number
  conflictOrigins: number
}

/** dry-run 返回：planId 供 execute 消费（主进程内存暂存 60s TTL，过期/未知一律拒绝） */
export interface ChromeImportPlan {
  planId: string
  scopes: ChromeImportScopePlan[]
}

/** 冲突裁决闭集（会话级一次二选一——用户批复不按站点分组、不逐条裁决） */
export const CHROME_IMPORT_POLICIES = ['chrome', 'session'] as const
export type ChromeImportPolicy = (typeof CHROME_IMPORT_POLICIES)[number]

/** execute 载荷：localStoragePolicy = 冲突键以哪侧为准（'chrome' 覆盖 / 'session' 保留现值） */
export interface ChromeImportResolution {
  planId: string
  localStoragePolicy: ChromeImportPolicy
}

/** 单 scope 执行结果：skipped = 该 scope 未勾选/暂存缺失；failed 时 error 为主进程中文案 */
export interface ChromeImportScopeResult {
  scope: ChromeImportScope
  status: 'done' | 'skipped' | 'failed'
  added: number
  merged: number
  conflictsResolved: number
  error?: string
}

/** execute 返回（逐 scope 汇总，renderer 据此拼反馈条） */
export interface ChromeImportResult {
  results: ChromeImportScopeResult[]
}
