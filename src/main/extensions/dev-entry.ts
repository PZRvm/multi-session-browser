/**
 * 插件宿主 dev 装配入口（A6）：
 * 提供默认路径与一次性挂载，供生产 index.ts 守卫装配与 host-smoke harness 共用。
 * M3/E 正式接线时扩展为多会话生命周期管理，不改变 runtime/install 模块边界。
 */
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import {
  app,
  BrowserWindow,
  clipboard,
  ClipboardItem,
  nativeImage,
  type Session,
  type WebContents
} from 'electron'
import { createManifestStore } from './install/manifest-store'
import {
  STAGED_IMAGE,
  type BridgeOperation,
  type BridgeRequest
} from '../../shared/extensions/protocol'
import {
  createExtensionRuntime,
  type EngineOptions,
  type ExtensionRuntime,
  type MountResult
} from './runtime'

export interface ExtensionsPaths {
  root: string
  manifestFile: string
  packagesRoot: string
}

export function extensionsPaths(): ExtensionsPaths {
  const root = join(app.getPath('userData'), 'extensions')
  return {
    root,
    manifestFile: join(root, 'installed.json'),
    packagesRoot: join(root, 'packages')
  }
}

export interface ExtensionsHandle {
  runtime: ExtensionRuntime
  paths: ExtensionsPaths
  /** 已挂载分区 → 会话（安装后重挂载与卸载移除用） */
  mounted: Map<string, Session>
}

let handle: ExtensionsHandle | undefined

/** 库 windows.create 需宿主 impl.createWindow（缺省抛 "createWindow is not implemented"）。
 *  自研截图插件编辑器窗经 SW 内 chrome.windows.create 走此链。宿主默认实现：按扩展 ID
 *  反查挂载会话，建 BrowserWindow 加载 chrome-extension:// URL（会话级 guarded preload
 *  自动生效，编辑器页拿到 shim 完备的 chrome）。返回 window 供引擎纳入 window 表面。 */
function createExtensionWindow(details: unknown): Promise<Electron.BrowserWindow> {
  const d = details as { url?: unknown; width?: unknown; height?: unknown; type?: unknown }
  const url = typeof d?.url === 'string' ? d.url : ''
  const extId = /^chrome-extension:\/\/([a-p]{32})\//.exec(url)?.[1]
  if (!extId) return Promise.reject(new Error('INVALID_EXTENSION_URL'))
  const h = handle
  let session: Session | undefined
  if (h) {
    for (const s of h.mounted.values()) {
      if (s.extensions.getExtension(extId)) {
        session = s
        break
      }
    }
  }
  if (!session) return Promise.reject(new Error('EXTENSION_NOT_MOUNTED'))
  const width = typeof d.width === 'number' ? Math.min(Math.max(d.width, 200), 2000) : 800
  const height = typeof d.height === 'number' ? Math.min(Math.max(d.height, 150), 1600) : 600
  const win = new BrowserWindow({
    width,
    height,
    show: false,
    webPreferences: {
      session,
      nodeIntegration: false,
      contextIsolation: true
    }
  })
  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.show()
  })
  void win.loadURL(url)
  return Promise.resolve(win)
}

/** 幂等创建运行时（进程内单例；engineOptions 由调用方传入 tab 表面回调） */
export function getExtensionsHandle(engineOptions?: EngineOptions): ExtensionsHandle {
  if (!handle) {
    const paths = extensionsPaths()
    handle = {
      runtime: createExtensionRuntime({
        manifest: createManifestStore(paths.manifestFile),
        packagesRoot: paths.packagesRoot,
        engineOptions: {
          createWindow: createExtensionWindow,
          ...engineOptions
        }
      }),
      paths,
      mounted: new Map()
    }
  }
  return handle
}

/** 守卫装配语义：挂载失败不抛出（返回错误结果），不阻塞宿主启动 */
export async function mountDevExtensions(
  session: Session,
  partition: string
): Promise<MountResult | { partition: string; error: string }> {
  const h = getExtensionsHandle()
  try {
    const result = await h.runtime.mountPartition(partition, session)
    h.mounted.set(partition, session)
    return result
  } catch (error) {
    return { partition, error: String(error).slice(0, 200) }
  }
}

export { extractCrx } from './install/crx'
export { createManifestStore } from './install/manifest-store'
export { createInstallService } from './install/service'
export { extensionId } from './install/crx'
export { createStoreInstall } from './install/store'
export { registerBridgeTarget } from './bridge'

/** 采集操作集（handshake/capture/image.copy），harness 与生产接线共用 */
export function createCaptureOperations(
  getWc: () => WebContents | undefined
): Record<string, BridgeOperation> {
  let version = 0
  let snapshot: { id: string; version: number; image: Electron.NativeImage } | undefined
  return {
    handshake: () => ({
      protocol: 1,
      capabilities: { capture: true, imageCopy: true, tabAudio: false, subscription: false },
      limits: {
        requestBytes: 4096,
        entries: 128,
        imageBytes: 32 * 1024 * 1024,
        imageInFlightBytes: 64 * 1024 * 1024
      },
      scope: 'msb production bridge'
    }),
    capture: async () => {
      const wc = getWc()
      if (!wc || wc.isDestroyed())
        throw Object.assign(new Error('TARGET_GONE'), { code: 'TARGET_GONE' })
      const image = await wc.capturePage()
      if (image.isEmpty()) throw Object.assign(new Error('TARGET_GONE'), { code: 'TARGET_GONE' })
      version += 1
      snapshot = { id: 'msb-snapshot', version, image }
      const bytes = image.toPNG()
      return {
        snapshot: { id: snapshot.id, version },
        width: image.getSize().width,
        height: image.getSize().height,
        mimeType: 'image/png',
        sha256: createHash('sha256').update(bytes).digest('hex'),
        png: bytes.buffer.slice(bytes.byteOffset, bytes.byteLength)
      }
    },
    'image.copy': async (request) => {
      const r = request as BridgeRequest
      if (
        !snapshot ||
        !r.snapshot ||
        r.snapshot.id !== snapshot.id ||
        r.snapshot.version !== snapshot.version
      ) {
        throw Object.assign(new Error('SNAPSHOT_STALE'), { code: 'SNAPSHOT_STALE' })
      }
      const staged = (request as unknown as Record<symbol, Buffer | undefined>)[STAGED_IMAGE]
      const image = staged ? nativeImage.createFromBuffer(staged) : snapshot.image
      if (image.isEmpty())
        throw Object.assign(new Error('INVALID_REQUEST'), { code: 'INVALID_REQUEST' })
      await clipboard.write([
        new ClipboardItem({
          'image/png': new Blob([new Uint8Array(image.toPNG())], { type: 'image/png' })
        })
      ])
      return { copied: await clipboard.has('image/png') }
    }
  }
}

let shellWindow: Electron.BrowserWindow | undefined

/** 记录壳窗引用（index.ts 装配时注入），供 attachShellTab 定位 parent 窗口 */
export function setShellWindow(win: Electron.BrowserWindow): void {
  shellWindow = win
}

/** 引擎注册应用壳页为活动 tab（addTab 幂等）：扩展 popup 锚定/打开的前置。语义 TODO：当前
 * 活跃被插件网页变化未同步进引擎（E 线 registry 事件接线），popup 仅锚定主窗不读网页。 */
export function attachShellTab(
  handle: ExtensionsHandle,
  partition: string,
  shell: Electron.WebContents
): void {
  const engine = handle.runtime.getEngine(partition)
  if (!engine) return
  ;(engine as unknown as { addTab: (wc: Electron.WebContents, win: unknown) => void }).addTab(
    shell,
    shellWindow
  )
  ;(engine as unknown as { selectTab: (wc: Electron.WebContents) => void }).selectTab(shell)
}

/** 把会话网页 tab 注册进引擎（addTab 幂等 + 激活标记）：内容脚本注入与 popup tab
 *  语义的前置。manager.attachView 单点调用；未挂载分区 no-op。 */
export function notifyEngineTab(
  partition: string,
  wc: Electron.WebContents,
  win: Electron.BrowserWindow | undefined
): void {
  const engine = handle?.runtime.getEngine(partition)
  if (!engine) return
  ;(engine as unknown as { addTab: (wc: Electron.WebContents, win: unknown) => void }).addTab(
    wc,
    win
  )
  ;(engine as unknown as { selectTab: (wc: Electron.WebContents) => void }).selectTab(wc)
}

/** 导航后失效引擎的 tabDetails 缓存（lib 缓存首建后永不更新，导航新 URL 必须失效
 *  重建——Cookie-Editor/Dark Reader 的 tabs.query URL 正确性依赖此点） */
export function invalidateEngineTabUrl(partition: string, wc: Electron.WebContents): void {
  const engine = handle?.runtime.getEngine(partition)
  if (!engine) return
  const store = (
    engine as unknown as {
      ctx?: { store?: { tabDetailsCache?: Map<number, unknown> } }
    }
  ).ctx?.store
  store?.tabDetailsCache?.delete(wc.id)
}

/** 生产进程自检（MSB_EXTENSIONS_SELFTEST=1 门控）：加载 dark 解包目录 → 生产同构
 *  popup 窗口 → 探渲染（脱离 Loading 且控件>2）。用于在生产 index.ts 进程内判定
 *  popup 初始化是否健康，结果走 stdout 供自动判定。 */
export async function runDarkPopupSelfTest(darkUnpackedDir: string): Promise<void> {
  const { session: electronSession, BrowserWindow: BW } = await import('electron')
  const ses = electronSession.fromPartition('persist:selftest-dark')
  const handle = getExtensionsHandle()

  // 前置环境合流要素①：起一个本地 http 站点并挂一个活动 tab（前置 popup 打开时
  // 总有 localhost http 活动页；无 tab 环境下 Dark Reader popup 等 active tab 会卡）
  const { createServer } = await import('node:http')
  const site = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end('<!doctype html><html><body><h1>selftest-site</h1></body></html>')
  })
  await new Promise<void>((r) => site.listen(0, '127.0.0.1', r))
  const siteUrl = 'http://127.0.0.1:' + (site.address() as { port: number }).port + '/'
  const siteWin = new BW({
    show: false,
    webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false }
  })
  await handle.runtime.mountPartition('persist:selftest-dark', ses)
  notifyEngineTab('persist:selftest-dark', siteWin.webContents, siteWin)
  await siteWin.loadURL(siteUrl)
  invalidateEngineTabUrl('persist:selftest-dark', siteWin.webContents)
  console.log('SELFTEST_SITE ' + siteUrl)
  const native = await ses.extensions.loadExtension(darkUnpackedDir)
  const manifest = native.manifest as {
    browser_action?: { default_popup?: string }
    action?: { default_popup?: string }
  }
  const popup = manifest.browser_action?.default_popup || manifest.action?.default_popup
  if (!popup) {
    console.log('SELFTEST_RESULT ' + JSON.stringify({ ok: false, reason: 'NO_POPUP' }))
    return
  }
  const win = new BW({
    show: true,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    backgroundColor: '#ffffff',
    roundedCorners: false,
    webPreferences: {
      session: ses,
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
      enablePreferredSizeMode: true
    }
  })
  await win
    .loadURL('chrome-extension://' + native.id + '/' + String(popup).replace(/^\//, ''))
    .catch(() => undefined)
  await new Promise((r) => setTimeout(r, 5000))
  const text = await win.webContents
    .executeJavaScript(
      `(() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      const visible = []
      while (walker.nextNode()) {
        const el = walker.currentNode.parentElement
        const style = getComputedStyle(el)
        if (el.getClientRects().length && style.display !== 'none' && style.visibility !== 'hidden' &&
            style.opacity !== '0' && !/rgba\\([^)]*, 0\\)/.test(style.color)) visible.push(walker.currentNode.textContent)
      }
      return visible.join(' ').trim().slice(0, 40)
    })()`,
      true
    )
    .catch(() => 'EXEC')
  const controls = await win.webContents
    .executeJavaScript('String(document.querySelectorAll("input,button,select").length)', true)
    .catch(() => -1)
  const ok = !/Loading/i.test(String(text)) && Number(controls) > 2
  console.log(
    'SELFTEST_RESULT ' + JSON.stringify({ ok, text: String(text).slice(0, 30), controls })
  )
  win.destroy()
  siteWin.destroy()
  site.close()
}
