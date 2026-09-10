import { create } from 'zustand'
import type { SessionStatus, StoredSession } from '../../../shared/sessions'

export interface SessionItem extends StoredSession {
  status: SessionStatus
}

interface SessionsState {
  sessions: SessionItem[]
  activeId: string | null
  init: () => Promise<void>
  addSession: () => Promise<void>
  removeSession: (id: string) => Promise<void>
  renameSession: (id: string, name: string) => Promise<void>
  selectSession: (id: string) => Promise<void>
}

let initialized = false

export const useSessionsStore = create<SessionsState>((set, get) => ({
  sessions: [],
  activeId: null,

  // 启动时从主进程加载持久化快照；失败时如实呈现空列表，不伪造兜底数据
  init: async () => {
    if (initialized) return
    initialized = true
    try {
      const snapshot = await window.api.sessions.list()
      const sessions: SessionItem[] = snapshot.sessions.map((item) => ({
        ...item,
        status: 'idle'
      }))
      const activeId = sessions.some((item) => item.id === snapshot.activeId)
        ? snapshot.activeId
        : null
      set({ sessions, activeId })
    } catch (error) {
      // 失败复位标志，允许下次调用重试；并发期间置位仍保证只执行一次
      initialized = false
      console.error('加载会话列表失败', error)
      set({ sessions: [], activeId: null })
    }
  },

  // id 由主进程生成，以返回值为准追加并选中
  addSession: async () => {
    try {
      const created = await window.api.sessions.create({})
      const item: SessionItem = { ...created, status: 'idle' }
      set((state) => ({ sessions: [...state.sessions, item], activeId: item.id }))
    } catch (error) {
      console.error('新建会话失败', error)
    }
  },

  // 删除成功后本地过滤；被删的是选中项时与主进程级联规则一致，指向剩余首项或 null
  removeSession: async (id) => {
    try {
      await window.api.sessions.delete({ id })
      set((state) => {
        const sessions = state.sessions.filter((s) => s.id !== id)
        const activeId = state.activeId === id ? (sessions[0]?.id ?? null) : state.activeId
        return { sessions, activeId }
      })
    } catch (error) {
      console.error('删除会话失败', error)
    }
  },

  // 非乐观更新：IPC 成功后以返回值更新本地，失败保持原状态
  renameSession: async (id, name) => {
    const trimmed = name.trim()
    if (!trimmed) return
    try {
      const updated: StoredSession = await window.api.sessions.rename({ id, name: trimmed })
      set((state) => ({
        sessions: state.sessions.map((s) => (s.id === id ? { ...s, ...updated } : s))
      }))
    } catch (error) {
      console.error('重命名会话失败', error)
    }
  },

  // 乐观更新本地选中项，落盘失败时回滚
  selectSession: async (id) => {
    const prev = get().activeId
    if (prev === id) return
    set({ activeId: id })
    try {
      await window.api.sessions.setActive({ id })
    } catch (error) {
      console.error('切换选中会话失败', error)
      if (get().activeId === id) set({ activeId: prev })
    }
  }
}))
