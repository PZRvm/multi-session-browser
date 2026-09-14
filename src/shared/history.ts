// 地址栏历史补全共享契约（主进程 / preload / renderer 三方共用）。
// 契约冻结于 notes/plans/20260914135141-地址栏历史补全开发计划.md 第 2.4 节。
//
// 事实源约定：会话历史由主进程持有并落盘（userData/history/<sessionId>.json，
// 每会话一文件），renderer 只是镜像——get 拉取当前作用域会话的全量、changed 增量
// upsert 单条；地址栏建议的检索计算在 renderer 本地完成（编辑期零 IPC 往返，
// 主进程不参与击键路径——"不阻塞主进程"为结构性保证）。历史按会话隔离，
// 推送与镜像都以 sessionId 守卫，A 会话的网址不出现在 B 会话的建议里。
// 类型只是编译期约定——跨 IPC/落盘边界的运行时守卫在 main 侧落实。

/** 单条历史记录（内存与落盘同构；upsert 键为 url） */
export interface HistoryEntry {
  url: string
  title: string
  faviconUrl: string | null
  visitCount: number
  lastVisitedAt: number
}

/**
 * 历史通道（浏览器域语系的独立常量对象，不并入 BROWSER_CHANNELS 本体——那是
 * 已冻结契约，本文件自持；浏览器域通道总数 18 → 20）：
 * - get：命令——拉取来源窗口作用域会话（主窗→激活会话，独立窗→绑定会话）的
 *   全量历史，无 payload，renderer 不传 sessionId（作用域由 event.sender 解析，
 *   防越权读他窗会话历史）
 * - changed：主进程 → 该会话窗口的定向增量推送（dragHover 同款集合：主窗仅当
 *   激活会话相符 + 该会话全部独立窗），payload.entry 按 url 并入镜像
 */
export const HISTORY_CHANNELS = {
  get: 'browser:history-get',
  changed: 'browser:history-changed'
} as const

/** 历史变化推送（增量 upsert 语义） */
export interface HistoryChangedPayload {
  sessionId: string
  entry: HistoryEntry
}

/** 单会话历史落盘形状：userData/history/<sessionId>.json */
export interface StoredSessionHistory {
  version: number
  entries: HistoryEntry[]
}

/** 落盘 schema 版本（读到不认识的版本按坏数据回退空史并告警） */
export const HISTORY_SCHEMA_VERSION = 1

/** 每会话历史上限：超限按 lastVisitedAt 淘汰最旧访问 */
export const HISTORY_MAX_ENTRIES = 2000

/**
 * 入史 URL 长度上限（与 sessions 域 LAST_URL_MAX 同值）：超长不入史并告警——
 * 不做截断（截断后的 URL 无法再导航，入史即坏数据），防写穿落盘与镜像内存
 */
export const HISTORY_URL_MAX = 2000

/** 地址栏建议触发最小输入字符数（不足不弹面板） */
export const SUGGEST_MIN_INPUT = 2

/** 地址栏建议最多展示条数 */
export const SUGGEST_MAX_RESULTS = 8
