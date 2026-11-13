import { BrowserWindow, ipcMain } from 'electron'
import {
  TOOLBAR_TOOLTIP_CHANNELS,
  TOOLTIP_FONT_STACK,
  TOOLTIP_METRICS
} from '../../shared/toolbarTooltip'
import type { ToolbarTooltipPayload } from '../../shared/toolbarTooltip'
import { isRecord } from '../../shared/guards'
import type { SessionBrowserRegistry } from './registry'
import { t } from '../i18n'
import { preserveWindowTransparency } from '../appearance'
import { escapeHtml } from './html'

// 与 .chrome-tools-pop 同一气泡语系；内容经字典翻译后传入并转义（html.ts 单源，
// 审查 20261030162931 低-1 收敛），子窗禁用脚本。度量全部取 shared/toolbarTooltip.ts
// 单源常量（低-2 收敛：renderer 测量层同源消费，改度量只改 shared 一处）
function tooltipHtml(payload: ToolbarTooltipPayload, arrowX: number): string {
  const m = TOOLTIP_METRICS
  return `<!doctype html><html><head><meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
    <style>
      *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}
      body{padding-top:${m.arrow}px;font:${m.fontSize}px/${m.lineHeight} ${TOOLTIP_FONT_STACK}}
      .tip{position:relative;display:flex;align-items:center;gap:${m.gap}px;padding:${m.paddingY}px ${m.paddingX}px;
        border-radius:4px;background:rgba(0,0,0,.85);color:#fff;white-space:nowrap}
      .tip:before{content:'';position:absolute;bottom:100%;left:${arrowX}px;transform:translateX(-50%);
        border:${m.arrow}px solid transparent;border-bottom-color:rgba(0,0,0,.85)}
      .key{color:rgba(255,255,255,.65);font-variant-numeric:tabular-nums}
    </style></head><body><div class="tip"><span>${escapeHtml(payload.label)}</span>${
      payload.keyText ? `<span class="key">${escapeHtml(payload.keyText)}</span>` : ''
    }</div></body></html>`
}

export function registerToolbarTooltipIpc(registry: SessionBrowserRegistry): void {
  interface Entry {
    win: BrowserWindow
    revision: number
  }
  const entries = new Map<number, Entry>()

  const hide = (entry: Entry): void => {
    entry.revision++
    if (!entry.win.isDestroyed()) entry.win.hide()
  }

  ipcMain.handle(TOOLBAR_TOOLTIP_CHANNELS.show, (event, value: unknown) => {
    // 仅接受主窗口/独立窗口 shell，网页、设置窗及提示子窗均不可调用。
    registry.resolveSenderScope(event.sender)
    const owner = BrowserWindow.fromWebContents(event.sender)
    if (!owner || owner.isDestroyed() || owner.webContents !== event.sender || !owner.isVisible())
      return
    if (
      !isRecord(value) ||
      !['x', 'y', 'width', 'height'].every(
        (key) => typeof value[key] === 'number' && Number.isFinite(value[key])
      ) ||
      typeof value.label !== 'string' ||
      value.label.length > 512 ||
      (value.keyText !== null && (typeof value.keyText !== 'string' || value.keyText.length > 128))
    ) {
      throw new Error(t('errors.invalidBrowserParams'))
    }
    const payload = value as unknown as ToolbarTooltipPayload
    if (payload.width <= 0 || payload.width > 512 || payload.height <= 0 || payload.height > 100) {
      throw new Error(t('errors.invalidBrowserParams'))
    }
    const content = owner.getContentBounds()
    const width = Math.ceil(payload.width)
    // 上箭头占位取度量单源（箭头不挤压气泡正文）
    const height = Math.ceil(payload.height) + TOOLTIP_METRICS.arrow
    const edgeMargin = Math.max(
      0,
      Math.min(TOOLTIP_METRICS.edgeMargin, Math.floor((content.width - width) / 2))
    )
    const bounds = {
      x:
        content.x +
        Math.round(
          Math.max(edgeMargin, Math.min(payload.x - width / 2, content.width - width - edgeMargin))
        ),
      y: content.y + Math.round(Math.max(0, Math.min(payload.y, content.height - height))),
      width,
      height
    }
    // 气泡贴边时会偏离锚点，箭头需按裁定后的窗口坐标反算，不能仍固定在气泡中央。
    // 两侧各留箭头宽度，避免三角形越过圆角；极窄气泡则回退中央。
    const arrowInset = Math.min(width / 2, TOOLTIP_METRICS.arrow * 2)
    const arrowX = Math.max(
      arrowInset,
      Math.min(content.x + payload.x - bounds.x, width - arrowInset)
    )
    let entry = entries.get(owner.id)
    if (!entry || entry.win.isDestroyed()) {
      const win = new BrowserWindow({
        ...bounds,
        parent: owner,
        frame: false,
        thickFrame: false,
        transparent: true,
        backgroundColor: '#00000000',
        show: false,
        focusable: false,
        skipTaskbar: true,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        roundedCorners: false,
        hasShadow: false,
        webPreferences: { sandbox: true, javascript: false }
      })
      preserveWindowTransparency(win)
      win.setIgnoreMouseEvents(true)
      entry = { win, revision: 0 }
      entries.set(owner.id, entry)
      const current = entry
      const dismiss = (): void => hide(current)
      const dispose = (): void => {
        entries.delete(owner.id)
        owner.removeListener('blur', dismiss)
        owner.removeListener('resize', dismiss)
        owner.removeListener('move', dismiss)
        owner.removeListener('closed', dispose)
        if (!win.isDestroyed()) win.destroy()
      }
      owner.on('blur', dismiss)
      owner.on('resize', dismiss)
      owner.on('move', dismiss)
      owner.once('closed', dispose)
      win.once('closed', dispose)
    }
    entry.win.setBounds(bounds)
    const current = entry
    const revision = ++current.revision
    // 就绪前移开图标或关闭宿主时不再显示，避免迟到的加载回调复活气泡。
    void current.win.webContents
      .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(tooltipHtml(payload, arrowX))}`)
      .then(() => {
        if (!current.win.isDestroyed() && current.revision === revision) {
          current.win.showInactive()
        }
      })
      .catch((error: unknown) => {
        if (!current.win.isDestroyed() && current.revision === revision) {
          hide(current)
          console.warn('[toolbar-tooltip] 工具栏气泡加载失败:', error)
        }
      })
  })

  ipcMain.handle(TOOLBAR_TOOLTIP_CHANNELS.hide, (event) => {
    registry.resolveSenderScope(event.sender)
    const owner = BrowserWindow.fromWebContents(event.sender)
    if (owner?.webContents !== event.sender) return
    const entry = owner ? entries.get(owner.id) : undefined
    if (entry) hide(entry)
  })
}
