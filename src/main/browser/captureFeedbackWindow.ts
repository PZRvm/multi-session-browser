// 悬浮截图反馈条的原生子窗口池（快速截图专项反馈轮三，承载机制同地址栏建议子窗
// omniboxSuggest.ts）：每个宿主窗口（'main' 或独立窗口 id）至多一个透明无框子窗，
// 懒创建、隐藏复用，销毁只随宿主窗口生命周期（closed 级联）。子窗不接键盘
// （focusable: false——键盘恒在宿主 shell）……接鼠标（「下载」点击经 action 通道
// 上报，capture.ts 校验后转发宿主 shell）、不进任务栏、无阴影；parent 归属宿主使其
// 浮于宿主（含 WebContentsView 原生层）之上——反馈条盖在网页上方，宿主内容区布局
// 零压缩（停靠压缩版随反馈轮三退役：消失时布局回弹的空白空窗即其缺陷）。
// 定位：宿主 getContentBounds() 原点 + shell 上报的 chrome-body 左缘/顶缘/宽度锚点
// （反馈条贴其顶缘全宽覆盖，用户定稿：宽 100% 贴导航栏下方），度量常量与 CSS 同源
// 配对（shared/capture.ts）；宿主 move/resize 期间以缓存锚点重算跟随（监听随 show
// 挂、hide/dispose 摘），零 renderer 参与。
// 本模块不含任何 IPC handler（通道装配在 capture.ts registerCaptureIpc，分层同
// manager/registry 惯例）。

import { BrowserWindow } from 'electron'
import type { WebContents } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { installShellInputGuard } from '../inputGuard'
import { getCurrentLanguage } from '../i18n'
import {
  CAPTURE_CHANNELS,
  CAPTURE_FEEDBACK_HEIGHT,
  CAPTURE_FEEDBACK_WINDOW_ROLE
} from '../../shared/capture'
import type { CaptureFeedbackShowPayload } from '../../shared/capture'
import type { ThemeSystemId } from '../../shared/themeSystems'

export interface CaptureFeedbackWindows {
  /** 显示/更新反馈条（幂等）：懒创建子窗、重定位、内容就绪后显窗（不夺焦） */
  show(windowId: string, payload: CaptureFeedbackShowPayload): void
  /** 隐藏反馈条（隐藏不销毁，复用）；建窗就绪前到达的 hide 撤销未决的显窗 */
  hide(windowId: string): void
  /** 销毁子窗并出池（宿主窗口 closed 级联；已不在池时 no-op） */
  dispose(windowId: string): void
  /** sender 身份判别：sender 属池内反馈子窗时返回宿主 windowId，否则 null（IPC 白名单用） */
  resolveOwnerOf(sender: WebContents): string | null
  /** 定向推送 download-request 到宿主 shell（「下载」点击回程；宿主已销毁 no-op） */
  sendToHost(windowId: string): void
}

/** 合成子窗屏幕位：锚点为宿主内容区 chrome-body（左缘/顶缘/宽度，客户端坐标 DIP），
 * 反馈条贴其顶缘全宽覆盖（用户定稿：宽 100% 贴导航栏下方、盖在网页上方），仅高度
 * 为固定常量（shared/capture.ts 与 CSS 同源配对） */
function computeBounds(
  owner: BrowserWindow,
  anchor: CaptureFeedbackShowPayload
): Electron.Rectangle {
  const content = owner.getContentBounds()
  return {
    x: Math.round(content.x + anchor.anchorLeft),
    y: Math.round(content.y + anchor.anchorTop),
    width: Math.max(0, Math.round(anchor.anchorWidth)),
    height: CAPTURE_FEEDBACK_HEIGHT
  }
}

export function createCaptureFeedbackWindows(deps: {
  /** 宿主窗口解析：'main' → 主窗口显式引用，独立窗口 → 登记表现取（index.ts 注入） */
  getWindow: (windowId: string) => BrowserWindow | null
  /** 当前主题色（建窗 query sys 现取，统一注入不特判；index.ts 注入） */
  getThemeColor: () => ThemeSystemId
}): CaptureFeedbackWindows {
  interface ChildEntry {
    win: BrowserWindow
    /** 首帧就绪（ready-to-show）后为 true：就绪前 show 的数据缓存待 flush */
    ready: boolean
    /** 反馈条是否应可见（hide 可先于首帧就绪到达，就绪时据此决定是否 showInactive） */
    visible: boolean
    /** 缓存锚点：宿主 move/resize 跟随重定位的数据源 */
    anchor: CaptureFeedbackShowPayload
    /** 就绪前最后一条内容（仅保留最新），就绪即 flush */
    pendingData: CaptureFeedbackShowPayload | null
    /** 宿主 move/resize 跟随监听挂摘（show 挂、hide/dispose 摘，防泄漏） */
    detachFollow: () => void
  }

  const children = new Map<string, ChildEntry>()

  function destroy(windowId: string): void {
    const entry = children.get(windowId)
    if (!entry) return
    children.delete(windowId)
    entry.detachFollow()
    if (!entry.win.isDestroyed()) entry.win.destroy()
  }

  function show(windowId: string, payload: CaptureFeedbackShowPayload): void {
    const owner = deps.getWindow(windowId)
    if (!owner || owner.isDestroyed()) return
    const existing = children.get(windowId)
    if (existing) {
      existing.anchor = payload
      existing.visible = true
      if (!existing.win.isDestroyed()) {
        existing.win.setBounds(computeBounds(owner, payload))
        if (existing.ready) {
          existing.win.webContents.send(CAPTURE_CHANNELS.feedbackData, payload)
          if (!existing.win.isVisible()) existing.win.showInactive()
        } else {
          existing.pendingData = payload
        }
      }
      return
    }

    // 懒创建：隐藏建窗，ready-to-show 后 flush 内容并 showInactive（不夺焦）
    const win = new BrowserWindow({
      ...computeBounds(owner, payload),
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      // 与建议子窗的唯一 deliberate 差异：focusable true——建议面板键盘恒留宿主地址栏
      // 必须 false，本子窗无任何键盘面；而 focusable:false（non-activating panel）在
      // macOS 不更新 CSS cursor（「下载」钮 pointer 失效，实测），true 后 showInactive
      // 仍不夺焦显示、hover cursor 正常（代价仅点击按钮瞬间 key 落子窗）
      focusable: true,
      skipTaskbar: true,
      show: false,
      parent: owner,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false
      }
    })
    installShellInputGuard(win.webContents)
    const entry: ChildEntry = {
      win,
      ready: false,
      visible: true,
      anchor: payload,
      pendingData: payload,
      detachFollow: () => undefined
    }
    children.set(windowId, entry)

    // 宿主 move/resize 跟随：以缓存锚点 + 现取内容区原点重算（监听随 show 挂、
    // hide/dispose 摘；监听挂在宿主上，宿主销毁时随之失效）
    const follow = (): void => {
      if (win.isDestroyed()) return
      win.setBounds(computeBounds(owner, entry.anchor))
    }
    owner.on('move', follow)
    owner.on('resize', follow)
    entry.detachFollow = () => {
      owner.removeListener('move', follow)
      owner.removeListener('resize', follow)
    }

    // 池一致性兜底：任何路径（dispose / 宿主级联 / 应用退出）导致子窗关闭都清池摘监听
    win.once('closed', () => {
      const current = children.get(windowId)
      if (current?.win === win) {
        children.delete(windowId)
        current.detachFollow()
      }
    })
    // 渲染进程崩溃兜底：销毁出池，不留空白透明窗悬于页面上方
    win.webContents.on('render-process-gone', () => destroy(windowId))

    win.once('ready-to-show', () => {
      if (win.isDestroyed()) return
      entry.ready = true
      if (entry.pendingData) {
        win.webContents.send(CAPTURE_CHANNELS.feedbackData, entry.pendingData)
        entry.pendingData = null
      }
      if (entry.visible && !win.isVisible()) win.showInactive()
    })

    // 同 renderer 入口 + query 子窗角色（omniboxSuggest 同款双路径）；catch 留痕后静默
    // （审查低-4）：不抛错不弹窗（口径同建议子窗），真失败补 console.warn 可追溯。
    // dispose 销毁期在途加载的 ERR_ABORTED 照旧吞：不以拒绝值本身判定（Electron 39 该
    // 失败的 code 为空串、描述不进 message，见 manager.ts NET_ERR_ABORTED 头注实测），
    // 改按 catch 时刻子窗已销毁筛——本子窗一生仅此一次加载且无他导航，销毁外无 abort
    // 来源。sys/lang 建窗时刻注入（语言更新经 settings:changed 推送，i18n 镜像订阅）
    const sys = deps.getThemeColor()
    const query: Record<string, string> = {
      role: CAPTURE_FEEDBACK_WINDOW_ROLE,
      sys,
      lang: getCurrentLanguage()
    }
    const onRejected = (error: unknown): void => {
      if (win.isDestroyed()) return
      console.warn('[capture-feedback] 子窗页面加载失败:', error)
    }
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      const search = new URLSearchParams(query)
      win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?${search.toString()}`).catch(onRejected)
    } else {
      win.loadFile(join(__dirname, '../renderer/index.html'), { query }).catch(onRejected)
    }
  }

  function hide(windowId: string): void {
    const entry = children.get(windowId)
    if (!entry || entry.win.isDestroyed()) return
    entry.visible = false
    entry.pendingData = null
    if (entry.win.isVisible()) entry.win.hide()
  }

  function resolveOwnerOf(sender: WebContents): string | null {
    for (const [windowId, entry] of children) {
      if (!entry.win.isDestroyed() && entry.win.webContents === sender) return windowId
    }
    return null
  }

  function sendToHost(windowId: string): void {
    const owner = deps.getWindow(windowId)
    if (!owner || owner.isDestroyed() || owner.webContents.isDestroyed()) return
    owner.webContents.send(CAPTURE_CHANNELS.downloadRequest, { action: 'download' })
  }

  return { show, hide, dispose: destroy, resolveOwnerOf, sendToHost }
}
