// 浏览器 Tab 管理器：主进程持有全部 WebContentsView；分区与会话 id 由创建方传入
// （registry 按一会话一分区注入 persist:sess-<id>，本模块不拼分区字符串）。
// 本模块不含任何 IPC（命令通道与状态推送由 ipc.ts 装配，见步骤 3）；
// 窗口引用一律经 getWindow() 现取、禁止缓存（macOS 关窗重建场景）。

import { BrowserWindow, WebContentsView } from 'electron'
import type { Input, WebContents } from 'electron'
import type { BrowserSnapshot, BrowserTabState, SetBoundsPayload } from '../../shared/browser'
import { matchBrowserShortcut, type BrowserShortcutId } from '../../shared/browserShortcuts'
import { isOpenableUrl, logLoadFailure } from './url'

const BLANK_URL = 'about:blank'
const BLANK_TITLE = '新标签页'
/** tab title 钳制上限，与会话侧 clampString 一致，防超长 title 刷全量快照推送 */
const TITLE_MAX = 200
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
  url: string
  title: string
  faviconUrl: string | null
  loading: boolean
  /** 该 Tab 的 DevTools 开关态；快照 devtoolsOpen 取激活 Tab 的此字段 */
  devtoolsOpen: boolean
}

export type SnapshotListener = (snapshot: BrowserSnapshot) => void

export type FocusAddressListener = () => void

export interface TabManager {
  /** 新建 Tab 并立即激活（挂入 contentView、应用当前 bounds）；空 url 加载 about:blank */
  newTab: (url?: string) => BrowserSnapshot
  /** 关闭 Tab；仅剩 1 个时 no-op；id 不存在时 no-op；均返回当前快照 */
  closeTab: (id: string) => BrowserSnapshot
  /** 切换激活 Tab；旧 view 脱离 contentView 但不销毁（页面状态保留） */
  switchTab: (id: string) => BrowserSnapshot
  /** 设置内容区矩形（窗口内容坐标系 DIP），仅作用于激活 view */
  setBounds: (rect: SetBoundsPayload) => void
  /** 切换激活 Tab 的原生受管 DevTools；无激活 Tab 时 no-op；返回当前快照 */
  toggleDevTools: () => BrowserSnapshot
  /** 关闭激活 Tab 的 DevTools；未开或无激活 Tab 时 no-op；返回当前快照 */
  closeDevTools: () => BrowserSnapshot
  /** 激活 Tab 的 webContents；无激活 Tab 或已销毁时返回 null（导航类命令的唯一取用口） */
  getActiveWebContents: () => WebContents | null
  /** 窗口（重）建后重挂激活 Tab 的页面 view；macOS 关窗重开由 index.ts 调用 */
  attachToWindow: () => void
  getSnapshot: () => BrowserSnapshot
  /** 订阅快照变化，返回退订函数 */
  onSnapshotChanged: (cb: SnapshotListener) => () => void
  /** 订阅 focus-address 请求（页面侧 Cmd/Ctrl+L、页面侧快捷键新建空 Tab），返回退订函数 */
  onFocusAddressRequest: (cb: FocusAddressListener) => () => void
}

export function createTabManager(
  getWindow: () => BrowserWindow | null,
  opts: { sessionId: string; partition: string; initialBounds?: SetBoundsPayload }
): TabManager {
  // Map 迭代序即创建序，快照 tabs 顺序直接按此输出
  const tabs = new Map<string, TabEntry>()
  let seq = 0
  let activeId: string | null = null
  // 布局缓存初值取创建方传入（registry 的全局 bounds 缓存），切换重挂即有矩形可用
  let bounds: SetBoundsPayload | null = opts.initialBounds ?? null
  // 悬挂态：renderer 上报零矩形（确认框等弹层收起原生层）期间置位，
  // 此后挂入的 view 一律按 HIDDEN_RECT 收起；布局缓存保留最后有效值，悬挂解除自动恢复
  let suspended = false
  const listeners = new Set<SnapshotListener>()
  const focusListeners = new Set<FocusAddressListener>()

  /** focus-address 请求点：manager 不碰 IPC，推送由 ipc.ts 订阅本点后转发主窗口 */
  function requestFocusAddress(): void {
    for (const cb of focusListeners) cb()
  }

  function buildSnapshot(): BrowserSnapshot {
    const list: BrowserTabState[] = []
    for (const tab of tabs.values()) {
      if (tab.view.webContents.isDestroyed()) continue
      const blank = tab.url === BLANK_URL
      list.push({
        id: tab.id,
        url: tab.url,
        title: blank ? BLANK_TITLE : tab.title,
        faviconUrl: blank ? null : tab.faviconUrl,
        loading: tab.loading,
        // canGoBack/canGoForward 构建快照时从 webContents 现读，不缓存
        canGoBack: tab.view.webContents.navigationHistory.canGoBack(),
        canGoForward: tab.view.webContents.navigationHistory.canGoForward()
      })
    }
    // devtoolsOpen 取激活 Tab 的真实开关态；无激活 Tab 时恒 false
    const active = activeId !== null ? tabs.get(activeId) : undefined
    // sessionId 由创建方（registry）注入：快照归属会话，registry/renderer 据此丢弃过期快照
    return {
      sessionId: opts.sessionId,
      tabs: list,
      activeTabId: activeId,
      devtoolsOpen: active?.devtoolsOpen ?? false
    }
  }

  function emitChange(): void {
    const snapshot = buildSnapshot()
    for (const cb of listeners) cb(snapshot)
  }

  /** 挂入 view 时应应用的矩形：悬挂收起优先，其次最后缓存的有效布局，均无则零矩形 */
  function currentRect(): SetBoundsPayload {
    return suspended ? HIDDEN_RECT : (bounds ?? HIDDEN_RECT)
  }

  function attachView(tab: TabEntry): void {
    const win = getWindow()
    if (!win) return
    win.contentView.addChildView(tab.view)
    tab.view.setBounds(currentRect())
  }

  function detachView(tab: TabEntry): void {
    const win = getWindow()
    if (!win) return
    win.contentView.removeChildView(tab.view)
  }

  /**
   * 激活指定 Tab：旧 Tab 的页面 view 脱离但保持存活，新 Tab 的页面 view 挂入。
   * 原生 DevTools 由对应页面 webContents 自己持有，随页面 view 一起切换，不另建宿主。
   */
  function activate(id: string): void {
    const prev = activeId !== null ? tabs.get(activeId) : undefined
    if (prev && prev.id !== id) detachView(prev)
    activeId = id
    const next = tabs.get(id)
    if (next) attachView(next)
  }

  function newTab(url?: string): BrowserSnapshot {
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
      emitChange()
    })
    wc.on('did-navigate-in-page', (_event, navigatedUrl, isMainFrame) => {
      // 子框架的页内导航不改主 frame 地址
      if (!isMainFrame) return
      tab.url = navigatedUrl
      emitChange()
    })
    wc.on('page-title-updated', (_event, title) => {
      tab.title = title.length > TITLE_MAX ? title.slice(0, TITLE_MAX) : title
      emitChange()
    })
    wc.on('page-favicon-updated', (_event, icons) => {
      // icons 是图标 URL 数组，取最后一个；无图标置 null
      tab.faviconUrl = icons.length > 0 ? icons[icons.length - 1] : null
      emitChange()
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
      switch (action) {
        case 'reload':
          wc.reload()
          break
        case 'new-tab':
          // 与 IPC 新建空 Tab 行为对齐：新建后随即请求聚焦地址栏（Chrome Cmd+T 惯例）
          newTab()
          requestFocusAddress()
          break
        case 'close-tab':
          // 最后留一由 closeTab 内部 no-op 承担
          closeTab(tab.id)
          break
        case 'focus-address':
          requestFocusAddress()
          break
        case 'toggle-devtools':
          // 页面聚焦态下该 Tab 即激活 Tab，manager 侧开关作用于激活 Tab
          toggleDevTools()
          break
        case 'close-devtools':
          // 上方守卫已确保该 Tab 的 DevTools 处于开启态
          closeDevTools()
          break
      }
    })

    // target=_blank / window.open 一律拒绝弹窗，转为本浏览器新 Tab；
    // URL 是页面可控输入，仅放行与地址栏一致的 scheme 白名单，其余（mailto: 等）拒绝且不建 Tab
    wc.setWindowOpenHandler(({ url: openUrl }) => {
      if (openUrl && isOpenableUrl(openUrl)) newTab(openUrl)
      return { action: 'deny' }
    })

    // 先激活（挂入 contentView、应用当前 bounds），再发起加载——保证首条快照已带 activeTabId
    activate(id)

    // 导航失败（坏域名等）由 Chromium 内建错误页呈现；reject 走统一日志（ERR_ABORTED 静默）
    void wc.loadURL(target).catch((error: unknown) => logLoadFailure(target, error))

    emitChange()
    return buildSnapshot()
  }

  function closeTab(id: string): BrowserSnapshot {
    // 最后留一：仅剩 1 个 Tab 时不关闭
    if (tabs.size <= 1) return buildSnapshot()
    const target = tabs.get(id)
    if (!target) return buildSnapshot()
    // 关闭前取创建序邻位（Map 迭代序 = 创建序）
    const order = [...tabs.keys()]
    const index = order.indexOf(id)
    tabs.delete(id)
    detachView(target)
    // 原生受管 DevTools 与页面 webContents 同生命周期，关闭后再销毁页面。
    closeTabDevTools(target)
    if (activeId === id) {
      // 关闭激活 Tab：优先激活原位置右侧第一个，无右侧则左侧最后一个
      const nextId = order[index + 1] ?? (index > 0 ? order[index - 1] : null)
      activeId = null
      if (nextId !== null) activate(nextId)
    }
    // 销毁 = removeChildView + webContents.close()
    target.view.webContents.close()
    emitChange()
    return buildSnapshot()
  }

  function switchTab(id: string): BrowserSnapshot {
    // id 不存在或已激活均 no-op
    if (!tabs.has(id) || id === activeId) return buildSnapshot()
    activate(id)
    emitChange()
    return buildSnapshot()
  }

  function setBounds(rect: SetBoundsPayload): void {
    // 零矩形是"收起信号"（确认框等弹层悬挂）而非布局：置悬挂态并作用于激活 view，
    // 不污染布局缓存；非零矩形解除悬挂并记忆布局
    if (rect.width <= 0 || rect.height <= 0) {
      suspended = true
    } else {
      suspended = false
      bounds = rect
    }
    // 仅作用于激活 view；未激活 view 保持脱离状态，切回时由 activate 应用
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

  /** 切换激活 Tab 的 DevTools：已开则关、未开则开；无激活 Tab 时 no-op 返回当前快照 */
  function toggleDevTools(): BrowserSnapshot {
    const tab = activeId !== null ? tabs.get(activeId) : undefined
    if (!tab) return buildSnapshot()
    if (tab.devtoolsOpen) closeTabDevTools(tab)
    else openTabDevTools(tab)
    emitChange()
    return buildSnapshot()
  }

  /** 关闭激活 Tab 的 DevTools；未开或无激活 Tab 时 no-op 返回当前快照 */
  function closeDevTools(): BrowserSnapshot {
    const tab = activeId !== null ? tabs.get(activeId) : undefined
    if (!tab || !tab.devtoolsOpen) return buildSnapshot()
    closeTabDevTools(tab)
    emitChange()
    return buildSnapshot()
  }

  function getSnapshot(): BrowserSnapshot {
    return buildSnapshot()
  }

  function getActiveWebContents(): WebContents | null {
    if (activeId === null) return null
    const tab = tabs.get(activeId)
    if (!tab || tab.view.webContents.isDestroyed()) return null
    return tab.view.webContents
  }

  function attachToWindow(): void {
    if (activeId === null) return
    const tab = tabs.get(activeId)
    const win = getWindow()
    if (!tab || !win || tab.view.webContents.isDestroyed()) return
    // 已挂入时只同步 bounds（含悬挂收起）；未挂入则复用 attachView 路径（activate 与重挂两路共用）
    if (!win.contentView.children.includes(tab.view)) {
      attachView(tab)
    } else {
      tab.view.setBounds(currentRect())
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

  return {
    newTab,
    closeTab,
    switchTab,
    setBounds,
    toggleDevTools,
    closeDevTools,
    getActiveWebContents,
    attachToWindow,
    getSnapshot,
    onSnapshotChanged,
    onFocusAddressRequest
  }
}
