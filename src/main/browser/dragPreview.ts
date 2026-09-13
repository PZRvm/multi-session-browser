// 拖拽跟随虚影窗（阶段 9 修订追加）：指针自绘手势期间，用一个透明置顶小窗渲染
// 被拖 Tab 的卡片虚影（Chrome 同款手感——HTML5 拖放被替换后系统拖影不复存在，
// 虚影由应用自绘）。跟随由拖拽控制器的 16ms 光标轮询驱动（moveTo 与悬停高亮
// 同源，本模块零定时器）；窗口不接鼠标事件（不挡命中与手势）、不抢焦点
//（showInactive + focusable: false）、不进任务栏；生命周期严格限于拖拽窗口期
//（dragStart 建、dragEnd/过期/接管即销毁，见 dragging.ts endSession 收口）。
// 内容为 data URL 内联自包含样式（不依赖 renderer 包与 app.css），配色取
// chrome-tab-active 亮暗两态，语义与 DESIGN.md 色板一致。

import { BrowserWindow } from 'electron'
import type { TabDragPreviewPayload } from '../../shared/browser'

export interface DragPreview {
  /** 建窗渲染虚影并定位到抓取点锚定位置（重复调用先销毁旧窗） */
  show(payload: TabDragPreviewPayload, at: { x: number; y: number }): void
  /** 光标轮询驱动跟随（未显示时 no-op）；bounds 宽高保持建窗时的限幅值 */
  moveTo(at: { x: number; y: number }): void
  /** 销毁虚影窗（拖拽收口/无虚影拖拽时 no-op） */
  hide(): void
}

/** HTML 文本转义（title 来自页面标题，不可信任直插） */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** favicon 只接受 http(s) 绝对地址（页面可控输入，防 javascript:/data: 注入） */
function safeFavicon(url: string | null): string | null {
  return url && /^https:\/\//.test(url) ? url : null
}

export function createDragPreview(): DragPreview {
  let win: BrowserWindow | null = null
  // 建窗时限幅后的度量（moveTo 复用，避免每帧重算）
  let metrics: { width: number; height: number; grabX: number; grabY: number } | null = null
  const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi)

  function destroy(): void {
    if (win && !win.isDestroyed()) win.destroy()
    win = null
    metrics = null
  }

  function renderHtml(payload: TabDragPreviewPayload): string {
    const dark = payload.theme === 'dark'
    const bg = dark ? '#292a2d' : '#ffffff'
    const ink = dark ? '#e8eaed' : '#3c4043'
    const dot = dark ? '#9aa0a6' : '#5f6368'
    const favicon = safeFavicon(payload.faviconUrl)
    const icon = favicon
      ? `<img src="${escapeHtml(favicon)}" alt="" style="width:16px;height:16px;flex:none" draggable="false">`
      : `<span style="width:6px;height:6px;border-radius:50%;background:${dot};flex:none"></span>`
    return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;background:transparent">
<div style="display:flex;align-items:center;gap:8px;height:100vh;padding:0 14px;box-sizing:border-box;background:${bg};border-radius:8px;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei','Segoe UI',sans-serif;font-size:12px;color:${ink};white-space:nowrap;overflow:hidden">${icon}<span style="overflow:hidden;text-overflow:ellipsis;flex:1">${escapeHtml(payload.title)}</span></div>
</body></html>`
  }

  return {
    show(payload, at) {
      destroy()
      const width = Math.round(clamp(payload.width, 40, 480))
      const height = Math.round(clamp(payload.height, 24, 40))
      metrics = {
        width,
        height,
        grabX: clamp(payload.grabX, 0, width),
        grabY: clamp(payload.grabY, 0, height)
      }
      win = new BrowserWindow({
        x: Math.round(at.x - metrics.grabX),
        y: Math.round(at.y - metrics.grabY),
        width,
        height,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        focusable: false,
        skipTaskbar: true,
        hasShadow: true,
        show: false
      })
      // floating 层：浮于普通窗口之上（含本应用各窗），表达「随光标的浮起卡片」
      win.setAlwaysOnTop(true, 'floating')
      // 虚影不接鼠标：不挡拖拽命中测试、不吞光标事件
      win.setIgnoreMouseEvents(true)
      win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(renderHtml(payload)))
      // 首帧就绪再显（showInactive 不抢焦点），建窗期的缺位对 16ms 轮询跟随无感
      win.once('ready-to-show', () => {
        if (win && !win.isDestroyed()) win.showInactive()
      })
    },
    moveTo(at) {
      if (!win || win.isDestroyed() || !metrics) return
      win.setBounds({
        x: Math.round(at.x - metrics.grabX),
        y: Math.round(at.y - metrics.grabY),
        width: metrics.width,
        height: metrics.height
      })
    },
    hide() {
      destroy()
    }
  }
}
