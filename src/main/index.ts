import { app, shell, BrowserWindow, Menu, session, WebContentsView } from 'electron'
import { join } from 'path'
import { access, rm } from 'fs/promises'
import { electronApp, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerSessionIpc } from './sessions'
import { registerBrowserIpc } from './browser/ipc'
import { createTabManager, type TabManager } from './browser/manager'

// 模块级持有：createWindow 在窗口（重）建时需调用 attachToWindow 重挂激活 view
let tabManager: TabManager | null = null

/**
 * 安装中文应用菜单（替代 Electron 默认英文菜单）。默认菜单的问题有二：
 * ① macOS 菜单栏恒显示（autoHideMenuBar 仅影响 Win/Linux），英文 File/Edit/View
 *   违反「界面纯中文」产品原则；② 默认 File/View 角色带 ⌘W（关窗）/⌘R（重载 shell）
 *   等加速键，与产品键位（⌘W 关 Tab、⌘R 刷页面）语义冲突，且菜单加速键优先于
 *   before-input-event——故直接裁掉 File/View 菜单，只保留 mac 文本编辑必需的
 *   Edit 角色与窗口管理项，全部中文文案。
 */
function installChineseMenu(): void {
  const appName = '多会话测试浏览器'
  const appMenu =
    process.platform === 'darwin'
      ? {
          label: appName,
          submenu: [
            { role: 'about' as const, label: `关于${appName}` },
            { type: 'separator' as const },
            { role: 'services' as const, label: '服务' },
            { type: 'separator' as const },
            { role: 'hide' as const, label: `隐藏${appName}` },
            { role: 'hideOthers' as const, label: '隐藏其他' },
            { role: 'unhide' as const, label: '全部显示' },
            { type: 'separator' as const },
            { role: 'quit' as const, label: `退出${appName}` }
          ]
        }
      : { label: appName, submenu: [{ role: 'quit' as const, label: '退出' }] }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      appMenu,
      {
        label: '编辑',
        submenu: [
          { role: 'undo', label: '撤销' },
          { role: 'redo', label: '重做' },
          { type: 'separator' },
          { role: 'cut', label: '剪切' },
          { role: 'copy', label: '复制' },
          { role: 'paste', label: '粘贴' },
          { role: 'selectAll', label: '全选' }
        ]
      },
      {
        label: '窗口',
        submenu: [
          { role: 'minimize', label: '最小化' },
          { role: 'zoom', label: '缩放' }
        ]
      }
    ])
  )
}

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

  // 防误刷新守卫（AGENTS.md 坑点闭环）：脚手架 optimizer 的窗口快捷键接管接线已移除——
  // 它会在 dev 态抢走 F12（打开 shell 自身的 Electron DevTools），与产品语义冲突。
  // 其余职责由此自接管（对照 @electron-toolkit/utils watchWindowShortcuts 默认行为逐一交接）：
  // 仅 prod 拦 shell 重载与 shell DevTools 热键（Cmd/Ctrl+R、F5、Cmd+Opt+I / Ctrl+Shift+I），
  // dev 放行保 HMR 便利（renderer 误触刷新可自愈：bounds 会重报）；缩放键（Cmd/Ctrl+- 与
  // Cmd/Ctrl+Shift+=）两种模式都拦（shell UI 不缩放，optimizer 原本恒拦）。
  // dev 态 shell 自身的 DevTools 经 Alt 唤出菜单栏 View 可达，F12 已归产品语义（唤起会话 DevTools）；
  // 本层不做任何 F12/ESC 处理（页面侧在 manager 的 before-input-event，shell 侧在 renderer keydown）。
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const withCmdCtrl = input.control || input.meta
    // 缩放键阻断（dev/prod 一致）：Minus = 缩小，Shift+Equal = 放大
    if (
      withCmdCtrl &&
      !input.alt &&
      (input.code === 'Minus' || (input.shift && input.code === 'Equal'))
    ) {
      event.preventDefault()
      return
    }
    if (is.dev) return
    const isCmdCtrlR = withCmdCtrl && !input.shift && !input.alt && input.key.toLowerCase() === 'r'
    const isF5 = !withCmdCtrl && !input.shift && !input.alt && input.key === 'F5'
    // shell 自身 DevTools 热键（optimizer 原 prod 拦截项）
    const isShellDevToolsHotkey =
      input.code === 'KeyI' && ((input.alt && input.meta) || (input.control && input.shift))
    if (isCmdCtrlR || isF5 || isShellDevToolsHotkey) {
      event.preventDefault()
    }
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

// [smoke4] 临时冒烟接线（阶段4步骤1；步骤6正式装配时移除）。
// 三项前置验证：① 多分区 cookie 隔离；② 跨分区挂摘交换后页面状态保活；
// ③ 分区数据清除时序（销毁 webContents → clearStorageData → 删分区目录 → 跨重启复查）。
// 仅在 SMOKE4=1|2 时激活，避免后续步骤的 dev 运行被冒烟退出打断。
const SMOKE4_A = 'persist:sess-smoke-a'
const SMOKE4_B = 'persist:sess-smoke-b'

function smoke4Log(...args: unknown[]): void {
  console.log('[smoke4]', ...args)
}

function dirExists(path: string): Promise<boolean> {
  return access(path)
    .then(() => true)
    .catch(() => false)
}

async function runSmoke4(): Promise<void> {
  const phase = process.env['SMOKE4']
  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
  const userData = app.getPath('userData')
  const dirA = join(userData, 'Partitions', 'sess-smoke-a')
  const dirB = join(userData, 'Partitions', 'sess-smoke-b')

  // 阶段 2（SMOKE4=2）：重启后复查清除与保留是否成立
  if (phase === '2') {
    const a = await session.fromPartition(SMOKE4_A).cookies.get({})
    const b = await session.fromPartition(SMOKE4_B).cookies.get({})
    smoke4Log('阶段2 重启后 A cookies（预期空）:', JSON.stringify(a))
    smoke4Log('阶段2 重启后 B cookies（预期含 smoke4-b）:', JSON.stringify(b))
    smoke4Log('阶段2 A 目录存在（预期 false）:', await dirExists(dirA))
    smoke4Log('阶段2 B 目录存在（预期 true）:', await dirExists(dirB))
    await sleep(1000)
    app.quit()
    return
  }

  // 阶段 1（SMOKE4=1）：完整序列
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) {
    smoke4Log('无主窗口，冒烟放弃')
    return
  }
  try {
    const rect = { x: 300, y: 300, width: 600, height: 400 }
    const viewA = new WebContentsView({ webPreferences: { partition: SMOKE4_A } })
    const viewB = new WebContentsView({ webPreferences: { partition: SMOKE4_B } })
    viewA.setBackgroundColor('#ffffff')
    viewB.setBackgroundColor('#ffffff')
    const sA = session.fromPartition(SMOKE4_A)
    const sB = session.fromPartition(SMOKE4_B)

    const load = (view: WebContentsView, url: string): Promise<void> =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`加载超时 ${url}`)), 20000)
        view.webContents.once('did-finish-load', () => {
          clearTimeout(timer)
          resolve()
        })
        void view.webContents.loadURL(url).catch(reject)
      })
    win.contentView.addChildView(viewA)
    viewA.setBounds(rect)
    await load(viewA, 'https://example.com')
    // B 后台加载（不挂入），验证分区后台 webContents 可独立完成加载
    await load(viewB, 'https://example.com')
    smoke4Log('双分区页面加载完成（A 挂入 / B 后台）')

    // ① 隔离：A 写 cookie，B 与 default 不得可见；反向同理。
    // expirationDate 必带：不带则是会话 cookie（仅内存、重启即失），无法验证持久语义
    const expires = Math.floor(Date.now() / 1000) + 3600
    await sA.cookies.set({
      url: 'https://example.com',
      name: 'smoke4-a',
      value: 'iso',
      expirationDate: expires
    })
    const namesA = (await sA.cookies.get({ url: 'https://example.com' })).map((c) => c.name)
    const namesB = (await sB.cookies.get({ url: 'https://example.com' })).map((c) => c.name)
    const namesD = (await session.defaultSession.cookies.get({ url: 'https://example.com' })).map(
      (c) => c.name
    )
    smoke4Log('隔离① A 写入——A 见（预期含 smoke4-a）:', JSON.stringify(namesA))
    smoke4Log('隔离① B 见（预期不含）:', JSON.stringify(namesB))
    smoke4Log('隔离① default 见（预期不含）:', JSON.stringify(namesD))
    await sB.cookies.set({
      url: 'https://example.com',
      name: 'smoke4-b',
      value: 'iso',
      expirationDate: expires
    })
    const namesA2 = (await sA.cookies.get({ url: 'https://example.com' })).map((c) => c.name)
    const namesB2 = (await sB.cookies.get({ url: 'https://example.com' })).map((c) => c.name)
    smoke4Log('隔离② B 写入——B 见（预期含 smoke4-b）:', JSON.stringify(namesB2))
    smoke4Log('隔离② A 见（预期不含）:', JSON.stringify(namesA2))

    // ② 保活：A 落 DOM 标记 → 摘 A 挂 B → 脱离期间读 A 标记 → 挂回再读
    await viewA.webContents.executeJavaScript(
      "document.body.setAttribute('data-smoke4','kept'); 'ok'"
    )
    win.contentView.removeChildView(viewA)
    win.contentView.addChildView(viewB)
    viewB.setBounds(rect)
    await sleep(1500)
    const markerDetached = await viewA.webContents.executeJavaScript(
      "document.body.getAttribute('data-smoke4')"
    )
    smoke4Log('保活① A 脱离期间 DOM 标记（预期 kept）:', markerDetached)
    win.contentView.removeChildView(viewB)
    win.contentView.addChildView(viewA)
    viewA.setBounds(rect)
    const markerBack = await viewA.webContents.executeJavaScript(
      "document.body.getAttribute('data-smoke4')"
    )
    smoke4Log('保活② A 重挂后 DOM 标记（预期 kept）:', markerBack)

    // ③ 清除时序：先销毁两分区全部 webContents，再 clearStorageData(A) + 删 A 目录
    win.contentView.removeChildView(viewA)
    viewA.webContents.close()
    viewB.webContents.close()
    await sleep(1000)
    await sA.clearStorageData()
    await rm(dirA, { recursive: true, force: true })
    const afterA = (await sA.cookies.get({})).map((c) => c.name)
    smoke4Log('清除① clearStorageData+rm 后 A cookies（预期空）:', JSON.stringify(afterA))
    smoke4Log('清除② A 目录存在（预期 false）:', await dirExists(dirA))
    smoke4Log('清除③ B 目录存在（预期 true，保留给阶段2复查）:', await dirExists(dirB))
    smoke4Log('阶段1 完成，2 秒后退出；请以 SMOKE4=2 再启一次复查重启语义')
    await sleep(2000)
    app.quit()
  } catch (error) {
    smoke4Log('冒烟失败:', error)
    await sleep(1000)
    app.quit()
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // 注册会话持久化 IPC handlers（须在窗口创建前就绪，保证 renderer 首帧即可调用）
  registerSessionIpc()

  // 中文应用菜单：先于窗口创建安装，mac 菜单栏首帧即为中文且无冲突加速键
  installChineseMenu()

  // 浏览器装配：manager 持有全部 WebContentsView，IPC handlers 在窗口创建前就绪；
  // 窗口引用一律现取不缓存（macOS 关窗重建场景）
  const getMainWindow = (): BrowserWindow | null => BrowserWindow.getAllWindows()[0] ?? null
  tabManager = createTabManager(getMainWindow)
  registerBrowserIpc(tabManager, getMainWindow)

  createWindow()

  // 初始单个新标签页（无 url，about:blank）；浏览器状态不持久化，重启即回到此初始态
  tabManager.newTab()

  // [smoke4] 冒烟入口（SMOKE4=1|2 时激活；步骤 6 移除）
  if (process.env['SMOKE4']) void runSmoke4()

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
