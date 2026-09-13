// 浏览器内嵌共享契约（主进程 / preload / renderer 三方共用）。
// 修改本文件的类型或通道名前，必须先修订
// notes/plans/20260913023538-阶段9拖出拖入手势开发计划.md 第 3 节。
//
// 事实源约定：tab 列表与全部状态由主进程持有并推送，renderer 只是镜像；
// tab id 由主进程生成（tab-<自增 seq>），renderer 不得自造。
// 阶段 4 起：命令通道作用于"当前激活会话"的浏览器（注册表路由，见
// src/main/browser/registry.ts）。
// 阶段 7—8 起：命令通道按来源窗口作用域路由（ipc 层经 event.sender 识别）——
// 主窗口来源 → 激活会话的 'main' 作用域；独立窗口来源 → 该窗口绑定会话的作用域
// （独立窗口登记表见 src/main/browser/windows.ts）；来源无法解析 → 拒绝。
// 快照按窗口作用域构建并定向推送（windowId 标识归属窗口），通道 payload 不变。
// 阶段 9 起：tear-off 的 renderer 入口随临时右键菜单退役（tear-off 的 IPC 通道已删，
// 建窗/迁移编排下沉为主进程内部接口，由拖拽控制器复用）；新增拖拽手势通道
// （tab-drag-start/end 命令 + tab-drag-hover 推送）——拖拽会话语义（单活动会话、
// 坐标裁决不依赖 dropEffect、60 秒过期）冻结于上述计划第 3 节。

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
  dragStart: 'browser:tab-drag-start',
  dragEnd: 'browser:tab-drag-end',
  stateChanged: 'browser:state-changed',
  focusAddress: 'browser:focus-address',
  dragHover: 'browser:tab-drag-hover'
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

/**
 * 拖拽跟随虚影描述（dragStart 可选携带）：主进程据此建透明置顶预览窗，渲染与源
 * Tab 同尺寸的卡片（Chrome 同款手感）。grabX/grabY 为按下点在卡片内的偏移——
 * 虚影锚定抓取点跟随光标（bounds = 光标 - 偏移）；theme 为当前解析后的亮暗，
 * 与应用壳一致。跟随由主进程 16ms 光标轮询驱动，窗口期外不存在。
 */
export interface TabDragPreviewPayload {
  width: number
  height: number
  grabX: number
  grabY: number
  title: string
  faviconUrl: string | null
  theme: 'light' | 'dark'
}

/** 拖拽开始上报（作用域 = 发起窗口，被拖 Tab 必属该作用域；主进程据此开启拖拽会话、悬停轮询与可选的跟随虚影） */
export interface TabDragStartPayload {
  id: string
  preview?: TabDragPreviewPayload
}

/**
 * 拖拽结束上报：落点屏幕坐标（DIP 屏幕系，取拖拽释放事件的 screenX/screenY——
 * 指针捕获手势的 pointerup）。
 * 取消判定不依赖 dropEffect（阶段 9 冒烟定案：合成路径 dropEffect/effectAllowed
 * setter 无效，真实路径中空白释放/异窗释放/Escape 同为 'none' 无法区分）——
 * 主进程一律按坐标裁决；Escape 由 renderer 以源窗内坐标收尾上报，落 'stayed'。
 */
export interface TabDragEndPayload {
  id: string
  screenX: number
  screenY: number
}

/**
 * 拖拽悬停推送（主进程 → 被拖 Tab 同会话的全部窗口广播）：各窗口与自身 windowId
 * 比对画高亮；hoverWindowId 为 null 表示无悬停或拖拽结束清态。异会话窗口不在
 * 广播集合内（发送侧已过滤）。
 */
export interface TabDragHoverPayload {
  sessionId: string
  tabId: string
  hoverWindowId: string | null
}

/**
 * 拖拽释放裁决结果（dragEnd 命令返回值）：
 * - 'moved-new-window'：空白处释放，已建新独立窗口（落点附近定位）；
 * - 'moved-window'：并入同会话既有窗口（追加末位并激活）；
 * - 'stayed'：原位不动（源窗上释放含 Escape、会话/Tab 已失效等零副作用场景）；
 * - 'rejected'：拒绝（异会话窗口或主窗激活会话不符），源 Tab 原位不丢，源窗回弹。
 */
export type TabDragOutcome = 'moved-new-window' | 'moved-window' | 'stayed' | 'rejected'

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
