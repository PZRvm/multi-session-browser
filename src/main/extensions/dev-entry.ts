/**
 * 插件宿主 dev 装配入口（A6）：
 * 提供默认路径与一次性挂载，供生产 index.ts 守卫装配与 host-smoke harness 共用。
 * M3/E 正式接线时扩展为多会话生命周期管理，不改变 runtime/install 模块边界。
 */
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { app, clipboard, nativeImage, type Session, type WebContents } from 'electron'
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

/** 幂等创建运行时（进程内单例；engineOptions 由调用方传入 tab 表面回调） */
export function getExtensionsHandle(engineOptions?: EngineOptions): ExtensionsHandle {
  if (!handle) {
    const paths = extensionsPaths()
    handle = {
      runtime: createExtensionRuntime({
        manifest: createManifestStore(paths.manifestFile),
        packagesRoot: paths.packagesRoot,
        engineOptions
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
    'image.copy': (request) => {
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
      clipboard.writeImage(image)
      return { copied: !clipboard.readImage().isEmpty() }
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
export function attachShellTab(handle: ExtensionsHandle, partition: string, shell: Electron.WebContents): void {
  const engine = handle.runtime.getEngine(partition)
  if (!engine) return
  ;(engine as unknown as { addTab: (wc: Electron.WebContents, win: unknown) => void }).addTab(shell, shellWindow)
  ;(engine as unknown as { selectTab: (wc: Electron.WebContents) => void }).selectTab(shell)
}


/** 把会话网页 tab 注册进引擎（addTab 幂等 + 激活标记）：内容脚本注入与 popup tab
 *  语义的前置。manager.attachView 单点调用；未挂载分区 no-op。 */
export function notifyEngineTab(
  partition: string,
  wc: Electron.WebContents,
  win: Electron.BrowserWindow | undefined
): void {
  const engine = getExtensionsHandle().runtime.getEngine(partition)
  if (!engine) return
  ;(engine as unknown as { addTab: (wc: Electron.WebContents, win: unknown) => void }).addTab(wc, win)
  ;(engine as unknown as { selectTab: (wc: Electron.WebContents) => void }).selectTab(wc)
}

/** 导航后失效引擎的 tabDetails 缓存（lib 缓存首建后永不更新，导航新 URL 必须失效
 *  重建——Cookie-Editor/Dark Reader 的 tabs.query URL 正确性依赖此点） */
export function invalidateEngineTabUrl(partition: string, wc: Electron.WebContents): void {
  const engine = getExtensionsHandle().runtime.getEngine(partition)
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
 *  MV2 popup 初始化是否健康，结果走 stdout 供自动判定。 */
export async function runDarkPopupSelfTest(darkUnpackedDir: string): Promise<void> {
  const { session: electronSession } = await import('electron')
  const ses = electronSession.fromPartition('persist:selftest-dark')
  const handle = getExtensionsHandle()
  await handle.runtime.mountPartition('persist:selftest-dark', ses)
  const native = await ses.loadExtension(darkUnpackedDir)
  const manifest = native.manifest as {
    browser_action?: { default_popup?: string }
    action?: { default_popup?: string }
  }
  const popup = manifest.browser_action?.default_popup || manifest.action?.default_popup
  if (!popup) {
    console.log('SELFTEST_RESULT ' + JSON.stringify({ ok: false, reason: 'NO_POPUP' }))
    return
  }
  const { BrowserWindow: BW } = await import('electron')
  const win = new BW({
    show: false,
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
    .executeJavaScript('(document.body.innerText || "").slice(0, 40)', true)
    .catch(() => 'EXEC')
  const controls = await win.webContents
    .executeJavaScript('String(document.querySelectorAll("input,button,select").length)', true)
    .catch(() => -1)
  const ok = !/Loading/i.test(String(text)) && Number(controls) > 2
  console.log('SELFTEST_RESULT ' + JSON.stringify({ ok, text: String(text).slice(0, 30), controls }))
  win.destroy()
}
