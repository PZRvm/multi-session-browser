// 地址栏建议下拉原生子窗口共享契约（主进程 / preload / renderer 三方共用）。
// 契约冻结于 notes/plans/20260915225410-地址栏建议下拉原生子窗口化开发计划.md 第 2.4 节。
//
// 承载机制：建议面板由主进程原生子窗口（BrowserWindow）承载——DOM 弹层越过工具栏
// 即被右侧 WebContentsView 原生层遮挡，旧 overlayDepth 整页收起方案以「页面白屏」
// 为代价（评审 L8 取舍），已由本方案取代：面板打开期间页面保持可见可交互（Chrome
// 对齐），原生层零触碰。
//
// 数据流单源：建议检索仍在宿主 shell renderer 本地完成（编辑期检索零 IPC，不变）；
// 面板数据由宿主 shell 经 show 命令全量推送，主进程只做承载（建窗/定位/转发），
// 子窗是纯渲染端——零拉取零自治；hover/pick 仅上报经主进程转发回宿主 shell，
// 键盘与选中状态机唯一在宿主 shell。hide 唯一驱动源是宿主 shell 的面板开合。
// 会话隔离不变量：子窗数据只是宿主 shell 当前作用域会话历史镜像的子集
//（≤ SUGGEST_MAX_RESULTS 条），子窗不持有不拉取任何会话数据。
// 类型只是编译期约定——跨 IPC 边界的运行时守卫在 main 侧落实。

/** 子窗承载的建议条目（宿主 shell 历史镜像的展示子集；url 为点选回传键） */
export interface OmniboxSuggestItemPayload {
  url: string
  title: string
  faviconUrl: string | null
}

/**
 * omnibox host 在宿主窗口内容坐标系（DIP，与 CSS px 同值）下的矩形。
 * 主进程以「宿主 getContentBounds() 原点 + 本矩形 + 面板间距」合成子窗屏幕位
 * （阶段 10 拖拽悬停坐标同款映射）；宿主 move/resize 期间以缓存锚点重算，零
 * renderer 参与
 */
export interface OmniboxSuggestAnchorPayload {
  x: number
  y: number
  width: number
  height: number
}

/** show 命令载荷（幂等全量语义：面板打开期间状态任一变化即重发整包，主进程转发并重定位） */
export interface OmniboxSuggestShowPayload {
  anchor: OmniboxSuggestAnchorPayload
  items: OmniboxSuggestItemPayload[]
  /** 规范化查询（小写、去 scheme/www；子窗命中加粗切分用，与 suggest 同规） */
  query: string
  /** 键盘/悬停高亮行（-1 = 无高亮；子窗渲染 is-active） */
  activeIndex: number
}

/** data 推送载荷（主进程 → 子窗：show 的数据部分，定位信息不下发） */
export interface OmniboxSuggestDataPayload {
  items: OmniboxSuggestItemPayload[]
  query: string
  activeIndex: number
}

/** hovered 推送载荷（子窗悬停行 → 宿主 shell，消费回 setSuggestIndex） */
export interface OmniboxSuggestHoverPayload {
  index: number
}

/** picked 推送载荷（子窗点选行 → 宿主 shell，消费回 pickSuggestion——导航与
 * 失败提示由 shell 既有链驱动，主进程不代收） */
export interface OmniboxSuggestPickPayload {
  url: string
}

/**
 * 建议子窗通道（独立常量对象不并入 BROWSER_CHANNELS 本体——shared/history.ts 先例，
 * 浏览器域通道合计 24 → 31）：
 * - show：宿主 shell → 主进程命令——开/更新面板（定位 + 全量数据；幂等）
 * - hide：宿主 shell → 主进程命令——收起面板（隐藏子窗不销毁，复用）
 * - hover：子窗 → 主进程命令——悬停行上报
 * - pick：子窗 → 主进程命令——点选行上报
 * - data：主进程 → 子窗推送——渲染数据
 * - hovered / picked：主进程 → 宿主 shell 推送——子窗鼠标事件转发（按子窗 parent
 *   归属定向，只达发起面板的宿主窗口）
 */
export const OMNIBOX_SUGGEST_CHANNELS = {
  show: 'omnibox-suggest:show',
  hide: 'omnibox-suggest:hide',
  hover: 'omnibox-suggest:hover',
  pick: 'omnibox-suggest:pick',
  data: 'omnibox-suggest:data',
  hovered: 'omnibox-suggest:hovered',
  picked: 'omnibox-suggest:picked'
} as const

/** 建议子窗载荷文本上限：title/query 超限在主进程守卫层截断归一（与 dragPreview 的标题截断先例同值） */
export const SUGGEST_TEXT_MAX = 200

/** 建议子窗确定性度量（与 app.css 的 .chrome-omnibox-suggest 系同源配对，
 * DESIGN.md「地址栏历史建议」条目注明配对关系——改 CSS 必须同步改这里，反之亦然）：
 * 子窗高度 = min(items.length, SUGGEST_MAX_RESULTS) × SUGGEST_ROW_HEIGHT
 *   + SUGGEST_PANEL_BORDER，超 SUGGEST_PANEL_MAX_HEIGHT 封顶（子窗内滚动）；
 * 子窗 y = anchor.y + anchor.height + SUGGEST_PANEL_GAP
 */
/** 建议行高（.chrome-omnibox-suggest-item height: 30px） */
export const SUGGEST_ROW_HEIGHT = 30
/** 面板上下边框合计（.chrome-omnibox-suggest border 1px × 2） */
export const SUGGEST_PANEL_BORDER = 2
/** 面板与输入框下缘间距（.chrome-omnibox-suggest top: calc(100% + 6px)） */
export const SUGGEST_PANEL_GAP = 6
/** 面板最大高度（.chrome-omnibox-suggest max-height: 298px，超出子窗内滚动） */
export const SUGGEST_PANEL_MAX_HEIGHT = 298
