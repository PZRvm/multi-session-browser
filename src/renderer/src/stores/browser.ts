import { create } from 'zustand'
import type { BrowserSnapshot, BrowserTabState } from '../../../shared/browser'

// 浏览器状态是主进程快照的纯镜像：tabs/activeTabId/devtoolsOpen 原样存储不加工，
// 本地不造任何 tab 字段；激活 tab 等派生值由组件用 selector 自行计算。
// setBounds 属布局上报，不进 store。
interface BrowserState {
  tabs: BrowserTabState[]
  activeTabId: string | null
  devtoolsOpen: boolean
  focusTick: number
  init: () => Promise<void>
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
}

let initialized = false

// 推送与命令返回值同构，以主进程数据为唯一事实源；双到达重复 set 幂等无害
const applySnapshot = (
  set: (partial: Partial<BrowserState>) => void,
  { tabs, activeTabId, devtoolsOpen }: BrowserSnapshot
): void => {
  set({ tabs, activeTabId, devtoolsOpen })
}

export const useBrowserStore = create<BrowserState>((set) => ({
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
