import { app, shell, BrowserWindow, Menu } from 'electron'
import { mkdirSync } from 'fs'
import { join } from 'path'
import { electronApp, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerSessionIpc } from './sessions'
import { registerBrowserIpc } from './browser/ipc'
import { createSessionBrowserRegistry, type SessionBrowserRegistry } from './browser/registry'
import { createIndependentWindows } from './browser/windows'
import { installShellInputGuard } from './inputGuard'
import { loadSnapshot } from './store'
import {
  createAppearanceController,
  getAppearanceBackgroundColor,
  registerAppearanceIpc
} from './appearance'
import { SESSIONS_CHANNELS, type SessionStatusesPayload } from '../shared/sessions'
import { WINDOW_ID_MAIN } from '../shared/browser'

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
// 主窗口显式引用（阶段 7—8）：多窗口后 getAllWindows()[0] 语义漂移——可能取到先建的
// 独立窗口；registry 的 getWindow('main')、ipc 定向推送、会话状态推送均经此引用。
// macOS 关窗期间自然为 null（closed 置空），重开由 activate → createWindow 回填
let mainWindow: BrowserWindow | null = null
const appearanceController = createAppearanceController()

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
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1080,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: getAppearanceBackgroundColor(appearanceController.getSnapshot().resolvedTheme),
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  // 回填主窗口显式引用（多窗口后此引用是 'main' 作用域的唯一身份判据）
  mainWindow = win

  win.on('ready-to-show', () => {
    win.show()
  })

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // 防误刷新守卫（AGENTS.md 坑点闭环，实现与完整说明在 inputGuard.ts——独立窗口同规则
  // 共用，L1 定案抽取）：F12 已归产品语义（唤起会话 DevTools），本层不做 F12/ESC 处理
  //（页面侧在 manager 的 before-input-event，shell 侧在 renderer keydown）
  installShellInputGuard(win.webContents)

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // 主窗口销毁（macOS 关窗）即置空显式引用：getWindow('main')/定向推送此后自然跳过；
  // 重开由 activate → createWindow 重建并回填
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  // macOS 关窗重开场景：重挂当前激活会话的 view 到新窗口（注册表路由到激活 manager；
  // 首次创建窗口时尚无激活会话，注册表内自然 no-op）
  registry?.attachToWindow()
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // 外观偏好必须在首个窗口创建前完成加载并应用。appearance.init 内部会将任何
  // 读取、校验或应用异常回退为“跟随系统”，不会阻断既有会话恢复与窗口创建。
  await appearanceController.init()

  // 中文应用菜单：先于窗口创建安装，mac 菜单栏首帧即为中文且无冲突加速键
  installChineseMenu()

  // 独立窗口登记表先建（其回调经模块级 registry 晚绑定触达——创建期 registry 尚为
  // null，回调只会在用户交互（tear-off 建窗）后触发）：ready-to-show 挂 view（防
  // 白屏）、closed 级联销毁该窗口作用域 Tab
  const independentWindows = createIndependentWindows({
    getBackgroundColor: () =>
      getAppearanceBackgroundColor(appearanceController.getSnapshot().resolvedTheme),
    onWindowReady: (sessionId: string, windowId: string): void => {
      registry?.onIndependentWindowReady(sessionId, windowId)
    },
    onWindowClosed: (sessionId: string, windowId: string): void => {
      registry?.onIndependentWindowClosed(sessionId, windowId)
    }
  })

  // 会话浏览器注册表：每会话一个独立分区（persist:sess-<id>）的 TabManager，命令按
  // 来源窗口作用域路由（ipc.ts 经 resolveSenderScope 解析后委托），会话运行状态
  //（idle/loading）在注册表内聚合；宿主窗口解析：'main' → 主窗口显式引用，独立窗口
  // → 登记表现取（一律不缓存，macOS 关窗重建场景）
  const created = createSessionBrowserRegistry({
    getWindow: (windowId: string): BrowserWindow | null =>
      windowId === WINDOW_ID_MAIN ? mainWindow : independentWindows.getWindowById(windowId),
    windows: independentWindows
  })
  registry = created

  // IPC handlers 须在窗口创建前就绪（renderer 首帧即可调用）：浏览器命令经 ipc.ts 路由
  // 注册表；会话侧编排回调在此注入（签名按计划第 3 节契约点 3/4 冻结，内联声明）——
  // 切换会话即切换浏览器（视图交换保活），删除先级联切换再异步销毁清分区，
  // 状态拉取（get-statuses）兜底启动期推送竞态；阶段 5 增量：克隆分区复制（close-then-copy）、
  // 批量关闭（一次切空态 + 逐会话销毁）、批量打开测试地址（逐会话新 Tab，后台摘 view）
  registerBrowserIpc(created, { getMainWindow: () => mainWindow, windows: independentWindows })
  registerAppearanceIpc(appearanceController)
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
    // rename 落盘成功后同步该会话全部独立窗口标题（窗口标题与会话名严格同源；
    // clamp 后的实际落盘名由 sessions.ts 传入，无 renderer 侧乐观标题）
    onRenamed: (id: string, name: string): void => {
      independentWindows.setTitleForSession(id, name)
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
  // sessions.ts，对齐 browser 侧 stateChanged 由 ipc.ts 接线的分工；会话面板只在主
  // 窗口）；窗口引用现取不缓存，无窗口（macOS 关窗期间）时静默跳过
  created.onSessionStatus((payload) => {
    mainWindow?.webContents.send(SESSIONS_CHANNELS.statusChanged, payload)
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
  // 上报，重启恢复到上上次页面。写盘异步，属尽力而为（小 JSON 通常毫秒级完成于进程退出前）。
  // 顺序口径（步骤 5 收口核对）：先关全部独立窗口再冲刷。二者无数据依赖——上报只绑
  // 'main' 作用域快照（独立窗 Tab 不上报，registry 接线定案），关窗级联发出的非 main
  // 快照不触发上报；级联若在冲刷之后才发出 main 快照，其内容也与冲刷值相同
  //（destroyTabsInWindow 不触碰 main 作用域的 Tab），迟到重写无数据损失。先关窗只为
  // 尽早开始页面卸载，让退出更快
  app.on('before-quit', () => {
    independentWindows.closeAll()
    registry?.flushPendingReports()
  })

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    // 判据用主窗口显式引用而非 getAllWindows()：独立窗口存活时后者非空，会漏重建主窗口
    if (!mainWindow) createWindow()
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
