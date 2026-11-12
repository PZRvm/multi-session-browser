/**
 * 自研插件宿主 shim 的主进程侧（计划 20261112-自研插件宿主集成 M1/M2）：
 * electron-chrome-extensions 4.10.0 不提供 tabs.captureVisibleTab（产物 grep 0 命中），
 * 自研截图插件的 action 点击链死在 `chrome.tabs.captureVisibleTab is not a function`。
 * 本模块提供受控 IPC：preload 生成链注入的 shim（preload-guard.ts）经
 * 'msb-ext-shim-capture-visible-tab' 请求，主进程以宿主既有截图能力
 * （webContents.capturePage）返回 dataURL。
 *
 * 同因补 downloads.download 实装：库 preload 提供的是 noop 桩（invokeExtension2 noop
 * 标记，主进程 0 实现）。只实现插件用到的两形态：data: URL（截图编辑器导出）与
 * blob: URL（录屏 MP4 产物，offscreen 页 createObjectURL 所得）——blob 由主进程回调
 * 产生它的 offscreen 采集窗自行 fetch 转 dataURL 后写盘（主进程取不到渲染层 blob）。
 * 文件名白名单化后写入系统下载目录，重名自动加序号。
 *
 * M2 录屏线：库缺 tabCapture/offscreen/runtime.getContexts，且 Chromium 的
 * getUserMedia 'tab' 源是 Chrome 专属约束（Electron 只认 desktop 源/getDisplayMedia）。
 * 映射：popup 的 getMediaStreamId → 宿主一次性 token（绑定"popup 宿主窗激活 tab"）；
 * SW 的 offscreen.createDocument → 宿主隐藏采集窗加载扩展 offscreen.html（同 session，
 * session 级 guarded preload 自动生效）；offscreen 页的 getUserMedia(tab) 由 shim 改写为
 * getDisplayMedia，本模块在采集窗 session 挂 setDisplayMediaRequestHandler 按 token 授
 * 被录 tab 的 mainFrame（recording/captureView.ts 同款先例）。tab 音频无 Electron 等价物，
 * audio 请求降级为 false（计划约束：如实降级，不假装）。
 *
 * 双路接线（2026-11-12 修复轮，关键平台事实）：Electron35+ 的扩展 SW invoke 不进
 * ipcMain.handle——必须挂到每个 SW 实例的 ServiceWorkerMain.ipc（库 crx-msg 同款
 * running-status-changed→sw.ipc.handle 模式）；页面/renderer invoke 走 ipcMain。
 * 两路复用同一组 impl；session 为权威会话——ipcMain 路取 event.sender.session，
 * SW 路用接线时绑定的 session。
 *
 * 安全边界：来源识别分两路——扩展页面经 senderFrame URL 直接携带扩展标识（主 frame
 * 限定，不可伪造）；SW 无 senderFrame/WebContents sender，由调用方自报 id（preload 桥
 * 注入 chrome.runtime.id），验证该扩展确已加载进绑定会话才受理。web 页面没有 shim 桥
 * （注入点在库的 chrome-extension:// 守卫内），无法触达本模块通道。
 */
import { app, BrowserWindow, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import type { Session, WebContents } from 'electron'

export const EXT_SHIM_CAPTURE_TAB = 'msb-ext-shim-capture-visible-tab'
export const EXT_SHIM_DOWNLOAD = 'msb-ext-shim-download'
export const EXT_SHIM_TAB_STREAM = 'msb-ext-shim-tab-stream'
export const EXT_SHIM_OFFSCREEN_CREATE = 'msb-ext-shim-offscreen-create'
export const EXT_SHIM_CONTEXTS = 'msb-ext-shim-contexts'

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

let shimDeps: ExtensionShimsDeps | undefined

/**
 * 来源识别（见头注安全边界）：扩展页面走 senderFrame URL；SW 走调用方自报 id +
 * 绑定会话内已加载验证。两类事件（ipcMain / ServiceWorkerMain.ipc）共用，
 * SW 事件无 senderFrame，结构化取用。
 */
function resolveExtensionId(
  event: ShimEvent,
  claimed: unknown,
  session: Session | undefined
): string | null {
  // 两类事件结构不同（SW 事件无 senderFrame），按需结构化取用
  const frame = (event as { senderFrame?: { url?: string | null } | null }).senderFrame
  const mainFrame = (event as { sender?: { mainFrame?: unknown } | null }).sender?.mainFrame
  if (frame && mainFrame !== undefined && frame === mainFrame) {
    const match = /^chrome-extension:\/\/([a-p]{32})\//.exec(frame.url ?? '')
    if (match) return match[1]
  }
  if (
    typeof claimed === 'string' &&
    /^[a-p]{32}$/.test(claimed) &&
    session?.extensions?.getExtension(claimed)
  ) {
    return claimed
  }
  return null
}

/** 各 shim 共享实现：ipcMain（页面/renderer）与 ServiceWorkerMain.ipc（SW）两路复用 */
type ShimEvent = Electron.IpcMainInvokeEvent | Electron.IpcMainServiceWorkerInvokeEvent
type ShimImpl = (event: ShimEvent, payload: unknown, session?: Session) => unknown

const captureImpl: ShimImpl = async (event, raw, session) => {
  try {
    const payload = raw as { windowId?: unknown; extId?: unknown }
    const extId = resolveExtensionId(event, payload?.extId, session)
    if (!extId) return { ok: false, error: 'UNAUTHORIZED' }
    const windowId =
      typeof payload?.windowId === 'number' && Number.isInteger(payload.windowId)
        ? payload.windowId
        : null
    const page = shimDeps?.resolveActivePage(windowId)
    if (!page || page.isDestroyed()) return { ok: false, error: 'NO_ACTIVE_TAB' }
    // capturePage 在合成器未就绪/窗口被遮挡时会抖动（display surface / UnknownVizError），
    // stayHidden+stayAwake 保持页面可采集（窗口隐藏/遮挡场景），轻量重试覆盖首帧窗口期
    let image: Electron.NativeImage | undefined
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        image = await page.capturePage(undefined, { stayHidden: true, stayAwake: true })
        if (!image.isEmpty()) break
      } catch {
        if (attempt === 2) throw new Error('CAPTURE_FAILED')
        await new Promise((r) => setTimeout(r, 150))
      }
    }
    if (!image || image.isEmpty()) return { ok: false, error: 'CAPTURE_FAILED' }
    return { ok: true, dataUrl: image.toDataURL() }
  } catch (error) {
    return { ok: false, error: String((error as Error).message ?? error).slice(0, 160) }
  }
}

const downloadImpl: ShimImpl = async (event, raw, session) => {
  try {
    const payload = raw as { url?: unknown; filename?: unknown; extId?: unknown }
    const extId = resolveExtensionId(event, payload?.extId, session)
    if (!extId) return { ok: false, error: 'UNAUTHORIZED' }
    if (typeof payload?.url !== 'string') return { ok: false, error: 'INVALID_URL' }
    let dataUrl: string
    if (payload.url.startsWith('data:')) {
      if (!/^data:[^;,]+;base64,/.test(payload.url)) return { ok: false, error: 'UNSUPPORTED_URL' }
      dataUrl = payload.url
    } else if (payload.url.startsWith('blob:')) {
      dataUrl = await readBlobAsDataUrl(extId, payload.url)
    } else {
      return { ok: false, error: 'UNSUPPORTED_URL' }
    }
    const target = await writeDownloadFile(dataUrl, payload.filename)
    return { ok: true, id: Date.now(), path: target }
  } catch (error) {
    return { ok: false, error: String((error as Error).message ?? error).slice(0, 160) }
  }
}

// tab-stream：popup 上下文取被录目标的一次性 token。目标 = popup 宿主窗的激活
// 会话网页（openPopup 建窗 parent=宿主窗；库弹的 popup 同样有 parent）
const tabStreamImpl: ShimImpl = async (event, raw, session) => {
  try {
    const payload = raw as { extId?: unknown }
    const extId = resolveExtensionId(event, payload?.extId, session)
    if (!extId) return { ok: false, error: 'UNAUTHORIZED' }
    const popupWin = BrowserWindow.fromWebContents(
      (event as { sender: Electron.WebContents }).sender
    )
    const owner = popupWin?.getParentWindow()
    if (!owner || owner.isDestroyed()) return { ok: false, error: 'NO_OWNER_WINDOW' }
    const page = shimDeps?.resolveActivePage(owner.id)
    if (!page || page.isDestroyed()) return { ok: false, error: 'NO_ACTIVE_TAB' }
    pendingTargets.set(extId, page)
    return { ok: true, streamId: `msb-tab:${randomUUID()}` }
  } catch (error) {
    return { ok: false, error: String((error as Error).message ?? error).slice(0, 160) }
  }
}

// offscreen-create：SW 上下文建宿主隐藏采集窗加载扩展 offscreen.html
const offscreenCreateImpl: ShimImpl = async (event, raw, session) => {
  try {
    const payload = raw as { url?: unknown; extId?: unknown }
    const extId = resolveExtensionId(event, payload?.extId, session)
    if (!extId) return { ok: false, error: 'UNAUTHORIZED' }
    if (offscreenByExtension.has(extId)) return { ok: false, error: 'ALREADY_EXISTS' }
    const rel = typeof payload?.url === 'string' ? payload.url.replace(/^\/+/, '') : ''
    if (!/^([a-zA-Z0-9._-]+\/)*[a-zA-Z0-9._-]+\.html$/.test(rel)) {
      return { ok: false, error: 'INVALID_URL' }
    }
    const target = pendingTargets.get(extId)
    if (!target || target.isDestroyed()) return { ok: false, error: 'NO_PENDING_TARGET' }
    pendingTargets.delete(extId)
    const bound =
      session ?? (event as { sender?: { session?: Session } }).sender?.session ?? undefined
    if (!bound) return { ok: false, error: 'NO_SESSION' }
    const win = new BrowserWindow({
      // 隐藏采集窗：取 blob 的 FileReader 卡死已改为 arrayBuffer+btoa 绕开（不再依赖
      // 可见窗事件投递）；backgroundThrottling:false 保全速，应用级还有禁渲染降级开关
      show: false,
      frame: false,
      skipTaskbar: true,
      focusable: false,
      resizable: false,
      webPreferences: {
        session: bound,
        nodeIntegration: false,
        contextIsolation: true,
        backgroundThrottling: false
      }
    })
    offscreenByExtension.set(extId, { win, target })
    const detach = (): void => {
      if (offscreenByExtension.get(extId)?.win === win) offscreenByExtension.delete(extId)
      // 采集窗关闭即摘授流 handler（session 上可能挂过宿主自录 handler 的场景
      // 由其自己的挂/摘生命周期管理，见 captureView.ts；本 handler 只管自己）
      try {
        bound.setDisplayMediaRequestHandler(null)
      } catch {
        /* 应用退出期 session 已释放 */
      }
    }
    win.once('closed', detach)
    // 授流（captureView.ts 先例）：只认本采集窗顶层 frame 的 getDisplayMedia 请求，
    // 授被录 tab 的 mainFrame；其余请求方一律空回调拒绝
    bound.setDisplayMediaRequestHandler((request, callback) => {
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

// contexts：模拟 OFFSCREEN_DOCUMENT 存在性（宿主采集窗登记态即事实源）。
// 覆盖原生 getContexts：原生签名不收无参调用且不识宿主采集窗，录屏 ensureOffscreen
// 依赖宿主登记态判定是否已建采集窗。
const contextsImpl: ShimImpl = (event, raw, session) => {
  const payload = raw as { extId?: unknown }
  const extId = resolveExtensionId(event, payload?.extId, session)
  if (!extId) return { ok: false, error: 'UNAUTHORIZED' }
  const entry = offscreenByExtension.get(extId)
  const contexts = entry ? [{ contextType: 'OFFSCREEN_DOCUMENT' }] : []
  return { ok: true, contexts }
}

/** blob: URL → dataURL：回调产生它的 offscreen 采集窗自行 fetch（主进程取不到渲染层 blob） */
async function readBlobAsDataUrl(extId: string, url: string): Promise<string> {
  const entry = offscreenByExtension.get(extId)
  if (!entry || entry.win.isDestroyed()) throw new Error('NO_OFFSCREEN')
  if (!url.startsWith(`blob:chrome-extension://${extId}/`)) throw new Error('INVALID_URL')
  const dataUrl = await entry.win.webContents.executeJavaScript(
    `(async () => {
  const resp = await fetch(${JSON.stringify(url)})
  if (!resp.ok) throw new Error('FETCH_FAILED')
  const blob = await resp.blob()
  // FileReader.readAsDataURL 在扩展页 + executeJavaScript 上下文会挂死（onloadstart
  // 后 onload 永不投递，实测多轮）——绕开：arrayBuffer（同上下文实测可用）+ 分块 btoa
  const buf = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < buf.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, buf.subarray(i, Math.min(i + CHUNK, buf.length)))
  }
  const dataUrl = 'data:' + (blob.type || 'application/octet-stream') + ';base64,' + btoa(binary)
  return dataUrl
})()`,
    true
  )
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
    throw new Error('UNSUPPORTED_URL')
  }
  return dataUrl
}

/** dataURL → 系统下载目录文件：文件名白名单化，重名自动加序号 */
async function writeDownloadFile(dataUrl: string, filename: unknown): Promise<string> {
  const safe =
    typeof filename === 'string'
      ? filename.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '')
      : ''
  const base = safe.length > 0 && safe !== '.' && safe !== '..' ? safe : 'extension-download'
  const dir = app.getPath('downloads')
  let target = join(dir, base)
  let seq = 1
  // 重名加序号（存在性探测循环，低频路径可接受）
  while (true) {
    try {
      // 分隔符必须找 ';base64,' 标记而非首个逗号——MIME 的 codecs 参数自带逗号
      //（data:video/mp4;codecs=avc1,mp4a.40.2;base64,...），用逗号会把
      // 'mp4a.40.2;base64,' 混进主体，base64 对齐整体错位、产物全坏（实测根因）
      const marker = ';base64,'
      const b64 = dataUrl.slice(dataUrl.indexOf(marker) + marker.length)
      await writeFile(target, Buffer.from(b64, 'base64'), { flag: 'wx' })
      return target
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const dot = base.lastIndexOf('.')
      const stem = dot > 0 ? base.slice(0, dot) : base
      const ext = dot > 0 ? base.slice(dot) : ''
      target = join(dir, `${stem}-${seq}${ext}`)
      seq += 1
      if (seq > 999) throw new Error('NAME_EXHAUSTED')
    }
  }
}

/** 页面/renderer 路：ipcMain.handle，权威会话取自 event.sender.session */
export function registerExtensionShims(deps: ExtensionShimsDeps): void {
  shimDeps = deps
  ipcMain.handle(EXT_SHIM_CAPTURE_TAB, (event, payload) =>
    captureImpl(event, payload, event.sender?.session)
  )
  ipcMain.handle(EXT_SHIM_DOWNLOAD, (event, payload) =>
    downloadImpl(event, payload, event.sender?.session)
  )
  ipcMain.handle(EXT_SHIM_TAB_STREAM, (event, payload) =>
    tabStreamImpl(event, payload, event.sender?.session)
  )
  ipcMain.handle(EXT_SHIM_OFFSCREEN_CREATE, (event, payload) =>
    offscreenCreateImpl(event, payload, event.sender?.session)
  )
  ipcMain.handle(EXT_SHIM_CONTEXTS, (event, payload) =>
    contextsImpl(event, payload, event.sender?.session)
  )
}

const SW_SHIM_CHANNELS: Array<[string, ShimImpl]> = [
  [EXT_SHIM_CAPTURE_TAB, captureImpl],
  [EXT_SHIM_DOWNLOAD, downloadImpl],
  [EXT_SHIM_TAB_STREAM, tabStreamImpl],
  [EXT_SHIM_OFFSCREEN_CREATE, offscreenCreateImpl],
  [EXT_SHIM_CONTEXTS, contextsImpl]
]

/**
 * SW 路（Electron35+ 扩展 SW invoke 不进 ipcMain——走 ServiceWorkerMain.ipc 逐实例
 * 注册；库 crx-msg 同款模式）：监听 running-status-changed，SW 'starting' 时在该
 * SW 实例的 ipc 上挂同构 handler，session 用接线时绑定的本会话。runtime 挂载时对
 * 每会话调用一次。扩展 ID 直接取自 sw.scope（平台权威）注入 payload——SW 隔离
 * preload 世界里 chrome.runtime.id 不可得，调用方自报不可用。SW 空闲终止后重启
 * 会再发 'starting'（ipc 注册表随实例重置，必须重挂——不做版本去重），重复注册由 catch 兜底。
 */
export function registerSessionShimIpc(session: Session): void {
  try {
    const wire = (sw: Electron.ServiceWorkerMain | undefined): void => {
      if (!sw?.ipc) return
      const scopeId = /^chrome-extension:\/\/([a-p]{32})\//.exec(sw.scope)?.[1]
      if (!scopeId) return
      for (const [channel, impl] of SW_SHIM_CHANNELS) {
        try {
          sw.ipc.handle(channel, (event, payload) => {
            const withId = { ...((payload ?? {}) as object), extId: scopeId }
            return impl(event, withId, session)
          })
        } catch {
          /* 重复注册等异常：SW shim 缺席即可，不阻塞宿主 */
        }
      }
    }
    // 兜底：分区恢复时扩展与 SW 随分区持久化、可能早于本轮接线启动——枚举存活 SW 补挂
    try {
      for (const info of Object.values(session.serviceWorkers.getAllRunning())) {
        wire(session.serviceWorkers.getWorkerFromVersionID(info.versionId))
      }
    } catch {
      /* 枚举不可用（旧 Electron）：仅事件路生效 */
    }
    session.serviceWorkers.on('running-status-changed', (details) => {
      if (details.runningStatus !== 'starting') return
      wire(session.serviceWorkers.getWorkerFromVersionID(details.versionId))
    })
  } catch {
    /* serviceWorkers emitter 不可用（旧 Electron）：SW shim 缺席，页面路不受影响 */
  }
}
