import { app, shell, BrowserWindow, Menu } from 'electron'
import { mkdirSync } from 'fs'
import { join } from 'path'
import { electronApp, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerSessionIpc } from './sessions'
import { registerDialogIpc } from './dialogs'
import { registerWorkspacePickerIpc } from './workspacePickerWindow'
import { registerBrowserIpc } from './browser/ipc'
import { createTabDragController } from './browser/dragging'
import { createDragPreview } from './browser/dragPreview'
import { createSessionBrowserRegistry, type SessionBrowserRegistry } from './browser/registry'
import { createIndependentWindows } from './browser/windows'
import { createOmniboxSuggestWindows, type OmniboxSuggestWindows } from './browser/omniboxSuggest'
import {
  createCaptureFeedbackWindows,
  type CaptureFeedbackWindows
} from './browser/captureFeedbackWindow'
import {
  createCaptureEditorWindowController,
  type CaptureEditorWindowController
} from './browser/captureEditorWindow'
import { installShellInputGuard } from './inputGuard'
import { installWarningChannelFilter } from './warnings'
import { loadSnapshot } from './store'
import {
  createAppearanceController,
  getAppearanceBackgroundColor,
  registerAppearanceIpc
} from './appearance'
import {
  createSettingsWindowController,
  registerSettingsIpc,
  type SettingsWindowController
} from './settingsWindow'
import {
  registerSettingsValueIpc,
  initHomepageCache,
  getHomepageUrl,
  getBootLanguage
} from './settings'
import { registerFactoryResetIpc } from './factoryReset'
import { registerShellIpc } from './shell'
import { registerChromeImportIpc } from './browser/chromeImport'
import { registerCaptureIpc } from './browser/capture'
import { registerRecordingIpc, routeBrowserLifecycleToRecording } from './browser/recording'
import collectorPageAsset from './browser/recording/capturePage.html?asset'
import { getCurrentLanguage, initMainProcessLanguage, onMainLanguageChanged, t } from './i18n'
import { SESSIONS_CHANNELS, type SessionStatusesPayload } from '../shared/sessions'
import { getAppDisplayNameForOS } from '../shared/appDisplay'
import { WINDOW_ID_MAIN, browserViewFallbackBackground } from '../shared/browser'
import type { TFunc } from '../shared/i18n'

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

// warning 通道接管（须在任何窗口加载页面前安装——Electron 对失败主 frame 导航的
// 固定警告经此通道打印，拦截见 ./warnings.ts 头注）
installWarningChannelFilter()

// 模块级持有：createWindow 在窗口（重）建时需调用 attachToWindow 重挂当前激活会话的 view，
// 启动恢复亦经此引用（registry 在 app ready 内创建，此前为 null）
let registry: SessionBrowserRegistry | null = null
// 主窗口显式引用（阶段 7—8）：多窗口后 getAllWindows()[0] 语义漂移——可能取到先建的
// 独立窗口；registry 的 getWindow('main')、ipc 定向推送、会话状态推送均经此引用。
// macOS 关窗期间自然为 null（closed 置空），重开由 activate → createWindow 回填
let mainWindow: BrowserWindow | null = null
// 建议子窗池（原生子窗口化专项）：宿主窗口 closed 级联销毁各自子窗——主窗 closed
// 钩子与独立窗 onWindowClosed 回调经此引用（whenReady 内创建，回调触发时必已就绪）
let suggestWindows: OmniboxSuggestWindows | null = null

// 截图反馈子窗池（快速截图专项反馈轮三）：宿主窗口 closed 级联销毁各自子窗——
// 主窗 closed 钩子与独立窗 onWindowClosed 调用（同建议子窗池）；whenReady 创建回填
let captureFeedbackWindows: CaptureFeedbackWindows | null = null
// 设置窗控制器（设置专项阶段一）：单例设置子窗的创建/聚焦/主窗级联——应用菜单
//「设置… ⌘,」直连 open()（模块级晚绑定：菜单安装先于控制器创建，click 触发必在
// 用户交互时、控制器已就绪），板头齿轮经设置域 open IPC 通道；主窗 closed 钩子经
// 此引用级联关闭设置窗（whenReady 内创建，此前为 null）
let settingsWindowController: SettingsWindowController | null = null
// 截图编辑子窗控制器（截图编辑器增量步骤 3）：单例编辑子窗的创建/聚焦/主窗级联——
// 宿主 open-editor IPC 与反馈条「编辑」钮两入口都在 registerCaptureIpc 内经此引用
// 触达（含编辑窗专属通道的 sender 白名单判据）；主窗 closed 钩子级联关闭、退出前
// 清理（whenReady 内创建，此前为 null）
let captureEditorWindowController: CaptureEditorWindowController | null = null
const appearanceController = createAppearanceController({
  // WebContentsView 兜底底色随主题（2026-09-25 专项）：亮暗翻转即同步全部存量会话
  // 视图；registry 晚于外观控制器初始化（whenReady 内创建），启动窗口期空值静默跳过
  onResolvedThemeChanged: (resolved) => {
    registry?.applyFallbackBackground(browserViewFallbackBackground(resolved))
  }
})

/**
 * 安装应用菜单（替代 Electron 默认英文菜单；阶段六参数化为 installAppMenu(t)——文案
 * 经 shared/i18n 字典 menu 命名空间取词，语言切换由 onMainLanguageChanged 回调重建，
 * 只换 label：结构、加速键与 click 晚绑定一律不动）。默认菜单的问题有二：
 * ① macOS 菜单栏恒显示（autoHideMenuBar 仅影响 Win/Linux），英文 File/Edit/View
 *   违反界面语言产品原则；② 默认 File/View 角色带 ⌘W（关窗）/⌘R（重载 shell）
 *   等加速键，与产品键位（⌘W 关 Tab、⌘R 刷页面）语义冲突，且菜单加速键优先于
 *   before-input-event——故直接裁掉 File/View 菜单，只保留 mac 文本编辑必需的
 *   Edit 角色与窗口管理项。
 */
function installAppMenu(t: TFunc): void {
  const appName = t('common.appName')
  const appMenu =
    process.platform === 'darwin'
      ? {
          label: appName,
          submenu: [
            { role: 'about' as const, label: t('menu.about', { name: appName }) },
            // 设置入口（设置专项阶段一）：macOS「偏好设置」惯例位——关于之后、服务
            // 分隔线之前，加速键 CmdOrCtrl+,；click 经模块级控制器晚绑定（菜单安装
            // 先于控制器创建，触发时必已就绪）。仅 darwin 加此项——Win/Linux 菜单栏
            // 默认隐藏（autoHideMenuBar），设置发现路径只有板头齿轮（PRD 3.8.1）
            {
              label: t('menu.settings'),
              accelerator: 'CmdOrCtrl+,',
              click: () => settingsWindowController?.open()
            },
            { type: 'separator' as const },
            { role: 'services' as const, label: t('menu.services') },
            { type: 'separator' as const },
            { role: 'hide' as const, label: t('menu.hide', { name: appName }) },
            { role: 'hideOthers' as const, label: t('menu.hideOthers') },
            { role: 'unhide' as const, label: t('menu.unhide') },
            { type: 'separator' as const },
            { role: 'quit' as const, label: t('menu.quit', { name: appName }) }
          ]
        }
      : { label: appName, submenu: [{ role: 'quit' as const, label: t('menu.quitSimple') }] }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      appMenu,
      {
        label: t('menu.edit'),
        submenu: [
          { role: 'undo', label: t('menu.undo') },
          { role: 'redo', label: t('menu.redo') },
          { type: 'separator' },
          { role: 'cut', label: t('menu.cut') },
          { role: 'copy', label: t('menu.copy') },
          { role: 'paste', label: t('menu.paste') },
          { role: 'selectAll', label: t('menu.selectAll') }
        ]
      },
      {
        label: t('menu.window'),
        submenu: [
          { role: 'minimize', label: t('menu.minimize') },
          { role: 'zoom', label: t('menu.zoom') }
        ]
      }
    ])
  )
}

function createWindow(): void {
  // 建窗外观现取一份快照：背景色与 query sys（renderer 求值期首帧主题注入，防非琥珀
  // 主题开窗闪色，契约见 shared/themeSystems.ts 头注）同源；macOS 关窗重开
  //（activate → createWindow）时取到的是当前偏好而非启动时旧值
  const appearance = appearanceController.getSnapshot()
  // 主窗标题 = OS 展示名（2026-09-18 用户裁决：Dock/任务栏 hover 名随操作系统语言
  // 取短名，契约见 shared/appDisplay.ts；Windows 任务栏 hover 显示的即窗口标题）。
  // 拦截 page-title-updated 防 index.html <title>（应用内产品名）覆写——设置窗同款
  //（settingsWindow.ts），独立窗口标题=会话名不受影响（PRD 验收 13）
  const displayTitle = getAppDisplayNameForOS(app.getLocale())
  // Create the browser window.
  // macOS 窗体 chrome（2026-09-20 用户二次裁决：去原生标题条与页内标题，但窗口控制
  // 调用 mac 原生三灯——自绘圆点方案废弃）：darwin 用 titleBarStyle hidden 去标题条，
  // 保留原生三灯并经 trafficLightPosition 定位到左侧板头行左端（x 与板头内边距对齐，
  // y 居中于板头行：板头契约高 40px、灯高 16px，(40-16)/2=12——魔法数与板头高度强
  // 耦合（app.css .board-head 头注登记对账），板头内容高度变化时须连本校准复核，
  // review 20260920161302 低-3 留痕；侧边栏收起态经 shell:set-native-window-buttons-
  // visible 整组隐藏、展开恢复，见 shared/shell.ts）；
  // renderer 板头左端留 spacer 占位（winc=traffic 建窗 query 门控，仅 darwin 携带）。
  // 窗口拖动由板头与 Tab 栏空白区 app-region: drag 承担。Windows/Linux 不携带
  // query、保持系统框原形态（平台惯例沿用）
  const darwin = process.platform === 'darwin'
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1080,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    title: displayTitle,
    backgroundColor: getAppearanceBackgroundColor(appearance.resolvedTheme, appearance.themeColor),
    ...(darwin ? { titleBarStyle: 'hidden' as const, trafficLightPosition: { x: 14, y: 12 } } : {}),
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  win.on('page-title-updated', (event) => event.preventDefault())
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
  // query sys = 建窗时刻主题色（renderer 求值期消费作首帧初始值；运行期变更一律经
  // appearance:changed 广播，query 不再被读取）；query lang = 建窗时刻语言（阶段六
  // 首帧语言注入，防英文用户首帧中文闪变；运行期变更经 settings:changed 广播）
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    // dev 路径与其余三处建窗同为 URLSearchParams 形态（审查修复轮低 6，防御式一致）
    const query = new URLSearchParams({
      sys: appearance.themeColor,
      lang: getCurrentLanguage(),
      ...(darwin ? { winc: 'traffic' } : {})
    })
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?${query.toString()}`)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), {
      query: {
        sys: appearance.themeColor,
        lang: getCurrentLanguage(),
        ...(darwin ? { winc: 'traffic' } : {})
      }
    })
  }

  // 主窗口销毁（macOS 关窗）即置空显式引用：getWindow('main')/定向推送此后自然跳过；
  // 重开由 activate → createWindow 重建并回填。建议子窗与截图反馈子窗随之销毁
  //（挂池摘监听），设置窗（若有）一并级联关闭（单例控制器内自清引用，重开主窗后
  // 可再次开窗）
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
    suggestWindows?.dispose(WINDOW_ID_MAIN)
    captureFeedbackWindows?.dispose(WINDOW_ID_MAIN)
    settingsWindowController?.dispose()
    // 编辑窗若有（单例）一并级联关闭（controller 内自清引用，重开主窗后可再次开窗）
    captureEditorWindowController?.dispose()
  })

  // macOS 关窗重开场景：重挂当前激活会话的 view 到新窗口（注册表路由到激活 manager；
  // 首次创建窗口时尚无激活会话，注册表内自然 no-op）
  registry?.attachToWindow()
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
/** 毫秒等待（退出防丢的写盘等待上限用；模块级纯计时器） */
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.pzrvm.multisessionbrowser')
  // OS 展示名（2026-09-18 用户裁决）：app.name 随操作系统语言取短名——Windows 任务
  // 栏归属名/关于面板等系统面消费；macOS dev 态 Dock 名来自未打包二进制不可运行期
  // 改（打包后由 electron-builder 元数据 + 本地化 InfoPlist.strings 生效），契约见
  // shared/appDisplay.ts
  app.setName(getAppDisplayNameForOS(app.getLocale()))

  // macOS dock 图标：dev 模式跑的是裸 Electron 二进制（bundle 内为默认图标，打包产物
  // 的 icns 不参与），运行时显式设置让 dev 与打包态一致；非 darwin 无此 API（窗口
  // 图标由上方 linux 的 icon 选项 / Windows 的 exe 资源承担）
  if (process.platform === 'darwin' && app.dock) {
    try {
      app.dock.setIcon(icon)
    } catch (error) {
      console.warn('[main] 设置 dock 图标失败（不影响功能）:', error)
    }
  }

  // 外观偏好必须在首个窗口创建前完成加载并应用。appearance.init 内部会将任何
  // 读取、校验或应用异常回退为“跟随系统”，不会阻断既有会话恢复与窗口创建。
  await appearanceController.init()

  // 主页与语言同步缓存先于窗口创建与会话恢复填充（新建标签页/会话首 Tab 的默认地址
  // 源 + 主进程语言 boot 初值，PRD 3.8.2 修订）：读失败在 loadSettings 内已回退默认
  // 骨架，不阻塞启动
  await initHomepageCache()

  // 主进程语言态 boot（阶段六）：getBootLanguage（settings 语言缓存）是唯一初值来源，
  // 必须在 initHomepageCache 之后（缓存已填充）、装菜单与建窗之前——菜单语言即启动
  // 语言；语言切换经下方回调重建菜单（只换 label，结构/加速键/晚绑定不动）
  initMainProcessLanguage(getBootLanguage())
  onMainLanguageChanged(() => installAppMenu(t))

  // 应用菜单：先于窗口创建安装，mac 菜单栏首帧即为当前语言且无冲突加速键
  installAppMenu(t)

  // 独立窗口登记表先建（其回调经模块级 registry 晚绑定触达——创建期 registry 尚为
  // null，回调只会在用户交互（tear-off 建窗）后触发）：ready-to-show 挂 view（防
  // 白屏）、closed 级联销毁该窗口作用域 Tab
  const independentWindows = createIndependentWindows({
    getBackgroundColor: () => {
      const appearance = appearanceController.getSnapshot()
      return getAppearanceBackgroundColor(appearance.resolvedTheme, appearance.themeColor)
    },
    // 建窗 query sys 现取（独立窗 renderer 首帧主题注入，主窗同款契约）
    getThemeColor: () => appearanceController.getSnapshot().themeColor,
    onWindowReady: (sessionId: string, windowId: string): void => {
      registry?.onIndependentWindowReady(sessionId, windowId)
    },
    onWindowClosed: (sessionId: string, windowId: string): void => {
      suggestWindows?.dispose(windowId)
      captureFeedbackWindows?.dispose(windowId)
      registry?.onIndependentWindowClosed(sessionId, windowId)
    }
  })

  // 建议子窗池（原生子窗口化专项）：每宿主窗口至多一个透明无框子窗承载地址栏建议
  //（懒创建/隐藏复用/宿主 move-resize 跟随），宿主窗口解析与 registry 同源
  suggestWindows = createOmniboxSuggestWindows({
    getWindow: (windowId: string): BrowserWindow | null =>
      windowId === WINDOW_ID_MAIN ? mainWindow : independentWindows.getWindowById(windowId),
    // 建窗 query sys 现取（子窗统一注入不特判，主窗/独立窗同款契约）
    getThemeColor: () => appearanceController.getSnapshot().themeColor
  })

  // 截图反馈子窗池（快速截图专项反馈轮三）：悬浮反馈条原生子窗承载（盖在网页上方，
  // 宿主内容区零压缩），机制同建议子窗池（懒创建/隐藏复用/宿主 move-resize 跟随/
  // closed 级联）
  captureFeedbackWindows = createCaptureFeedbackWindows({
    getWindow: (windowId: string): BrowserWindow | null =>
      windowId === WINDOW_ID_MAIN ? mainWindow : independentWindows.getWindowById(windowId),
    getThemeColor: () => appearanceController.getSnapshot().themeColor
  })

  // 设置窗控制器（设置专项阶段一）：单例设置子窗——应用菜单「设置… ⌘,」直连
  // open()，板头齿轮经设置域 open IPC 通道（下方注册区接线）；建窗背景色与 sys query
  // 随外观主题现取（主窗同款注入），后续主题翻转由 appearance 广播链自动覆盖（getAllWindows
  // 逐窗 setBackgroundColor，设置窗创建后即纳入），无需本控制器额外接线
  settingsWindowController = createSettingsWindowController({
    getMainWindow: () => mainWindow,
    getResolvedTheme: () => appearanceController.getSnapshot().resolvedTheme,
    getThemeColor: () => appearanceController.getSnapshot().themeColor
  })

  // 截图编辑子窗控制器（截图编辑器增量步骤 3）：单例编辑子窗——宿主 open-editor IPC
  // 与反馈条「编辑」钮双入口在 registerCaptureIpc 内触达（下方注册区接线）；建窗
  // 背景色与 sys query 随外观主题现取（设置窗同款注入），后续主题翻转由 appearance
  // 广播链自动覆盖（getAllWindows 逐窗 setBackgroundColor），无需本控制器额外接线
  captureEditorWindowController = createCaptureEditorWindowController({
    getMainWindow: () => mainWindow,
    getResolvedTheme: () => appearanceController.getSnapshot().resolvedTheme,
    getThemeColor: () => appearanceController.getSnapshot().themeColor
  })

  // 会话浏览器注册表：每会话一个独立分区（persist:sess-<id>）的 TabManager，命令按
  // 来源窗口作用域路由（ipc.ts 经 resolveSenderScope 解析后委托），会话运行状态
  //（idle/loading）在注册表内聚合；宿主窗口解析：'main' → 主窗口显式引用，独立窗口
  // → 登记表现取（一律不缓存，macOS 关窗重建场景）
  // 录制中锚定窗 holder（F''）：registry 构造在录制域之前，经可变引用回填——
  // manager 弹层收起按录制态分派「移出屏幕」应用矩形
  const recordedWindowIdHolder: { get: () => string | null } = { get: () => null }
  const created = createSessionBrowserRegistry({
    getWindow: (windowId: string): BrowserWindow | null =>
      windowId === WINDOW_ID_MAIN ? mainWindow : independentWindows.getWindowById(windowId),
    windows: independentWindows,
    getHomepageUrl,
    // WebContentsView 兜底底色现取（外观快照派生 chrome surface 族，单源 shared/browser.ts）
    getFallbackBackground: () =>
      browserViewFallbackBackground(appearanceController.getSnapshot().resolvedTheme),
    getRecordingWindowId: () => recordedWindowIdHolder.get()
  })
  registry = created

  // 拖拽会话控制器（阶段 9）：光标轮询/同会话窗口命中/悬停推送/四态裁决/60s 过期
  // 兜底。迁移原语经 registry 薄接口包装注入（控制器不拼分区串、不碰持久化、不直接
  // 持有 WebContentsView）；isTabInScope 谓词取自作用域快照——manager 摘除后快照为
  // 空态，天然覆盖「会话 manager 仍在注册表」的 dragEnd 重验判据。虚影窗（阶段 9
  // 修订追加：透明置顶预览窗随光标跟随）随拖拽会话生命周期由控制器统一驱动
  const tabDragController = createTabDragController({
    getMainWindow: (): BrowserWindow | null => mainWindow,
    windows: independentWindows,
    getActiveSessionId: (): string | null => created.getActiveSessionId(),
    isTabInScope: (tabId: string, windowId: string): boolean =>
      created.getSnapshot(windowId).tabs.some((tab) => tab.id === tabId),
    moveTabToWindow: (
      tabId: string,
      sourceWindowId: string,
      targetWindowId: string,
      insertIndex?: number
    ): void => {
      created.moveTabToWindow(tabId, sourceWindowId, targetWindowId, insertIndex)
    },
    tearOffAt: (tabId: string, sourceWindowId: string, at: { x: number; y: number }) =>
      created.tearOffTab(tabId, sourceWindowId, at).then(() => undefined),
    preview: createDragPreview()
  })

  // IPC handlers 须在窗口创建前就绪（renderer 首帧即可调用）：浏览器命令经 ipc.ts 路由
  // 注册表；会话侧编排回调在此注入（签名按计划第 3 节契约点 3/4 冻结，内联声明）——
  // 切换会话即切换浏览器（视图交换保活），删除先级联切换再异步销毁清分区，
  // 状态拉取（get-statuses）兜底启动期推送竞态；阶段 5 增量：克隆分区复制（close-then-copy）、
  // 批量关闭选中（一次切到级联激活 + 逐会话销毁）、批量打开测试地址（逐会话新 Tab，后台摘 view）
  registerBrowserIpc(created, {
    getMainWindow: () => mainWindow,
    windows: independentWindows,
    dragController: tabDragController,
    suggestWindows
  })
  registerAppearanceIpc(appearanceController)
  registerSettingsIpc(settingsWindowController, { getMainWindow: () => mainWindow })
  // 窗口壳域（侧边栏收起态专项）：whenReady 一次性注册、独立于 createWindow 重入
  // （macOS 关窗重开时 createWindow 会再跑，固定 win 引用二次注册即抛）；sender
  // 白名单 = 现取主窗，收起态隐藏/展开恢复原生三灯
  registerShellIpc({ getMainWindow: () => mainWindow })
  // 设置值域四通道（阶段四 get/changed/set-homepage + 阶段六 set-language）：无 sender
  // 白名单（对齐外观域先例，入参值守卫承担），changed 经 getAllWindows 全推；
  // set-language 成功链在 settings.ts 内闭环（落盘 + 语言缓存 + 主进程语言态——菜单
  // 重建/设置窗标题经 onMainLanguageChanged 装配回调触发，见上方注册点）
  registerSettingsValueIpc()
  // 恢复出厂通道（设置专项阶段七）：sender 白名单 = 设置窗；编排链在 factoryReset.ts——
  // 单临界区清会话/工作区元数据 → 先切后毁（onBatchDeleted 先例）→ 逐会话既有销毁链 →
  // 偏好重置（外观 + 设置，主进程语言态回默认在前者链内）→ sessions:changed 推送清空
  // 快照（主窗列表归零的跨窗事实通道，接线对齐下方 statusChanged：引用现取，无窗静默跳过）
  registerFactoryResetIpc({
    getSettingsWindow: () => settingsWindowController?.getSettingsWindow() ?? null,
    switchToNoSession: () => {
      try {
        created.switchSession(null)
      } catch (error) {
        console.warn('[main] 恢复出厂切换到空会话失败:', error)
      }
    },
    destroySession: (id: string) => created.destroySession(id),
    resetAppearancePreferences: () => appearanceController.resetToDefaults(),
    pushSessionsChanged: (snapshot) => {
      mainWindow?.webContents.send(SESSIONS_CHANNELS.changed, snapshot)
    }
  })
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
    // 克隆恢复集取 settle 时点缓存（阶段 10）：closeSession 冲刷前置后 persistence 缓存
    // 即「关闭发起时刻的完整归并集」，clone 元数据复制不重读盘（关窗级联窗口期的落盘
    // 重写不再影响克隆产物）
    getRestoreSet: (srcId: string) => created.getRestoreSet(srcId),
    // 批量关闭选中：一次切到级联 activeId（同步摘 view、广播快照）再逐会话异步销毁
    // 清分区（N 次逐条切换不可取——一次切换 + 并行销毁，计划契约点 3 定案）；选中集
    // 不含激活会话时级联 id 即原激活值，switchSession 同 id no-op 无副作用
    onBatchDeleted: (ids: string[], nextActiveId: string | null): void => {
      try {
        created.switchSession(nextActiveId)
      } catch (error) {
        console.warn(`[main] 批量删除后级联切换到 ${nextActiveId} 失败:`, error)
      }
      for (const id of ids) {
        void created.destroySession(id).catch((error: unknown) => {
          console.warn(`[main] 销毁会话 ${id} 失败:`, error)
        })
      }
    },
    // 批量打开测试地址：逐会话懒创建 manager 并新建 Tab（后台会话摘 view 保活后台加载）
    onBatchOpenUrl: (ids: string[], url: string): void => created.openUrlInSessions(ids, url)
  })
  // Chrome 浏览数据导入（导入专项 20260930133553 步骤 5）：枚举 profile / dry-run 只读
  // 探测并暂存 / execute 经 registry 静默窗口写入目标分区；分区路径取自 registry 单源
  //（partitionFor/partitionDir 守卫不旁路），暂存与单飞在模块内自持
  registerChromeImportIpc({
    registry: created,
    getPartitionDir: (sessionId) => created.getPartitionDir(sessionId),
    getMainWindow: () => mainWindow
  })
  // 快速截图（快速截图专项 20261009232146 步骤 5）：capture 截来源窗口作用域激活
  // Tab 入剪贴板 + save-last 最近一次截图落盘下载目录（captureId 单槽对账）；
  // 页面聚焦态快捷键的 capture:request 定向推挂在 manager before-input-event 分支
  // （快捷键链路），不经本装配。编辑器增量（2026-10-14 步骤 3）：编辑子窗控制器一并
  // 注入——open-editor 开窗 / 反馈条 edit 动作直连 / get-edit-image 等三通道 sender
  // 白名单判据（控制器创建先于本注册，非空断言对齐上方 captureFeedbackWindows!）
  registerCaptureIpc({
    registry: created,
    feedbackWindows: captureFeedbackWindows!,
    editorWindow: captureEditorWindowController!
  })
  // 录屏域（录屏线 A' 架构，计划 20261009231903 步骤 5，两线合并融合）：四 UI 通道 +
  // 采集器桥 + 生命周期订阅；采集器 preload 为多入口产物（electron.vite.config.ts），
  // 采集页 ?asset 导入。会话名经 loadSnapshot 现取（begin 低频动作，读盘可接受）。
  // getRecordedWindowId 经可变 holder 回填（registry 构造在先、录制域在后，F''）
  const recordingHooks = registerRecordingIpc({
    registry: created,
    getMainWindow: () => mainWindow,
    collectorPreloadPath: join(__dirname, '../preload/capturePreload.js'),
    collectorPagePath: collectorPageAsset,
    getSessionName: (id) => loadSnapshot().then((s) => s.sessions.find((x) => x.id === id)?.name),
    t,
    tmpDir: join(app.getPath('userData'), 'recording-tmp')
  })
  routeBrowserLifecycleToRecording(created, recordingHooks)
  recordedWindowIdHolder.get = recordingHooks.getRecordedWindowId
  // 破坏性确认框（PRD 4.10）：删除会话/批量关闭/删除工作区的二次确认弹主进程原生
  // 对话框，弹框期间页面视图保持可见；本通道只确认不执行，删除仍由上方 sessions/
  // workspaces 通道闭环（契约见 shared/dialog.ts）
  registerDialogIpc()
  // 工作区选择模态框（PRD 4.11，2026-09-21）：「移动到工作区」（单条 + 批量）目标
  // 选择弹主进程模态子窗口（macOS 原生 sheet，冒烟实证窗口模态阻塞 + 页面可见），
  // 展示上下文由权威快照现取；只返回选择结果，移动仍由 workspaces 既有通道闭环。
  // 建窗主题/语言注入与设置窗同源（appearanceController 现取）
  registerWorkspacePickerIpc({
    getMainWindow: () => mainWindow,
    getResolvedTheme: () => appearanceController.getSnapshot().resolvedTheme,
    getThemeColor: () => appearanceController.getSnapshot().themeColor
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

  // 退出前冲刷上报去抖的待写值（pageTitle/lastUrl/tabs）并关全部独立窗口。
  // 时序（阶段 10 翻转）：先冲刷（含封笔）后关窗——旧序「先关窗后冲刷」的前提
  // 「上报只绑 'main' 作用域快照，关窗级联不触发上报」已随归并收口失效：归并后独立窗
  // Tab 参与落盘，先关窗会让级联清空触发归并收缩、在去抖窗口内抢写缩水列表（独立窗
  // Tab 退出丢失）；先冲刷此刻独立窗全部存活、捕获完整归并集，冲刷后封笔（sealed），
  // 级联的收缩重算不再安排任何写盘。
  // 退出防丢（阶段 10 修复轮 2）：冲刷的写盘是异步链，直接放行会在写落定前退进程——
  // 撕出/导航后 500ms 去抖窗口内退出丢最后一次改动（实例实证）。preventDefault 拦下
  // 首次退出，等全部在途写盘落定（1s 上限防 fs 挂死阻塞退出）再关窗真正退出；信号退出
  // （SIGTERM——终止 dev 实例的常规形态）不触发 before-quit，统一转 app.quit() 走本链
  let quitFlushStarted = false
  let quitFlushSettled = false
  const quitThroughFlush = (): void => {
    // 在途去重：冲刷未落定期间的重复退出请求一律吞掉——放行判据是「已落定」而非
    // 「已启动」（审查 A：连按 Cmd+Q/连发 SIGTERM 的第二次若按启动标志放行，会截断
    // 在途写盘），落定后的统一 quit 才是唯一放行出口
    if (quitFlushStarted) return
    quitFlushStarted = true
    void Promise.race([registry?.flushPendingReports() ?? Promise.resolve(), sleep(1000)])
      .catch(() => undefined)
      .then(() => {
        quitFlushSettled = true
        independentWindows.closeAll()
        // 编辑窗显式关闭（截图编辑器增量步骤 3）：主窗 closed 级联在 app.quit 关全部
        // 窗口时同样触达，此处先行一步——编辑态不持久化（用户裁决关窗即弃），无需等
        // 待，只求退出路径不留孤儿窗
        captureEditorWindowController?.dispose()
        app.quit()
      })
  }
  app.on('before-quit', (event) => {
    if (quitFlushSettled) return // 冲刷落定后的真正退出，放行
    event.preventDefault()
    quitThroughFlush()
  })
  process.on('SIGTERM', () => {
    app.quit()
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
