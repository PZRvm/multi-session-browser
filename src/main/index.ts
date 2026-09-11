import { app, shell, BrowserWindow, Menu } from 'electron'
import { mkdirSync } from 'fs'
import { join } from 'path'
import { electronApp, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerSessionIpc } from './sessions'
import { registerBrowserIpc } from './browser/ipc'
import { createSessionBrowserRegistry, type SessionBrowserRegistry } from './browser/registry'
import { loadSnapshot } from './store'
import { SESSIONS_CHANNELS, type SessionStatusesPayload } from '../shared/sessions'

// 测试隔离（必须在 app ready 前执行）：设置 MSB_USER_DATA 环境变量时，应用的
// userData（sessions.json、Partitions 分区数据）整体指向该目录，开发期验证/冒烟
// 永不触碰用户真实数据。背景：2026-09-12 修复轮曾用过期备份还原用户 sessions.json
// 并误删分区目录（见 notes/process.md 执行决策记录「阶段 4 修复轮……数据事故记录」），
// 此后一切运行时验证强制走本隔离。
if (process.env['MSB_USER_DATA']) {
  const override = process.env['MSB_USER_DATA']
  try {
    mkdirSync(override, { recursive: true })
  } catch (error) {
    // fail-fast 保留（隔离目录不可用则无法保证"不触碰真实数据"），但带中文说明退出，
    // 不以原始堆栈裸崩（F4 定案）
    console.error(
      `[main] MSB_USER_DATA 目录创建失败（${override}），退出以保护真实用户数据:`,
      error
    )
    throw error
  }
  app.setPath('userData', override)
}

// 模块级持有：createWindow 在窗口（重）建时需调用 attachToWindow 重挂当前激活会话的 view，
// 启动恢复亦经此引用（registry 在 app ready 内创建，此前为 null）
let registry: SessionBrowserRegistry | null = null

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

  // macOS 关窗重开场景：重挂当前激活会话的 view 到新窗口（注册表路由到激活 manager；
  // 首次创建窗口时尚无激活会话，注册表内自然 no-op）
  registry?.attachToWindow()
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // 中文应用菜单：先于窗口创建安装，mac 菜单栏首帧即为中文且无冲突加速键
  installChineseMenu()

  // 会话浏览器注册表：每会话一个独立分区（persist:sess-<id>）的 TabManager，命令一律
  // 路由到当前激活会话的 manager（ipc.ts 守卫后委托），会话运行状态（idle/loading）在
  // 注册表内聚合；窗口引用一律现取不缓存（macOS 关窗重建场景）
  const getMainWindow = (): BrowserWindow | null => BrowserWindow.getAllWindows()[0] ?? null
  const created = createSessionBrowserRegistry({ getWindow: getMainWindow })
  registry = created

  // IPC handlers 须在窗口创建前就绪（renderer 首帧即可调用）：浏览器命令经 ipc.ts 路由
  // 注册表；会话侧编排回调在此注入（签名按计划第 3 节契约点 3/4 冻结，内联声明）——
  // 切换会话即切换浏览器（视图交换保活），删除先级联切换再异步销毁清分区，
  // 状态拉取（get-statuses）兜底启动期推送竞态；阶段 5 增量：克隆分区复制（close-then-copy）、
  // 批量关闭（一次切空态 + 逐会话销毁）、批量打开测试地址（逐会话新 Tab，后台摘 view）
  registerBrowserIpc(created, getMainWindow)
  registerSessionIpc({
    onActiveChanged: (id: string | null): void => {
      created.switchSession(id)
    },
    onDeleted: (id: string, nextActiveId: string | null): void => {
      // 先切后毁：切换即时响应 UI，销毁（含清分区数据）异步收尾。
      // switchSession 包 catch（R3 定案）：切换抛错（如级联落到的 next id 被判非法）
      // 不得跳过销毁——否则盘已删净而分区残留。destroy 的 catch 兜底：销毁链含
      // partitionFor 读入口校验等抛错路径，fire-and-forget 不接 catch 会成未处理拒绝
      try {
        created.switchSession(nextActiveId)
      } catch (error) {
        console.warn(`[main] 删除后级联切换到 ${nextActiveId} 失败:`, error)
      }
      void created.destroySession(id).catch((error: unknown) => {
        console.warn(`[main] 销毁会话 ${id} 失败:`, error)
      })
    },
    getStatuses: (): SessionStatusesPayload => created.getStatuses(),
    // 克隆：分区数据复制全在 registry 内完成（关闭源 webContents 收尾活库 → 排除缓存
    // 目录递归复制 → 失败清目标残留上抛）；失败上抛即不落元数据，renderer 乐观态回滚
    clonePartition: (srcId: string, dstId: string): Promise<void> =>
      created.clonePartition(srcId, dstId),
    // 批量关闭全部：一次切空态（同步摘 view、广播空态快照）再逐会话异步销毁清分区
    // （N 次逐条切换不可取——主进程一次切空 + 并行销毁，计划契约点 3 定案）
    onAllDeleted: (ids: string[]): void => {
      created.switchSession(null)
      for (const id of ids) {
        void created.destroySession(id).catch((error: unknown) => {
          console.warn(`[main] 销毁会话 ${id} 失败:`, error)
        })
      }
    },
    // 批量打开测试地址：逐会话懒创建 manager 并新建 Tab（后台会话摘 view 保活后台加载）
    onBatchOpenUrl: (ids: string[], url: string): void => created.openUrlInSessions(ids, url)
  })

  // 会话状态推送：注册表聚合的全量状态 map 直连主窗口（status-changed 通道不经
  // sessions.ts，对齐 browser 侧 stateChanged 由 ipc.ts 接线的分工）；窗口引用现取
  // 不缓存，无窗口（macOS 关窗期间）时静默跳过
  created.onSessionStatus((payload) => {
    getMainWindow()?.webContents.send(SESSIONS_CHANNELS.statusChanged, payload)
  })

  createWindow()

  // 启动恢复（PRD 3.1.4）：读盘取上次激活会话交注册表恢复（init 内部会再读一次盘缓存
  // 各会话 lastUrl，属既定设计）；无持久化激活会话即保持零会话空态。用户操作先于恢复
  // 到达时 registry 的 initHandled 守卫已兜底（见 registry.ts 注释）。浏览器 Tab 结构
  // 不持久化，重启每会话回到单 Tab
  void loadSnapshot()
    .then((snapshot) => {
      registry?.init(snapshot.activeId)
    })
    .catch(() => undefined)

  // 退出前冲刷上报去抖的待写值（pageTitle/lastUrl）：导航后 500ms 内 Cmd+Q 会丢最后一次
  // 上报，重启恢复到上上次页面。写盘异步，属尽力而为（小 JSON 通常毫秒级完成于进程退出前）
  app.on('before-quit', () => {
    registry?.flushPendingReports()
  })

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
