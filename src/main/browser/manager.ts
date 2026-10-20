// 浏览器 Tab 管理器：主进程持有全部 WebContentsView；分区与会话 id 由创建方传入
// （registry 按一会话一分区注入 persist:sess-<id>，本模块不拼分区字符串）。
// 本模块不含任何 IPC（命令通道与状态推送由 ipc.ts 装配，见步骤 3）；
// 窗口引用一律经 getWindow(windowId) 现取、禁止缓存（macOS 关窗重建场景）。
// 阶段7—8 起模型按宿主窗口索引：Tab 归属宿主窗口（TabEntry.windowId），激活位与
// 布局缓存按窗口分槽；步骤 3 起独立窗口作用域可达（tear-off 迁移 + windows.ts 登记表，
// 本模块仍不感知窗口创建/销毁——级联经 registry 回调触达 destroyTabsInWindow）。

import { BrowserWindow, WebContentsView } from 'electron'
import type { Input, WebContents } from 'electron'
import {
  WINDOW_ID_MAIN,
  browserErrorCardPalette,
  pageErrorReasonKey,
  type BrowserErrorCardPalette,
  type BrowserSnapshot,
  type BrowserTabState,
  type FoundInPageResult,
  type SetBoundsPayload
} from '../../shared/browser'
import {
  matchBrowserShortcut,
  matchConfiguredShortcut,
  type BrowserShortcutId
} from '../../shared/browserShortcuts'
import { CAPTURE_CHANNELS } from '../../shared/capture'
import { PAGE_TITLE_MAX } from '../../shared/sessions'
import { t } from '../i18n'
import { getScreenshotShortcut } from '../settings'
import type { VisitFact } from './history'
import { escapeHtml } from './html'
import { isOpenableUrl } from './url'

const BLANK_URL = 'about:blank'
export { BLANK_URL }

// Chromium 网络层 net::ERR_ABORTED 的错误码（did-fail-load 的 errorCode）：停止加载/
// 被新导航替换。Electron 39 对该失败的 code 字段是空串、描述不进 reject message，
// 只能按此数值判定（2026-09-20 修复轮实测：用户终端 -3 失败的 code 为 ''）
const NET_ERR_ABORTED = -3
/** 悬挂（确认框等弹层）时的收起矩形 */
const HIDDEN_RECT: SetBoundsPayload = { x: 0, y: 0, width: 0, height: 0 }
/**
 * 弹层收起态的应用矩形（非录制窗，F'）：1×1 而非 0×0——录制中的 view 经历零尺寸→
 * 恢复会触发合成层不跟随新 bounds（破版，见 setBounds 注），1×1 避开零尺寸路径；
 * 悬挂信号仍以 renderer 的 0×0 上报表达（判定语义不变）
 */
const COLLAPSE_RECT: SetBoundsPayload = { x: 0, y: 0, width: 1, height: 1 }

/** 页面侧快捷键匹配：Input 适配 shared 单源匹配函数（规则见 shared/browserShortcuts） */
function matchShortcut(input: Input): BrowserShortcutId | null {
  if (input.type !== 'keyDown') return null
  return matchBrowserShortcut({
    key: input.key,
    ctrl: input.control,
    meta: input.meta,
    shift: input.shift,
    alt: input.alt
  })
}

interface TabEntry {
  id: string
  view: WebContentsView
  /** 该 Tab 的 view 当前挂入的宿主窗口（WINDOW_ID_MAIN；独立窗口 id 步骤 3 tear-off 起可达） */
  windowId: string
  url: string
  title: string
  faviconUrl: string | null
  loading: boolean
  /**
   * 最近一次主 frame 加载失败（2026-10-20 交互修复专项瞬态）：did-fail-load 置位、
   * did-start-loading 清位、did-stop-loading 据此注入错误卡（Electron 无内建错误页，
   * 失败落 chrome-error 空白页，不自绘即与加载中不可区分的白屏）。仅主进程内存态，
   * 不进快照不落盘
   */
  loadError: { code: number; description: string; url: string } | null
  /** 该 Tab 的 DevTools 开关态；快照 devtoolsOpen 取该窗口激活 Tab 的此字段 */
  devtoolsOpen: boolean
}

export type SnapshotListener = (snapshot: BrowserSnapshot) => void

/** windowId = 请求来源页面所在宿主窗口：独立窗口的地址栏聚焦须发往该窗口而非主窗口 */
export type FocusAddressListener = (windowId: string) => void

/**
 * 页面聚焦态 Cmd/Ctrl+F 的查找栏唤起请求（键位 find，见 shared/browserShortcuts）：
 * manager 吞键后上抛，ipc 按来源窗口定向推 find-request 给 shell renderer 开栏
 * （focus-address 同构）
 */
export type FindRequestListener = (windowId: string) => void

/**
 * found-in-page 计数事件（页内查找引擎回执）：windowId = 发生查找的 Tab 归属宿主
 * 窗口，ipc 据此定向推 find-result；result 载荷见 shared/browser 的 FoundInPageResult
 */
export type FindResultListener = (windowId: string, result: FoundInPageResult) => void

/**
 * 页面侧导航事实监听（地址栏历史补全的采集面）。manager 只上抛事实不碰持久化，
 * registry 订阅后转发 history.recordVisit；kind 语义（visit 计数 / title、favicon
 * 元数据补写）与时序背景见 browser/history.ts 头注释
 */
export type VisitListener = (fact: VisitFact) => void

// windowId 参数缺省 'main'：ipc 层经 sender 作用域解析后显式传入（主窗口来源 →
// 'main'，独立窗口来源 → 其窗口 id）；缺省值仅兼容 registry 内部 main 作用域调用点
// 与 persistence 恢复路径
export interface TabManager {
  /** 新建 Tab 归属指定窗口并立即激活（挂入该窗 contentView、应用该窗当前 bounds）；空 url 加载 about:blank */
  newTab: (url?: string, windowId?: string) => BrowserSnapshot
  /**
   * 用户语义新建 Tab（renderer ⌘T / Tab 栏 +、页面聚焦态快捷键、会话首 Tab 与零恢复
   * 集兜底，PRD 3.8.2 2026-09-17 修订）：主页设置非空时加载主页，留空与 newTab() 同为
   * 空白页；归属窗口与激活语义同 newTab。恢复径逐条 newTab(url) 与 window.open 的
   * newTab(openUrl) 不经此口——恢复地址与页面指定地址优先于主页
   */
  newUserTab: (windowId?: string) => BrowserSnapshot
  /**
   * 关闭 Tab；"最后留一"仅主窗口作用域（Chrome 式保底 Tab，现行为不变）；独立窗口
   * 作用域最后一个 Tab 允许关闭——关毕该作用域空快照经 emitChange 分发，关窗由
   * registry 快照监听收口（manager 不直接关窗）；id 不存在或异窗托管时 no-op；
   * 均返回该窗口作用域快照
   */
  closeTab: (id: string, windowId?: string) => BrowserSnapshot
  /** 切换指定窗口的激活 Tab；旧 view 脱离 contentView 但不销毁（页面状态保留） */
  switchTab: (id: string, windowId?: string) => BrowserSnapshot
  /**
   * 同窗口 Tab 重排（栏内拖拽排序，2026-09-18）：ids 须为该窗作用域全部 Tab id 的
   * 无重复全序（纯重排不增删）——集合不符/含未知或越权 id/有重复整单拒绝抛中文
   * 错误（对齐 sessions reorder 整单拒绝口径），通过即 applyTabOrder 全序覆盖并
   * emitChange；视图挂摘与激活位零触碰（激活 Tab 重排后仍激活）
   */
  reorderTabs: (ids: string[], windowId?: string) => BrowserSnapshot
  /** 设置该窗口内容区矩形（窗口内容坐标系 DIP），仅作用于该窗口的激活 view */
  setBounds: (rect: SetBoundsPayload, windowId?: string) => void
  /** 切换该窗口激活 Tab 的原生受管 DevTools；无激活 Tab 时 no-op；返回该窗口作用域快照 */
  toggleDevTools: (windowId?: string) => BrowserSnapshot
  /** 关闭该窗口激活 Tab 的 DevTools；未开或无激活 Tab 时 no-op；返回该窗口作用域快照 */
  closeDevTools: (windowId?: string) => BrowserSnapshot
  /** 该窗口激活 Tab 的 webContents；无激活 Tab 或已销毁时返回 null（导航类命令的唯一取用口） */
  getActiveWebContents: (windowId?: string) => WebContents | null
  /** 窗口（重）建后重挂该窗口激活 Tab 的页面 view；macOS 关窗重开由 index.ts 调用 */
  attachToWindow: (windowId?: string) => void
  /**
   * 窗口销毁级联（windows.ts 的 closed 回调经 registry 触达）：销毁该窗口作用域全部
   * Tab 的 webContents 并清该窗口激活/布局/悬挂槽位；仅对已销毁窗口调用，不做 view
   * 摘除（contentView 随窗口回收，销毁后的窗口不可再触碰）
   */
  destroyTabsInWindow: (windowId: string) => void
  /**
   * WebContentsView 页面首帧前兜底底色随主题（2026-09-25）：遍历本 manager 全部 Tab
   * 的视图（含未挂载/悬挂态——防切换激活时以旧色兜底首帧）逐个 setBackgroundColor。
   * 对 webContents 已销毁的视图调用安全无副作用；只设合成器底色，不触碰页面渲染。
   */
  applyFallbackBackground: (color: string) => void
  /**
   * 注销本 manager：此后 newTab 一律 no-op。注册表销毁会话时于关闭 webContents 前
   * 调用——销毁等待期内垂死页面仍可能经 window.open 触发 newTab，若放行会在同分区
   * 复生 webContents（清除后数据覆写回盘 + 泄漏），dispose 后一切创建路径封死
   */
  dispose: () => void
  /** 该窗口作用域的全量快照 */
  getSnapshot: (windowId?: string) => BrowserSnapshot
  /** 订阅快照变化（每持有 Tab 的窗口各一份，见 emitChange），返回退订函数 */
  onSnapshotChanged: (cb: SnapshotListener) => () => void
  /** 订阅 focus-address 请求（页面侧 Cmd/Ctrl+L、页面侧快捷键新建空 Tab；回调带来源窗口 id），返回退订函数 */
  onFocusAddressRequest: (cb: FocusAddressListener) => () => void
  /** 订阅 find 请求（页面侧 Cmd/Ctrl+F 唤起 shell 查找栏；回调带来源窗口 id），返回退订函数 */
  onFindRequest: (cb: FindRequestListener) => () => void
  /** 订阅 found-in-page 计数事件（回调带 Tab 归属窗口 id 与结果载荷），返回退订函数 */
  onFindResult: (cb: FindResultListener) => () => void
}

/**
 * tear-off 迁移原语（registry 建窗后调用）。独立成扩展面而不并入 TabManager 基面：
 * 基面是 registry 对 ipc 暴露的命令兼容面，registry 的 tear-off 命令是「读会话名 +
 * 建窗 + 迁移」的异步编排（签名/返回类型均不同），同名混入基面会让两种语义纠缠
 */
export type TearOffTabManager = TabManager & {
  /**
   * 把 sourceWindowId 作用域的 Tab 迁往 targetWindowId 窗口：摘 view 保活（webContents
   * 不销毁、页面状态原样）并改写归属；源窗口激活位按 closeTab 邻位规则补位（可至
   * 0 Tab，合法空态），目标窗口激活位置为该 Tab；view 不在此挂入目标窗口——建窗
   * ready-to-show 后由 attachToWindow 重挂（windows.ts 回调链，防白屏）；双侧作用域
   * 快照各分发一次；id 不存在或不属 source 作用域时 no-op 返回源作用域快照
   *（跨作用域越权已由 ipc 层守卫拦截，此处防御性兜底）
   */
  tearOffTab: (id: string, sourceWindowId: string, targetWindowId: string) => BrowserSnapshot
  /**
   * 把 Tab 从 sourceWindowId 作用域并入既有 targetWindowId 窗口（阶段 9 拖拽
   * 'moved-window' 裁决的迁移原语；阶段 10 增按位插入）。与 tearOffTab 同构（摘 view
   * 保活 + 归属改写 + 源窗邻位补位），收尾差异：目标窗已就绪，走 activate 收尾——摘目标
   * 窗旧激活 view 并即时挂入新 view。不复用 tearOffTab：它对目标窗只置激活位不挂 view
   * （新建窗的防白屏时序），对已就绪窗口会造成新旧激活 view 双挂叠加。insertIndex 按
   * 目标窗作用域 Tab 序列计（0 = 最左，tabs.length = 末位之后），缺省 = 末位（无 hint
   * 兜底）；越界钳制（负 → 0、超上界 → 末位）。id 不存在或不属 source 作用域时 no-op
   * 返回源作用域快照（作用域/会话强校验在 registry）
   */
  moveTabToWindow: (
    id: string,
    sourceWindowId: string,
    targetWindowId: string,
    insertIndex?: number
  ) => BrowserSnapshot
  /**
   * 订阅页面侧导航事实（历史采集面，kind 语义见 history.ts 的 VisitFact），返回退订
   * 函数。挂在 TearOffTabManager 扩展面而非 TabManager 基面：基面是 registry 对 ipc
   * 暴露的作用域命令兼容面，采集订阅是具体 manager 的能力（registry 持
   * TearOffTabManager 实例，ensureManager 接线 history.recordVisit）
   */
  onVisit: (cb: VisitListener) => () => void
  /**
   * 该窗口是否处于 HTML 全屏态（槽位现读）。registry 切会话编排用：旧会话持有槽位
   * 即窗口 OS 全屏源于 HTML 全屏（非用户自主全屏），摘 view 前主动退出窗口全屏态
   * 消除「窗口钉在全屏 + 新会话壳层全显」的矛盾（review 20260918125417 中 1）
   */
  hasHtmlFullscreen: (windowId?: string) => boolean
}

export function createTabManager(
  getWindow: (windowId: string) => BrowserWindow | null,
  opts: {
    sessionId: string
    partition: string
    initialBounds?: SetBoundsPayload
    /** 当前主页（空串 = 未设置）现取：registry 注入 settings 域同步缓存——newTab 为同步函数，主页须经内存缓存同步可取 */
    getHomepageUrl: () => string
    /** WebContentsView 兜底底色现取（chrome surface 族随亮暗，单源 shared/browser.ts）：registry 注入外观快照派生——newTab 同步函数同上不容 await */
    getFallbackBackground: () => string
    /** 当前解析主题（'light' | 'dark'）现取：registry 注入外观快照——错误卡配色派生（现取口径同上） */
    getResolvedTheme: () => 'light' | 'dark'
    /**
     * 录制中锚定窗现取（录屏线 F''，可缺省）：该窗的弹层收起用「整尺寸移出屏幕」
     * 替代 1×1——被录 view 的合成输出尺寸不变（弹层期间捕获画面不出现缩小损坏段）；
     * 非录制窗维持 1×1（既有弹层行为，页面近乎不可见但布局稳定）
     */
    getRecordingWindowId?: () => string | null
  }
): TearOffTabManager {
  // Map 迭代序即创建序，快照 tabs 顺序直接按此输出（作用域过滤不改变窗口内创建序）
  const tabs = new Map<string, TabEntry>()
  let seq = 0
  // 每窗口激活表：windowId → 该窗口激活 Tab id（null = 该窗口无激活位）。同一 manager
  // 的 Tab 可分布于多个宿主窗口（步骤 3 tear-off 起），各窗口激活位互不挤占
  const activeByWindow = new Map<string, string | null>()
  // 每窗口布局缓存（各自最近一次有效矩形）。初值取创建方传入的 initialBounds——
  // registry 的全局 bounds 缓存语义即主窗口内容区矩形，故只垫 'main' 槽位（步骤 3
  // 独立窗口的首个矩形由建窗后 setBounds 下发，不依赖此初值）
  const boundsByWindow = new Map<string, SetBoundsPayload>()
  if (opts.initialBounds) boundsByWindow.set(WINDOW_ID_MAIN, opts.initialBounds)
  // 悬挂态按窗口分槽（取舍：单份标志在多窗口下会"A 窗收起连坐 B 窗"——收起信号源自
  // 该窗口 renderer 的零矩形上报，作用域本就按窗口，分槽才是语义自洽；每 manager 窗口
  // 数个位数，无成本代价）：悬挂期间挂入该窗口的 view 一律按 HIDDEN_RECT 收起，布局
  // 缓存保留最后有效值，该窗口的非零矩形上报即解除悬挂并恢复
  const suspendedByWindow = new Set<string>()
  // HTML 全屏态按窗口分槽（视频全屏按钮等 Fullscreen API 路径）：windowId → 触发全屏
  // 的 Tab id。Chromium 全屏获批后 Electron 只把宿主窗口置为 OS 全屏，不动 view
  // bounds（壳层也不隐藏）——接管与恢复均在本模块收口：全屏期间 currentRect 一律
  // 整窗矩形、setBounds 上报只应用不写缓存（防整窗矩形污染布局缓存，退出后恢复进
  // 入全屏前的最后正常布局）。值记 Tab id 是为关闭/迁移持有 Tab 时精准释放槽位
  //（wc 销毁不保证补发 leave-html-full-screen）
  const htmlFullscreenByWindow = new Map<string, string>()
  // 注销标志（注册表销毁会话前置位）：封死 newTab 创建路径，防垂死页面复生 webContents
  let disposed = false
  const listeners = new Set<SnapshotListener>()
  const focusListeners = new Set<FocusAddressListener>()
  const findRequestListeners = new Set<FindRequestListener>()
  const findResultListeners = new Set<FindResultListener>()
  const visitListeners = new Set<VisitListener>()

  /** focus-address 请求点：manager 不碰 IPC，ipc.ts 订阅后按来源窗口定向转发 */
  function requestFocusAddress(windowId: string): void {
    for (const cb of focusListeners) cb(windowId)
  }

  /** find 请求点（页面侧 Cmd/Ctrl+F）：同 focus-address，ipc.ts 订阅后定向转发 */
  function requestFindBar(windowId: string): void {
    for (const cb of findRequestListeners) cb(windowId)
  }

  /**
   * 历史采集点：只携带事件自身确定的信息（did-navigate 时 TabEntry 的 title/favicon
   * 还是上一页旧值，不可上抛）——visit 事件 url 取刚落地的导航地址，title/favicon
   * 事件 url 取 Tab 当前地址、只带本事件新值。manager 不碰持久化，registry 订阅转发
   */
  function emitVisit(
    kind: VisitFact['kind'],
    tab: TabEntry,
    overrides: { url?: string; title?: string; faviconUrl?: string | null } = {}
  ): void {
    if (visitListeners.size === 0) return
    const fact: VisitFact = {
      kind,
      url: overrides.url ?? tab.url,
      title: overrides.title ?? '',
      faviconUrl: overrides.faviconUrl ?? null
    }
    for (const cb of visitListeners) cb(fact)
  }

  /** 该窗口托管的 Tab id 列表（创建序）："最后留一"作用域判定与邻位补位共用 */
  function scopedTabIds(windowId: string): string[] {
    const ids: string[] = []
    for (const tab of tabs.values()) {
      if (tab.windowId === windowId) ids.push(tab.id)
    }
    return ids
  }

  /** 持有 Tab 的宿主窗口集合（按 Tab 归属聚合）：作用域快照分发的目标全集 */
  function hostedWindowIds(): Set<string> {
    const ids = new Set<string>()
    for (const tab of tabs.values()) ids.add(tab.windowId)
    return ids
  }

  function buildSnapshot(windowId: string): BrowserSnapshot {
    const list: BrowserTabState[] = []
    for (const tab of tabs.values()) {
      // 作用域过滤：只输出该窗口托管的 tabs（全会话 tabs 盲发各窗口即串台，计划 2.3 数据原则）
      if (tab.windowId !== windowId) continue
      if (tab.view.webContents.isDestroyed()) continue
      const blank = tab.url === BLANK_URL
      list.push({
        id: tab.id,
        url: tab.url,
        // 空白 Tab 标题经字典取词（common.blankTabTitle，构建快照时现取——语言切换后
        // 新建 Tab 即新语言；TabStrip 的兜底渲染消费同一键）
        title: blank ? t('common.blankTabTitle') : tab.title,
        faviconUrl: blank ? null : tab.faviconUrl,
        loading: tab.loading,
        // canGoBack/canGoForward 构建快照时从 webContents 现读，不缓存
        canGoBack: tab.view.webContents.navigationHistory.canGoBack(),
        canGoForward: tab.view.webContents.navigationHistory.canGoForward()
      })
    }
    // devtoolsOpen 取该窗口激活 Tab 的真实开关态；htmlFullscreen 取该窗口的 HTML 全屏
    // 槽位（窗口级，切 Tab 保持——Chrome 语义）；无激活 Tab 时二者恒 false
    const activeId = activeByWindow.get(windowId) ?? null
    const active = activeId !== null ? tabs.get(activeId) : undefined
    // sessionId 由创建方（registry）注入：快照归属会话，registry/renderer 据此丢弃过期快照
    return {
      windowId,
      sessionId: opts.sessionId,
      tabs: list,
      activeTabId: activeId,
      devtoolsOpen: active?.devtoolsOpen ?? false,
      htmlFullscreen: htmlFullscreenByWindow.has(windowId)
    }
  }

  function emitChange(): void {
    // 快照按窗口作用域分发：持有 Tab 的窗口 + 曾持有而今已空的窗口（激活槽仍在——
    // tear-off 移出/独立窗口关最后 Tab 后 0-Tab 是合法可达态，源窗口 renderer 需收到
    // 清空事实、registry 据空快照收口关窗；槽位在窗口销毁级联 destroyTabsInWindow 清除）
    const windowIds = new Set<string>([...hostedWindowIds(), ...activeByWindow.keys()])
    for (const windowId of windowIds) {
      const snapshot = buildSnapshot(windowId)
      for (const cb of listeners) cb(snapshot)
    }
  }

  /** 该窗口内容区的整窗矩形（HTML 全屏态的覆盖矩形）：窗口引用现取不缓存，窗口缺失回退零矩形 */
  function fullWindowRect(windowId: string): SetBoundsPayload {
    const win = getWindow(windowId)
    if (!win) return HIDDEN_RECT
    const [width, height] = win.getContentSize()
    return { x: 0, y: 0, width, height }
  }

  /** 挂入 view 时应应用的矩形（按窗口）：悬挂收起优先（弹层必须可见），其次 HTML 全屏整窗，再次该窗口最后缓存的有效布局，均无则零矩形 */
  function currentRect(windowId: string): SetBoundsPayload {
    if (suspendedByWindow.has(windowId)) return collapseRectFor(windowId)
    if (htmlFullscreenByWindow.has(windowId)) return fullWindowRect(windowId)
    return boundsByWindow.get(windowId) ?? HIDDEN_RECT
  }

  /** 对该窗口激活 view 应用矩形（解析激活槽 + destroyed 防御，无激活 Tab 时 no-op） */
  function applyRect(windowId: string, rect: SetBoundsPayload): void {
    const activeId = activeByWindow.get(windowId) ?? null
    if (activeId === null) return
    const tab = tabs.get(activeId)
    if (!tab || tab.view.webContents.isDestroyed()) return
    tab.view.setBounds(rect)
  }

  /** 对该窗口激活 view 应用 currentRect 现值（HTML 全屏进出的收口应用点） */
  function applyRectToActive(windowId: string): void {
    applyRect(windowId, currentRect(windowId))
  }

  /**
   * 释放该 Tab 持有的 HTML 全屏槽位并恢复布局（关闭/ tear-off /跨窗迁移持有 Tab 的
   * 收口）：wc 销毁不保证补发 leave-html-full-screen，槽位残留会让窗口卡在全屏布局
   * （整窗矩形盖壳层）。须在改写 tab.windowId 前调用——槽位按归属窗口查
   */
  function releaseFullscreenSlot(tab: TabEntry): void {
    if (htmlFullscreenByWindow.get(tab.windowId) !== tab.id) return
    htmlFullscreenByWindow.delete(tab.windowId)
    applyRectToActive(tab.windowId)
  }

  /** 挂摘一律解析 Tab 归属窗口：挂入窗口与 tab.windowId 恒同窗（步骤 3 tear-off 改写归属后重挂） */
  function attachView(tab: TabEntry): void {
    const win = getWindow(tab.windowId)
    if (!win) return
    win.contentView.addChildView(tab.view)
    tab.view.setBounds(currentRect(tab.windowId))
  }

  function detachView(tab: TabEntry): void {
    const win = getWindow(tab.windowId)
    if (!win) return
    win.contentView.removeChildView(tab.view)
  }

  /**
   * 激活指定窗口的 Tab：旧 Tab 的页面 view 脱离但保持存活，新 Tab 的页面 view 挂入
   * （挂入窗口 = 该 Tab 归属窗口，调用方保证二者一致）。原生 DevTools 由对应页面
   * webContents 自己持有，随页面 view 一起切换，不另建宿主。
   * 摘除前对旧 Tab 停止页内查找并清高亮——「切 Tab 即清旧 Tab 高亮」的源头保证，
   * renderer 关栏无需依赖先发 find-stop 的推送时序（会话切换走 registry 的
   * detachActiveView，同款清理在其内承担）
   */
  function activate(id: string, windowId: string): void {
    const prevId = activeByWindow.get(windowId) ?? null
    const prev = prevId !== null ? tabs.get(prevId) : undefined
    if (prev && prev.id !== id) {
      if (!prev.view.webContents.isDestroyed()) {
        prev.view.webContents.stopFindInPage('clearSelection')
      }
      detachView(prev)
    }
    activeByWindow.set(windowId, id)
    const next = tabs.get(id)
    if (next) attachView(next)
  }

  /** 用户语义新标签页（PRD 3.8.2 修订）：主页非空加载主页、留空与 newTab() 同为空白；
   *  分流语义见 TabManager.newUserTab 注释 */
  /**
   * 构建错误卡注入 HTML（2026-10-20 交互修复专项）：Chrome 错误页同构的裸排版块，
   * 视觉契约见 DESIGN.md「页面加载失败卡」。插值一律 escapeHtml——URL 与错误描述
   * 是页面可控输入；重试 = location.reload()（Chromium 对主 frame 失败的 reload
   * 语义即重试原导航，验收以 CDP 实证）
   */
  function buildErrorCardHtml(args: {
    palette: BrowserErrorCardPalette
    heading: string
    retryLabel: string
    url: string
    code: string
    codeNum: string
  }): string {
    const { palette, heading, retryLabel, url, code, codeNum } = args
    return [
      '<style>',
      'html, body { margin: 0; padding: 0; }',
      `body { background: ${palette.bg}; color: ${palette.ink}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', 'Helvetica Neue', Arial, sans-serif; -webkit-font-smoothing: antialiased; }`,
      `::selection { background: ${palette.selectVeil}; }`,
      '.msb-error-wrap { min-height: 100vh; display: flex; justify-content: center; }',
      '.msb-error { max-width: 560px; box-sizing: border-box; padding: 15vh 32px 48px; }',
      '.msb-error-icon { display: block; margin: 0 0 24px; }',
      `.msb-error h1 { margin: 0 0 12px; font-size: 21px; line-height: 1.45; font-weight: 600; color: ${palette.ink}; }`,
      `.msb-error-url { margin: 0; font-size: 13px; line-height: 1.6; color: ${palette.inkDim}; word-break: break-all; user-select: text; cursor: text; }`,
      `.msb-error-code { margin: 16px 0 0; font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; font-size: 12px; line-height: 1.6; color: ${palette.inkDim}; user-select: text; cursor: text; }`,
      `.msb-error button { margin-top: 28px; height: 34px; padding: 0 20px; border-radius: 8px; border: 1px solid ${palette.line}; background: transparent; color: ${palette.ink}; font-size: 13px; font-weight: 500; font-family: inherit; cursor: pointer; }`,
      `.msb-error button:hover { background: ${palette.hoverVeil}; }`,
      `.msb-error button:active { background: ${palette.activeVeil}; }`,
      `.msb-error button:focus-visible { outline: 2px solid ${palette.inkDim}; outline-offset: 2px; }`,
      '</style>',
      '<div class="msb-error-wrap"><div class="msb-error">',
      `<svg class="msb-error-icon" width="56" height="56" viewBox="0 0 56 56" fill="none" aria-hidden="true"><circle cx="28" cy="28" r="25" stroke="${palette.inkDim}" stroke-width="2.5"/><line x1="28" y1="16" x2="28" y2="31" stroke="${palette.inkDim}" stroke-width="3" stroke-linecap="round"/><circle cx="28" cy="39.5" r="2" fill="${palette.inkDim}"/></svg>`,
      `<h1>${escapeHtml(heading)}</h1>`,
      `<p class="msb-error-url">${escapeHtml(url)}</p>`,
      `<p class="msb-error-code">${escapeHtml(code)} · ${escapeHtml(codeNum)}</p>`,
      `<button type="button" onclick="location.reload()">${escapeHtml(retryLabel)}</button>`,
      '</div></div>'
    ].join('')
  }

  /**
   * 注入页面加载失败错误卡（2026-10-20 交互修复专项）：did-stop-loading 且失败置位
   * 时调用——此刻页面已停在 chrome-error 空白页，写入自绘 DOM 即不再白屏。注入
   * 表达式前置 chrome-error 位置自守卫（审查中-1）：「派发后、执行前」用户已发起新
   * 导航且新页已提交的极窄交错下，防止陈旧注入覆盖新提交页面的 body——判定不满足
   * 即空操作，语义零损失。注入失败（view 销毁等竞态）中文告警静默降级，不劣化于
   * 现状白屏
   */
  function injectErrorCard(tab: TabEntry): void {
    const loadError = tab.loadError
    if (!loadError) return
    const wc = tab.view.webContents
    if (wc.isDestroyed()) return
    const reasonKey = pageErrorReasonKey(loadError.code, loadError.description)
    const html = buildErrorCardHtml({
      palette: browserErrorCardPalette(opts.getResolvedTheme()),
      heading: reasonKey
        ? t(`browser.pageError.reasons.${reasonKey}`)
        : t('browser.pageError.title'),
      retryLabel: t('browser.pageError.retry'),
      url: loadError.url,
      code: loadError.description || 'ERR_UNKNOWN',
      codeNum: String(loadError.code)
    })
    void wc
      .executeJavaScript(
        `if (location.href.startsWith('chrome-error://')) document.body.innerHTML = ${JSON.stringify(html)};`
      )
      .catch((injectError: unknown) => {
        console.warn('[browser] 错误卡注入失败:', injectError)
      })
  }

  function newUserTab(windowId: string = WINDOW_ID_MAIN): BrowserSnapshot {
    return newTab(opts.getHomepageUrl() || undefined, windowId)
  }

  function newTab(url?: string, windowId: string = WINDOW_ID_MAIN): BrowserSnapshot {
    // 已注销（注册表销毁会话）：拒绝一切创建，防垂死页面 window.open 复生 webContents
    if (disposed) return buildSnapshot(windowId)
    seq += 1
    const id = `tab-${seq}`
    const view = new WebContentsView({
      // 只设分区，不设 preload/nodeIntegration/contextIsolation（网页内容不可信）
      webPreferences: { partition: opts.partition }
    })
    // 页面加载前兜底底色（随当前亮暗取 chrome surface 族，单源 shared/browser.ts），防透明闪烁
    view.setBackgroundColor(opts.getFallbackBackground())
    const target = url ?? BLANK_URL
    const tab: TabEntry = {
      id,
      view,
      windowId,
      url: target,
      title: '',
      faviconUrl: null,
      loading: false,
      loadError: null,
      devtoolsOpen: false
    }
    tabs.set(id, tab)
    const wc = view.webContents

    // 任一加载/导航事件后重算快照并触发回调（含 canGoBack/canGoForward 现读）
    wc.on('did-start-loading', () => {
      // 新导航开启即清失败态：错误卡随后续结果重新裁决（重试成功自然清除）
      tab.loadError = null
      tab.loading = true
      emitChange()
    })
    wc.on('did-stop-loading', () => {
      tab.loading = false
      // 失败置位时注入错误卡（2026-10-20 交互修复专项）：此刻页面已停在 chrome-error
      // 空白页，写入自绘 DOM 即不再白屏
      if (tab.loadError) injectErrorCard(tab)
      emitChange()
    })
    wc.on('did-navigate', (_event, navigatedUrl) => {
      tab.url = navigatedUrl
      emitVisit('visit', tab)
      emitChange()
    })
    wc.on('did-navigate-in-page', (_event, navigatedUrl, isMainFrame) => {
      // 子框架的页内导航不改主 frame 地址
      if (!isMainFrame) return
      tab.url = navigatedUrl
      emitVisit('visit', tab)
      emitChange()
    })
    wc.on('page-title-updated', (_event, title) => {
      tab.title = title.length > PAGE_TITLE_MAX ? title.slice(0, PAGE_TITLE_MAX) : title
      emitVisit('title', tab, { title: tab.title })
      emitChange()
    })
    wc.on('page-favicon-updated', (_event, icons) => {
      // icons 是图标 URL 数组，取最后一个；无图标置 null
      tab.faviconUrl = icons.length > 0 ? icons[icons.length - 1] : null
      emitVisit('favicon', tab, { faviconUrl: tab.faviconUrl })
      emitChange()
    })
    // 主 frame 失败导航的统一日志（单点）：覆盖地址栏/恢复/克隆等 loadURL 路径与页内
    // 链点击路径（loadURL 的 reject 本就由此事件驱动，原 url.ts logLoadFailure 已退役，
    // Electron C++ 对同一失败还有一条固定警告、已由 main/warnings.ts 接管吞掉）。
    // ERR_ABORTED（停止加载/被新导航替换）属正常静默；失败呈现走自绘错误卡（见下）
    wc.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === NET_ERR_ABORTED) return
      console.warn(`[browser] 加载失败 ${validatedURL}: ${errorDescription} (${errorCode})`)
      // 失败态置位（2026-10-20 交互修复专项）：did-stop-loading 时据此注入错误卡，
      // 如实呈现可读原因 + 原码；Electron 无 Chromium 内建错误页资源（失败落
      // chrome-error://chromewebdata 空白页），不再依赖「内建错误页呈现」
      tab.loadError = {
        code: errorCode,
        description: errorDescription,
        url: validatedURL || tab.url
      }
    })
    // 页内查找计数回执：windowId 取 Tab 归属宿主窗口，ipc 层据此定向推送 find-result
    wc.on('found-in-page', (_event, result) => {
      for (const cb of findResultListeners) cb(tab.windowId, result)
    })
    // DevTools 经原生关闭钮等途径关闭时同步状态；本方主动关闭已先复位，守卫拦下重复处理。
    wc.on('devtools-closed', () => {
      if (!tab.devtoolsOpen) return
      tab.devtoolsOpen = false
      emitChange()
    })
    // 原生受管 DevTools 每次打开都会创建自己的 webContents；在其聚焦时接管 F12 关闭语义。
    wc.on('devtools-opened', () => {
      const devtools = wc.devToolsWebContents
      if (!devtools) return
      devtools.on('before-input-event', (event, input) => {
        if (!tab.devtoolsOpen || matchShortcut(input) !== 'toggle-devtools') return
        event.preventDefault()
        closeTabDevTools(tab)
        emitChange()
      })
    })

    // HTML 全屏（视频全屏按钮等 Fullscreen API 路径）：Chromium 获批后 Electron 只把
    // 宿主窗口置为/退出 OS 全屏，view bounds 与 renderer 壳层均无人动——本模块按窗口
    // 槽位接管恢复（取舍见 htmlFullscreenByWindow 声明处），壳层显隐随快照字段下发
    wc.on('enter-html-full-screen', () => {
      // 防御：全屏请求需可见元素+用户手势，只有该窗口激活 Tab（挂入渲染中）可达此
      // 事件；非激活来源忽略，防槽位被错误置位扩整窗
      if (activeByWindow.get(tab.windowId) !== tab.id) return
      htmlFullscreenByWindow.set(tab.windowId, tab.id)
      // 立即扩整窗：不等 renderer 壳层隐藏后的锚点重报，防窗口全屏过渡期内容区外露
      applyRectToActive(tab.windowId)
      emitChange()
    })
    wc.on('leave-html-full-screen', () => {
      // 只清自己置位的槽位：全屏 Tab 被切走后窗口保持全屏布局（Chrome 切 Tab 不退
      // 全屏语义），其他 Tab 的进出事件不得误清
      if (htmlFullscreenByWindow.get(tab.windowId) !== tab.id) return
      htmlFullscreenByWindow.delete(tab.windowId)
      applyRectToActive(tab.windowId)
      emitChange()
    })

    // 页面侧快捷键（Chrome 对齐最小集，键位表 shared/browserShortcuts 与 renderer shell 侧共用）：
    // 命中即吞掉按键防页面默认行为，未命中放行；close-devtools（ESC）仅该 Tab DevTools 已开时吞键
    wc.on('before-input-event', (event, input) => {
      // 自定义截图快捷键（快速截图专项）：主进程同步缓存 null（未设置）整链跳过。
      // 命中即吞键并把 CAPTURE_CHANNELS.request 定向推送到该 Tab 归属窗口的 shell
      // webContents——推送目标解析与 find-request 同款（tab.windowId 对应窗口现取，
      // ipc.ts 的 find 桥接在 manager 外监听转发，本通道按步骤 4 契约收口在此直发）；
      // 渲染层 onRequest 汇流同一 capture 动作，无需归还 shell 焦点（截图不依赖焦点）。
      // HTML 全屏期间不激活：状态位用 htmlFullscreenByWindow（enter/leave-html-full-screen
      // 接管实现的事实源，快照 htmlFullscreen 字段与壳层 TabStrip/Toolbar/反馈条隐藏
      // 均由它派生——全屏时壳层不可见，触发了也无反馈位），与 find 分支同门控：不吞键
      // 放行、按键留给页面。仅消费非自动重复键（按住不放不连发截图，与 renderer 侧
      // !e.repeat 同口径）
      const screenshotAccel = getScreenshotShortcut()
      if (
        screenshotAccel !== null &&
        input.type === 'keyDown' &&
        !input.isAutoRepeat &&
        !htmlFullscreenByWindow.has(tab.windowId) &&
        matchConfiguredShortcut(
          {
            key: input.key,
            ctrl: input.control,
            meta: input.meta,
            shift: input.shift,
            alt: input.alt
          },
          screenshotAccel
        )
      ) {
        event.preventDefault()
        getWindow(tab.windowId)?.webContents.send(CAPTURE_CHANNELS.request)
        return
      }
      const action = matchShortcut(input)
      if (!action) return
      // 未开 DevTools 时 ESC 原样放行（不吞键，页面自留行为不受影响）
      if (action === 'close-devtools' && !tab.devtoolsOpen) return
      // HTML 全屏期间查找栏不可达（PRD 3.7.3，Chrome 对齐）：不吞键不唤起，按键留给页面
      if (action === 'find' && htmlFullscreenByWindow.has(tab.windowId)) return
      event.preventDefault()
      // 页面侧命令的作用域 = 触发页面所在 Tab 的宿主窗口（事件时现读 tab.windowId）
      switch (action) {
        case 'reload':
          wc.reload()
          break
        case 'new-tab':
          // 用户语义新建（主页非空加载主页，PRD 3.8.2 修订）：新建后随即请求聚焦
          // 地址栏（Chrome Cmd+T 惯例）
          newUserTab(tab.windowId)
          requestFocusAddress(tab.windowId)
          break
        case 'close-tab':
          // 最后留一由 closeTab 内部 no-op 承担
          closeTab(tab.id, tab.windowId)
          break
        case 'focus-address':
          requestFocusAddress(tab.windowId)
          break
        case 'find':
          // 页面聚焦态 Cmd/Ctrl+F：吞键后唤起该窗口 shell 查找栏（引擎在 find-start 命令，
          // 此处只做开栏请求；shell 聚焦态不经此路，renderer 本地直接开栏）
          requestFindBar(tab.windowId)
          break
        case 'toggle-devtools':
          // 页面聚焦态下该 Tab 即其宿主窗口的激活 Tab，开关作用于该窗口激活位
          toggleDevTools(tab.windowId)
          break
        case 'close-devtools':
          // 上方守卫已确保该 Tab 的 DevTools 处于开启态
          closeDevTools(tab.windowId)
          break
      }
    })

    // target=_blank / window.open 一律拒绝弹窗，转为本浏览器新 Tab（落在触发页面的宿主窗口）；
    // URL 是页面可控输入，仅放行与地址栏一致的 scheme 白名单，其余（mailto: 等）拒绝且不建 Tab
    wc.setWindowOpenHandler(({ url: openUrl }) => {
      if (openUrl && isOpenableUrl(openUrl)) newTab(openUrl, tab.windowId)
      return { action: 'deny' }
    })

    // 先激活（挂入 contentView、应用当前 bounds），再发起加载——保证首条快照已带 activeTabId
    activate(id, windowId)

    // 导航失败的呈现由本模块自绘错误卡承担（did-fail-load 置位 + did-stop-loading
    // 注入，2026-10-20 交互修复专项）：Electron 无 Chromium 内建错误页资源，失败落
    // chrome-error://chromewebdata 空白页（2026-10-20 探针实测），不自绘即白屏；
    // 失败日志由 did-fail-load 单点承担
    void wc.loadURL(target).catch(() => {})

    emitChange()
    return buildSnapshot(windowId)
  }

  function closeTab(id: string, windowId: string = WINDOW_ID_MAIN): BrowserSnapshot {
    const target = tabs.get(id)
    // id 不存在或不属该窗口托管时 no-op
    if (!target || target.windowId !== windowId) {
      return buildSnapshot(windowId)
    }
    // 作用域内 id 序列（创建序）：最后留一判定与邻位补位均以该窗口托管为准。
    // 最后留一仅主窗口作用域（Chrome 式保底 Tab，现行为不变）；独立窗口最后一个
    // Tab 允许关闭——关毕该作用域空快照经 emitChange 分发，registry 快照监听收口
    // 关窗（manager 不直接关窗）
    const order = scopedTabIds(windowId)
    if (windowId === WINDOW_ID_MAIN && order.length <= 1) {
      return buildSnapshot(windowId)
    }
    // 关闭前取创建序邻位（作用域内创建序）
    const index = order.indexOf(id)
    tabs.delete(id)
    // 持有 HTML 全屏槽位时先释放（wc 销毁不保证补发 leave 事件，理由见 releaseFullscreenSlot）
    releaseFullscreenSlot(target)
    detachView(target)
    // 原生受管 DevTools 与页面 webContents 同生命周期，关闭后再销毁页面。
    closeTabDevTools(target)
    const activeId = activeByWindow.get(windowId) ?? null
    if (activeId === id) {
      // 关闭激活 Tab：优先激活原位置右侧第一个，无右侧则左侧最后一个；
      // 独立窗口关最后 Tab 时 nextId 为 null → 该窗口清空（槽位保留至销毁级联）
      const nextId = order[index + 1] ?? (index > 0 ? order[index - 1] : null)
      activeByWindow.set(windowId, null)
      if (nextId !== null) activate(nextId, windowId)
    }
    // 销毁 = removeChildView + webContents.close()
    target.view.webContents.close()
    emitChange()
    return buildSnapshot(windowId)
  }

  function tearOffTab(id: string, sourceWindowId: string, targetWindowId: string): BrowserSnapshot {
    const target = tabs.get(id)
    // 校验 Tab 属发起作用域（跨作用域越权命令防御性 no-op——存在性守卫在 ipc 层）
    if (!target || target.windowId !== sourceWindowId) {
      return buildSnapshot(sourceWindowId)
    }
    // 迁移前源作用域序列（含本 Tab）：邻位补位与 closeTab 同规则取序
    const order = scopedTabIds(sourceWindowId)
    const index = order.indexOf(id)
    // 摘 view 保活（webContents 不销毁，页面滚动/输入/登录态/DevTools 原样）；重挂由
    // 建窗 ready-to-show 后的 attachToWindow 完成（windows.ts 回调链，防白屏）
    releaseFullscreenSlot(target)
    detachView(target)
    target.windowId = targetWindowId
    // 源窗口激活位补位：被移出的是激活 Tab 时按 closeTab 邻位规则（右邻优先，退左邻）；
    // 源窗口可至 0 Tab（主窗口空态/独立窗口将被收口关窗均属合法）
    const activeId = activeByWindow.get(sourceWindowId) ?? null
    if (activeId === id) {
      const nextId = order[index + 1] ?? (index > 0 ? order[index - 1] : null)
      activeByWindow.set(sourceWindowId, null)
      if (nextId !== null) activate(nextId, sourceWindowId)
    }
    // 目标窗口激活位置为该 Tab（只置位不挂 view，理由见上方 detachView 注释）
    activeByWindow.set(targetWindowId, id)
    emitChange()
    return buildSnapshot(sourceWindowId)
  }

  /**
   * 作用域内 Tab 重排的 Map 迭代序应用原语（moveTabToWindow 按位插入与 reorderTabs
   * 全序重排的单源）：tabs Map 对既有键直接 set 不移动位序，逐键 delete + set 使其
   * 落到 Map 末尾——按 orderedIds 顺序全部应用后，迭代序即 orderedIds。ids 内不存
   * 在的键跳过；作用域外的键不被触碰（其他窗口作用域的相对序不受扰动）
   */
  function applyTabOrder(orderedIds: string[]): void {
    for (const tabId of orderedIds) {
      const tab = tabs.get(tabId)
      if (!tab) continue
      tabs.delete(tabId)
      tabs.set(tabId, tab)
    }
  }

  function moveTabToWindow(
    id: string,
    sourceWindowId: string,
    targetWindowId: string,
    insertIndex?: number
  ): BrowserSnapshot {
    const target = tabs.get(id)
    // 校验 Tab 属发起作用域（跨作用域/会话越权的强校验在 registry，此处防御性 no-op）
    if (!target || target.windowId !== sourceWindowId) {
      return buildSnapshot(sourceWindowId)
    }
    // 迁移前源作用域序列（含本 Tab）：邻位补位与 closeTab 同规则取序
    const order = scopedTabIds(sourceWindowId)
    const index = order.indexOf(id)
    // 摘 view 保活（webContents 不销毁，页面滚动/输入/登录态/DevTools 原样）
    releaseFullscreenSlot(target)
    detachView(target)
    target.windowId = targetWindowId
    // 源窗口激活位补位：被移出的是激活 Tab 时按 closeTab 邻位规则（右邻优先，退左邻）
    const activeId = activeByWindow.get(sourceWindowId) ?? null
    if (activeId === id) {
      const nextId = order[index + 1] ?? (index > 0 ? order[index - 1] : null)
      activeByWindow.set(sourceWindowId, null)
      if (nextId !== null) activate(nextId, sourceWindowId)
    }
    // 按位插入（阶段 10）：目标作用域期望序 = 现序摘出本 Tab 后在第 insertIndex 位放入
    //（缺省 = 末位；负 → 0、超上界 → 末位钳制）；Map 迭代序应用走 applyTabOrder 单源
    const rest = scopedTabIds(targetWindowId).filter((tabId) => tabId !== id)
    const insertAt =
      insertIndex === undefined ? rest.length : Math.min(Math.max(insertIndex, 0), rest.length)
    applyTabOrder([...rest.slice(0, insertAt), id, ...rest.slice(insertAt)])
    // 目标窗已就绪，activate 收尾：摘目标窗旧激活 view + 即时挂入新 view——只置激活位
    // 会与目标窗旧激活 view 双挂叠加（tearOffTab 的只置位是新建窗的防白屏时序，不适用）
    activate(id, targetWindowId)
    emitChange()
    return buildSnapshot(sourceWindowId)
  }

  function destroyTabsInWindow(windowId: string): void {
    const doomed: TabEntry[] = []
    for (const tab of tabs.values()) {
      if (tab.windowId === windowId) doomed.push(tab)
    }
    // 槽位清理无条件执行（0 Tab 窗口也有激活/布局/悬挂/全屏残留）
    activeByWindow.delete(windowId)
    boundsByWindow.delete(windowId)
    suspendedByWindow.delete(windowId)
    htmlFullscreenByWindow.delete(windowId)
    if (doomed.length === 0) return
    for (const tab of doomed) {
      tabs.delete(tab.id)
      // 不做 view 摘除（窗口已销毁，contentView 随之回收，销毁后的窗口不可触碰）；
      // 原生受管 DevTools 随宿主 webContents 同生命周期，先关再补刀 webContents
      closeTabDevTools(tab)
      const wc = tab.view.webContents
      if (!wc.isDestroyed()) wc.close()
    }
    emitChange()
  }

  function switchTab(id: string, windowId: string = WINDOW_ID_MAIN): BrowserSnapshot {
    const target = tabs.get(id)
    const activeId = activeByWindow.get(windowId) ?? null
    // id 不存在、异窗托管或已激活均 no-op
    if (!target || target.windowId !== windowId || id === activeId) {
      return buildSnapshot(windowId)
    }
    activate(id, windowId)
    emitChange()
    return buildSnapshot(windowId)
  }

  function reorderTabs(ids: string[], windowId: string = WINDOW_ID_MAIN): BrowserSnapshot {
    const current = scopedTabIds(windowId)
    // 整单校验：长度一致 + 无重复 + 每项均为本作用域 Tab（覆盖未知 id 与越权 id），
    // 三者成立则 ids 与现序集合必然一致；不匹配整单拒绝（renderer 回滚本地预览序）
    const valid =
      ids.length === current.length &&
      new Set(ids).size === ids.length &&
      ids.every((id) => tabs.get(id)?.windowId === windowId)
    if (!valid) throw new Error(t('errors.tabReorderInvalidOrder'))
    applyTabOrder(ids)
    emitChange()
    return buildSnapshot(windowId)
  }

  /**
   * 收起应用矩形（2026-10-10 破版二轮 F'/F''）：双因素实证——「录制进行中（合成器挂
   * 视频捕获轨道）」+「view 经历零尺寸→恢复」同时满足时，恢复后的合成层不跟随新
   * bounds（页面绘制停在 0,0 小块、盖住壳层，用户两轮报告"网页跑到左上角"；纯录制
   * 或纯弹层收起均不触发，真实键盘/鼠标交互可稳定复现）。据此：
   * - 非录制窗：应用 1×1（避开零尺寸路径；左上角 1 像素残点弹层期间不可感知）
   * - 录制中锚定窗（F''）：应用「整尺寸移出屏幕」——1×1 仍会让捕获轨道在弹层期间
   *   录到缩小画面（实测产物含损坏段），移出屏幕保持合成输出尺寸、捕获内容无损
   */
  function collapseRectFor(windowId: string): SetBoundsPayload {
    if (opts.getRecordingWindowId?.() === windowId) {
      const cached = boundsByWindow.get(windowId)
      if (cached && cached.width > 0 && cached.height > 0) {
        return { x: -cached.width - 64, y: cached.y, width: cached.width, height: cached.height }
      }
    }
    return COLLAPSE_RECT
  }

  function setBounds(rect: SetBoundsPayload, windowId: string = WINDOW_ID_MAIN): void {
    // 零矩形是"收起信号"（确认框等弹层悬挂）而非布局：置该窗口悬挂态并作用于其激活
    // view，不污染布局缓存；非零矩形解除该窗口悬挂并记忆布局（均只写该窗口槽位）
    if (rect.width <= 0 || rect.height <= 0) {
      suspendedByWindow.add(windowId)
    } else {
      suspendedByWindow.delete(windowId)
      // HTML 全屏期间的非零上报只应用不写缓存：壳层隐藏后锚点扩满窗口，上报的整窗
      // 矩形若入缓存，退出全屏会恢复成整窗布局盖住壳层；缓存保留进入全屏前最后正常
      // 布局（窗口 resize 的实时跟随由本应用的 rect 承担，不依赖缓存）
      if (!htmlFullscreenByWindow.has(windowId)) boundsByWindow.set(windowId, rect)
    }
    // 仅作用于该窗口激活 view；未激活 view 保持脱离状态，切回时由 activate 应用
    const applied = rect.width <= 0 || rect.height <= 0 ? collapseRectFor(windowId) : rect
    applyRect(windowId, applied)
  }

  /** 打开该 Tab 的原生受管 DevTools；停靠位置和设备模拟布局全部交由 Chromium 管理 */
  function openTabDevTools(tab: TabEntry): void {
    const wc = tab.view.webContents
    if (wc.isDestroyed()) return
    wc.openDevTools()
    tab.devtoolsOpen = true
  }

  /** 关闭该 Tab 的原生受管 DevTools */
  function closeTabDevTools(tab: TabEntry): void {
    if (!tab.devtoolsOpen) return
    // 先复位标志再关，防 closeDevTools 同步触发 devtools-closed 事件造成重入
    tab.devtoolsOpen = false
    const wc = tab.view.webContents
    if (!wc.isDestroyed()) wc.closeDevTools()
  }

  /** 切换该窗口激活 Tab 的 DevTools：已开则关、未开则开；无激活 Tab 时 no-op 返回该窗口快照 */
  function toggleDevTools(windowId: string = WINDOW_ID_MAIN): BrowserSnapshot {
    const activeId = activeByWindow.get(windowId) ?? null
    const tab = activeId !== null ? tabs.get(activeId) : undefined
    if (!tab) return buildSnapshot(windowId)
    if (tab.devtoolsOpen) closeTabDevTools(tab)
    else openTabDevTools(tab)
    emitChange()
    return buildSnapshot(windowId)
  }

  /** 关闭该窗口激活 Tab 的 DevTools；未开或无激活 Tab 时 no-op 返回该窗口快照 */
  function closeDevTools(windowId: string = WINDOW_ID_MAIN): BrowserSnapshot {
    const activeId = activeByWindow.get(windowId) ?? null
    const tab = activeId !== null ? tabs.get(activeId) : undefined
    if (!tab || !tab.devtoolsOpen) return buildSnapshot(windowId)
    closeTabDevTools(tab)
    emitChange()
    return buildSnapshot(windowId)
  }

  function getSnapshot(windowId: string = WINDOW_ID_MAIN): BrowserSnapshot {
    return buildSnapshot(windowId)
  }

  function getActiveWebContents(windowId: string = WINDOW_ID_MAIN): WebContents | null {
    const activeId = activeByWindow.get(windowId) ?? null
    if (activeId === null) return null
    const tab = tabs.get(activeId)
    if (!tab || tab.view.webContents.isDestroyed()) return null
    return tab.view.webContents
  }

  function attachToWindow(windowId: string = WINDOW_ID_MAIN): void {
    const activeId = activeByWindow.get(windowId) ?? null
    if (activeId === null) return
    const tab = tabs.get(activeId)
    const win = getWindow(windowId)
    if (!tab || !win || tab.view.webContents.isDestroyed()) return
    // 已挂入时只同步 bounds（含悬挂收起）；未挂入则复用 attachView 路径（activate 与重挂两路共用）
    if (!win.contentView.children.includes(tab.view)) {
      attachView(tab)
    } else {
      tab.view.setBounds(currentRect(windowId))
    }
  }

  function onSnapshotChanged(cb: SnapshotListener): () => void {
    listeners.add(cb)
    return () => listeners.delete(cb)
  }

  function onFocusAddressRequest(cb: FocusAddressListener): () => void {
    focusListeners.add(cb)
    return () => focusListeners.delete(cb)
  }

  function onFindRequest(cb: FindRequestListener): () => void {
    findRequestListeners.add(cb)
    return () => findRequestListeners.delete(cb)
  }

  function onFindResult(cb: FindResultListener): () => void {
    findResultListeners.add(cb)
    return () => findResultListeners.delete(cb)
  }

  function onVisit(cb: VisitListener): () => void {
    visitListeners.add(cb)
    return () => visitListeners.delete(cb)
  }

  function hasHtmlFullscreen(windowId: string = WINDOW_ID_MAIN): boolean {
    return htmlFullscreenByWindow.has(windowId)
  }

  function dispose(): void {
    disposed = true
  }

  function applyFallbackBackground(color: string): void {
    for (const tab of tabs.values()) tab.view.setBackgroundColor(color)
  }

  return {
    newTab,
    newUserTab,
    closeTab,
    tearOffTab,
    moveTabToWindow,
    destroyTabsInWindow,
    applyFallbackBackground,
    switchTab,
    reorderTabs,
    setBounds,
    toggleDevTools,
    closeDevTools,
    getActiveWebContents,
    attachToWindow,
    dispose,
    getSnapshot,
    onSnapshotChanged,
    onFocusAddressRequest,
    onFindRequest,
    onFindResult,
    onVisit,
    hasHtmlFullscreen
  }
}
