import { BaseWindow, WebContentsView, dialog } from 'electron'
import type { BrowserWindow, Rectangle, WebContents } from 'electron'
import { join } from 'path'
import { t } from '../i18n'
import { rememberDevToolsWindowBounds, restoreDevToolsWindowBounds } from './devtoolsWindowState'

/** 兼容层只承载官方面板及设备辅助页，不依赖 DevTools 私有前端模块。 */
export interface DevToolsHost {
  open: () => void
  attach: (window: BrowserWindow, bounds: Rectangle) => void
  detach: () => void
  setBounds: (bounds: Rectangle) => void
  close: () => void
}

function isFrontend(raw: string): boolean {
  try {
    const url = new URL(raw)
    return (
      url.protocol === 'devtools:' &&
      url.hostname === 'devtools' &&
      url.pathname === '/bundled/devtools_app.html'
    )
  } catch {
    return false
  }
}

function pageBounds(value: unknown): Rectangle | null {
  if (!value || typeof value !== 'object') return null
  const rect = value as Rectangle
  const values = [rect.x, rect.y, rect.width, rect.height]
  if (!values.every((n) => Number.isSafeInteger(n) && n >= 0 && n <= 100000)) return null
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
}

export function createDevToolsHost(page: WebContentsView, onClose: () => void): DevToolsHost {
  const wc = page.webContents
  const sourceSession = wc.session
  const view = new WebContentsView({
    webPreferences: {
      session: sourceSession,
      preload: join(__dirname, '../preload/devtoolsPreload.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })
  const devtools = view.webContents
  let owner: BrowserWindow | null = null
  let bounds: Rectangle = { x: 0, y: 0, width: 1, height: 1 }
  let inspected: Rectangle | null = null
  let toolbox: WebContentsView | null = null
  let toolboxContents: WebContents | null = null
  let floating: BaseWindow | null = null
  let docked = true
  let closed = false
  let ready = false
  const agent = process.argv.includes('--agent-debug')

  function remove(window: BaseWindow | null, child: WebContentsView): void {
    if (window && !window.isDestroyed() && window.contentView.children.includes(child)) {
      window.contentView.removeChildView(child)
    }
  }

  function floatingBounds(): void {
    if (closed || devtools.isDestroyed() || !floating || floating.isDestroyed()) return
    const [width, height] = floating.getContentSize()
    view.setBounds({ x: 0, y: 0, width, height })
    rememberFloatingBounds()
  }

  function rememberFloatingBounds(): void {
    if (floating && !floating.isDestroyed()) {
      rememberDevToolsWindowBounds(sourceSession, floating.getNormalBounds())
    }
  }

  function ensureFloating(): BaseWindow {
    if (!floating) {
      const restored = restoreDevToolsWindowBounds(sourceSession)
      floating = new BaseWindow({
        width: 900,
        height: 700,
        ...restored,
        minWidth: Math.min(400, restored?.width ?? 400),
        minHeight: Math.min(300, restored?.height ?? 300),
        show: false,
        autoHideMenuBar: true,
        title: t('browser.devtools.windowTitle', { url: wc.getURL() })
      })
      floating.on('resize', floatingBounds)
      floating.on('move', rememberFloatingBounds)
      floating.on('close', (event) => {
        if (closed) return
        event.preventDefault()
        onClose()
      })
    }
    return floating
  }

  function layout(): void {
    if (closed) return
    if (owner?.isDestroyed()) owner = null
    if (!docked) {
      const window = ensureFloating()
      remove(owner, view)
      if (!window.contentView.children.includes(view)) window.contentView.addChildView(view)
      floatingBounds()
      if (ready && !agent && !window.isVisible()) window.show()
    } else {
      remove(floating, view)
      floating?.hide()
    }
    if (!owner) return
    const surface = docked ? view : toolbox
    if (docked && toolbox) remove(owner, toolbox)
    if (surface) {
      if (!owner.contentView.children.includes(surface)) {
        owner.contentView.addChildView(surface)
        // 页面需覆盖原生面板的 inspected-page placeholder，不能覆盖设备工具栏。
        owner.contentView.addChildView(page)
      }
      surface.setBounds(bounds)
    }
    const rect =
      surface && inspected ? inspected : { x: 0, y: 0, width: bounds.width, height: bounds.height }
    // 原生 bounds 相对于设备/停靠视图；裁剪到应用浏览区，拒绝越界覆盖应用壳。
    const x = Math.min(Math.max(0, surface && inspected ? rect.x : 0), bounds.width)
    const y = Math.min(Math.max(0, surface && inspected ? rect.y : 0), bounds.height)
    page.setBounds({
      x: bounds.x + x,
      y: bounds.y + y,
      width: Math.max(1, Math.min(rect.width, bounds.width - x)),
      height: Math.max(1, Math.min(rect.height, bounds.height - y))
    })
  }

  function setDocked(next: boolean): void {
    if (docked !== next) inspected = null
    docked = next
    layout()
  }

  function fail(): void {
    if (closed) return
    const parent = owner
    onClose()
    const options = {
      type: 'error' as const,
      message: t('browser.devtools.failed'),
      buttons: [t('common.confirm')]
    }
    void (
      parent && !parent.isDestroyed()
        ? dialog.showMessageBox(parent, options)
        : dialog.showMessageBox(options)
    ).catch((error: unknown) => {
      console.warn('[devtools] 初始化失败反馈未能显示:', error)
    })
  }

  function pageDestroyed(): void {
    if (!closed) onClose()
  }

  function updateTitle(): void {
    if (floating && !floating.isDestroyed() && !wc.isDestroyed()) {
      floating.setTitle(t('browser.devtools.windowTitle', { url: wc.getURL() }))
    }
  }

  wc.once('destroyed', pageDestroyed)
  wc.on('did-navigate', updateTitle)
  wc.on('did-navigate-in-page', updateTitle)

  const startupTimer = setTimeout(fail, 8000)
  devtools.on('ipc-message', (event, channel, message: unknown) => {
    if (
      closed ||
      devtools.isDestroyed() ||
      channel !== 'msb:devtools-layout' ||
      event.senderFrame !== devtools.mainFrame ||
      !isFrontend(devtools.getURL()) ||
      !message ||
      typeof message !== 'object'
    )
      return
    const { method, params } = message as { method?: string; params?: unknown[] }
    if (method === 'hostReady') {
      ready = true
      clearTimeout(startupTimer)
    } else if (method === 'hostUnavailable') {
      fail()
    } else if (method === 'setIsDocked') {
      if (Array.isArray(params) && typeof params[0] === 'boolean') setDocked(params[0])
    } else if (method === 'setInspectedPageBounds') {
      const rect = Array.isArray(params) ? pageBounds(params[0]) : null
      // 前端首帧会先报 1×1 占位；此时缩小真实网页会把移动端初始缩放钉到 4 倍。
      // 原生设备工具栏的有效尺寸大于该占位，保留完整浏览区等下一次布局。
      if (rect && rect.width > 1 && rect.height > 1) {
        inspected = rect
        layout()
      }
    } else if (method === 'closeWindow') {
      onClose()
    } else if (method === 'bringToFront' || method === 'activateWindow') {
      if (!agent) {
        if (!docked) floating?.show()
        else owner?.focus()
        devtools.focus()
      }
    }
  })
  devtools.setWindowOpenHandler(({ url }) => {
    if (closed || devtools.isDestroyed()) return { action: 'deny' }
    const expected = devtools
      .getURL()
      .replace('devtools_app.html', 'device_mode_emulation_frame.html')
    if (!isFrontend(devtools.getURL()) || url !== expected || toolbox) {
      return { action: 'deny' }
    }
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        webPreferences: {
          preload: '',
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          backgroundThrottling: false
        }
      },
      createWindow: (options) => {
        // options 携带 Chromium 已创建的子 webContents，必须原样认领以保留 opener。
        // 另建空白 webContents 会让工具栏画在已脱管的页面，且破坏布局与生命周期。
        const child = new WebContentsView(options)
        const childContents = child.webContents
        // allow 与 Chromium 提交子页之间，来源工具可能已经关闭。
        if (closed || wc.isDestroyed()) {
          childContents.close({ waitForBeforeUnload: false })
          return childContents
        }
        toolbox = child
        toolboxContents = childContents
        childContents.setWindowOpenHandler(() => ({ action: 'deny' }))
        childContents.on('will-navigate', (event, target) => {
          if (target !== expected) event.preventDefault()
        })
        childContents.on('will-redirect', (event, target) => {
          if (target !== expected) event.preventDefault()
        })
        childContents.on('render-process-gone', fail)
        childContents.once('destroyed', () => {
          if (toolbox === child) toolbox = null
          if (!closed) onClose()
        })
        layout()
        return childContents
      }
    }
  })
  devtools.on('will-navigate', (event, url) => {
    if (!isFrontend(url)) event.preventDefault()
  })
  devtools.once('destroyed', () => {
    if (!closed) onClose()
  })
  devtools.on('render-process-gone', fail)

  return {
    open() {
      wc.setDevToolsWebContents(devtools)
      // 不指定 mode，保留 Electron 分区中记住的 Dock side；显示和焦点由宿主负责。
      wc.openDevTools()
    },
    attach(window, rect) {
      if (closed) return
      if (owner && owner !== window) {
        remove(owner, view)
        if (toolbox) remove(owner, toolbox)
        remove(owner, page)
      }
      owner = window
      bounds = rect
      if (!owner.contentView.children.includes(page)) owner.contentView.addChildView(page)
      layout()
    },
    detach() {
      remove(owner, view)
      if (toolbox) remove(owner, toolbox)
      remove(owner, page)
      owner = null
    },
    setBounds(rect) {
      bounds = rect
      layout()
    },
    close() {
      if (closed) return
      closed = true
      rememberFloatingBounds()
      clearTimeout(startupTimer)
      wc.removeListener('destroyed', pageDestroyed)
      wc.removeListener('did-navigate', updateTitle)
      wc.removeListener('did-navigate-in-page', updateTitle)
      remove(owner, view)
      if (toolbox) remove(owner, toolbox)
      remove(floating, view)
      if (!wc.isDestroyed()) wc.closeDevTools()
      if (!devtools.isDestroyed()) devtools.close({ waitForBeforeUnload: false })
      if (toolboxContents && !toolboxContents.isDestroyed())
        toolboxContents.close({ waitForBeforeUnload: false })
      floating?.destroy()
      if (!wc.isDestroyed()) page.setBounds(bounds)
    }
  }
}
