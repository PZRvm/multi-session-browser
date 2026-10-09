import { create } from 'zustand'
import type {
  BrowserSnapshot,
  BrowserTabState,
  FoundInPageResult,
  TabDragHoverPayload,
  TabDragOutcome,
  TabDragPreviewPayload
} from '../../../shared/browser'
import { WINDOW_ID_MAIN } from '../../../shared/browser'
import type { CaptureFeedbackShowPayload } from '../../../shared/capture'
import type { HistoryChangedPayload, HistoryEntry } from '../../../shared/history'
import { createT, DICTIONARIES } from '../../../shared/i18n'
import { readableIpcError } from './settings'
import { useI18nStore } from './i18n'
import { useSessionsStore } from './sessions'

// 浏览器状态是主进程快照的纯镜像：sessionId/tabs/activeTabId/devtoolsOpen 原样存储
// 不加工，本地不造任何 tab 字段；激活 tab 等派生值由组件用 selector 自行计算。
// setBounds 属布局上报，不进 store。
interface BrowserState {
  sessionId: string | null
  tabs: BrowserTabState[]
  activeTabId: string | null
  devtoolsOpen: boolean
  /** 该窗口 HTML 全屏态镜像（视频全屏等，窗口级）：壳层组件据此隐藏/显现 */
  htmlFullscreen: boolean
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
  // 页内查找瞬态（本窗口 shell 查找栏，Cmd/Ctrl+F）：纯本地 UI 态，不进快照契约、
  // 不落盘、主进程零感知（比照上方拖拽瞬态口径）；findQuery 关栏保留（Chrome 重开
  // 重搜语义），计数以 found-in-page 推送为唯一事实源，本地不推算
  findOpen: boolean
  findQuery: string
  /** 当前匹配序号（引擎 1 起计；0 = 尚无结果） */
  findOrdinal: number
  findMatches: number
  /** 查找结果已到达标志：输入/重搜后首个回执前为 false——计数区留白不闪红 0/0（审查 L6） */
  findResolved: boolean
  /** find-request 推送/shell 开栏的计数信号：FindBar 据此聚焦并全选输入框 */
  findRequestTick: number
  // 快速截图瞬态（本窗口作用域）：lastCaptureId/captureSaving 为纯本地态，不进快照
  // 契约、不落盘（比照拖拽/查找瞬态口径）；反馈条渲染态在原生子窗（反馈轮三），
  // 本地不再持有
  /** 最近一次截图 captureId 镜像（「下载」次动作对账：主进程单槽，新截图覆盖） */
  lastCaptureId: string | null
  /** 「下载」在途锁（防回程连点重复落盘） */
  captureSaving: boolean
  init: () => Promise<void>
  /** 重拉当前快照对齐主进程（删除会话等场景：级联推送先于命令回复到达而被守卫丢弃） */
  resync: () => Promise<void>
  newTab: (url?: string) => Promise<void>
  closeTab: (id: string) => Promise<void>
  switchTab: (id: string) => Promise<void>
  /** 同窗口 Tab 重排（栏内拖拽排序）：全序提交，成功以返回快照更新，失败保持原状 */
  reorderTabs: (ids: string[]) => Promise<void>
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
  /** 打开查找栏：query 非空即重发初搜（Chrome 重开重搜语义）；重复调用幂等（仅刷新聚焦信号） */
  openFind: () => void
  /** 关闭查找栏并清高亮复位计数（findStop fire-and-forget）；findQuery 保留供下次开栏 */
  closeFind: () => void
  /** 输入变化：非空发初搜（findNext=true 自顶部起），清空则停引擎清高亮（栏保持开） */
  searchFind: (query: string) => void
  /** Enter/Shift+Enter 步进（findNext=false 沿 forward 换向）；栏未开或 query 为空 no-op */
  findNextStep: (forward: boolean) => void
  /** 导入完成后重拉当前作用域会话的历史镜像（Chrome 导入专项）：复用全量拉取链路 */
  refetchHistory: () => void
  /** 快速截图：截当前激活 Tab 入剪贴板，成功置反馈条（含「下载」次动作），失败置
   *  danger 反馈（主进程已本地化的错误优先，兜底 browser.capture.failed） */
  capture: () => Promise<void>
  /** 「下载」次动作：最近一次截图落盘系统下载目录（captureId 对账，过期由主进程
   *  拒绝并上浮「截图已过期」） */
  saveLastCapture: () => Promise<void>
}

let initialized = false

// 截图反馈条自动消退定时器（batchFeedback 时序先例）：success 6000ms 后置 fading
//（2026-10-10 用户反馈：原 2400ms 偏短，需留足点「下载」的时间），再 260ms 卸载；
// 截图反馈显隐编排（反馈轮三：反馈条由原生子窗承载——全宽贴宿主内容区顶缘、
// 覆盖在网页上方、宿主布局零压缩〔消失即整窗 hide，无布局回弹空白〕；用户定稿：
// 宽 100% 贴导航栏下方）：success 6s 后整窗隐藏，danger 不排定时器、持续至下一次
// 截图动作（审查低-3：主窗会话漂移时亦收起，编排见 applySnapshot 漂移分支）
const CAPTURE_FEEDBACK_VISIBLE_MS = 6000

let captureHideTimer: number | null = null

// 最近一次已发 show-feedback 的完整载荷镜像（审查低-2 resize 跟随用）：重发时复用
// 其 kind/text/actionLabel 组配新锚点，保证条内容与原条完全一致；随收起/重挂清空
let captureFeedbackShown: CaptureFeedbackShowPayload | null = null

// 宿主内容区 resize 跟随观察器（审查低-2）：show-feedback 锚点是显示时刻快照，
// 主进程 follow 只按缓存锚点重定位——宿主 resize 后条宽不跟随（变宽不满宽、变窄
// 右侧溢出）。显示期间观察 .chrome-body，尺寸变化即以相同 kind/text/actionLabel +
// 新锚点幂等重发 showFeedback（主进程池对已有子窗是幂等全量更新：重定位 + 重推
// 内容 + showInactive，安全）；danger 持续显示期间保持存活（跟随 resize），直到
// 下一次截图动作或 hide
let captureResizeObserver: ResizeObserver | null = null

function clearCaptureTimer(): void {
  if (captureHideTimer !== null) {
    window.clearTimeout(captureHideTimer)
    captureHideTimer = null
  }
}

/** 收起本地反馈编排态（定时器 + resize 跟随 + 内容镜像）：重挂（下一次
 *  showCaptureFeedback）、6s 自动隐藏、会话漂移隐藏三路共用，防 observer 泄漏 */
function teardownCaptureFeedback(): void {
  clearCaptureTimer()
  captureResizeObserver?.disconnect()
  captureResizeObserver = null
  captureFeedbackShown = null
}

/** 显示悬浮反馈条：组装已本地化内容 + chrome-body 锚点（左缘/顶缘/宽度，客户端
 * 坐标 DIP——反馈条贴内容区顶缘全宽覆盖在网页上方），经 show-feedback 交主进程
 * 子窗池承载；fire-and-forget（失败静默——反馈属尽力而为通知，截图/落盘主链路
 * 结果不依赖它） */
function showCaptureFeedback(kind: 'copied' | 'saved' | 'danger', text: string): void {
  teardownCaptureFeedback()
  const body = document.querySelector('.chrome-body')
  const rect = body?.getBoundingClientRect()
  const anchorLeft = rect ? rect.left : 0
  const anchorTop = rect ? rect.top : 0
  const anchorWidth = rect ? rect.width : window.innerWidth
  const t = storeT()
  const payload: CaptureFeedbackShowPayload = {
    kind,
    text,
    ...(kind === 'copied' ? { actionLabel: t('browser.capture.download') } : {}),
    anchorLeft,
    anchorTop,
    anchorWidth
  }
  captureFeedbackShown = payload
  window.api.capture.showFeedback(payload).catch(() => {})
  // resize 跟随挂载：锚点未变的事件（含观察开始的首次回调）与宿主元素已脱离文档
  //（零会话空态卸载等，反馈即将随会话漂移路径收起）不重发
  if (body) {
    captureResizeObserver = new ResizeObserver(() => {
      const shown = captureFeedbackShown
      if (!shown || !body.isConnected) return
      const next = body.getBoundingClientRect()
      if (
        next.left === shown.anchorLeft &&
        next.top === shown.anchorTop &&
        next.width === shown.anchorWidth
      ) {
        return
      }
      captureFeedbackShown = {
        ...shown,
        anchorLeft: next.left,
        anchorTop: next.top,
        anchorWidth: next.width
      }
      window.api.capture.showFeedback(captureFeedbackShown).catch(() => {})
    })
    captureResizeObserver.observe(body)
  }
  if (kind !== 'danger') {
    captureHideTimer = window.setTimeout(() => {
      captureHideTimer = null
      teardownCaptureFeedback()
      window.api.capture.hideFeedback().catch(() => {})
    }, CAPTURE_FEEDBACK_VISIBLE_MS)
  }
}

/** store 层取当前语言字典的 t（无 hook 语境：动作内组装已本地化反馈文案） */
function storeT(): ReturnType<typeof createT> {
  return createT(DICTIONARIES[useI18nStore.getState().language])
}

/** 截图动作失败文案：主进程 t() 上浮的已本地化消息经 readableIpcError 剥 invoke
 * 包装壳（「Error invoking remote method …」前缀）后透出，剥不出用通用句兜底
 * （审查中 2 修复——纯中文界面原则，settings store 同款剥壳先例） */
function captureErrorText(error: unknown): string {
  return readableIpcError(error, storeT()('browser.capture.failed'))
}

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

/**
 * 主窗自绘窗口控制钮门控（2026-09-20 主窗去原生标题条专项）：建窗 query winc=traffic
 * 仅 darwin 主窗携带（主进程 index.ts 单源注入，renderer 不经 navigator 推断平台，
 * 对齐设置窗 chrome=custom-close 单源纪律）；独立窗/Windows/Linux 不携带 → 不渲染
 * 自绘钮（独立窗当前保持原生标题栏，契约见 shared/window.ts 头注）
 */
export const windowTrafficControls =
  new URLSearchParams(window.location.search).get('winc') === 'traffic'

// 历史镜像重拉的过期判据（单调递增 token）：快速连续切换会话时，只有最新一次
// 重拉的回填生效，晚到的旧回复整体丢弃（独立窗绑定恒定，token 同样防重入叠加）
let historyPullToken = 0

// 页内查找 0 命中的自动重搜判据（实验定案：Chromium find 对刚加载完成的页面存在
// 非确定性瞬时假阴性——同一加载完成的页面首搜 0 命中、稍后同参重搜全量命中，引擎
// 内部行为应用无法预判）。finalUpdate 且 0 命中且同 query 未重试过 → 延迟重发一次
// 初搜；重搜仍 0 即为真实无匹配，如实显 0/0。query 变化即重置预算
let findRetryQuery: string | null = null

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

/**
 * 页内查找瞬态的快照失效补丁（审查 L3 抽出为纯函数）：栏开才有意义——切会话/切激活
 * Tab → 关栏复位计数（findQuery 保留，重开重搜）；同 Tab 导航（激活 Tab url 变化）→
 * 栏保持开、仅复位计数与结果到达标志。均不发 IPC——高亮清理由主进程摘 view 源头
 * 保证与 Chromium 导航语义承担
 */
function findPatchFor(
  state: BrowserState,
  snapshot: Pick<BrowserSnapshot, 'sessionId' | 'tabs' | 'activeTabId'>,
  sessionDrifted: boolean
): Partial<BrowserState> {
  if (!state.findOpen) return {}
  const prevActive =
    state.activeTabId !== null ? state.tabs.find((t) => t.id === state.activeTabId) : undefined
  const nextActive =
    snapshot.activeTabId !== null
      ? snapshot.tabs.find((t) => t.id === snapshot.activeTabId)
      : undefined
  if (sessionDrifted || state.activeTabId !== snapshot.activeTabId) {
    return { findOpen: false, findOrdinal: 0, findMatches: 0, findResolved: false }
  }
  if (prevActive && nextActive && prevActive.url !== nextActive.url) {
    return { findOrdinal: 0, findMatches: 0, findResolved: false }
  }
  return {}
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
  const { sessionId, tabs, activeTabId, devtoolsOpen, htmlFullscreen } = snapshot
  set((state) => ({
    sessionId,
    tabs,
    activeTabId,
    devtoolsOpen,
    htmlFullscreen,
    history: sessionDrifted ? [] : state.history,
    // 拖拽瞬态自愈（阶段 9）：快照已不含被拖 Tab（主进程在裁决/级联中先行移除、
    // 或会话切换重排）时清掉本地拖拽源态——dragend 可能因此在已卸载组件上不可达
    // （React 合成事件不派发到脱离文档的节点），卸载路径由此兜底，不悬挂半透明态
    draggingTabId:
      state.draggingTabId !== null && !tabs.some((t) => t.id === state.draggingTabId)
        ? null
        : state.draggingTabId,
    // 页内查找失效补丁（语义见 findPatchFor）
    ...findPatchFor(state, snapshot, sessionDrifted)
  }))
  if (sessionDrifted && snapshot.sessionId !== null) void refreshHistory(set, get)
  // 会话漂移即收起悬浮反馈条（审查低-3）：danger 定稿语义为持续至下一次截图动作，
  // 但主窗会话已漂移时陈旧反馈仍悬于新会话内容上方（与查找栏「切 Tab 即关」同
  // 语义；此路需补发 IPC——反馈子窗归主进程，摘 view 清不掉它）；fire-and-forget
  // 失败静默（反馈属尽力而为通知）。漂移判断复用 sessionDrifted：镜像随每次快照
  // 更新，仅在 sessionId 实际变化的那一次为 true，不逐快照触发；独立窗无需此路
  //——会话建窗绑定恒定，异窗快照已被上方守卫丢弃
  if (windowIdentity.mode === 'main' && sessionDrifted) {
    teardownCaptureFeedback()
    window.api.capture.hideFeedback().catch(() => {})
  }
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
  htmlFullscreen: false,
  focusTick: 0,
  draggingTabId: null,
  hoverWindowId: null,
  dragCursorX: null,
  dragCursorY: null,
  dragHoverTabId: null,
  history: [],
  findOpen: false,
  findQuery: '',
  findOrdinal: 0,
  findMatches: 0,
  findResolved: false,
  findRequestTick: 0,
  lastCaptureId: null,
  captureSaving: false,

  // 先订阅推送、再拉取初始快照：订阅先就位后拉取期间到达的推送不会丢失，避免推送与拉取竞态
  init: async () => {
    if (initialized) return
    initialized = true
    let offStateChanged: (() => void) | null = null
    let offFocusAddress: (() => void) | null = null
    let offDragHover: (() => void) | null = null
    let offHistoryChanged: (() => void) | null = null
    let offFindRequest: (() => void) | null = null
    let offFindResult: (() => void) | null = null
    let offCaptureRequest: (() => void) | null = null
    let offCaptureDownload: (() => void) | null = null
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
      // 页面聚焦态 Cmd/Ctrl+F 唤起查找栏（find-request 定向推送）：与 shell 侧快捷键
      // 汇合同一 openFind（tick 信号驱动 FindBar 聚焦/全选）；计数控 find-result 推送
      offFindRequest = window.api.browser.onFindRequest(() => {
        get().openFind()
      })
      // 页面聚焦态自定义截图快捷键（capture:request 定向推送，快速截图专项）：与
      // 工具栏钮、shell 侧快捷键三路汇流同一 capture（反馈条随动）
      offCaptureRequest = window.api.capture.onRequest(() => {
        void get().capture()
      })
      // 「下载」点击回程（反馈轮三：反馈子窗 action 上报经主进程转发本窗）：与
      // 工具栏钮/快捷键同作用域，汇流同一 saveLastCapture（in-flight 锁防回程连点）
      offCaptureDownload = window.api.capture.onDownloadRequest(() => {
        void get().saveLastCapture()
      })
      offFindResult = window.api.browser.onFindResult((result: FoundInPageResult) => {
        // 栏开才采用：关栏后的迟到回执不复活旧态
        if (!get().findOpen) return
        set({
          findOrdinal: result.activeMatchOrdinal,
          findMatches: result.matches,
          findResolved: true
        })
        // 瞬时假阴性兜底（见 findRetryQuery 注释）：0 命中收尾且本 query 未重试过 →
        // 150ms 后自动重发一次初搜；fire-and-forget，失败静默（与命令同口径）
        if (
          result.finalUpdate &&
          result.matches === 0 &&
          get().findQuery &&
          findRetryQuery !== get().findQuery
        ) {
          findRetryQuery = get().findQuery
          window.setTimeout(() => {
            const query = get().findQuery
            if (get().findOpen && query && findRetryQuery === query) {
              window.api.browser
                .findStart({ text: query, forward: true, findNext: true })
                .catch(() => {})
            }
          }, 150)
        }
      })
      const snapshot = await window.api.browser.getState()
      applySnapshot(set, get, snapshot)
    } catch (error) {
      // 失败复位标志允许下次调用重试；已建立的订阅一并退订，防止重试后重复接收推送
      offStateChanged?.()
      offFocusAddress?.()
      offDragHover?.()
      offHistoryChanged?.()
      offFindRequest?.()
      offFindResult?.()
      offCaptureRequest?.()
      offCaptureDownload?.()
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

  // Chrome 导入专项：导入不经 recordVisit 链路（无逐条增量推送——2000 条推送风暴已
  // 否决），完成后全量重拉一次。镜像本就只属于当前作用域会话：导入目标非激活会话时
  // 本次重拉结果与导入无关，无害
  refetchHistory: () => {
    refreshHistory(set, get)
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

  // 重排与其他命令同规：不乐观更新（本地预览序由 useTabReorder 持有），IPC 成功以
  // 返回快照更新（全序覆盖），失败保持原状——预览序已由手势层清空即自然回滚
  reorderTabs: async (ids) => {
    try {
      applySnapshot(set, get, await window.api.browser.reorderTabs({ ids }))
    } catch (error) {
      console.error('标签页排序失败', error)
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
  },

  // 页内查找四动作：renderer 瞬态 + fire-and-forget 命令（失败静默——查找属尽力而为
  // 交互，计数以 find-result 推送为准，命令未达即无计数，不误导航不伪造状态）。
  // find-request 推送与 shell 快捷键汇合同一 openFind，tick 驱动 FindBar 聚焦/全选
  openFind: () => {
    set((state) => ({
      findOpen: true,
      findRequestTick: state.findRequestTick + 1,
      // 重开重搜期间计数留白（首个回执前不显红 0/0）
      findResolved: false
    }))
    findRetryQuery = null
    const { findQuery } = get()
    // query 非空的重开即重搜（Chrome 重开重搜语义；初搜恒 findNext=true 自顶部起）
    if (findQuery) {
      window.api.browser
        .findStart({ text: findQuery, forward: true, findNext: true })
        .catch(() => {})
    }
  },

  closeFind: () => {
    if (!get().findOpen) return
    set({ findOpen: false, findOrdinal: 0, findMatches: 0, findResolved: false })
    // 主进程 findStop：清高亮 + 焦点归还页面（Chrome 对齐）；快照守卫触发的关栏
    // 不经此路（该路径不发 findStop，高亮已由主进程摘 view 源头清理）
    window.api.browser.findStop().catch(() => {})
  },

  searchFind: (query) => {
    // query 变化重置重搜预算（重搜回执的 set 不经此处，不会误重置）
    if (query !== get().findQuery) findRetryQuery = null
    set({ findQuery: query, findOrdinal: 0, findMatches: 0, findResolved: false })
    if (query) {
      window.api.browser.findStart({ text: query, forward: true, findNext: true }).catch(() => {})
    } else {
      // 关键词清空：停引擎清高亮，栏保持开（下一步输入即新会话初搜）
      window.api.browser.findStop().catch(() => {})
    }
  },

  findNextStep: (forward) => {
    const { findOpen, findQuery } = get()
    if (!findOpen || !findQuery) return
    window.api.browser.findStart({ text: findQuery, forward, findNext: false }).catch(() => {})
  },

  // 快速截图（按钮/页面聚焦态推送/shell 聚焦态快捷键三路汇流）：不乐观更新——
  // capturePage 完成即回 captureId，成功/失败均经悬浮反馈子窗呈现（反馈轮三）；
  // 单槽语义下 lastCaptureId 随最新截图覆盖
  capture: async () => {
    const t = storeT()
    try {
      const result = await window.api.capture.capture()
      set({ lastCaptureId: result.captureId })
      showCaptureFeedback('copied', t('browser.capture.copied'))
    } catch (error) {
      console.error('截图失败', error)
      showCaptureFeedback('danger', captureErrorText(error))
    }
  },

  // 「下载」次动作：最近一次截图落盘（在途锁防连点）；成功/失败（含 captureId
  // 过期）经悬浮反馈子窗如实呈现（工具栏钮与反馈条「下载」回程同汇此动作）
  saveLastCapture: async () => {
    const { lastCaptureId, captureSaving } = get()
    if (!lastCaptureId || captureSaving) return
    const t = storeT()
    set({ captureSaving: true })
    try {
      const result = await window.api.capture.saveLast({ captureId: lastCaptureId })
      showCaptureFeedback('saved', t('browser.capture.saved', { path: result.path }))
    } catch (error) {
      console.error('保存截图失败', error)
      showCaptureFeedback('danger', captureErrorText(error))
    } finally {
      set({ captureSaving: false })
    }
  }
}))
