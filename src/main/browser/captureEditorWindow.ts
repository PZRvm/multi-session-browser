// 截图编辑窗口池：每张原始截图一窗，窗口与内存快照共同创建和释放。
// IPC 按可信 sender 解析本窗快照；不同截图独立，同图重复打开仅还原并聚焦。

import { BrowserWindow, screen, nativeImage, dialog, type WebContents } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import icon from '../../../resources/icon.png?asset'
import { getAppearanceBackgroundColor } from '../appearance'
import { installShellInputGuard } from '../inputGuard'
import { getCurrentLanguage, t } from '../i18n'
import { dialogIconForDarwin } from '../dialogs'
import { CAPTURE_EDITOR_WINDOW_ROLE } from '../../shared/capture'
import type { ResolvedTheme } from '../../shared/appearance'
import type { ThemeSystemId } from '../../shared/themeSystems'

// 窗口度量锚点（DIP）：编辑窗是内容随图的工具窗，宽度/高度按开窗图像现算（见 open），
// 此处持工作区留边、工具栏余量与尺寸下限
/** 主屏工作区四周留边（计划步骤 3：各留 80px——工具栏与窗体 chrome 余量一并兜住） */
const WORK_AREA_MARGIN = 80
/** 窗高在画布显示区之外的工具栏/产出钮预留行 */
const TOOLBAR_ALLOWANCE = 56
/** 度量下限：极小图（裁剪产物再编辑）仍保可用工具条 */
const MIN_WINDOW_WIDTH = 720
const MIN_WINDOW_HEIGHT = 280
/** 原始截图身份用于窗口去重，captureId 仅表示当前图像版本。 */
export interface CaptureEditorSnapshot {
  sourceCaptureId: string
  captureId: string
  png: Buffer
  sessionName: string
}

export interface CaptureEditorWindowController {
  open(snapshot: CaptureEditorSnapshot): void
  dispose(): void
  getSnapshot(sender: WebContents): CaptureEditorSnapshot | null
  /** 条目仍存活且版本未变才提交；异步输出完成不能复活已关窗口。 */
  commitSnapshot(
    sender: WebContents,
    expected: CaptureEditorSnapshot,
    next: CaptureEditorSnapshot
  ): boolean
}

export function createCaptureEditorWindowController(deps: {
  /** 主窗口解析（parent 归属与 settings 窗同款：macOS 关窗期间为 null → 无 parent
   *  建窗，同图不双开） */
  getMainWindow: () => BrowserWindow | null
  /** 当前解析主题（建窗背景色，主窗 index.ts 同款注入） */
  getResolvedTheme: () => ResolvedTheme
  /** 当前主题色（建窗背景色与 query sys 现取，主窗 index.ts 同款注入） */
  getThemeColor: () => ThemeSystemId
}): CaptureEditorWindowController {
  const entries = new Map<string, { window: BrowserWindow; snapshot: CaptureEditorSnapshot }>()

  function open(snapshot: CaptureEditorSnapshot): void {
    const existing = entries.get(snapshot.sourceCaptureId)
    if (existing && !existing.window.isDestroyed()) {
      if (existing.window.isMinimized()) existing.window.restore()
      existing.window.focus()
      return
    }
    const sourceCaptureId = snapshot.sourceCaptureId
    const size = nativeImage.createFromBuffer(snapshot.png).getSize()

    const owner = deps.getMainWindow()
    // 建窗时刻现取外观（背景色与 query sys 同源快照语义，主窗 index.ts 同款）
    const resolvedTheme = deps.getResolvedTheme()
    const themeColor = deps.getThemeColor()

    // 尺寸自适应：可用区 = 主屏工作区四周留边（高度另扣工具栏预留），
    // 显示缩放系数 = min(1, 可用宽/图宽, 可用高/图高)——只缩不放；窗度量 = 画布显示
    // 尺寸 + 工具栏预留（useContentSize：度量即内容区，系统框 chrome 不占预算）。
    // scale/imgWidth/imgHeight 仅编辑窗显示层消费，导出链不缩放
    const query: Record<string, string> = {
      role: CAPTURE_EDITOR_WINDOW_ROLE,
      sys: themeColor,
      lang: getCurrentLanguage()
    }
    // darwin 去标题条保留红绿灯：renderer 经 chrome query 让位（settings
    // 窗同款门控——不经 navigator 推断平台，窗口形态单源 = 建窗 query）
    const darwin = process.platform === 'darwin'
    if (darwin) query['chrome'] = 'hidden-titlebar'
    const work = screen.getPrimaryDisplay().workAreaSize
    const availWidth = Math.max(1, work.width - WORK_AREA_MARGIN * 2)
    const availHeight = Math.max(1, work.height - WORK_AREA_MARGIN * 2 - TOOLBAR_ALLOWANCE)
    const scale = Math.min(1, availWidth / size.width, availHeight / size.height)
    const width = Math.max(MIN_WINDOW_WIDTH, Math.round(size.width * scale))
    const height = Math.max(MIN_WINDOW_HEIGHT, Math.round(size.height * scale) + TOOLBAR_ALLOWANCE)
    query['scale'] = String(scale)
    query['imgWidth'] = String(size.width)
    query['imgHeight'] = String(size.height)

    const created = new BrowserWindow({
      width,
      height,
      minWidth: MIN_WINDOW_WIDTH,
      minHeight: MIN_WINDOW_HEIGHT,
      useContentSize: true,
      show: false,
      autoHideMenuBar: true,
      // darwin 去标题条保留红绿灯，不禁最小化。
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
    const entry = { window: created, snapshot }
    entries.set(sourceCaptureId, entry)
    const release = (): void => {
      if (entries.get(sourceCaptureId) === entry) entries.delete(sourceCaptureId)
    }
    created.webContents.once('render-process-gone', () => {
      release()
      if (!created.isDestroyed()) created.destroy()
    })

    // 防误刷新守卫（主窗/设置窗同规则共用，实现与完整说明在 inputGuard.ts）
    installShellInputGuard(created.webContents)

    // 防白屏时点：首帧就绪才显窗并取焦点（show 默认聚焦——focusable 正常有框窗）
    created.once('ready-to-show', () => {
      if (created.isDestroyed()) return
      created.show()
    })

    // 任何路径（用户关窗 / 主窗级联 / 应用退出）关闭后清引用，下次 open 重建
    created.once('closed', () => {
      release()
    })

    // 同 renderer 入口 + query 编辑窗角色 + sys 主题色 + lang 当前语言（设置窗/建议
    // 子窗双路径同款；lang 首帧语言注入防闪变，运行期变更经 settings:changed 广播）；
    // 加载失败销毁窗口并释放快照；标题归 renderer。
    const onRejected = (error: unknown): void => {
      if (created.isDestroyed()) return
      console.warn('[capture-editor] 编辑窗页面加载失败:', error)
      release()
      created.destroy()
      // 加载错误发生在 open 返回后，由主进程统一反馈，覆盖两个开窗入口。
      const parent = deps.getMainWindow()
      const options = {
        type: 'info' as const,
        message: t('browser.captureEditor.loadFailed'),
        buttons: [t('common.confirm')],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
        icon: dialogIconForDarwin()
      }
      const shown =
        parent && !parent.isDestroyed()
          ? dialog.showMessageBox(parent, options)
          : dialog.showMessageBox(options)
      void shown.catch((error: unknown) => {
        console.warn('[capture-editor] 加载失败提示框显示失败:', error)
      })
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
    for (const entry of [...entries.values()]) {
      if (!entry.window.isDestroyed()) entry.window.destroy()
    }
    entries.clear()
  }

  function findEntry(
    sender: WebContents
  ): { window: BrowserWindow; snapshot: CaptureEditorSnapshot } | undefined {
    if (sender.isDestroyed()) return undefined
    return [...entries.values()].find(
      (entry) => !entry.window.isDestroyed() && entry.window.webContents === sender
    )
  }

  function getSnapshot(sender: WebContents): CaptureEditorSnapshot | null {
    return findEntry(sender)?.snapshot ?? null
  }

  function commitSnapshot(
    sender: WebContents,
    expected: CaptureEditorSnapshot,
    next: CaptureEditorSnapshot
  ): boolean {
    const entry = findEntry(sender)
    if (!entry || entry.snapshot !== expected) return false
    entry.snapshot = next
    return true
  }

  return { open, dispose, getSnapshot, commitSnapshot }
}
