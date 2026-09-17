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
  type BrowserSnapshot,
  type BrowserTabState,
  type FoundInPageResult,
  type SetBoundsPayload
} from '../../shared/browser'
import { matchBrowserShortcut, type BrowserShortcutId } from '../../shared/browserShortcuts'
import { PAGE_TITLE_MAX } from '../../shared/sessions'
import { t } from '../i18n'
import type { VisitFact } from './history'
import { isOpenableUrl, logLoadFailure } from './url'

const BLANK_URL = 'about:blank'
export { BLANK_URL }
/** 悬挂（确认框等弹层）时的收起矩形 */
const HIDDEN_RECT: SetBoundsPayload = { x: 0, y: 0, width: 0, height: 0 }

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
   * 函数。挂在 TearOffTabManager 扩展面而非 TabManager 基面：基面是 registry 对
   * ipc 暴露的作用域命令兼容面，采集订阅是具体 manager 的能力（registry 持
   * TearOffTabManager 实例，ensureManager 接线 history.recordVisit）
   */
  onVisit: (cb: VisitListener) => () => void
}

export function createTabManager(
  getWindow: (windowId: string) => BrowserWindow | null,
  opts: {
    sessionId: string
    partition: string
    initialBounds?: SetBoundsPayload
    /** 当前主页（空串 = 未设置）现取：registry 注入 settings 域同步缓存——newTab 为同步函数，主页须经内存缓存同步可取 */
    getHomepageUrl: () => string
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
    // devtoolsOpen 取该窗口激活 Tab 的真实开关态；无激活 Tab 时恒 false
    const activeId = activeByWindow.get(windowId) ?? null
    const active = activeId !== null ? tabs.get(activeId) : undefined
    // sessionId 由创建方（registry）注入：快照归属会话，registry/renderer 据此丢弃过期快照
    return {
      windowId,
      sessionId: opts.sessionId,
      tabs: list,
      activeTabId: activeId,
      devtoolsOpen: active?.devtoolsOpen ?? false
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

  /** 挂入 view 时应应用的矩形（按窗口）：悬挂收起优先，其次该窗口最后缓存的有效布局，均无则零矩形 */
  function currentRect(windowId: string): SetBoundsPayload {
    return suspendedByWindow.has(windowId)
      ? HIDDEN_RECT
      : (boundsByWindow.get(windowId) ?? HIDDEN_RECT)
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
    // 页面加载前兜底白底，防透明闪烁
    view.setBackgroundColor('#ffffff')
    const target = url ?? BLANK_URL
    const tab: TabEntry = {
      id,
      view,
      windowId,
      url: target,
      title: '',
      faviconUrl: null,
      loading: false,
      devtoolsOpen: false
    }
    tabs.set(id, tab)
    const wc = view.webContents

    // 任一加载/导航事件后重算快照并触发回调（含 canGoBack/canGoForward 现读）
    wc.on('did-start-loading', () => {
      tab.loading = true
      emitChange()
    })
    wc.on('did-stop-loading', () => {
      tab.loading = false
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

    // 页面侧快捷键（Chrome 对齐最小集，键位表 shared/browserShortcuts 与 renderer shell 侧共用）：
    // 命中即吞掉按键防页面默认行为，未命中放行；close-devtools（ESC）仅该 Tab DevTools 已开时吞键
    wc.on('before-input-event', (event, input) => {
      const action = matchShortcut(input)
      if (!action) return
      // 未开 DevTools 时 ESC 原样放行（不吞键，页面自留行为不受影响）
      if (action === 'close-devtools' && !tab.devtoolsOpen) return
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

    // 导航失败（坏域名等）由 Chromium 内建错误页呈现；reject 走统一日志（ERR_ABORTED 静默）
    void wc.loadURL(target).catch((error: unknown) => logLoadFailure(target, error))

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
    //（缺省 = 末位；负 → 0、超上界 → 末位钳制）。tabs Map 迭代序即创建序（快照顺序的
    // 唯一次序源），对既有键直接 set 不移动位序——必须 delete 后重新 set 才落到 Map
    // 末尾；故把「本 Tab + 期望序中排其后的目标作用域 Tab」逐个 delete + 重新 set 恢复
    // 目标作用域相对序（重排键全部属目标窗，其他窗口作用域的相对序不受扰动）
    const rest = scopedTabIds(targetWindowId).filter((tabId) => tabId !== id)
    const insertAt =
      insertIndex === undefined ? rest.length : Math.min(Math.max(insertIndex, 0), rest.length)
    tabs.delete(id)
    tabs.set(id, target)
    for (const tabId of rest.slice(insertAt)) {
      const tab = tabs.get(tabId)
      if (!tab) continue
      tabs.delete(tabId)
      tabs.set(tabId, tab)
    }
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
    // 槽位清理无条件执行（0 Tab 窗口也有激活/布局/悬挂残留）
    activeByWindow.delete(windowId)
    boundsByWindow.delete(windowId)
    suspendedByWindow.delete(windowId)
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

  function setBounds(rect: SetBoundsPayload, windowId: string = WINDOW_ID_MAIN): void {
    // 零矩形是"收起信号"（确认框等弹层悬挂）而非布局：置该窗口悬挂态并作用于其激活
    // view，不污染布局缓存；非零矩形解除该窗口悬挂并记忆布局（均只写该窗口槽位）
    if (rect.width <= 0 || rect.height <= 0) {
      suspendedByWindow.add(windowId)
    } else {
      suspendedByWindow.delete(windowId)
      boundsByWindow.set(windowId, rect)
    }
    // 仅作用于该窗口激活 view；未激活 view 保持脱离状态，切回时由 activate 应用
    const activeId = activeByWindow.get(windowId) ?? null
    if (activeId === null) return
    const tab = tabs.get(activeId)
    if (!tab || tab.view.webContents.isDestroyed()) return
    tab.view.setBounds(rect)
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

  function dispose(): void {
    disposed = true
  }

  return {
    newTab,
    newUserTab,
    closeTab,
    tearOffTab,
    moveTabToWindow,
    destroyTabsInWindow,
    switchTab,
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
    onVisit
  }
}
