// 截图编辑子窗控制器（截图编辑器增量步骤 3，计划 notes/plans/20261014134249-截图
// 编辑器开发计划.md 第 5 节步骤 3；通道与载荷契约见 src/shared/capture.ts）：单例编辑
// 子窗生命周期的唯一事实源——宿主 shell 的 open-editor IPC（registerCaptureIpc 内
// 作用域解析同 capture 后调用）与反馈条「编辑」钮（feedback-action 的 edit 分支，
// 主进程直连不经宿主回程）双入口共用；重复触发聚焦既有窗而非新开。窗体形态先例 =
// settings 窗（settingsWindow.ts createSettingsWindowController）：focusable 有框
// 正常窗、建窗 query role/sys/lang、preload + sandbox:false、once('closed') 引用
// 自清、主窗 closed 级联 dispose + 退出清理（index.ts 装配）。
//
// 与 settings 窗的两点差异（反馈轮一 2026-10-14 定稿）：
// ① 尺寸自适应：开窗时按单槽图像宽高与主屏工作区取 min(图像, 可用) 的显示缩放系数
//   （只缩不放），连同图像尺寸经建窗 query（scale/imgWidth/imgHeight）传给编辑窗
//   ——显示层缩放，不缩放导出（导出 pixelRatio 由编辑窗按图像像素/显示尺寸换算，
//   契约 CaptureEditImagePayload 头注）；空槽开窗无图可依，用默认度量且不携尺寸
//   query（空态错误由编辑窗 get-edit-image 如实呈现）。
// ② 窗体 chrome（反馈轮一用户裁决落地）：darwin 下 titleBarStyle:'hidden' 去标题条
//   **保留原生红绿灯**（trafficLightPosition {x:8,y:8}，settings 窗同款裁决位；与
//   settings 的差异：不禁最小化——编辑窗是工具窗，红灯三态全保留），query 携
//   chrome=hidden-titlebar 供 renderer 让位（顶部工具条承担窗口拖动，控件 no-drag，
//   见 app.css chrome-capture-editor-chrome-custom 段）；其余平台保持系统默认框
//   （win/linux 无红绿灯，去标题条会失去窗控——系统框为终态，非临时方案）。

import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import icon from '../../../resources/icon.png?asset'
import { getAppearanceBackgroundColor } from '../appearance'
import { installShellInputGuard } from '../inputGuard'
import { getCurrentLanguage } from '../i18n'
import { CAPTURE_EDITOR_WINDOW_ROLE } from '../../shared/capture'
import type { ResolvedTheme } from '../../shared/appearance'
import type { ThemeSystemId } from '../../shared/themeSystems'

// 窗口度量锚点（DIP）：编辑窗是内容随图的工具窗，宽度/高度按开窗图像现算（见 open），
// 此处只持工作区留边、工具栏余量与下限/空槽缺省四个锚点，视觉轮（计划步骤 7）可校准
/** 主屏工作区四周留边（计划步骤 3：各留 80px——工具栏与窗体 chrome 余量一并兜住） */
const WORK_AREA_MARGIN = 80
/** 窗高在画布显示区之外的工具栏/产出钮预留行 */
const TOOLBAR_ALLOWANCE = 56
/** 度量下限：极小图（裁剪产物再编辑）仍保可用工具条 */
const MIN_WINDOW_WIDTH = 360
const MIN_WINDOW_HEIGHT = 280
/** 空槽开窗（无图可依）缺省度量 */
const DEFAULT_WINDOW_WIDTH = 800
const DEFAULT_WINDOW_HEIGHT = 520

export interface CaptureEditorWindowController {
  /** 打开编辑窗（幂等单例）：已存在未销毁则聚焦，否则建窗（ready-to-show 后显窗取
   *  焦点）；imageWidth/imageHeight 为单槽现图像素尺寸（尺寸自适应入参，缺省走默认
   *  度量——调用方 capture.ts 读单槽现取，空槽不携） */
  open(options?: { imageWidth: number; imageHeight: number }): void
  /** 关闭编辑窗（主窗 closed 级联 / 退出清理用；窗口不存在时 no-op，引用由 closed
   *  钩子自清） */
  dispose(): void
  /** 编辑窗引用现取（编辑窗专属通道 sender 白名单判据：get-edit-image 等比对
   *  event.sender 用，settings 域 getSettingsWindow 先例；closed 自清钩子之外可能
   *  短暂残留已销毁引用，isDestroyed 由调用方判） */
  getEditorWindow(): BrowserWindow | null
}

export function createCaptureEditorWindowController(deps: {
  /** 主窗口解析（parent 归属与 settings 窗同款：macOS 关窗期间为 null → 无 parent
   *  建窗，单例不双开） */
  getMainWindow: () => BrowserWindow | null
  /** 当前解析主题（建窗背景色，主窗 index.ts 同款注入） */
  getResolvedTheme: () => ResolvedTheme
  /** 当前主题色（建窗背景色与 query sys 现取，主窗 index.ts 同款注入） */
  getThemeColor: () => ThemeSystemId
}): CaptureEditorWindowController {
  let win: BrowserWindow | null = null

  function open(options?: { imageWidth: number; imageHeight: number }): void {
    if (win && !win.isDestroyed()) {
      win.focus()
      return
    }

    const owner = deps.getMainWindow()
    // 建窗时刻现取外观（背景色与 query sys 同源快照语义，主窗 index.ts 同款）
    const resolvedTheme = deps.getResolvedTheme()
    const themeColor = deps.getThemeColor()

    // 尺寸自适应（头注差异①）：可用区 = 主屏工作区四周留边（高度另扣工具栏预留），
    // 显示缩放系数 = min(1, 可用宽/图宽, 可用高/图高)——只缩不放；窗度量 = 画布显示
    // 尺寸 + 工具栏预留（useContentSize：度量即内容区，系统框 chrome 不占预算）。
    // scale/imgWidth/imgHeight 仅编辑窗显示层消费，导出链不缩放
    let width = DEFAULT_WINDOW_WIDTH
    let height = DEFAULT_WINDOW_HEIGHT
    const query: Record<string, string> = {
      role: CAPTURE_EDITOR_WINDOW_ROLE,
      sys: themeColor,
      lang: getCurrentLanguage()
    }
    // darwin 去标题条保留红绿灯（头注差异②）：renderer 经 chrome query 让位（settings
    // 窗同款门控——不经 navigator 推断平台，窗口形态单源 = 建窗 query）
    const darwin = process.platform === 'darwin'
    if (darwin) query['chrome'] = 'hidden-titlebar'
    if (options && options.imageWidth > 0 && options.imageHeight > 0) {
      const work = screen.getPrimaryDisplay().workAreaSize
      const availWidth = Math.max(1, work.width - WORK_AREA_MARGIN * 2)
      const availHeight = Math.max(1, work.height - WORK_AREA_MARGIN * 2 - TOOLBAR_ALLOWANCE)
      const scale = Math.min(1, availWidth / options.imageWidth, availHeight / options.imageHeight)
      width = Math.max(MIN_WINDOW_WIDTH, Math.round(options.imageWidth * scale))
      height = Math.max(
        MIN_WINDOW_HEIGHT,
        Math.round(options.imageHeight * scale) + TOOLBAR_ALLOWANCE
      )
      query['scale'] = String(scale)
      query['imgWidth'] = String(options.imageWidth)
      query['imgHeight'] = String(options.imageHeight)
    }

    const created = new BrowserWindow({
      width,
      height,
      minWidth: MIN_WINDOW_WIDTH,
      minHeight: MIN_WINDOW_HEIGHT,
      useContentSize: true,
      show: false,
      autoHideMenuBar: true,
      // darwin 去标题条保留红绿灯（头注差异②；不禁最小化——工具窗红灯三态全留）。
      // y=16 = 48px 工具条垂直居中（(48−16)/2，反馈轮二用户裁决）；x=16 = 左缘留
      // 一段呼吸边距（反馈轮二续：8px 太贴左缘）——CSS 让位 padding-left 与之配对
      ...(darwin
        ? { titleBarStyle: 'hidden' as const, trafficLightPosition: { x: 16, y: 16 } }
        : {}),
      backgroundColor: getAppearanceBackgroundColor(resolvedTheme, themeColor),
      ...(owner && !owner.isDestroyed() ? { parent: owner } : {}),
      ...(process.platform === 'linux' ? { icon } : {}),
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false
      }
    })
    win = created

    // 防误刷新守卫（主窗/设置窗同规则共用，实现与完整说明在 inputGuard.ts）
    installShellInputGuard(created.webContents)

    // 防白屏时点：首帧就绪才显窗并取焦点（show 默认聚焦——focusable 正常有框窗）
    created.once('ready-to-show', () => {
      if (created.isDestroyed()) return
      created.show()
    })

    // 任何路径（用户关窗 / 主窗级联 / 应用退出）关闭后清引用，下次 open 重建
    created.once('closed', () => {
      if (win === created) win = null
    })

    // 同 renderer 入口 + query 编辑窗角色 + sys 主题色 + lang 当前语言（设置窗/建议
    // 子窗双路径同款；lang 首帧语言注入防闪变，运行期变更经 settings:changed 广播）；
    // catch 留痕后静默（captureFeedbackWindow 同口径）——不拦截 page-title-updated
    //（标题归 renderer，头注差异②）
    const onRejected = (error: unknown): void => {
      if (created.isDestroyed()) return
      console.warn('[capture-editor] 编辑窗页面加载失败:', error)
    }
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      const search = new URLSearchParams(query)
      created
        .loadURL(`${process.env['ELECTRON_RENDERER_URL']}?${search.toString()}`)
        .catch(onRejected)
    } else {
      created.loadFile(join(__dirname, '../renderer/index.html'), { query }).catch(onRejected)
    }
    console.log('[capture-editor] 截图编辑窗口已创建')
  }

  function dispose(): void {
    if (!win || win.isDestroyed()) return
    win.close()
  }

  function getEditorWindow(): BrowserWindow | null {
    return win
  }

  return { open, dispose, getEditorWindow }
}
