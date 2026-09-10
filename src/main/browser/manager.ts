// 浏览器 Tab 管理器：主进程持有全部 WebContentsView，统一走 persist:browse 分区。
// 本模块不含任何 IPC（命令通道与状态推送由 ipc.ts 装配，见步骤 3）；
// 窗口引用一律经 getWindow() 现取、禁止缓存（macOS 关窗重建场景）。

import { BrowserWindow, WebContentsView } from 'electron'
import type { Input, WebContents } from 'electron'
import type { BrowserSnapshot, BrowserTabState, SetBoundsPayload } from '../../shared/browser'
import { BROWSER_SHORTCUTS, type BrowserShortcutId } from '../../shared/browserShortcuts'

const BROWSE_PARTITION = 'persist:browse'
const BLANK_URL = 'about:blank'
const BLANK_TITLE = '新标签页'

/**
 * 页面侧快捷键精确匹配（键位表见 shared/browserShortcuts）：字母键要求
 * control||meta 命中且 shift/alt 均未按下（避免吞掉 Cmd+Shift+R 等组合），
 * 多字符功能键（F5）不带任何修饰；仅处理 keyDown，未命中返回 null 放行。
 */
function matchShortcut(input: Input): BrowserShortcutId | null {
  if (input.type !== 'keyDown') return null
  const key = input.key.toLowerCase()
  for (const shortcut of BROWSER_SHORTCUTS) {
    if (shortcut.key.toLowerCase() !== key) continue
    if (shortcut.key.length === 1) {
      if ((input.control || input.meta) && !input.shift && !input.alt) return shortcut.id
    } else if (!input.control && !input.meta && !input.shift && !input.alt) {
      return shortcut.id
    }
  }
  return null
}

interface TabEntry {
  id: string
  view: WebContentsView
  url: string
  title: string
  faviconUrl: string | null
  loading: boolean
  /** 该 Tab 的 DevTools 宿主 view（懒创建，每 Tab 至多一个，与页面 webContents 一对一强绑定） */
  devtoolsView: WebContentsView | null
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
  /** 设置内容区矩形（窗口内容坐标系 DIP），仅作用于激活 view；DevTools 宿主若开则跟随切分 */
  setBounds: (rect: SetBoundsPayload) => void
  /** 切换激活 Tab 的 DevTools：未开则开（懒建宿主嵌入）、已开则关；无激活 Tab 时 no-op；返回当前快照 */
  toggleDevTools: () => BrowserSnapshot
  /** 关闭激活 Tab 的 DevTools；未开或无激活 Tab 时 no-op；返回当前快照 */
  closeDevTools: () => BrowserSnapshot
  /** 设置 DevTools 停靠区矩形（窗口内容坐标系 DIP）；未开启时仅缓存，开启后作用于激活 Tab */
  setDevToolsBounds: (rect: SetBoundsPayload) => void
  /** 激活 Tab 的 webContents；无激活 Tab 或已销毁时返回 null（导航类命令的唯一取用口） */
  getActiveWebContents: () => WebContents | null
  /** 窗口（重）建后重挂激活 Tab 的页面 view 与 DevTools view（若开）；macOS 关窗重开由 index.ts 调用 */
  attachToWindow: () => void
  getSnapshot: () => BrowserSnapshot
  /** 订阅快照变化，返回退订函数 */
  onSnapshotChanged: (cb: SnapshotListener) => () => void
  /** 订阅 focus-address 请求（页面侧 Cmd/Ctrl+L、页面侧快捷键新建空 Tab），返回退订函数 */
  onFocusAddressRequest: (cb: FocusAddressListener) => () => void
}

export function createTabManager(getWindow: () => BrowserWindow | null): TabManager {
  // Map 迭代序即创建序，快照 tabs 顺序直接按此输出
  const tabs = new Map<string, TabEntry>()
  let seq = 0
  let activeId: string | null = null
  let bounds: SetBoundsPayload | null = null
  // 最近一次上报的 DevTools 停靠区矩形（renderer 双锚点之一）；为 null 时按页面矩形底部 40% 兜底切分
  let devtoolsBounds: SetBoundsPayload | null = null
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
    return { tabs: list, activeTabId: activeId, devtoolsOpen: active?.devtoolsOpen ?? false }
  }

  function emitChange(): void {
    const snapshot = buildSnapshot()
    for (const cb of listeners) cb(snapshot)
  }

  function attachView(tab: TabEntry): void {
    const win = getWindow()
    if (!win) return
    win.contentView.addChildView(tab.view)
    if (bounds) tab.view.setBounds(bounds)
  }

  function detachView(tab: TabEntry): void {
    const win = getWindow()
    if (!win) return
    win.contentView.removeChildView(tab.view)
  }

  /** DevTools 停靠区矩形：优先 renderer 上报缓存，未上报时按页面矩形底部 40% 兜底切分 */
  function resolveDevToolsRect(): SetBoundsPayload | null {
    if (devtoolsBounds) return devtoolsBounds
    if (!bounds) return null
    const height = Math.round(bounds.height * 0.4)
    return { x: bounds.x, y: bounds.y + bounds.height - height, width: bounds.width, height }
  }

  /** 挂入 DevTools 宿主 view 并应用矩形（调用方保证 z 序：页面 view 先挂、宿主 view 后挂） */
  function attachDevToolsView(tab: TabEntry): void {
    const win = getWindow()
    if (!win || !tab.devtoolsView) return
    win.contentView.addChildView(tab.devtoolsView)
    const rect = resolveDevToolsRect()
    if (rect) tab.devtoolsView.setBounds(rect)
  }

  /** 摘除 DevTools 宿主 view（webContents 存活，调试数据持续收集） */
  function detachDevToolsView(tab: TabEntry): void {
    const win = getWindow()
    if (!win || !tab.devtoolsView) return
    win.contentView.removeChildView(tab.devtoolsView)
  }

  /**
   * 激活指定 Tab：旧 Tab 的页面 view 与 DevTools 宿主 view 一并脱离（DevTools
   * webContents 存活、数据持续收集）；新 Tab devtoolsOpen 为真则按「页面 view 先、
   * 宿主 view 后」的 z 序一并重挂，为假则停靠区保持收起。
   */
  function activate(id: string): void {
    const prev = activeId !== null ? tabs.get(activeId) : undefined
    if (prev && prev.id !== id) {
      detachView(prev)
      detachDevToolsView(prev)
    }
    activeId = id
    const next = tabs.get(id)
    if (next) {
      attachView(next)
      if (next.devtoolsOpen) attachDevToolsView(next)
    }
  }

  function newTab(url?: string): BrowserSnapshot {
    seq += 1
    const id = `tab-${seq}`
    const view = new WebContentsView({
      // 只设分区，不设 preload/nodeIntegration/contextIsolation（网页内容不可信）
      webPreferences: { partition: BROWSE_PARTITION }
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
      devtoolsView: null,
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
      tab.title = title
      emitChange()
    })
    wc.on('page-favicon-updated', (_event, icons) => {
      // icons 是图标 URL 数组，取最后一个；无图标置 null
      tab.faviconUrl = icons.length > 0 ? icons[icons.length - 1] : null
      emitChange()
    })
    // DevTools 经面板内途径自行关闭（如面板关闭钮）时兜底同步状态，防 devtoolsOpen 与实际脱节；
    // 本方主动关闭也会触发本事件，但 closeTabDevTools 先复位标志，此处守卫可拦下重复处理
    wc.on('devtools-closed', () => {
      if (!tab.devtoolsOpen) return
      closeTabDevTools(tab)
      emitChange()
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

    // target=_blank / window.open 一律拒绝弹窗，转为本浏览器新 Tab
    wc.setWindowOpenHandler(({ url: openUrl }) => {
      if (openUrl) newTab(openUrl)
      return { action: 'deny' }
    })

    // 先激活（挂入 contentView、应用当前 bounds），再发起加载——保证首条快照已带 activeTabId
    activate(id)

    // 导航失败（坏域名等）由 Chromium 内建错误页呈现，此处只吞掉 reject 防未处理异常
    void wc.loadURL(target).catch(() => {})

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
    // DevTools 一并清理：先关 DevTools（销毁其 webContents），宿主 view 摘除并销毁，防泄漏
    disposeTabDevTools(target)
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
    bounds = rect
    // 仅作用于激活 view；未激活 view 保持脱离状态，切回时由 activate 应用
    if (activeId === null) return
    const tab = tabs.get(activeId)
    if (!tab || tab.view.webContents.isDestroyed()) return
    tab.view.setBounds(rect)
    // DevTools 宿主若开则跟随：显式缓存矩形优先，未上报时按新页面矩形兜底切分
    if (tab.devtoolsOpen && tab.devtoolsView) {
      const devRect = resolveDevToolsRect()
      if (devRect) tab.devtoolsView.setBounds(devRect)
    }
  }

  /** 打开该 Tab 的 DevTools：懒创建宿主 view 并一对一绑定；重复开关仅走 open/closeDevTools */
  function openTabDevTools(tab: TabEntry): void {
    const wc = tab.view.webContents
    if (wc.isDestroyed()) return
    if (!tab.devtoolsView) {
      const host = new WebContentsView()
      // DevTools 自身聚焦态的按键拦截（宿主每 Tab 仅创建一次，事件只挂一次）：
      // 仅拦 F12（DevTools 聚焦时也可关闭，Chrome 对齐）；ESC 不拦（留给 DevTools 抽屉），其余放行
      host.webContents.on('before-input-event', (event, input) => {
        if (!tab.devtoolsOpen) return
        if (matchShortcut(input) !== 'toggle-devtools') return
        event.preventDefault()
        closeTabDevTools(tab)
        emitChange()
      })
      tab.devtoolsView = host
      // setDevToolsWebContents 每 webContents 生命周期内只调一次，重复开关走 open/closeDevTools
      wc.setDevToolsWebContents(host.webContents)
    }
    wc.openDevTools()
    tab.devtoolsOpen = true
    // 激活 Tab 的页面 view 已在 contentView，宿主 view 追加其后（z 序：页面下、DevTools 上）
    attachDevToolsView(tab)
  }

  /** 关闭该 Tab 的 DevTools：closeDevTools 销毁其 webContents；宿主 view 摘除保留待复用 */
  function closeTabDevTools(tab: TabEntry): void {
    if (!tab.devtoolsOpen) return
    // 先复位标志再关，防 closeDevTools 同步触发 devtools-closed 事件造成重入
    tab.devtoolsOpen = false
    const wc = tab.view.webContents
    if (!wc.isDestroyed()) wc.closeDevTools()
    detachDevToolsView(tab)
  }

  /** 丢弃 Tab 前的 DevTools 清理：关 DevTools + 摘除并销毁宿主 view 的 webContents，防泄漏 */
  function disposeTabDevTools(tab: TabEntry): void {
    closeTabDevTools(tab)
    if (!tab.devtoolsView) return
    detachDevToolsView(tab)
    if (!tab.devtoolsView.webContents.isDestroyed()) tab.devtoolsView.webContents.close()
    tab.devtoolsView = null
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

  /** 记录 DevTools 停靠区矩形并作用于激活 Tab 的宿主 view；未开启时仅缓存 */
  function setDevToolsBounds(rect: SetBoundsPayload): void {
    devtoolsBounds = rect
    if (activeId === null) return
    const tab = tabs.get(activeId)
    if (!tab || tab.view.webContents.isDestroyed()) return
    if (tab.devtoolsOpen && tab.devtoolsView) tab.devtoolsView.setBounds(rect)
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
    // 已挂入时只同步 bounds；未挂入则复用 attachView 路径（activate 与重挂两路共用）
    if (!win.contentView.children.includes(tab.view)) {
      attachView(tab)
    } else if (bounds) {
      tab.view.setBounds(bounds)
    }
    // DevTools 宿主 view（若开）一并重挂，保持「页面下、DevTools 上」的 z 序
    if (tab.devtoolsOpen && tab.devtoolsView) {
      if (!win.contentView.children.includes(tab.devtoolsView)) {
        attachDevToolsView(tab)
      } else {
        const rect = resolveDevToolsRect()
        if (rect) tab.devtoolsView.setBounds(rect)
      }
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
    setDevToolsBounds,
    getActiveWebContents,
    attachToWindow,
    getSnapshot,
    onSnapshotChanged,
    onFocusAddressRequest
  }
}
