// 悬浮截图反馈条的原生子视图（快速截图专项反馈轮三/五：初版为透明无框子窗，用户
// 实测 macOS 对子窗施加系统级圆角（28px 高条两端被切呈半圆，CSS 无法去除）——改
// 为宿主窗口内的 WebContentsView 承载：视图位于宿主内容坐标系（方角有保证、随窗
// 移动、无独立窗口生命周期），浮于页面视图之上（addChildView 后加者在上，show 时
// 重挂保顶；会话切换重建页面视图的极端竞态下反馈条可能被短暂覆盖，6s 瞬态可接受）。
// 定位：视图 bounds 即宿主内容坐标（anchorLeft/anchorTop/anchorWidth 直接使用，
// 免去子窗方案的 getContentBounds 原点换算）；resize 跟随由 shell 侧 ResizeObserver
// 重发 show-feedback（审查低-2 修复）承担，主进程不再挂 follow 监听。
// 懒创建、隐藏复用（setVisible），宿主 closed 级联销毁（index.ts dispose 钩子）。
// 本模块不含任何 IPC handler（通道装配在 capture.ts registerCaptureIpc，分层同
// manager/registry 惯例）。

import { WebContentsView } from 'electron'
import type { BrowserWindow, WebContents } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { getCurrentLanguage } from '../i18n'
import {
  CAPTURE_CHANNELS,
  CAPTURE_FEEDBACK_HEIGHT,
  CAPTURE_FEEDBACK_WINDOW_ROLE
} from '../../shared/capture'
import type { CaptureFeedbackDataPayload, CaptureFeedbackShowPayload } from '../../shared/capture'
import type { ThemeSystemId } from '../../shared/themeSystems'

export interface CaptureFeedbackWindows {
  /** 显示/更新反馈条（幂等）：懒创建子视图、重定位、内容就绪后显示（不夺焦） */
  show(windowId: string, payload: CaptureFeedbackShowPayload): void
  /** 隐藏反馈条（隐藏不销毁，复用）；就绪前到达的 hide 撤销未决的显示 */
  hide(windowId: string): void
  /** 销毁子视图并出池（宿主窗口 closed 级联；已不在池时 no-op） */
  dispose(windowId: string): void
  /** sender 身份判别：sender 属池内反馈子视图时返回宿主 windowId，否则 null */
  resolveOwnerOf(sender: WebContents): string | null
  /** 定向推送 download-request 到宿主 shell（「下载」点击回程；宿主已销毁 no-op） */
  sendToHost(windowId: string): void
}

/** 视图 bounds：锚点为宿主内容区 chrome-body（左缘/顶缘/宽度，客户端坐标 DIP 与
 * 视图坐标系同值），贴其顶缘全宽覆盖（用户定稿：宽 100% 贴导航栏下方、盖在网页
 * 上方），高度为固定常量（shared/capture.ts 与 CSS 同源配对） */
function boundsFor(anchor: CaptureFeedbackShowPayload): Electron.Rectangle {
  return {
    x: Math.round(anchor.anchorLeft),
    y: Math.round(anchor.anchorTop),
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
  interface ViewEntry {
    view: WebContentsView
    /** 首帧就绪（dom-ready）后为 true：就绪前 show 的内容缓存待 flush */
    ready: boolean
    /** 是否应可见（hide 可先于就绪到达，就绪时据此补显示） */
    visible: boolean
    /** 缓存锚点（resize 重发时随载荷更新） */
    anchor: CaptureFeedbackShowPayload
    /** 就绪前最后一条内容（仅保留最新），就绪即 flush */
    pendingData: CaptureFeedbackDataPayload | null
  }

  const views = new Map<string, ViewEntry>()

  function destroy(windowId: string): void {
    const entry = views.get(windowId)
    if (!entry) return
    views.delete(windowId)
    const owner = deps.getWindow(windowId)
    if (owner && !owner.isDestroyed()) {
      try {
        owner.contentView.removeChildView(entry.view)
      } catch {
        // 宿主销毁期移除失败可忽略（视图随宿主一并释放）
      }
    }
    if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close()
  }

  function show(windowId: string, payload: CaptureFeedbackShowPayload): void {
    const owner = deps.getWindow(windowId)
    if (!owner || owner.isDestroyed()) return
    const data: CaptureFeedbackDataPayload = {
      kind: payload.kind,
      text: payload.text,
      ...(payload.actionLabel !== undefined ? { actionLabel: payload.actionLabel } : {})
    }
    const existing = views.get(windowId)
    if (existing) {
      existing.anchor = payload
      existing.visible = true
      if (!existing.view.webContents.isDestroyed()) {
        existing.view.setBounds(boundsFor(payload))
        // 重挂保顶：会话切换会重建页面视图（后加者在上），反馈条显示期间被覆盖的
        // 极端场景由此兜回（addChildView 对已挂视图等价于提升到最上层）
        owner.contentView.addChildView(existing.view)
        if (existing.ready) {
          existing.view.webContents.send(CAPTURE_CHANNELS.feedbackData, data)
          existing.view.setVisible(true)
        } else {
          existing.pendingData = data
        }
      }
      return
    }

    // 懒创建：透明背景（条自身无底透明——反馈轮五澄清「下载按钮不要有背景」的
    // 前提即条底由 CSS 控制）、bounds 即内容坐标，挂到宿主最上层
    const view = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false
      }
    })
    view.setBackgroundColor('#00000000')
    const entry: ViewEntry = {
      view,
      ready: false,
      visible: true,
      anchor: payload,
      pendingData: data
    }
    views.set(windowId, entry)
    owner.contentView.addChildView(view)
    view.setBounds(boundsFor(payload))

    // 渲染进程崩溃兜底：销毁出池，不留空白视图占位
    view.webContents.on('render-process-gone', () => destroy(windowId))

    view.webContents.on('dom-ready', () => {
      const entry2 = views.get(windowId)
      if (!entry2 || entry2.view.webContents.isDestroyed()) return
      entry2.ready = true
      if (entry2.pendingData) {
        entry2.view.webContents.send(CAPTURE_CHANNELS.feedbackData, entry2.pendingData)
        entry2.pendingData = null
      }
      if (entry2.visible) entry2.view.setVisible(true) // setVisible 幂等，重复调用无害
    })

    // 同 renderer 入口 + query 子窗角色（omniboxSuggest 同款双路径）；catch 留痕后
    // 静默（审查低-4 口径）。sys/lang 创建时刻注入（语言更新经 settings:changed 推送）
    const sys = deps.getThemeColor()
    const query: Record<string, string> = {
      role: CAPTURE_FEEDBACK_WINDOW_ROLE,
      sys,
      lang: getCurrentLanguage()
    }
    const onRejected = (error: unknown): void => {
      if (view.webContents.isDestroyed()) return
      console.warn('[capture-feedback] 反馈视图页面加载失败:', error)
    }
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      const search = new URLSearchParams(query)
      view.webContents
        .loadURL(`${process.env['ELECTRON_RENDERER_URL']}?${search.toString()}`)
        .catch(onRejected)
    } else {
      view.webContents
        .loadFile(join(__dirname, '../renderer/index.html'), { query })
        .catch(onRejected)
    }
  }

  function hide(windowId: string): void {
    const entry = views.get(windowId)
    if (!entry) return
    entry.visible = false
    entry.pendingData = null
    if (!entry.view.webContents.isDestroyed()) {
      entry.view.setVisible(false)
    }
  }

  function resolveOwnerOf(sender: WebContents): string | null {
    for (const [windowId, entry] of views) {
      if (!entry.view.webContents.isDestroyed() && entry.view.webContents === sender) {
        return windowId
      }
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
