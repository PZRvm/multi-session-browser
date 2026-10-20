// 浏览器内嵌共享契约（主进程 / preload / renderer 三方共用）。
// 修改本文件的类型或通道名前，必须先修订
// notes/plans/20260913200109-阶段10跨窗口转移与生命周期收尾开发计划.md 第 3 节。
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
// 坐标裁决不依赖 dropEffect、60 秒过期）冻结于阶段 9 计划第 3 节。
// 阶段 10 起：拖入升级插入位精确定位（tab-drag-hover 推送可选携带悬停窗内容坐标、
// tab-drag-insert 命令上报目标窗计算的插入位 hint，尽力而为语义——无 hint/陈旧一律
// 回退末位追加）；落盘恢复集升级为全会话归并口径（主窗 Tab 在先 + 独立窗按创建序
// 并入，退出/关窗时序语义见 browser/persistence.ts）。两口径冻结于上述计划第 3 节。
// 2026-09-14 起增页内查找 4 通道（find-start/find-stop 命令 + find-request/find-result
// 推送，契约冻结于会话网页内查找开发计划 2.4 节）。
// 2026-09-18 起快照增 htmlFullscreen 字段（HTML 全屏态）与 TearOffTabManager 内部面
// hasHtmlFullscreen 查询（无新通道）：契约冻结于会话网页视频全屏开发计划第 1 节
//（notes/plans/20260918125946-会话网页视频全屏开发计划.md）。
// 2026-09-25 起增拖出裁决修订：report-tabstrip-rect 命令通道（浏览器域 24→25）+ 四态
// 裁决从「命中窗口 bounds」细化为「命中 Tab 栏矩形」（离开 Tab 栏的一切位置均建新
// 窗，Chrome 对齐）——契约修订记录见 notes/plans/20260925085925-拖出裁决阈值修订.md。
// 2026-09-18 起增 reorder-tabs 命令通道（浏览器域 25→26）：同窗口作用域内 Tab 拖拽
// 重排的全序提交——契约冻结于 tab栏分隔线与栏内拖动排序开发计划 2.4 节
//（notes/plans/20260918140903-tab栏分隔线与栏内拖动排序开发计划.md）。
// 2026-09-25 起增 WebContentsView 页面首帧前兜底底色单源（无新通道，纯主进程消费）
// ——契约冻结于浏览器区兜底底色随主题开发计划 2.4 节
//（notes/plans/20260925003358-浏览器区兜底底色随主题开发计划.md）。

/** 主窗口浏览区的宿主窗口标识：常量跨 macOS 关窗重建稳定；独立窗口用其 BrowserWindow.id 字符串化（创建时由登记表分配） */
export const WINDOW_ID_MAIN = 'main'

export const BROWSER_CHANNELS = {
  getState: 'browser:get-state',
  newTab: 'browser:new-tab',
  closeTab: 'browser:close-tab',
  switchTab: 'browser:switch-tab',
  reorderTabs: 'browser:reorder-tabs',
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
  dragInsert: 'browser:tab-drag-insert',
  reportTabstripRect: 'browser:report-tabstrip-rect',
  findStart: 'browser:find-start',
  findStop: 'browser:find-stop',
  stateChanged: 'browser:state-changed',
  focusAddress: 'browser:focus-address',
  dragHover: 'browser:tab-drag-hover',
  findRequest: 'browser:find-request',
  findResult: 'browser:find-result'
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
  /**
   * 该窗口是否处于 HTML 全屏态（视频全屏按钮等 Fullscreen API 路径）：窗口级槽位
   * （Chrome 语义：全屏挂窗口，切 Tab 保持）。renderer 壳层（Tab 栏/工具栏/主窗
   * 左栏）据此隐藏，内容锚点自然扩满窗口、bounds 沿既有上报链路跟随；退出
   * （ESC/网页按钮）后主进程恢复缓存布局，壳层随本字段回落显现
   */
  htmlFullscreen: boolean
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
 * 同窗口作用域内 Tab 重排（栏内拖拽排序，2026-09-18）：ids 须为该窗作用域全部
 * Tab id 的**无重复全序**（纯重排，不增删）——与 sessions 域 reorder 同款整单校验
 * 口径，集合不符/含未知 id/有重复一律整单拒绝（ipc 层抛错回传，renderer 回滚本地
 * 预览序）。顺序即主进程 tabs Map 迭代序，成功返回该窗作用域新快照
 */
export interface ReorderTabsPayload {
  ids: string[]
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
  /**
   * 显式取消（阶段 10 修订：Esc 放回）：源窗键盘 Esc 收尾携带 true，主进程一律
   * stayed 清场——坐标假想点（源窗内偏移）在源窗与独立窗重叠时会同时命中他窗，
   * 坐标裁决无法区分取消与释放（执行期实例实证）。与阶段 9「不读 dropEffect」
   * 定案不冲突：那是推断不可靠，这是显式信号
   */
  canceled?: true
}

/**
 * 拖拽悬停推送（主进程 → 被拖 Tab 同会话的全部窗口广播）：各窗口与自身 windowId
 * 比对画高亮；hoverWindowId 为 null 表示无悬停或拖拽结束清态。异会话窗口不在
 * 广播集合内（发送侧已过滤）。
 * 阶段 10 增可选 cursorX/cursorY：光标在悬停窗内容坐标系的位置（主进程以
 * getContentBounds 原点起算的 DIP，与 renderer CSS px 同值）——仅 hoverWindowId
 * 非 null 时携带，悬停落点本窗据此计算 Tab 条插入位；坐标取值失败（无边窗等）
 * 省略字段，消费方按无坐标处理（只高亮不指示）。
 */
export interface TabDragHoverPayload {
  sessionId: string
  tabId: string
  hoverWindowId: string | null
  cursorX?: number
  cursorY?: number
}

/**
 * 拖入插入位上报（阶段 10，目标窗 → 主进程的尽力而为 hint 通道）：目标窗 renderer
 * 在自身为悬停落点时按 TabStrip 布局计算插入位（0 = 最左，tabs.length = 末位之后），
 * 仅 index 变化时上报。主进程缓存为 dragEnd 裁决 'moved-window' 的插入位；无上报 /
 * 陈旧（悬停窗已切换）/ 会话不符一律回退末位追加——hint 不是命令语义，主进程守卫
 * 不匹配时静默忽略返回 ok，不抛错。
 */
export interface TabDragInsertPayload {
  tabId: string
  index: number
}

/**
 * Tab 栏矩形上报（拖出裁决修订，窗口 → 主进程的尽力而为布局通道）：TabStrip 根
 * 容器的视口矩形（窗口内容坐标系 DIP，与 CSS px 同值——结构复用 SetBoundsPayload）。
 * TabStrip 挂载/尺寸变化时上报；卸载（HTML 全屏壳层隐藏等）上报零矩形即清除，主
 * 进程据此缓存「窗口 → Tab 栏视口矩形」，裁决时叠加窗口 contentBounds 原点换算
 * 屏幕矩形。fire-and-forget：丢失/陈旧上报的后果是该窗 Tab 栏不可被命中（释放即
 * 走建窗），TabStrip 重挂载/resize 即自愈，不阻断拖拽
 */
export interface TabstripRectPayload {
  x: number
  y: number
  width: number
  height: number
}

/**
 * 拖拽释放裁决结果（dragEnd 命令返回值）：
 * - 'moved-new-window'：空白处释放，已建新独立窗口（落点附近定位）；
 * - 'moved-window'：并入同会话既有窗口（按指示位插入并激活，无指示位时末位追加）；
 * - 'stayed'：原位不动（源窗上释放含 Escape、会话/Tab 已失效等零副作用场景）；
 * - 'rejected'：拒绝（异会话窗口或主窗激活会话不符），源 Tab 原位不丢，源窗回弹。
 */
export type TabDragOutcome = 'moved-new-window' | 'moved-window' | 'stayed' | 'rejected'

export interface NavigatePayload {
  url: string
}

/** findStart 文本长度上限（ipc 层运行时守卫用）：页内查找无超长关键词的合理场景，防御性封顶 */
export const FIND_TEXT_MAX = 200

/**
 * 页内查找发起（find-start 命令）：作用于来源窗口作用域激活 Tab 的 webContents。
 * findNext 语义对齐 Electron findInPage——初搜（输入变化）传 true 自顶部起新会话，
 * 跟进（Enter/Shift+Enter 步进）传 false 沿 forward 方向换向；forward 缺省 true
 */
export interface FindStartPayload {
  text: string
  forward?: boolean
  findNext?: boolean
}

/**
 * 页内查找收尾（find-stop 命令）：action 缺省 'clearSelection'（清除高亮）；
 * 主进程停止查找后对目标 webContents.focus()——关栏焦点归还页面（Chrome 对齐）
 */
export interface FindStopPayload {
  action?: 'clearSelection' | 'keepSelection'
}

/** found-in-page 结果（Electron webContents 'found-in-page' 事件载荷原样，经 findResult 推送下发） */
export interface FoundInPageResult {
  requestId: number
  /** 当前匹配序号（1 起计） */
  activeMatchOrdinal: number
  /** 匹配总数 */
  matches: number
  /** 本轮扫描是否已收尾（中间推送 matches 是扫描进度值，renderer 照常采用——Chrome 同款即时计数） */
  finalUpdate: boolean
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

/**
 * WebContentsView 页面首帧前兜底底色（chrome surface 族，亮暗成对）：主进程建视图时
 * 现取防透明闪烁，主题翻转经 appearance 广播链同步存量视图（只随亮暗两态，主题色不
 * 入右区）。主进程不读 CSS——本常量与 app.css `--chrome-surface` token、DESIGN.md
 * 「Chrome 侧」色板三处字面量对账，改一处须同步其余两处。
 */
export const BROWSER_VIEW_FALLBACK_BACKGROUND = {
  light: '#ffffff',
  dark: '#202124'
} as const

/** 兜底底色取值：resolved 亮暗与 shared/appearance 的 ResolvedTheme 同构（'light' | 'dark'） */
export function browserViewFallbackBackground(resolved: 'light' | 'dark'): string {
  return BROWSER_VIEW_FALLBACK_BACKGROUND[resolved]
}

/**
 * 页面加载失败错误卡配色（2026-10-20 交互修复专项）：主 frame 加载失败后 manager 向
 * 该 Tab view 注入自绘错误卡——Electron 无 Chromium 内建错误页资源，失败落
 * chrome-error 空白页（2026-10-20 探针实测），不自绘即与加载中不可区分的白屏。
 * bg 复用兜底底色单源；墨色/线色/蒙版与 app.css chrome-* token、DESIGN.md「Chrome 侧」
 * 色板三处字面量对账，改一处须同步其余两处。只随亮暗两态，主题色不入右区。
 */
export interface BrowserErrorCardPalette {
  bg: string
  ink: string
  inkDim: string
  line: string
  hoverVeil: string
  activeVeil: string
  selectVeil: string
}

export function browserErrorCardPalette(resolved: 'light' | 'dark'): BrowserErrorCardPalette {
  if (resolved === 'dark') {
    return {
      bg: BROWSER_VIEW_FALLBACK_BACKGROUND.dark,
      ink: '#e8eaed',
      inkDim: '#bdc1c6',
      line: '#3c4043',
      hoverVeil: 'rgba(232, 234, 237, 0.08)',
      activeVeil: 'rgba(232, 234, 237, 0.14)',
      selectVeil: 'rgba(232, 234, 237, 0.2)'
    }
  }
  return {
    bg: BROWSER_VIEW_FALLBACK_BACKGROUND.light,
    ink: '#3c4043',
    inkDim: '#5f6368',
    line: '#c7cbd1',
    hoverVeil: 'rgba(60, 64, 67, 0.08)',
    activeVeil: 'rgba(60, 64, 67, 0.1)',
    selectVeil: 'rgba(60, 64, 67, 0.14)'
  }
}

/**
 * 错误码 → 可读原因键的单源映射（2026-10-20 交互修复专项）：did-fail-load 的数字
 * 错误码为主判据，描述串前缀为证书族兜底（ERR_CERT_* 区段不连续，数字表难穷举）；
 * 未映射返回 null，调用方回退通用标题——不猜测不引申，原码恒并列展示。文案键对应
 * shared/i18n browser.pageError.reasons.*。
 */
export type PageErrorReasonKey =
  'dns' | 'refused' | 'timeout' | 'reset' | 'offline' | 'proxy' | 'cert' | 'empty' | 'fileNotFound'

export function pageErrorReasonKey(
  errorCode: number,
  errorDescription: string
): PageErrorReasonKey | null {
  if (
    errorDescription.startsWith('net::ERR_CERT_') ||
    errorDescription.startsWith('net::ERR_SSL_')
  ) {
    return 'cert'
  }
  const BY_CODE: Record<number, PageErrorReasonKey> = {
    [-105]: 'dns', // ERR_NAME_NOT_RESOLVED
    [-102]: 'refused', // ERR_CONNECTION_REFUSED
    [-7]: 'timeout', // ERR_CONNECTION_TIMED_OUT
    [-118]: 'timeout', // ERR_TIMED_OUT
    [-101]: 'reset', // ERR_CONNECTION_RESET
    [-106]: 'offline', // ERR_INTERNET_DISCONNECTED
    [-130]: 'proxy', // ERR_PROXY_CONNECTION_FAILED
    [-107]: 'cert', // ERR_SSL_PROTOCOL_ERROR
    [-324]: 'empty', // ERR_EMPTY_RESPONSE
    [-6]: 'fileNotFound' // ERR_FILE_NOT_FOUND
  }
  return BY_CODE[errorCode] ?? null
}
