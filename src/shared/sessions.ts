// 会话持久化共享契约（主进程 / preload / renderer 三方共用）。
// 修改本文件的类型或通道名前，必须先修订
// notes/plans/20260912201534-阶段6会话Tab列表落盘与恢复开发计划.md 第 2.4 节
// （阶段 5 增量契约的历史修订记录见同目录阶段 5 计划第 3 节）。
//
// 契约要点：
// - 落盘 schema version 3（v3 增 tabs/activeTabIndex；v1/v2 文件读取时按
//   lastUrl 派生单元素 tabs 迁移，写盘恒出 v3，见 src/main/store.ts）
// - status 是运行时状态不落盘，由"该会话任一 Tab loading"聚合而来，经
//   statusChanged 全量 map 推送；renderer 先订阅后拉取（getStatuses）防启动竞态
// - setActive 通道在主进程内附带副作用：触发浏览器切换到目标会话（编排见 registry）
// - 阶段 5 增量：clone（分区数据+元数据复制）、deleteAll（批量关闭=删除全部）、
//   batchOpenUrl（选中会话统一开测试地址）；通道整单校验拒绝制，无部分成功
// - 阶段 6 增量：tabs（恢复用 URL 列表，顺序即创建序）+ activeTabIndex（激活位）；
//   恢复是 URL 级——页面运行态与 DevTools 开关态不持久化（PRD 3.6.4）

export const SESSIONS_CHANNELS = {
  list: 'sessions:list',
  create: 'sessions:create',
  rename: 'sessions:rename',
  delete: 'sessions:delete',
  setActive: 'sessions:set-active',
  getStatuses: 'sessions:get-statuses',
  statusChanged: 'sessions:status-changed',
  clone: 'sessions:clone',
  deleteAll: 'sessions:delete-all',
  batchOpenUrl: 'sessions:batch-open-url'
} as const

/**
 * 会话 id 的格式契约：sess-<base36 时间戳>-<自增 seq>。
 * 单一事实源——生成端（main/sessions.ts 的 generateSessionId）与校验端
 * （main/browser/registry.ts 的分区拼装/目录解析）共同引用本常量，规则变更只改此处，
 * 防两模块靠注释互相同步的漂移（纵深防御：被篡改的落盘 id 在拼分区串前即被拒绝）
 */
export const SESSION_ID_RE = /^sess-[a-z0-9-]+$/

/**
 * pageTitle / tab title 的截断上限（按 UTF-16 码元切，中文不受影响）。
 * 单一事实源：sessions IPC 入口 clamp、manager 的 tab title、registry 的落盘上报
 * 三处消费同一值，禁止各持字面量（防改一处漏两处）。
 */
export const PAGE_TITLE_MAX = 200

/** 落盘的单个恢复用 Tab（仅 URL；页面运行态不持久化） */
export interface StoredTab {
  url: string
}

/**
 * StoredTab[] 浅克隆（新建元素对象，防与落盘/缓存对象共享可变引用）。
 * 单一事实源：store 重建、registry 恢复集缓存、clone 元数据复制三处消费同一实现，
 * tabs 结构演进（如阶段 7 增字段）时只改此处
 */
export function cloneTabs(tabs: readonly StoredTab[]): StoredTab[] {
  return tabs.map((tab) => ({ url: tab.url }))
}

/**
 * 落盘的会话元数据（status 为运行时状态，不落盘）。
 * lastUrl：该会话上次打开页（激活 Tab 的 URL），空串 = 无记录；
 * 重启后首次激活该会话时自动重载（PRD 3.1.4"上次打开页面"）。
 * tabs/activeTabIndex（阶段 6）：恢复用 Tab URL 列表与激活位，lastUrl 与
 * tabs[activeTabIndex] 由写侧同源计算保持一致；tabs 空表示无恢复集
 * （懒创建时回退单空白 Tab，v1/v2 老文件迁移为由 lastUrl 派生的单元素）
 */
export interface StoredSession {
  id: string
  name: string
  note: string
  pageTitle: string
  lastUrl: string
  tabs: StoredTab[]
  activeTabIndex: number
}

/** renderer 运行时会话 = 落盘数据 + 状态 */
export type SessionStatus = 'idle' | 'loading'

/** 全量会话运行状态 map（key 为会话 id）；推送与拉取同构，整体替换不合并 */
export interface SessionStatusesPayload {
  statuses: Record<string, SessionStatus>
}

export interface SessionsSnapshot {
  version: number
  sessions: StoredSession[]
  activeId: string | null
}

export interface CreateSessionPayload {
  name?: string
  note?: string
}

export interface RenameSessionPayload {
  id: string
  name: string
}

export interface DeleteSessionPayload {
  id: string
}

export interface SetActiveSessionPayload {
  id: string | null
}

/** 克隆会话：复制源会话的分区数据（登录态等持久环境）与元数据，生成同款新环境 */
export interface CloneSessionPayload {
  id: string
}

/**
 * 批量打开测试地址：全部选中会话各新建一个 Tab 加载该 URL。
 * 整单校验拒绝制——ids 任一不存在或 URL 不合法时整单拒绝，无部分成功
 */
export interface BatchOpenUrlPayload {
  ids: string[]
  url: string
}

export interface OkResult {
  ok: true
}
