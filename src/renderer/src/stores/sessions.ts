import { create } from 'zustand'
import type { SessionStatus, SessionStatusesPayload, StoredSession } from '../../../shared/sessions'
// browser ↔ sessions 互相引用均为函数体内惰性取用（无模块级执行依赖），循环安全：
// browser 的快照守卫读 sessions.activeId，sessions 删除会话后经 browser.resync 对齐
import { useBrowserStore } from './browser'

export interface SessionItem extends StoredSession {
  status: SessionStatus
}

interface SessionsState {
  sessions: SessionItem[]
  activeId: string | null
  init: () => Promise<void>
  addSession: () => Promise<void>
  cloneSession: (id: string) => Promise<void>
  removeSession: (id: string) => Promise<void>
  // 返回整单是否成功：整单拒绝制下失败即无任何删除，供调用方呈现失败反馈
  deleteSessions: (ids: string[]) => Promise<boolean>
  renameSession: (id: string, name: string) => Promise<void>
  selectSession: (id: string) => Promise<void>
  batchOpenUrl: (ids: string[], url: string) => Promise<boolean>
  // 返回是否成功：整单拒绝或 IPC 失败返回 false，供调用方呈现中文失败反馈
  reorderSessions: (ids: string[]) => Promise<boolean>
}

let initialized = false

// 全量状态 map 写入各会话 status：map 中不存在的会话回 'idle'（推送与拉取同构，
// 整体替换不合并）
const applyStatuses = (
  set: (updater: (state: SessionsState) => Partial<SessionsState>) => void,
  { statuses }: SessionStatusesPayload
): void => {
  set((state) => ({
    sessions: state.sessions.map((item) => ({ ...item, status: statuses[item.id] ?? 'idle' }))
  }))
}

export const useSessionsStore = create<SessionsState>((set, get) => ({
  sessions: [],
  activeId: null,

  // 启动时从主进程加载持久化快照：先订阅状态推送、再拉列表、最后补拉一次全量状态
  // （订阅先就位后拉取期间到达的推送不丢失，末次补拉兜底启动早期的推送竞态，
  // 模式同 browser store init）；失败时如实呈现空列表，不伪造兜底数据
  init: async () => {
    if (initialized) return
    initialized = true
    let offStatusChanged: (() => void) | null = null
    try {
      offStatusChanged = window.api.sessions.onStatusChanged((payload) => {
        applyStatuses(set, payload)
      })
      const snapshot = await window.api.sessions.list()
      const sessions: SessionItem[] = snapshot.sessions.map((item) => ({
        ...item,
        status: 'idle'
      }))
      const activeId = sessions.some((item) => item.id === snapshot.activeId)
        ? snapshot.activeId
        : null
      set({ sessions, activeId })
      applyStatuses(set, await window.api.sessions.getStatuses())
    } catch (error) {
      // 失败复位标志，允许下次调用重试；已建立的订阅一并退订，防止重试后重复接收推送
      offStatusChanged?.()
      initialized = false
      console.error('加载会话列表失败', error)
      set({ sessions: [], activeId: null })
    }
  },

  // id 由主进程生成，以返回值为准追加并选中。阶段 4 起"选中"必须落主进程（setActive
  // 触发注册表切换浏览器分区）——只改本地 activeId 会让主进程仍激活旧会话、其快照
  // 推送被 sessionId 守卫全部丢弃，右侧冻结（首次新建则永久卡在零会话空态）。
  // 乐观先置 activeId（守卫随推送对齐），setActive 失败回滚到前值（新会话保留在列表）
  addSession: async () => {
    const prev = get().activeId
    try {
      const created = await window.api.sessions.create({})
      const item: SessionItem = { ...created, status: 'idle' }
      set((state) => ({ sessions: [...state.sessions, item], activeId: item.id }))
      try {
        await window.api.sessions.setActive({ id: item.id })
      } catch (error) {
        console.error('激活新会话失败', error)
        if (get().activeId === item.id) set({ activeId: prev })
      }
    } catch (error) {
      console.error('新建会话失败', error)
    }
  },

  // 克隆：以主进程返回值追加并乐观激活（照 addSession 模式，setActive 失败回滚
  // 到前值、新会话保留在列表）。分区复制可能耗时数秒，函数体即耗时边界，
  // 调用方（组件）用它驱动行内「克隆中…」反馈
  cloneSession: async (id) => {
    const prev = get().activeId
    try {
      const cloned = await window.api.sessions.clone({ id })
      const item: SessionItem = { ...cloned, status: 'idle' }
      set((state) => ({ sessions: [...state.sessions, item], activeId: item.id }))
      try {
        await window.api.sessions.setActive({ id: item.id })
      } catch (error) {
        console.error('激活克隆会话失败', error)
        if (get().activeId === item.id) set({ activeId: prev })
      }
    } catch (error) {
      console.error('克隆会话失败', error)
    }
  },

  // 删除成功后本地过滤；被删的是选中项时与主进程级联规则一致，指向剩余首项或 null。
  // 级联切换的快照推送在 delete 回复之前到达（推送时本地 activeId 仍旧值，被守卫
  // 丢弃），故本地状态更新后必须重拉浏览器快照对齐当前激活会话
  removeSession: async (id) => {
    try {
      await window.api.sessions.delete({ id })
      set((state) => {
        const sessions = state.sessions.filter((s) => s.id !== id)
        const activeId = state.activeId === id ? (sessions[0]?.id ?? null) : state.activeId
        return { sessions, activeId }
      })
      void useBrowserStore.getState().resync()
    } catch (error) {
      console.error('删除会话失败', error)
    }
  },

  // 批量关闭选中：主进程整单校验，成功即本地按同一集合原子移除。级联切换的快照推送
  // 在 deleteBatch 回复之前到达（推送时本地 activeId 仍旧值，被守卫丢弃），故本地更新
  // 后必须重拉浏览器快照对齐（模式照 removeSession）；activeId 级联规则与主进程一致——
  // 选中集含激活会话时指向剩余首项（无剩余则 null）
  deleteSessions: async (ids) => {
    try {
      await window.api.sessions.deleteBatch({ ids })
      set((state) => {
        const idSet = new Set(ids)
        const sessions = state.sessions.filter((s) => !idSet.has(s.id))
        const activeId =
          state.activeId !== null && idSet.has(state.activeId)
            ? (sessions[0]?.id ?? null)
            : state.activeId
        return { sessions, activeId }
      })
      void useBrowserStore.getState().resync()
      return true
    } catch (error) {
      console.error('关闭选中会话失败', error)
      return false
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
  },

  // 批量打开测试地址：无本地快照变更——各会话新 Tab 的快照经 statusChanged 推送
  // 与激活路径自然到达。url 非空由调用方（弹层确定钮）保证；与 navigate 同规，
  // 失败不吞错返回 false，供弹层展示行内错误提示（整单拒绝时无部分打开）
  batchOpenUrl: async (ids, url) => {
    try {
      await window.api.sessions.batchOpenUrl({ ids, url })
      return true
    } catch (error) {
      console.error('批量打开测试地址失败', error)
      return false
    }
  },

  // 拖拽排序：只接受与当前本地列表相同 ID 集合的全序（防陈旧顺序覆盖并发新建/删除）。
  // 无变化直接短路返回 true（相邻无位移/拖回原位零 IPC）；有效变化乐观换序（元素对象
  // 原样移动，实时 status 保留）后提交一次全序 IPC。失败时重拉主进程快照回到权威
  // 顺序——以快照顺序映射现有 SessionItem（缺失项按 idle 补齐，activeId 以快照为准），
  // 不用旧对象整体回滚覆盖并发状态推送；重拉也失败时仅在当前顺序仍等于本次乐观结果
  // （未被其他操作改写）时回滚原顺序，返回 false 供调用方提示
  reorderSessions: async (ids) => {
    const prev = get().sessions
    const prevIds = prev.map((s) => s.id)
    const idSet = new Set(ids)
    if (ids.length !== prevIds.length || prevIds.some((id) => !idSet.has(id))) {
      console.error('排序入参与当前会话列表不一致')
      return false
    }
    if (ids.every((id, i) => id === prevIds[i])) return true
    set({ sessions: ids.map((id) => prev.find((s) => s.id === id) as SessionItem) })
    try {
      await window.api.sessions.reorder({ ids })
      return true
    } catch (error) {
      console.error('会话排序失败', error)
      try {
        const snapshot = await window.api.sessions.list()
        const byId = new Map(get().sessions.map((s) => [s.id, s]))
        const sessions: SessionItem[] = snapshot.sessions.map(
          (item) => byId.get(item.id) ?? { ...item, status: 'idle' }
        )
        const activeId = sessions.some((item) => item.id === snapshot.activeId)
          ? snapshot.activeId
          : null
        set({ sessions, activeId })
      } catch (listError) {
        console.error('重拉会话列表失败', listError)
        const current = get().sessions
        const stillOptimistic = current.map((s) => s.id).join('\n') === ids.join('\n')
        if (stillOptimistic) {
          // 回滚按 prev 的 id 序合成、status 取当前实时值——直接整体恢复 prev 旧对象
          // 会把乐观期间的状态推送翻转（如 loading→idle）拉回旧值，且推送是变化驱
          // 动的，翻转后无新推送纠正，状态字滞留到下次真实加载
          const statusById = new Map(current.map((s) => [s.id, s.status]))
          set({
            sessions: prev.map((s) => ({ ...s, status: statusById.get(s.id) ?? s.status })),
            activeId: get().activeId
          })
        }
      }
      return false
    }
  }
}))
