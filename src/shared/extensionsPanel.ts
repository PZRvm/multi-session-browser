// 扩展面板原生子窗口共享契约（主进程 / preload / renderer 三方共用）。
// 契约见 book/plans/20261111-扩展面板原生子窗口化.md Phase 2。
//
// 承载机制（omniboxSuggest 同款）：扩展面板由主进程原生子窗口（BrowserWindow）承载
// ——DOM 弹层越过工具栏即被右侧 WebContentsView 原生层遮挡，旧 overlayDepth 整页收
// 起方案以「页面白屏」为代价，本方案取代之：面板打开期间页面保持可见可交互（Chrome
// 对齐），原生层零触碰，overlayDepth 不再登记。
//
// 与建议子窗的两处刻意分歧（plan Phase 1）：
// 1. focusable:true + blur 关闭（action popup 先例）：外点含页面区点击即关（Chrome
//    菜单语义；建议面板是键盘驱动无需此项）；
// 2. enablePreferredSizeMode 高度自适应（action popup 先例）：面板高度随条目数变化，
//    免行数度量常量配对；宽度恒 360 常量。
//
// 数据流单源：面板数据由宿主 shell 经 show 命令全量推送（打开时现取 extensions:list
// 一发全量），主进程只做承载（建窗/定位/转发），子窗纯渲染零自治零拉取；pick 仅上报
// 经主进程转发回宿主 shell，open/manage/close/togglePin 四语义状态机唯一在宿主 shell。类型只
// 是编译期约定——跨 IPC 边界的运行时守卫在 main 侧落实。

import type { ExtensionListItem } from './extensions/management'

/** 子窗角色 query 值（main.tsx 角色分流 + 主进程建窗注入） */
export const EXTENSIONS_PANEL_WINDOW_ROLE = 'extensions-panel'

/** 子窗高度下限（工作区下方空间小于此值时拒绝展示；列表溢出走 CSS 滚动） */
export const EXTENSIONS_PANEL_MIN_HEIGHT = 120
/** 子窗高度上限（preferred-size 超出后钳制，超出部分 CSS 滚动承担） */
export const EXTENSIONS_PANEL_MAX_HEIGHT = 600
/** 面板宽度（CSS .chrome-ext-panel 承载态 width 与本常量对账，改一处必改另一处） */
export const EXTENSIONS_PANEL_WIDTH = 360
/** 阴影环带宽（双层短模糊 box-shadow 的 3σ 在 24px 内归零，同建议面板 SUGGEST_SHADOW_MARGIN） */
export const EXTENSIONS_PANEL_SHADOW_MARGIN = 24

/** 拼图按钮在宿主窗口内容坐标系（DIP 与 CSS px 同值）下的矩形 */
export interface ExtensionsPanelAnchorPayload {
  x: number
  y: number
  width: number
  height: number
}

/** show 命令载荷（幂等全量：打开即整包，主进程转发并定位） */
export interface ExtensionsPanelShowPayload {
  anchor: ExtensionsPanelAnchorPayload
  items: ExtensionListItem[]
}

/** data 推送载荷（主进程 → 子窗：show 的数据部分，定位信息不下发） */
export interface ExtensionsPanelDataPayload {
  items: ExtensionListItem[]
}

/** pick 上报载荷（子窗 → 主进程转发回宿主 shell，四语义） */
export interface ExtensionsPanelPickPayload {
  kind: 'open' | 'manage' | 'close' | 'togglePin'
  /** kind=open/togglePin 时必填的扩展 ID */
  id?: string
  /** kind=togglePin 时必填的固定目标态（面板按 item.pinned 取反后传入） */
  pinned?: boolean
}

/** 主进程 → 宿主 shell 的 picked 转发载荷（与 pick 同构，主进程白名单校验后定向转发） */
export interface ExtensionsPanelPickedPayload {
  kind: 'open' | 'manage' | 'close' | 'togglePin'
  id?: string
  pinned?: boolean
}

export interface ExtensionsPanelChannels {
  show: 'extensions-panel:show'
  hide: 'extensions-panel:hide'
  pick: 'extensions-panel:pick'
  setMousePassthrough: 'extensions-panel:set-mouse-passthrough'
  data: 'extensions-panel:data'
  picked: 'extensions-panel:picked'
  closed: 'extensions-panel:closed'
}

export const EXTENSIONS_PANEL_CHANNELS: ExtensionsPanelChannels = {
  show: 'extensions-panel:show',
  hide: 'extensions-panel:hide',
  pick: 'extensions-panel:pick',
  setMousePassthrough: 'extensions-panel:set-mouse-passthrough',
  data: 'extensions-panel:data',
  picked: 'extensions-panel:picked',
  closed: 'extensions-panel:closed'
} as const
