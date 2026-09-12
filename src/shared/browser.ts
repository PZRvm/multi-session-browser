// 浏览器内嵌共享契约（主进程 / preload / renderer 三方共用）。
// 修改本文件的类型或通道名前，必须先修订
// notes/plans/20260912221518-阶段7与8合并独立窗口宿主与创建开发计划.md 第 3 节。
//
// 事实源约定：tab 列表与全部状态由主进程持有并推送，renderer 只是镜像；
// tab id 由主进程生成（tab-<自增 seq>），renderer 不得自造。
// 阶段 4 起：命令通道作用于"当前激活会话"的浏览器（注册表路由，见
// src/main/browser/registry.ts）。
// 阶段 7—8 起：命令通道按来源窗口作用域路由（ipc 层经 event.sender 识别）——
// 主窗口来源 → 激活会话的 'main' 作用域；独立窗口来源 → 该窗口绑定会话的作用域
// （独立窗口登记表见 src/main/browser/windows.ts）；来源无法解析 → 拒绝。
// 快照按窗口作用域构建并定向推送（windowId 标识归属窗口），通道 payload 不变。

/** 主窗口浏览区的宿主窗口标识：常量跨 macOS 关窗重建稳定；独立窗口用其 BrowserWindow.id 字符串化（创建时由登记表分配） */
export const WINDOW_ID_MAIN = 'main'

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
  tearOffTab: 'browser:tear-off-tab',
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

/**
 * 主进程推送的全量快照：tab 有序列表 + 当前激活项 + 激活 Tab 的 DevTools 开关态，
 * 全部按窗口作用域构建——只含该窗口托管的 tabs 与该窗口的激活位。
 * windowId：快照归属的宿主窗口（WINDOW_ID_MAIN 或独立窗口 id）；renderer 守卫据此
 * 过滤过期/异窗推送（主窗口模式另叠会话守卫，独立窗口模式只比对 windowId）。
 * sessionId：该快照归属的会话（阶段 4 会话绑定）；null = 无激活会话的空浏览器态，
 * 此时 tabs 恒 []、activeTabId 恒 null、devtoolsOpen 恒 false。renderer 据此丢弃
 * 与当前选中会话不符的过期快照（快速连续切换时旧会话推送可能晚到）。
 */
export interface BrowserSnapshot {
  windowId: string
  sessionId: string | null
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

/** 移出 Tab 为独立窗口（阶段 7—8 临时入口为 Tab 条右键菜单；阶段 9 拖拽手势替换入口，通道语义保留） */
export interface TearOffTabPayload {
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
