// 会话持久化共享契约（主进程 / preload / renderer 三方共用）。
// 修改本文件的类型或通道名前，必须先修订
// notes/plans/20260911191316-阶段4多会话浏览器绑定开发计划.md 第 3 节。
//
// 阶段 4 契约要点：
// - 落盘 schema version 2（v1 文件读取时按 lastUrl='' 迁移，写盘恒出 v2，见 src/main/store.ts）
// - status 是运行时状态不落盘，由"该会话任一 Tab loading"聚合而来，经
//   statusChanged 全量 map 推送；renderer 先订阅后拉取（getStatuses）防启动竞态
// - setActive 通道在主进程内附带副作用：触发浏览器切换到目标会话（编排见 registry）

export const SESSIONS_CHANNELS = {
  list: 'sessions:list',
  create: 'sessions:create',
  rename: 'sessions:rename',
  delete: 'sessions:delete',
  setActive: 'sessions:set-active',
  getStatuses: 'sessions:get-statuses',
  statusChanged: 'sessions:status-changed'
} as const

/**
 * 落盘的会话元数据（status 为运行时状态，不落盘）。
 * lastUrl：该会话上次打开页（激活 Tab 的 URL），空串 = 无记录；
 * 重启后首次激活该会话时自动重载（PRD 3.1.4"上次打开页面"）。
 */
export interface StoredSession {
  id: string
  name: string
  note: string
  pageTitle: string
  lastUrl: string
}

/** renderer 运行時會话 = 落盘数据 + 状态 */
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

export interface OkResult {
  ok: true
}
