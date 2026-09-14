import { create } from 'zustand'
import type {
  BrowserSnapshot,
  BrowserTabState,
  TabDragHoverPayload,
  TabDragOutcome,
  TabDragPreviewPayload
} from '../../../shared/browser'
import { WINDOW_ID_MAIN } from '../../../shared/browser'
import type { HistoryChangedPayload, HistoryEntry } from '../../../shared/history'
import { useSessionsStore } from './sessions'

// 浏览器状态是主进程快照的纯镜像：sessionId/tabs/activeTabId/devtoolsOpen 原样存储
// 不加工，本地不造任何 tab 字段；激活 tab 等派生值由组件用 selector 自行计算。
// setBounds 属布局上报，不进 store。
interface BrowserState {
  sessionId: string | null
  tabs: BrowserTabState[]
  activeTabId: string | null
  devtoolsOpen: boolean
  focusTick: number
  // 拖拽瞬态（阶段 9）：纯本地 UI 态，不进快照守卫链（守卫只裁 sessionId/windowId）、
  // 不落盘、不参与 BrowserSnapshot 契约——主进程持久化对此零感知
  /** 本窗口正被拖起的 Tab id（源 Tab 半透明的数据源）；dragEnd/快照自愈清空 */
  draggingTabId: string | null
  /** 本窗口是否为拖拽悬停落点：仅当主进程悬停推送指向本窗口时为本窗口 id，否则 null */
  hoverWindowId: string | null
  /** 悬停落点为本窗时的光标位置（悬停窗内容坐标，DIP 与 CSS px 同值；推送未携带则 null，只高亮不指示）——与 hoverWindowId 同生命周期的镜像 */
  dragCursorX: number | null
  dragCursorY: number | null
  /** 悬停推送的被拖 Tab id 镜像（阶段 10）：目标窗不是源窗，须镜像 payload.tabId 才能上报插入位 hint */
  dragHoverTabId: string | null
  /**
   * 当前作用域会话的浏览历史镜像（地址栏补全数据源）：主进程事实源的副本，切会话即
   * 整体清空重拉（不跨会话串数据）；建议检索在组件层本地同步过滤（编辑期零 IPC）
   */
  history: HistoryEntry[]
  init: () => Promise<void>
  /** 重拉当前快照对齐主进程（删除会话等场景：级联推送先于命令回复到达而被守卫丢弃） */
  resync: () => Promise<void>
  newTab: (url?: string) => Promise<void>
  closeTab: (id: string) => Promise<void>
  switchTab: (id: string) => Promise<void>
  navigate: (url: string) => Promise<boolean>
  goBack: () => Promise<void>
  goForward: () => Promise<void>
  reload: () => Promise<void>
  stop: () => Promise<void>
  toggleDevTools: () => Promise<void>
  closeDevTools: () => Promise<void>
  /** 拖拽开始上报：本地瞬态先行（半透明即时可见），preview 为可选虚影描述（主进程据此建跟随预览窗）；IPC 失败/异常时清态兜底 */
  dragStart: (id: string, preview?: TabDragPreviewPayload) => Promise<void>
  /**
   * 拖拽结束上报落点坐标，返回主进程裁决结果（TabDragOutcome）；
   * IPC 失败返回 null——结果未知时不伪造拒绝，组件据返回值仅对 'rejected' 触发回弹
   */
  dragEnd: (
    id: string,
    screenX: number,
    screenY: number,
    canceled?: boolean
  ) => Promise<TabDragOutcome | null>
}

let initialized = false

/**
 * 窗口身份（模块加载时解析一次 URL query，契约：计划第 3 节点 1）：
 * - 主窗口：URL 无 query，windowId 固定 WINDOW_ID_MAIN；
 * - 独立窗口：URL 由主进程建窗时拼好（?role=tab-window&session=<id>&windowId=<id>），
 *   两值取自 query；缺参回退空串——守卫将丢弃全部快照，宁可显性空白也不吃错窗数据。
 * store 守卫、main.tsx 的 init 分流、App/TabStrip 的形态分流共用这一份解析结果。
 */
export type WindowIdentity =
  | { mode: 'main'; windowId: typeof WINDOW_ID_MAIN; sessionId: null }
  | { mode: 'independent'; windowId: string; sessionId: string }

const parseWindowIdentity = (): WindowIdentity => {
  const params = new URLSearchParams(window.location.search)
  if (params.get('role') !== 'tab-window') {
    return { mode: 'main', windowId: WINDOW_ID_MAIN, sessionId: null }
  }
  return {
    mode: 'independent',
    windowId: params.get('windowId') ?? '',
    sessionId: params.get('session') ?? ''
  }
}

export const windowIdentity = parseWindowIdentity()

// 历史镜像重拉的过期判据（单调递增 token）：快速连续切换会话时，只有最新一次
// 重拉的回填生效，晚到的旧回复整体丢弃（独立窗绑定恒定，token 同样防重入叠加）
let historyPullToken = 0

/**
 * 会话级历史重拉（init 首帧漂移与切会话共用）：先清空再拉取；回填前比对 token
 * 与当前镜像会话（主窗比对 store sessionId——主进程 get 按来源解析激活会话，回填
 * 时会话已再漂移即过期；独立窗绑定恒定只比对 token）。失败保持空镜像并告警——
 * 建议层无数据即可用性归零，不阻塞浏览
 */
const refreshHistory = (
  set: (partial: Partial<BrowserState>) => void,
  get: () => BrowserState
): void => {
  const token = ++historyPullToken
  const requestedSession = get().sessionId
  set({ history: [] })
  window.api.browser
    .getHistory()
    .then((entries) => {
      if (token !== historyPullToken) return
      if (windowIdentity.mode === 'main' && get().sessionId !== requestedSession) return
      set({ history: entries })
    })
    .catch((error: unknown) => {
      if (token === historyPullToken) console.error('拉取会话历史失败', error)
    })
}

/**
 * 历史增量推送守卫与并入（与 applySnapshot 同构的按窗口模式分流）：
 * - 主窗：payload.sessionId 须等于 sessions store 的 activeId（与快照守卫同源）；
 * - 独立窗：payload.sessionId 须等于建窗绑定的 identity.sessionId。
 * 双重校验（activeId 之外还比对镜像 sessionId）：会话切换在途时旧会话推送晚到、
 * 新会话推送早于快照到达均按过期丢弃——refreshHistory 的全量拉取兜底收编
 */
const applyHistoryChanged = (
  set: (partial: Partial<BrowserState> | ((state: BrowserState) => Partial<BrowserState>)) => void,
  get: () => BrowserState,
  payload: HistoryChangedPayload
): void => {
  const mine =
    windowIdentity.mode === 'main'
      ? payload.sessionId === useSessionsStore.getState().activeId
      : payload.sessionId === windowIdentity.sessionId
  if (!mine || get().sessionId !== payload.sessionId) return
  set((state) => {
    const index = state.history.findIndex((item) => item.url === payload.entry.url)
    if (index < 0) return { history: [...state.history, payload.entry] }
    const next = [...state.history]
    next[index] = payload.entry
    return { history: next }
  })
}

// 推送与命令返回值同构，以主进程数据为唯一事实源；双到达重复 set 幂等无害。
// 守卫按窗口模式分流（契约：计划第 3 节点 2）：
// - 主窗口：windowId 须为 main，且会话与 sessions store 的 activeId 相符
//   （selectSession 乐观先改 activeId，会话切换期间旧会话推送晚到、命令返回晚归时
//   整体丢弃；null 与 null 视为相符——零会话空态）；异 windowId 快照按串台丢弃。
// - 独立窗口：只比对 windowId 与自身相符——本实例的 sessions store 永不初始化
//   （main.tsx 分流跳过 sessions.init），不得依赖 activeId；作用域会话由建窗绑定。
const applySnapshot = (
  set: (partial: Partial<BrowserState> | ((state: BrowserState) => Partial<BrowserState>)) => void,
  get: () => BrowserState,
  snapshot: BrowserSnapshot
): void => {
  if (windowIdentity.mode === 'main') {
    if (snapshot.windowId !== WINDOW_ID_MAIN) return
    if (snapshot.sessionId !== useSessionsStore.getState().activeId) return
  } else if (snapshot.windowId !== windowIdentity.windowId) {
    return
  }
  // 历史镜像随会话漂移清空（含切到零会话）：旧会话数据即刻不可见，非空新会话
  // 随后经 refreshHistory 重拉（快速连续切换时晚到的回复按过期 token 丢弃）
  const sessionDrifted = get().sessionId !== snapshot.sessionId
  const { sessionId, tabs, activeTabId, devtoolsOpen } = snapshot
  set((state) => ({
    sessionId,
    tabs,
    activeTabId,
    devtoolsOpen,
    history: sessionDrifted ? [] : state.history,
    // 拖拽瞬态自愈（阶段 9）：快照已不含被拖 Tab（主进程在裁决/级联中先行移除、
    // 或会话切换重排）时清掉本地拖拽源态——dragend 可能因此在已卸载组件上不可达
    // （React 合成事件不派发到脱离文档的节点），卸载路径由此兜底，不悬挂半透明态
    draggingTabId:
      state.draggingTabId !== null && !tabs.some((t) => t.id === state.draggingTabId)
        ? null
        : state.draggingTabId
  }))
  if (sessionDrifted && snapshot.sessionId !== null) void refreshHistory(set, get)
}

// 悬停推送守卫（与 applySnapshot 同构，按窗口模式分流，契约：阶段 9 计划第 3 节）：
// - 主窗口：payload.sessionId 须等于 sessions store 的 activeId——主窗浏览区只在
//   「主窗激活会话 = 拖拽会话」时才是合法落点（PRD 3.6.2），不符即丢弃；
// - 独立窗口：payload.sessionId 须等于建窗绑定的 identity.sessionId。
// hoverWindowId 归一化为「本窗口 id 或 null」：只有自己是悬停落点时才置位，
// 组件层无需再比对 payload。异会话窗口本就不在发送侧广播集合内，守卫属双保险；
// 会话不符时不丢弃而清高亮——收到不属本窗会话的悬停推送即意味着本窗高亮已过期
//（拖拽中激活会话被切走/删除，或发送与接收时点的主/镜像 activeId 漂移），清比丢严格
// 更安全，杜绝终态 null 被守卫拦截后高亮滞留到下一次推送。
// 阶段 10 增光标与被拖 Tab 镜像（dragCursorX/Y、dragHoverTabId），仅在悬停落点为
// 本窗时置位，与 hoverWindowId 同生共灭（非落点/终态 null/会话不符一并清空）
const applyDragHover = (
  set: (partial: Partial<BrowserState>) => void,
  payload: TabDragHoverPayload
): void => {
  const mine =
    windowIdentity.mode === 'main'
      ? payload.sessionId === useSessionsStore.getState().activeId
      : payload.sessionId === windowIdentity.sessionId
  if (!mine) {
    set({ hoverWindowId: null, dragCursorX: null, dragCursorY: null, dragHoverTabId: null })
    return
  }
  if (payload.hoverWindowId === windowIdentity.windowId) {
    // 落点本窗：坐标字段缺省（无边窗等取值失败）如实存 null，消费方按只高亮不指示处理
    set({
      hoverWindowId: payload.hoverWindowId,
      dragCursorX: payload.cursorX ?? null,
      dragCursorY: payload.cursorY ?? null,
      dragHoverTabId: payload.tabId
    })
    return
  }
  set({ hoverWindowId: null, dragCursorX: null, dragCursorY: null, dragHoverTabId: null })
}

export const useBrowserStore = create<BrowserState>((set, get) => ({
  sessionId: null,
  tabs: [],
  activeTabId: null,
  devtoolsOpen: false,
  focusTick: 0,
  draggingTabId: null,
  hoverWindowId: null,
  dragCursorX: null,
  dragCursorY: null,
  dragHoverTabId: null,
  history: [],

  // 先订阅推送、再拉取初始快照：订阅先就位后拉取期间到达的推送不会丢失，避免推送与拉取竞态
  init: async () => {
    if (initialized) return
    initialized = true
    let offStateChanged: (() => void) | null = null
    let offFocusAddress: (() => void) | null = null
    let offDragHover: (() => void) | null = null
    let offHistoryChanged: (() => void) | null = null
    try {
      // 历史增量推送（地址栏补全）：订阅先于拉取就位，推送与重拉双到达幂等无害
      offHistoryChanged = window.api.browser.onHistoryChanged((payload) => {
        applyHistoryChanged(set, get, payload)
      })
      offStateChanged = window.api.browser.onStateChanged((snapshot) => {
        applySnapshot(set, get, snapshot)
      })
      // focusTick 仅是聚焦请求的计数信号，无负载数据，UI 层按计数变化响应
      offFocusAddress = window.api.browser.onFocusAddress(() => {
        set((state) => ({ focusTick: state.focusTick + 1 }))
      })
      // 拖拽悬停推送（阶段 9）：主窗口与独立窗口两形态都经此 init 订阅（main.tsx 分流），
      // 守卫在 applyDragHover 内按窗口模式分流
      offDragHover = window.api.browser.onDragHover((payload) => {
        applyDragHover(set, payload)
      })
      const snapshot = await window.api.browser.getState()
      applySnapshot(set, get, snapshot)
    } catch (error) {
      // 失败复位标志允许下次调用重试；已建立的订阅一并退订，防止重试后重复接收推送
      offStateChanged?.()
      offFocusAddress?.()
      offDragHover?.()
      offHistoryChanged?.()
      initialized = false
      console.error('初始化浏览器状态失败', error)
    }
  },

  // 主动重拉快照（守卫照常生效）：用于推送已丢、命令回复又不含新快照的路径（删除级联）
  resync: async () => {
    try {
      applySnapshot(set, get, await window.api.browser.getState())
    } catch (error) {
      console.error('重拉浏览器状态失败', error)
    }
  },

  // 以下命令均不乐观更新：IPC 成功后以返回快照更新，失败保持原状态
  newTab: async (url) => {
    try {
      applySnapshot(set, get, await window.api.browser.newTab(url === undefined ? {} : { url }))
    } catch (error) {
      console.error('新建标签页失败', error)
    }
  },

  closeTab: async (id) => {
    try {
      applySnapshot(set, get, await window.api.browser.closeTab({ id }))
    } catch (error) {
      console.error('关闭标签页失败', error)
    }
  },

  switchTab: async (id) => {
    try {
      applySnapshot(set, get, await window.api.browser.switchTab({ id }))
    } catch (error) {
      console.error('切换标签页失败', error)
    }
  },

  // 与其他命令不同：导航失败不吞错，返回 false 供地址栏展示「无效的网址」行内提示
  navigate: async (url) => {
    try {
      applySnapshot(set, get, await window.api.browser.navigate({ url }))
      return true
    } catch (error) {
      console.error('导航失败', error)
      return false
    }
  },

  goBack: async () => {
    try {
      applySnapshot(set, get, await window.api.browser.back())
    } catch (error) {
      console.error('后退失败', error)
    }
  },

  goForward: async () => {
    try {
      applySnapshot(set, get, await window.api.browser.forward())
    } catch (error) {
      console.error('前进失败', error)
    }
  },

  reload: async () => {
    try {
      applySnapshot(set, get, await window.api.browser.reload())
    } catch (error) {
      console.error('刷新失败', error)
    }
  },

  stop: async () => {
    try {
      applySnapshot(set, get, await window.api.browser.stop())
    } catch (error) {
      console.error('停止加载失败', error)
    }
  },

  // 开发者工具开关与既有命令同规：不乐观更新，IPC 成功后以返回快照更新，失败保持原状态
  toggleDevTools: async () => {
    try {
      applySnapshot(set, get, await window.api.browser.toggleDevTools())
    } catch (error) {
      console.error('切换开发者工具失败', error)
    }
  },

  // 关闭走独立 close 通道（只关不开，未开启时主进程原子 no-op）：
  // 不读镜像态做守卫，消除「守卫 + toggle」之间推送在途导致的误重开窗口
  closeDevTools: async () => {
    try {
      applySnapshot(set, get, await window.api.browser.closeDevTools())
    } catch (error) {
      console.error('关闭开发者工具失败', error)
    }
  },

  // 拖拽手势（阶段 9）：瞬态本地态先行置位（源 Tab 即时半透明），tabs 数据绝不
  // 乐观改动——事实源仍是主进程快照；IPC 失败或通道未就绪时清态兜底，绝不悬挂
  // 半透明态（条件清：并发场景下不误清后来者接管的拖拽态）
  dragStart: async (id, preview) => {
    set({ draggingTabId: id })
    try {
      await window.api.browser.dragStart({ id, preview })
    } catch (error) {
      set((state) => (state.draggingTabId === id ? { draggingTabId: null } : {}))
      console.error('上报拖拽开始失败', error)
    }
  },

  // 裁决结果以返回值交组件处理，而非存成 lastDragOutcome 瞬态：回弹是单组件、
  // 亚秒级的一次性视觉，进 store 需要额外的「已消费」清理动作，且任何新订阅方
  // 都可能读到陈旧值重播回弹；返回值把生命周期锁死在 dragend handler 内，零残留。
  // IPC 失败返回 null：结果未知不伪造 'rejected'（主进程 60s 过期兜底自会清态）。
  dragEnd: async (id, screenX, screenY, canceled) => {
    try {
      return await window.api.browser.dragEnd(
        canceled ? { id, screenX, screenY, canceled: true } : { id, screenX, screenY }
      )
    } catch (error) {
      console.error('上报拖拽结束失败', error)
      return null
    } finally {
      // 本地拖拽态必清（含 IPC 失败路径）：清自己的源 Tab 态；单活动拖拽会话约束下，
      // 此刻全局只可能有本拖拽的悬停态，一并清不误伤（悬停候选本就不含源窗口）；
      // 光标/被拖 Tab 镜像与 hoverWindowId 同组瞬态，同步清空不悬挂
      set((state) =>
        state.draggingTabId === id
          ? {
              draggingTabId: null,
              hoverWindowId: null,
              dragCursorX: null,
              dragCursorY: null,
              dragHoverTabId: null
            }
          : {}
      )
    }
  }
}))
