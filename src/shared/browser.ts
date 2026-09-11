// 浏览器内嵌共享契约（主进程 / preload / renderer 三方共用）。
// 修改本文件的类型或通道名前，必须先修订
// notes/plans/20260911014828-阶段3开发者模式对接开发计划.md 第 3 节。
//
// 事实源约定：tab 列表与全部状态由主进程持有并推送，renderer 只是镜像；
// tab id 由主进程生成（tab-<自增 seq>），renderer 不得自造。

export const BROWSER_CHANNELS = {
  getState: 'browser:get-state',
  newTab: 'browser:new-tab',
  closeTab: 'browser:close-tab',
  switchTab: 'browser:switch-tab',
  navigate: 'browser:navigate',
  back: 'browser:back',
  forward: 'browser:forward',
  reload: 'browser:reload',
  stop: 'browser:stop',
  setBounds: 'browser:set-bounds',
  toggleDevTools: 'browser:toggle-devtools',
  closeDevTools: 'browser:close-devtools',
  stateChanged: 'browser:state-changed',
  focusAddress: 'browser:focus-address'
} as const

/** 单个 Tab 的运行时状态（主进程推送的快照字段） */
export interface BrowserTabState {
  id: string
  url: string
  title: string
  faviconUrl: string | null
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
}

/** 主进程推送的全量快照：tab 有序列表 + 当前激活项 + 激活 Tab 的 DevTools 开关态 */
export interface BrowserSnapshot {
  tabs: BrowserTabState[]
  activeTabId: string | null
  /** 激活 Tab 的 DevTools 是否开启（无激活 Tab 时恒 false）；停靠区显隐随此字段 */
  devtoolsOpen: boolean
}

export interface NewTabPayload {
  url?: string
}

export interface CloseTabPayload {
  id: string
}

export interface SwitchTabPayload {
  id: string
}

export interface NavigatePayload {
  url: string
}

/** renderer 内容区在窗口内容坐标系（DIP，与 CSS px 同值）下的矩形 */
export interface SetBoundsPayload {
  x: number
  y: number
  width: number
  height: number
}

export interface OkResult {
  ok: true
}
