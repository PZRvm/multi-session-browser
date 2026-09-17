// 设置窗口控制器（设置专项阶段一）：单例设置子窗生命周期的唯一事实源——应用菜单
//「设置… ⌘,」（主进程内直连 open()，不经 IPC）与主窗板头齿轮（settings:open IPC，
// registerSettingsIpc 注册、sender 白名单 = 主窗 shell）双入口共用；重复触发聚焦
// 既有窗而非新开；主窗 closed 级联 dispose 关闭。与建议子窗（omniboxSuggest.ts）的
// 关键差异：设置窗是 focusable 的正常有框窗（系统标题栏 + 标题「设置」、要焦点、
// 可交互），不是透明无框不夺焦面板。窗口度量（DESIGN.md「设置窗口」条目定稿）：
// 初值 700×480、min 600×420、max 900×680、可拉伸（侧栏双栏重构定稿）；位置与尺寸记忆为留白
//（不落盘，OS 默认落位）。
// 外观背景色：建窗经 getAppearanceBackgroundColor（resolvedTheme + themeColor 现取
// 注入，主窗 index.ts 同款写法）；建窗 query 追加 sys = 建窗时刻主题色（renderer 求
// 值期首帧注入防闪色，契约见 shared/themeSystems.ts 头注）。后续主题翻转无需本模块
// 接线——appearance.ts 的 syncSnapshot 已对 BrowserWindow.getAllWindows() 逐窗
// setBackgroundColor，设置窗创建后自动纳入广播；renderer 壳体主题走 CSS 媒体查询
//（步骤四实现），零新增主题通道。
// macOS 裁决：主窗缺席（用户关掉主窗后经菜单 ⌘, 触发）时允许无 parent 建窗——
// darwin 菜单栏常驻、应用菜单在无任何窗口时仍可触达，拒绝开窗会让「设置…」成
// 死路；无 parent 的设置窗独立落位，主窗重开后的打开请求仍聚焦此窗（单例不双开）。

import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { getAppearanceBackgroundColor } from './appearance'
import { installShellInputGuard } from './inputGuard'
import type { ResolvedTheme } from '../shared/appearance'
import type { ThemeSystemId } from '../shared/themeSystems'
import { SETTINGS_CHANNELS, SETTINGS_WINDOW_ROLE } from '../shared/settings'
import type { OkResult, SettingsAppInfo } from '../shared/settings'

/** 设置窗口度量（DIP，DESIGN.md「设置窗口」条目侧栏双栏重构定稿）：可拉伸，位置记忆为留白 */
const DEFAULT_WIDTH = 700
const DEFAULT_HEIGHT = 480
const MIN_WIDTH = 600
const MIN_HEIGHT = 420
const MAX_WIDTH = 900
const MAX_HEIGHT = 680

export interface SettingsWindowController {
  /** 打开设置窗（幂等单例）：已存在未销毁则聚焦，否则建窗（ready-to-show 后显窗取焦点） */
  open(): void
  /** 关闭设置窗（主窗 closed 级联用；窗口不存在时 no-op，引用由 closed 钩子自清） */
  dispose(): void
  /** 设置窗引用现取（阶段三起 sender 白名单判据：get-app-info 等设置窗专属通道比对
   * event.sender 用；closed 自清钩子之外可能短暂残留已销毁引用，isDestroyed 由调用方判） */
  getSettingsWindow(): BrowserWindow | null
}

export function createSettingsWindowController(deps: {
  /** 主窗口解析（parent 归属；macOS 关窗期间为 null → 无 parent 建窗，见头注释裁决） */
  getMainWindow: () => BrowserWindow | null
  /** 当前解析主题（建窗背景色，主窗 index.ts 同款注入） */
  getResolvedTheme: () => ResolvedTheme
  /** 当前主题色（建窗背景色与 query sys 现取，主窗 index.ts 同款注入） */
  getThemeColor: () => ThemeSystemId
}): SettingsWindowController {
  let win: BrowserWindow | null = null

  function open(): void {
    if (win && !win.isDestroyed()) {
      win.focus()
      return
    }

    const owner = deps.getMainWindow()
    // 建窗时刻现取外观（背景色与 query sys 同源快照语义，主窗 index.ts 同款）
    const resolvedTheme = deps.getResolvedTheme()
    const themeColor = deps.getThemeColor()
    const created = new BrowserWindow({
      title: '设置',
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
      minWidth: MIN_WIDTH,
      minHeight: MIN_HEIGHT,
      maxWidth: MAX_WIDTH,
      maxHeight: MAX_HEIGHT,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: getAppearanceBackgroundColor(resolvedTheme, themeColor),
      ...(owner && !owner.isDestroyed() ? { parent: owner } : {}),
      ...(process.platform === 'linux' ? { icon } : {}),
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false
      }
    })
    win = created

    // 防误刷新守卫（主窗/独立窗同规则共用，实现与完整说明在 inputGuard.ts）
    installShellInputGuard(created.webContents)

    // 标题「设置」归建窗参数管理：拦截 renderer 页面 document.title 的覆盖（独立窗
    // page-title-updated 同款；否则 renderer 加载 index.html 会把标题刷掉）
    created.on('page-title-updated', (event) => event.preventDefault())

    // 防白屏时点：首帧就绪才显窗并取焦点（show 默认聚焦——与建议子窗 showInactive
    // 不夺焦的口径相反，设置窗是正常有框窗）
    created.once('ready-to-show', () => {
      if (created.isDestroyed()) return
      created.show()
    })

    // 任何路径（用户关窗 / 主窗级联 / 应用退出）关闭后清引用，下次 open 重建
    created.once('closed', () => {
      if (win === created) win = null
    })

    // 同 renderer 入口 + query 设置窗角色 + sys 主题色（omniboxSuggest / windows.ts
    // 双路径同款）；catch 静默关闭期在途加载的 ERR_ABORTED（close 触发 unload 的
    // 竞态，不成年抛错）
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      const query = new URLSearchParams({ role: SETTINGS_WINDOW_ROLE, sys: themeColor })
      created
        .loadURL(`${process.env['ELECTRON_RENDERER_URL']}?${query.toString()}`)
        .catch(() => undefined)
    } else {
      created
        .loadFile(join(__dirname, '../renderer/index.html'), {
          query: { role: SETTINGS_WINDOW_ROLE, sys: themeColor }
        })
        .catch(() => undefined)
    }
    console.log('[settings] 设置窗口已创建')
  }

  function dispose(): void {
    if (!win || win.isDestroyed()) return
    win.close()
  }

  function getSettingsWindow(): BrowserWindow | null {
    return win
  }

  return { open, dispose, getSettingsWindow }
}

export function registerSettingsIpc(
  controller: SettingsWindowController,
  deps: {
    /** sender 白名单判据：主窗口显式引用现取（macOS 关窗期间为 null，一律拒绝） */
    getMainWindow: () => BrowserWindow | null
  }
): void {
  ipcMain.handle(SETTINGS_CHANNELS.open, (event): OkResult => {
    const mainWindow = deps.getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) {
      console.warn('[settings] 拒绝非主窗来源的设置窗打开请求')
      throw new Error('设置窗命令仅接受主窗口来源')
    }
    controller.open()
    return { ok: true }
  })

  // 关于信息（阶段三）：版本三元组为 process.versions / app.getVersion() 真实值，
  // dev 态 appVersion 即 package.json 版本，如实返回不伪造。无害信息通道不设
  // sender 白名单（对齐 appearance.getState 先例，无入参无守卫需求）
  ipcMain.handle(SETTINGS_CHANNELS.getAppInfo, (): SettingsAppInfo => ({
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    chromiumVersion: process.versions.chrome,
    // Electron 官方仅发布 darwin/win32/linux 三平台，其余理论值按 linux 归一
    platform:
      process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win32' : 'linux'
  }))

  // 打开数据目录：唯一触发 OS 级外部动作的设置通道，sender 白名单 = 设置窗
  //（判据经 controller.getSettingsWindow 现取，macOS 关窗重建周期为 null 一律拒绝）。
  // shell.openPath 失败返回非空错误串（不 reject），包中文前缀如实上抛由设置窗呈现
  ipcMain.handle(SETTINGS_CHANNELS.openDataDir, async (event): Promise<OkResult> => {
    const settingsWindow = controller.getSettingsWindow()
    if (
      !settingsWindow ||
      settingsWindow.isDestroyed() ||
      event.sender !== settingsWindow.webContents
    ) {
      console.warn('[settings] 拒绝非设置窗来源的数据目录打开请求')
      throw new Error('数据目录命令仅接受设置窗口来源')
    }
    const errorMessage = await shell.openPath(app.getPath('userData'))
    if (errorMessage) {
      throw new Error(`打开数据目录失败：${errorMessage}`)
    }
    return { ok: true }
  })
}
