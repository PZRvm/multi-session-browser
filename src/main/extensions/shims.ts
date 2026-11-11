/**
 * 自研插件宿主 shim 的主进程侧（计划 20261112-自研插件宿主集成 M1/M2）：
 * electron-chrome-extensions 4.10.0 不提供 tabs.captureVisibleTab（产物 grep 0 命中），
 * 自研截图插件的 action 点击链死在 `chrome.tabs.captureVisibleTab is not a function`。
 * 本模块提供受控 IPC：preload 生成链注入的 shim（preload-guard.ts）经
 * 'msb-ext-shim:capture-visible-tab' 请求，主进程以宿主既有截图能力
 * （webContents.capturePage）返回 dataURL。
 *
 * 同因补 downloads.download：库 preload 提供的是 noop 桩（invokeExtension2 noop 标记，
 * 主进程 0 实现）——自研编辑器的下载导出会静默无产物。shim 只实现插件用到的
 * data: URL 保存形态：文件名白名单化（basename + 字符集限制，防路径穿越）后写入
 * 系统下载目录，重名自动加序号。
 *
 * M2 录屏线：库缺 tabCapture/offscreen/runtime.getContexts，且 Chromium 的
 * getUserMedia 'tab' 源是 Chrome 专属约束（Electron 只认 desktop 源/getDisplayMedia）。
 * 映射：popup 的 getMediaStreamId → 宿主一次性 token（绑定"popup 宿主窗激活 tab"）；
 * SW 的 offscreen.createDocument → 宿主隐藏采集窗加载扩展 offscreen.html（同 session，
 * session 级 guarded preload 自动生效）；offscreen 页的 getUserMedia(tab) 由 preload
 * shim 改写为 getDisplayMedia，本模块在采集窗 session 挂 setDisplayMediaRequestHandler
 * 按 token 授被录 tab 的 mainFrame（recording/captureView.ts 同款先例）。tab 音频无
 * Electron 等价物，audio 请求降级为 false（计划约束：如实降级，不假装）。
 *
 * 安全边界：sender 必须是扩展上下文（senderFrame URL 以 chrome-extension:// 开头，
 * 且限定主 frame——子 frame 不得触发宿主截图）；windowId 为库语义的 BrowserWindow.id，
 * 经调用方注入的解析函数映射到宿主 scope 后取激活会话网页。
 */
import { app, BrowserWindow, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import type { Session, WebContents } from 'electron'

export const EXT_SHIM_CAPTURE_TAB = 'msb-ext-shim:capture-visible-tab'
export const EXT_SHIM_DOWNLOAD = 'msb-ext-shim:download'
export const EXT_SHIM_TAB_STREAM = 'msb-ext-shim:tab-stream'
export const EXT_SHIM_OFFSCREEN_CREATE = 'msb-ext-shim:offscreen-create'
export const EXT_SHIM_CONTEXTS = 'msb-ext-shim:contexts'

export interface ExtensionShimsDeps {
  /** 库语义 windowId（BrowserWindow.id）→ 该窗口激活会话的网页；无窗口/无激活返回 null */
  resolveActivePage: (windowId: number | null) => WebContents | null
}

/** 采集窗登记：扩展ID → 隐藏窗与授流目标（重复 createDocument 按 Chrome 语义拒绝） */
interface OffscreenEntry {
  win: BrowserWindow
  target: WebContents
}
const offscreenByExtension = new Map<string, OffscreenEntry>()
/** tab-stream 与 offscreen-create 之间的一次性授流目标（同扩展先后两步握手） */
const pendingTargets = new Map<string, WebContents>()

/** senderFrame 校验（扩展上下文 + 主 frame），返回扩展 ID 或 null */
function extensionIdOf(event: Electron.IpcMainInvokeEvent): string | null {
  const url = event.senderFrame?.url ?? ''
  const match = /^chrome-extension:\/\/([a-p]{32})\//.exec(url)
  if (!match || event.senderFrame !== event.sender.mainFrame) return null
  return match[1]
}

export function registerExtensionShims(deps: ExtensionShimsDeps): void {
  ipcMain.handle(
    EXT_SHIM_CAPTURE_TAB,
    async (
      event,
      payload: { windowId?: unknown; format?: unknown }
    ): Promise<{ ok: boolean; dataUrl?: string; error?: string }> => {
      try {
        const url = event.senderFrame?.url ?? ''
        if (
          !url.startsWith('chrome-extension://') ||
          event.senderFrame !== event.sender.mainFrame
        ) {
          return { ok: false, error: 'UNAUTHORIZED' }
        }
        const windowId =
          typeof payload?.windowId === 'number' && Number.isInteger(payload.windowId)
            ? payload.windowId
            : null
        const page = deps.resolveActivePage(windowId)
        if (!page || page.isDestroyed()) return { ok: false, error: 'NO_ACTIVE_TAB' }
        const image = await page.capturePage()
        return { ok: true, dataUrl: image.toDataURL() }
      } catch (error) {
        return { ok: false, error: String((error as Error).message ?? error).slice(0, 160) }
      }
    }
  )

  ipcMain.handle(
    EXT_SHIM_DOWNLOAD,
    async (
      event,
      payload: { url?: unknown; filename?: unknown }
    ): Promise<{ ok: boolean; id?: number; path?: string; error?: string }> => {
      try {
        const url = event.senderFrame?.url ?? ''
        if (
          !url.startsWith('chrome-extension://') ||
          event.senderFrame !== event.sender.mainFrame
        ) {
          return { ok: false, error: 'UNAUTHORIZED' }
        }
        if (typeof payload?.url !== 'string') return { ok: false, error: 'INVALID_URL' }
        const dataMatch = /^data:([^;,]+);base64,(.+)$/.exec(payload.url)
        if (!dataMatch) return { ok: false, error: 'UNSUPPORTED_URL' }
        // 文件名白名单化：只保留安全字符，兜底默认名，永不接受路径分隔
        const safe =
          typeof payload.filename === 'string'
            ? payload.filename.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\. +/, '')
            : ''
        const base = safe.length > 0 && safe !== '.' && safe !== '..' ? safe : 'extension-download'
        const dir = app.getPath('downloads')
        let target = join(dir, base)
        let seq = 1
        // 重名加序号（存在性探测循环，低频路径可接受）

        while (true) {
          try {
            await writeFile(target, Buffer.from(dataMatch[2], 'base64'), { flag: 'wx' })
            break
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
            const dot = base.lastIndexOf('.')
            const stem = dot > 0 ? base.slice(0, dot) : base
            const ext = dot > 0 ? base.slice(dot) : ''
            target = join(dir, `${stem}-${seq}${ext}`)
            seq += 1
            if (seq > 999) return { ok: false, error: 'NAME_EXHAUSTED' }
          }
        }
        return { ok: true, id: Date.now(), path: target }
      } catch (error) {
        return { ok: false, error: String((error as Error).message ?? error).slice(0, 160) }
      }
    }
  )

  // tab-stream：popup 上下文取被录目标的一次性 token。目标 = popup 宿主窗的激活
  // 会话网页（openPopup 建窗 parent=宿主窗；库弹的 popup 同样有 parent）
  ipcMain.handle(
    EXT_SHIM_TAB_STREAM,
    async (event): Promise<{ ok: boolean; streamId?: string; error?: string }> => {
      try {
        const extId = extensionIdOf(event)
        if (!extId) return { ok: false, error: 'UNAUTHORIZED' }
        const popupWin = BrowserWindow.fromWebContents(event.sender)
        const owner = popupWin?.getParentWindow()
        if (!owner || owner.isDestroyed()) return { ok: false, error: 'NO_OWNER_WINDOW' }
        const page = deps.resolveActivePage(owner.id)
        if (!page || page.isDestroyed()) return { ok: false, error: 'NO_ACTIVE_TAB' }
        // token 一次性：登记进 offscreen 建窗时的授流目标（由 createDocument 消费）
        pendingTargets.set(extId, page)
        return { ok: true, streamId: `msb-tab:${randomUUID()}` }
      } catch (error) {
        return { ok: false, error: String((error as Error).message ?? error).slice(0, 160) }
      }
    }
  )

  // offscreen-create：SW 上下文建宿主隐藏采集窗加载扩展 offscreen.html
  ipcMain.handle(
    EXT_SHIM_OFFSCREEN_CREATE,
    async (event, payload: { url?: unknown }): Promise<{ ok: boolean; error?: string }> => {
      try {
        const extId = extensionIdOf(event)
        if (!extId) return { ok: false, error: 'UNAUTHORIZED' }
        if (offscreenByExtension.has(extId)) return { ok: false, error: 'ALREADY_EXISTS' }
        const rel = typeof payload?.url === 'string' ? payload.url.replace(/^\/+/, '') : ''
        if (!/^([a-zA-Z0-9._-]+\/)*[a-zA-Z0-9._-]+\.html$/.test(rel)) {
          return { ok: false, error: 'INVALID_URL' }
        }
        const target = pendingTargets.get(extId)
        if (!target || target.isDestroyed()) return { ok: false, error: 'NO_PENDING_TARGET' }
        pendingTargets.delete(extId)
        const session = event.sender.session as Session
        const win = new BrowserWindow({
          show: false,
          frame: false,
          skipTaskbar: true,
          focusable: false,
          resizable: false,
          webPreferences: {
            session,
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false
          }
        })
        offscreenByExtension.set(extId, { win, target })
        const detach = (): void => {
          if (offscreenByExtension.get(extId)?.win === win) offscreenByExtension.delete(extId)
          // 采集窗关闭即摘授流 handler（session 上可能挂过宿主自录 handler 的场景
          // 由其自己的挂/摘生命周期管理，见 captureView.ts；本 handler 只管自己）
          try {
            session.setDisplayMediaRequestHandler(null)
          } catch {
            /* 应用退出期 session 已释放 */
          }
        }
        win.once('closed', detach)
        // 授流（captureView.ts 先例）：只认本采集窗顶层 frame 的 getDisplayMedia 请求，
        // 授被录 tab 的 mainFrame；其余请求方一律空回调拒绝
        session.setDisplayMediaRequestHandler((request, callback) => {
          const fromSelf =
            request.frame !== null &&
            request.frame === request.frame.top &&
            request.frame.url.startsWith(`chrome-extension://${extId}/`)
          if (fromSelf && !target.isDestroyed()) {
            callback({ video: target.mainFrame ?? undefined })
          } else {
            callback({})
          }
        })
        await win.loadURL(`chrome-extension://${extId}/${rel}`)
        return { ok: true }
      } catch (error) {
        return { ok: false, error: String((error as Error).message ?? error).slice(0, 160) }
      }
    }
  )

  // contexts：模拟 OFFSCREEN_DOCUMENT 存在性（宿主采集窗登记态即事实源）
  ipcMain.handle(
    EXT_SHIM_CONTEXTS,
    (event): { ok: boolean; contexts?: Array<{ contextType: string }>; error?: string } => {
      const extId = extensionIdOf(event)
      if (!extId) return { ok: false, error: 'UNAUTHORIZED' }
      const entry = offscreenByExtension.get(extId)
      const contexts = entry ? [{ contextType: 'OFFSCREEN_DOCUMENT' }] : []
      return { ok: true, contexts }
    }
  )
}
