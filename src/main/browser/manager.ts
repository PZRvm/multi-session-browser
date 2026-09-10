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
  /** 激活 Tab 的 webContents；无激活 Tab 或已销毁时返回 null（导航类命令的唯一取用口） */
  getActiveWebContents: () => WebContents | null
  /** 窗口（重）建后重挂激活 view 并应用当前 bounds；macOS 关窗重开场景由 index.ts 在 createWindow 内调用 */
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
    return { tabs: list, activeTabId: activeId }
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

  /** 激活指定 Tab：旧 view 脱离 contentView（不销毁），新 view 挂入并应用当前 bounds */
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
      webPreferences: { partition: BROWSE_PARTITION }
    })
    // 页面加载前兜底白底，防透明闪烁
    view.setBackgroundColor('#ffffff')
    const target = url ?? BLANK_URL
    const tab: TabEntry = { id, view, url: target, title: '', faviconUrl: null, loading: false }
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

    // 页面侧快捷键（Chrome 对齐最小集，键位表 shared/browserShortcuts 与 renderer shell 侧共用）：
    // 命中即吞掉按键防页面默认行为，未命中放行；F12/ESC 等明确不做清单见该表头注
    wc.on('before-input-event', (event, input) => {
      const action = matchShortcut(input)
      if (!action) return
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
    if (tab && !tab.view.webContents.isDestroyed()) tab.view.setBounds(rect)
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
    getActiveWebContents,
    attachToWindow,
    getSnapshot,
    onSnapshotChanged,
    onFocusAddressRequest
  }
}
