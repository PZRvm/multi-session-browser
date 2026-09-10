import { app, shell, BrowserWindow, WebContentsView } from 'electron'
import { join } from 'path'
import { writeFileSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerSessionIpc } from './sessions'
import { registerBrowserIpc } from './browser/ipc'
import { createTabManager, type TabManager } from './browser/manager'

// 模块级持有：createWindow 在窗口（重）建时需调用 attachToWindow 重挂激活 view
let tabManager: TabManager | null = null

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1080,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // macOS 关窗重开场景：重挂激活 view 到新窗口（首次创建时还没有任何 Tab，manager 内经 activeId 判空早退）
  tabManager?.attachToWindow()
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // 注册会话持久化 IPC handlers（须在窗口创建前就绪，保证 renderer 首帧即可调用）
  registerSessionIpc()

  // 浏览器装配：manager 持有全部 WebContentsView，IPC handlers 在窗口创建前就绪；
  // 窗口引用一律现取不缓存（macOS 关窗重建场景）
  const getMainWindow = (): BrowserWindow | null => BrowserWindow.getAllWindows()[0] ?? null
  tabManager = createTabManager(getMainWindow)
  registerBrowserIpc(tabManager, getMainWindow)

  createWindow()

  // 初始单个新标签页（无 url，about:blank）；浏览器状态不持久化，重启即回到此初始态
  tabManager.newTab()

  // ===== [smoke3] 阶段3步骤1 DevTools 嵌入冒烟临时接线（正式装配时移除，见计划步骤 6） =====
  // 文档模式验证：new WebContentsView() 宿主 → addChildView → setBounds →
  // setDevToolsWebContents → openDevTools；12s 双 view 截屏取证；13s 关闭 / 16s 重开
  setTimeout(() => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return
    // 开一个真实页面作为 DevTools 的观察对象（newTab 后即成为激活 Tab）
    const snapshot = tabManager?.newTab('https://example.com')
    console.log('[smoke3] newTab snapshot =', JSON.stringify(snapshot))
    const wc = tabManager?.getActiveWebContents()
    if (!wc) return
    wc.on('did-navigate', (_e, url) => console.log('[smoke3] page did-navigate:', url))
    wc.on('did-fail-load', (_e, code, desc, url) =>
      console.log('[smoke3] page did-fail-load:', code, desc, url)
    )
    const host = new WebContentsView()
    host.webContents.on('did-finish-load', () => {
      console.log('[smoke3] devtools wc did-finish-load, url =', host.webContents.getURL())
    })
    host.webContents.on('did-fail-load', (_e, code, desc, url) =>
      console.log('[smoke3] devtools wc did-fail-load:', code, desc, url.slice(0, 80))
    )
    host.webContents.on('render-process-gone', () =>
      console.log('[smoke3] devtools wc render-gone!')
    )
    win.contentView.addChildView(host)
    const [w, h] = win.getContentSize()
    host.setBounds({ x: 0, y: h - 320, width: w, height: 320 })
    wc.setDevToolsWebContents(host.webContents)
    wc.openDevTools()
    console.log('[smoke3] opened: isDevToolsOpened =', wc.isDevToolsOpened())
    // 12s：对页面 view 与 DevTools 宿主 view 各截一张，落 /tmp 供目视核对
    setTimeout(() => {
      void (async () => {
        try {
          const pageImg = await wc.capturePage()
          writeFileSync('/tmp/smoke3-page.png', pageImg.toPNG())
          const hostImg = await host.webContents.capturePage()
          writeFileSync('/tmp/smoke3-host.png', hostImg.toPNG())
          console.log(
            '[smoke3] capture done: page =',
            pageImg.getSize(),
            'host =',
            hostImg.getSize()
          )
        } catch (err) {
          console.log('[smoke3] capture failed:', String(err))
        }
      })()
    }, 12000)
    setTimeout(() => {
      wc.closeDevTools()
      win.contentView.removeChildView(host)
      console.log('[smoke3] closed: isDevToolsOpened =', wc.isDevToolsOpened())
    }, 13000)
    setTimeout(() => {
      win.contentView.addChildView(host)
      wc.openDevTools()
      console.log('[smoke3] reopened: isDevToolsOpened =', wc.isDevToolsOpened())
    }, 16000)
  }, 5000)
  // ===== [/smoke3] =====

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
