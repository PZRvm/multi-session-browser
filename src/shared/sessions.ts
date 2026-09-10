// 会话持久化共享契约（主进程 / preload / renderer 三方共用）。
// 修改本文件的类型或通道名前，必须先修订
// notes/plans/20260910183402-阶段1会话持久化开发计划.md 第 3 节。

export const SESSIONS_CHANNELS = {
  list: 'sessions:list',
  create: 'sessions:create',
  rename: 'sessions:rename',
  delete: 'sessions:delete',
  setActive: 'sessions:set-active'
} as const

/** 落盘的会话元数据（status 为运行时状态，不落盘） */
export interface StoredSession {
  id: string
  name: string
  note: string
  pageTitle: string
}

/** renderer 运行时會话 = 落盘数据 + 状态 */
export type SessionStatus = 'idle' | 'loading'

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
