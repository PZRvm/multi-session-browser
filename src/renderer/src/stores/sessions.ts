import { create } from 'zustand'
import type {
  SessionStatus,
  SessionStatusesPayload,
  StoredSession,
  StoredWorkspace
} from '../../../shared/sessions'
import { WORKSPACE_VIEW_ALL } from '../../../shared/sessions'
// browser ↔ sessions 互相引用均为函数体内惰性取用（无模块级执行依赖），循环安全：
// browser 的快照守卫读 sessions.activeId，sessions 删除会话后经 browser.resync 对齐
import { useBrowserStore } from './browser'

export interface SessionItem extends StoredSession {
  status: SessionStatus
}

interface SessionsState {
  sessions: SessionItem[]
  activeId: string | null
  workspaces: StoredWorkspace[]
  /** 当前视野：WORKSPACE_VIEW_ALL（'all'）或工作区 id（主进程快照镜像，切换经 switchWorkspace 落盘） */
  activeWorkspaceId: string
  init: () => Promise<void>
  addSession: (workspaceId?: string | null) => Promise<void>
  cloneSession: (id: string, workspaceId?: string | null) => Promise<void>
  removeSession: (id: string) => Promise<void>
  // 返回整单是否成功：整单拒绝制下失败即无任何删除，供调用方呈现失败反馈
  deleteSessions: (ids: string[]) => Promise<boolean>
  renameSession: (id: string, name: string) => Promise<void>
  selectSession: (id: string) => Promise<void>
  batchOpenUrl: (ids: string[], url: string) => Promise<boolean>
  // 返回是否成功：整单拒绝或 IPC 失败返回 false，供调用方呈现中文失败反馈
  reorderSessions: (ids: string[]) => Promise<boolean>
  // 工作区动作（失败均返回 false/null 供中文反馈；成功后镜像与主进程权威状态一致）
  switchWorkspace: (id: string) => Promise<boolean>
  // 成功返回新建的 StoredWorkspace，失败返回 null
  createWorkspace: (name: string) => Promise<StoredWorkspace | null>
  renameWorkspace: (id: string, name: string) => Promise<boolean>
  deleteWorkspace: (id: string) => Promise<boolean>
  moveSessionToWorkspace: (sessionId: string, workspaceId: string | null) => Promise<boolean>
  moveSessionsToWorkspace: (
    sessionIds: string[],
    workspaceId: string | null
  ) => Promise<{ moved: number; skipped: number } | null>
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

/**
 * 以主进程快照为权威整体接管镜像（init 与各工作区动作失败重拉共用）：
 * 会话映射保留现有对象的实时 status（缺失项按 idle 补齐，reorderSessions 先例），
 * activeId/workspaces/activeWorkspaceId 一律以快照为准
 */
const adoptSnapshot = (
  set: (partial: Partial<SessionsState>) => void,
  snapshot: {
    sessions: StoredSession[]
    activeId: string | null
    workspaces: StoredWorkspace[]
    activeWorkspaceId: string
  },
  prevSessions: SessionItem[]
): void => {
  const byId = new Map(prevSessions.map((s) => [s.id, s]))
  const sessions: SessionItem[] = snapshot.sessions.map((item) => ({
    ...item,
    status: byId.get(item.id)?.status ?? 'idle'
  }))
  const activeId = sessions.some((item) => item.id === snapshot.activeId) ? snapshot.activeId : null
  set({
    sessions,
    activeId,
    workspaces: snapshot.workspaces,
    activeWorkspaceId: snapshot.activeWorkspaceId
  })
}

/**
 * 视野切换的激活位级联（与主进程 workspaceSetActive 同规则逐字对齐，供乐观更新）：
 * 当前激活会话已属目标工作区 → 不动；否则该工作区记忆（须仍属该工作区）→ 全序
 * 首个 → 空工作区 null
 */
const cascadeActiveForView = (
  sessions: SessionItem[],
  activeId: string | null,
  viewId: string,
  workspaces: StoredWorkspace[]
): string | null => {
  const current = sessions.find((s) => s.id === activeId)
  if (current && current.workspaceId === viewId) return activeId
  const ws = workspaces.find((w) => w.id === viewId)
  if (ws && ws.lastActiveSessionId !== null) {
    const remembered = sessions.find(
      (s) => s.id === ws.lastActiveSessionId && s.workspaceId === viewId
    )
    if (remembered) return remembered.id
  }
  return sessions.find((s) => s.workspaceId === viewId)?.id ?? null
}

/**
 * 回填镜像的工作区激活记忆（镜像主进程 setActive/workspaceSetActive 在同临界区写入
 * 的 lastActiveSessionId 副作用）。镜像若不随激活更新，后续 switchWorkspace 的乐观
 * 级联会按陈旧记忆计算，与主进程级联分叉——列表高亮与右侧实际会话不一致，且分叉
 * 后浏览器快照推送被守卫丢弃（审查高 1）。记忆指向的会话须仍属该工作区才回填
 */
const rememberInMirror = (
  set: (updater: (state: SessionsState) => Partial<SessionsState>) => void,
  get: () => SessionsState,
  sessionId: string | null
): void => {
  if (sessionId === null) return
  const session = get().sessions.find((s) => s.id === sessionId)
  if (!session || session.workspaceId === null) return
  set((state) => ({
    workspaces: state.workspaces.map((w) =>
      w.id === session.workspaceId ? { ...w, lastActiveSessionId: sessionId } : w
    )
  }))
}

export const useSessionsStore = create<SessionsState>((set, get) => ({
  sessions: [],
  activeId: null,
  workspaces: [],
  activeWorkspaceId: WORKSPACE_VIEW_ALL,

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
      adoptSnapshot(set, snapshot, [])
      applyStatuses(set, await window.api.sessions.getStatuses())
    } catch (error) {
      // 失败复位标志，允许下次调用重试；已建立的订阅一并退订，防止重试后重复接收推送
      offStatusChanged?.()
      initialized = false
      console.error('加载会话列表失败', error)
      set({
        sessions: [],
        activeId: null,
        workspaces: [],
        activeWorkspaceId: WORKSPACE_VIEW_ALL
      })
    }
  },

  // id 由主进程生成，以返回值为准追加并选中；workspaceId 为落点归属（当前视野，
  // 'all' 视野传 null = 未分组）。阶段 4 起"选中"必须落主进程（setActive 触发注册表
  // 切换浏览器分区）——只改本地 activeId 会让主进程仍激活旧会话、其快照推送被
  // sessionId 守卫全部丢弃，右侧冻结（首次新建则永久卡在零会话空态）。
  // 乐观先置 activeId（守卫随推送对齐），setActive 失败回滚到前值（新会话保留在列表）
  addSession: async (workspaceId = null) => {
    const prev = get().activeId
    try {
      const created = await window.api.sessions.create({ workspaceId })
      const item: SessionItem = { ...created, status: 'idle' }
      set((state) => ({ sessions: [...state.sessions, item], activeId: item.id }))
      try {
        await window.api.sessions.setActive({ id: item.id })
        rememberInMirror(set, get, item.id)
      } catch (error) {
        console.error('激活新会话失败', error)
        if (get().activeId === item.id) set({ activeId: prev })
      }
    } catch (error) {
      console.error('新建会话失败', error)
    }
  },

  // 克隆：以主进程返回值追加并乐观激活（照 addSession 模式，setActive 失败回滚
  // 到前值、新会话保留在列表）。workspaceId 为落点归属（缺省随源会话）；分区复制
  // 可能耗时数秒，函数体即耗时边界，调用方（组件）用它驱动行内「克隆中…」反馈
  cloneSession: async (id, workspaceId) => {
    const prev = get().activeId
    try {
      const cloned = await window.api.sessions.clone(
        workspaceId === undefined ? { id } : { id, workspaceId }
      )
      const item: SessionItem = { ...cloned, status: 'idle' }
      set((state) => ({ sessions: [...state.sessions, item], activeId: item.id }))
      try {
        await window.api.sessions.setActive({ id: item.id })
        rememberInMirror(set, get, item.id)
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
        // 镜像主进程 clearDanglingMemory：指向被删会话的工作区记忆置 null
        const workspaces = state.workspaces.map((w) =>
          w.lastActiveSessionId === id ? { ...w, lastActiveSessionId: null } : w
        )
        return { sessions, activeId, workspaces }
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
        // 镜像主进程 clearDanglingMemory（批量同覆盖）
        const workspaces = state.workspaces.map((w) =>
          w.lastActiveSessionId !== null && idSet.has(w.lastActiveSessionId)
            ? { ...w, lastActiveSessionId: null }
            : w
        )
        return { sessions, activeId, workspaces }
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

  // 乐观更新本地选中项，落盘失败时回滚；成功后回填镜像记忆（镜像主进程 setActive
  // 的工作区记忆副作用，防后续视野切换的乐观级联分叉——审查高 1）
  selectSession: async (id) => {
    const prev = get().activeId
    if (prev === id) return
    set({ activeId: id })
    try {
      await window.api.sessions.setActive({ id })
      rememberInMirror(set, get, id)
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
  },

  // 切换工作区视野（视野 + 激活位整体切换，PRD 3.1.5）：乐观置视野并按主进程同规则
  // 级联本地 activeId（级联激活会话变化 → 主进程 onActiveChanged 编排 → 浏览器快照
  // 推送经既有守卫链到达，照 selectSession 模式无需显式 resync）；成功后镜像主进程
  // 的级联记忆副作用（仅真实级联写、'all' 与零级联不动，防镜像漂移——审查高 1）；
  // 失败重拉主进程权威快照整体接管（视野/激活/归属/工作区全恢复），返回 false 供
  // 中文反馈
  switchWorkspace: async (id) => {
    const { sessions, activeId, workspaces } = get()
    const nextActiveId = cascadeActiveForView(sessions, activeId, id, workspaces)
    const cascaded = nextActiveId !== activeId
    set({ activeWorkspaceId: id, activeId: nextActiveId })
    try {
      await window.api.sessions.workspaceSetActive({ id })
      if (id !== WORKSPACE_VIEW_ALL && cascaded) {
        rememberInMirror(set, get, nextActiveId)
      }
      return true
    } catch (error) {
      console.error('切换工作区失败', error)
      try {
        adoptSnapshot(set, await window.api.sessions.list(), get().sessions)
      } catch (listError) {
        console.error('重拉会话列表失败', listError)
      }
      return false
    }
  },

  // 新建工作区：主进程整单校验（空名/重名拒绝），成功以返回值入镜；不做乐观——
  // 单次 IPC 即回，主进程返回值即权威（id 主进程生成，调用方用它切入新工作区）。
  // 返回新建的工作区；失败返回 null 供中文反馈
  createWorkspace: async (name) => {
    try {
      const workspace = await window.api.sessions.workspaceCreate({ name })
      set((state) => ({ workspaces: [...state.workspaces, workspace] }))
      return workspace
    } catch (error) {
      console.error('新建工作区失败', error)
      return null
    }
  },

  // 重命名工作区：非乐观，成功以返回值更新；失败保持原名返回 false
  renameWorkspace: async (id, name) => {
    try {
      const updated = await window.api.sessions.workspaceRename({ id, name })
      set((state) => ({
        workspaces: state.workspaces.map((w) => (w.id === id ? updated : w))
      }))
      return true
    } catch (error) {
      console.error('重命名工作区失败', error)
      return false
    }
  },

  // 删除工作区：镜像主进程语义——其中会话全部移入未分组、视野指向它时回落 'all'、
  // activeId 不动（视野与激活正交）；成功后本地原子应用，失败返回 false
  deleteWorkspace: async (id) => {
    try {
      await window.api.sessions.workspaceDelete({ id })
      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.workspaceId === id ? { ...s, workspaceId: null } : s
        ),
        workspaces: state.workspaces.filter((w) => w.id !== id),
        activeWorkspaceId:
          state.activeWorkspaceId === id ? WORKSPACE_VIEW_ALL : state.activeWorkspaceId
      }))
      return true
    } catch (error) {
      console.error('删除工作区失败', error)
      return false
    }
  },

  // 移动会话归属（独占制）：非乐观（主进程幂等校验），成功更新该会话 workspaceId，
  // 并镜像主进程的源工作区记忆清理（记忆指向被移会话时置 null——审查低 3 的镜像侧）；
  // 不动 activeId 与目标/未分组侧的激活记忆（记忆只随真实激活更新）。视野过滤随之
  // 自然变化——若移出当前视野，行消失、右侧不变
  moveSessionToWorkspace: async (sessionId, workspaceId) => {
    try {
      await window.api.sessions.workspaceMoveSession({ sessionId, workspaceId })
      set((state) => {
        const prevWorkspaceId = state.sessions.find((s) => s.id === sessionId)?.workspaceId
        return {
          sessions: state.sessions.map((s) => (s.id === sessionId ? { ...s, workspaceId } : s)),
          workspaces:
            prevWorkspaceId && prevWorkspaceId !== workspaceId
              ? state.workspaces.map((w) =>
                  w.id === prevWorkspaceId && w.lastActiveSessionId === sessionId
                    ? { ...w, lastActiveSessionId: null }
                    : w
                )
              : state.workspaces
        }
      })
      return true
    } catch (error) {
      console.error('移动会话失败', error)
      return false
    }
  },

  // 批量移动归属（批量模式板脚入口）：非乐观（主进程整单校验 + 幂等计数为真值源，
  // moved/skipped 透传给反馈条不自算口径）；成功后逐会话镜像 workspaceId，并镜像
  // 源工作区记忆清理——仅「确实被移出」的会话（prev != 目标）清其源工作区记忆，
  // 已在目标的跳过项记忆不动（对齐单会话移动的镜像侧先例）。视野过滤随之自然变化
  // （工作区视野内被移出的行消失、右侧不变）；失败返回 null，调用方 danger 呈现
  moveSessionsToWorkspace: async (sessionIds, workspaceId) => {
    try {
      const result = await window.api.sessions.workspaceMoveSessionsBatch({
        ids: sessionIds,
        workspaceId
      })
      set((state) => {
        const idSet = new Set(sessionIds)
        const movedFrom = new Map<string, string | null>()
        for (const s of state.sessions) {
          if (idSet.has(s.id) && s.workspaceId !== workspaceId) {
            movedFrom.set(s.id, s.workspaceId)
          }
        }
        return {
          sessions: state.sessions.map((s) => (idSet.has(s.id) ? { ...s, workspaceId } : s)),
          workspaces: state.workspaces.map((w) => {
            if (w.lastActiveSessionId != null && movedFrom.get(w.lastActiveSessionId) === w.id) {
              return { ...w, lastActiveSessionId: null }
            }
            return w
          })
        }
      })
      return { moved: result.moved, skipped: result.skipped }
    } catch (error) {
      console.error('批量移动会话失败', error)
      return null
    }
  }
}))
