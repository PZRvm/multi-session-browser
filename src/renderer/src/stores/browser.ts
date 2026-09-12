import { create } from 'zustand'
import type { BrowserSnapshot, BrowserTabState } from '../../../shared/browser'
import { WINDOW_ID_MAIN } from '../../../shared/browser'
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
  init: () => Promise<void>
  /** 重拉当前快照对齐主进程（删除会话等场景：级联推送先于命令回复到达而被守卫丢弃） */
  resync: () => Promise<void>
  newTab: (url?: string) => Promise<void>
  closeTab: (id: string) => Promise<void>
  switchTab: (id: string) => Promise<void>
  /** 移出 Tab 为独立窗口（阶段 7—8 临时入口为 Tab 条右键菜单；阶段 9 拖拽手势替换入口，通道语义保留）；失败返回 false */
  tearOffTab: (id: string) => Promise<boolean>
  navigate: (url: string) => Promise<boolean>
  goBack: () => Promise<void>
  goForward: () => Promise<void>
  reload: () => Promise<void>
  stop: () => Promise<void>
  toggleDevTools: () => Promise<void>
  closeDevTools: () => Promise<void>
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

// 推送与命令返回值同构，以主进程数据为唯一事实源；双到达重复 set 幂等无害。
// 守卫按窗口模式分流（契约：计划第 3 节点 2）：
// - 主窗口：windowId 须为 main，且会话与 sessions store 的 activeId 相符
//   （selectSession 乐观先改 activeId，会话切换期间旧会话推送晚到、命令返回晚归时
//   整体丢弃；null 与 null 视为相符——零会话空态）；异 windowId 快照按串台丢弃。
// - 独立窗口：只比对 windowId 与自身相符——本实例的 sessions store 永不初始化
//   （main.tsx 分流跳过 sessions.init），不得依赖 activeId；作用域会话由建窗绑定。
const applySnapshot = (
  set: (partial: Partial<BrowserState>) => void,
  snapshot: BrowserSnapshot
): void => {
  if (windowIdentity.mode === 'main') {
    if (snapshot.windowId !== WINDOW_ID_MAIN) return
    if (snapshot.sessionId !== useSessionsStore.getState().activeId) return
  } else if (snapshot.windowId !== windowIdentity.windowId) {
    return
  }
  const { sessionId, tabs, activeTabId, devtoolsOpen } = snapshot
  set({ sessionId, tabs, activeTabId, devtoolsOpen })
}

export const useBrowserStore = create<BrowserState>((set) => ({
  sessionId: null,
  tabs: [],
  activeTabId: null,
  devtoolsOpen: false,
  focusTick: 0,

  // 先订阅推送、再拉取初始快照：订阅先就位后拉取期间到达的推送不会丢失，避免推送与拉取竞态
  init: async () => {
    if (initialized) return
    initialized = true
    let offStateChanged: (() => void) | null = null
    let offFocusAddress: (() => void) | null = null
    try {
      offStateChanged = window.api.browser.onStateChanged((snapshot) => {
        applySnapshot(set, snapshot)
      })
      // focusTick 仅是聚焦请求的计数信号，无负载数据，UI 层按计数变化响应
      offFocusAddress = window.api.browser.onFocusAddress(() => {
        set((state) => ({ focusTick: state.focusTick + 1 }))
      })
      const snapshot = await window.api.browser.getState()
      applySnapshot(set, snapshot)
    } catch (error) {
      // 失败复位标志允许下次调用重试；已建立的订阅一并退订，防止重试后重复接收推送
      offStateChanged?.()
      offFocusAddress?.()
      initialized = false
      console.error('初始化浏览器状态失败', error)
    }
  },

  // 主动重拉快照（守卫照常生效）：用于推送已丢、命令回复又不含新快照的路径（删除级联）
  resync: async () => {
    try {
      applySnapshot(set, await window.api.browser.getState())
    } catch (error) {
      console.error('重拉浏览器状态失败', error)
    }
  },

  // 以下命令均不乐观更新：IPC 成功后以返回快照更新，失败保持原状态
  newTab: async (url) => {
    try {
      applySnapshot(set, await window.api.browser.newTab(url === undefined ? {} : { url }))
    } catch (error) {
      console.error('新建标签页失败', error)
    }
  },

  closeTab: async (id) => {
    try {
      applySnapshot(set, await window.api.browser.closeTab({ id }))
    } catch (error) {
      console.error('关闭标签页失败', error)
    }
  },

  switchTab: async (id) => {
    try {
      applySnapshot(set, await window.api.browser.switchTab({ id }))
    } catch (error) {
      console.error('切换标签页失败', error)
    }
  },

  // 移出为独立窗口（临时入口见 TabStrip 右键菜单）：不乐观更新，成功以发起窗口作用域
  // 快照更新（目标窗口的快照由主进程定向推给它）；与 navigate 同规返回 boolean，
  // 失败返回 false 供右键入口给出可见反馈（L3 定案）
  tearOffTab: async (id) => {
    try {
      applySnapshot(set, await window.api.browser.tearOffTab({ id }))
      return true
    } catch (error) {
      console.error('移出标签页失败', error)
      return false
    }
  },

  // 与其他命令不同：导航失败不吞错，返回 false 供地址栏展示「无效的网址」行内提示
  navigate: async (url) => {
    try {
      applySnapshot(set, await window.api.browser.navigate({ url }))
      return true
    } catch (error) {
      console.error('导航失败', error)
      return false
    }
  },

  goBack: async () => {
    try {
      applySnapshot(set, await window.api.browser.back())
    } catch (error) {
      console.error('后退失败', error)
    }
  },

  goForward: async () => {
    try {
      applySnapshot(set, await window.api.browser.forward())
    } catch (error) {
      console.error('前进失败', error)
    }
  },

  reload: async () => {
    try {
      applySnapshot(set, await window.api.browser.reload())
    } catch (error) {
      console.error('刷新失败', error)
    }
  },

  stop: async () => {
    try {
      applySnapshot(set, await window.api.browser.stop())
    } catch (error) {
      console.error('停止加载失败', error)
    }
  },

  // 开发者工具开关与既有命令同规：不乐观更新，IPC 成功后以返回快照更新，失败保持原状态
  toggleDevTools: async () => {
    try {
      applySnapshot(set, await window.api.browser.toggleDevTools())
    } catch (error) {
      console.error('切换开发者工具失败', error)
    }
  },

  // 关闭走独立 close 通道（只关不开，未开启时主进程原子 no-op）：
  // 不读镜像态做守卫，消除「守卫 + toggle」之间推送在途导致的误重开窗口
  closeDevTools: async () => {
    try {
      applySnapshot(set, await window.api.browser.closeDevTools())
    } catch (error) {
      console.error('关闭开发者工具失败', error)
    }
  }
}))
