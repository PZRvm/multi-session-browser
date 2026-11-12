/**
 * 插件管理 IPC（用户入口层）：
 * list/install-store/import-crx/uninstall 四通道；商店安装经允许列表('*'=开放)
 * 与原生确认框；安装后对全部已挂载分区重挂载（loader 幂等去重，新插件即装即用）。
 * 确认框父窗取焦点窗口回退主窗。模块单例注册。
 */
import { BrowserWindow, dialog, ipcMain, screen, type Session, type WebContents } from 'electron'
import { readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createManifestStore, type InstallRecord } from './install/manifest-store'
import { createInstallService } from './install/service'
import { createStoreInstall } from './install/store'
import { extensionsPaths, getExtensionsHandle, mountDevExtensions } from './dev-entry'
import {
  EXTENSIONS_CHANNELS,
  type ExtensionListItem,
  type InstallResult,
  type UninstallResult
} from '../../shared/extensions/management'

export interface ManagementDeps {
  getMainWindow: () => BrowserWindow | null
  /** 插件运行时权限请求（Cookie-Editor 等对站点 host 权限的授予确认） */
  approveRuntimePermissions: (
    extension: { id: string; name?: string },
    permissions: { origins?: string[]; permissions?: string[] }
  ) => Promise<boolean>
  /** 打开设置窗并定位版面（工具栏面板「管理插件」入口） */
  openSettings?: (pane?: string) => void
  /** 从受信壳窗口解析当前网页，禁止用全局首个挂载分区代替活动会话。 */
  getPopupTarget: (
    sender: WebContents
  ) => { win: BrowserWindow; wc: WebContents; partition: string } | null
  onPopupTargetChanged: (callback: () => void) => () => void
}

interface InstallOutcome extends InstallResult {
  record?: InstallRecord
}

let registered = false
const readManifestFileSync = (dir: string): string =>
  readFileSync(join(dir, 'manifest.json'), 'utf8')

export function registerExtensionsManagement(deps: ManagementDeps): void {
  if (registered) return
  registered = true
  const approve = async (
    extension: { id: string; name?: string },
    permissions: { origins?: string[]; permissions?: string[] }
  ): Promise<boolean> => {
    const parent = BrowserWindow.getFocusedWindow() ?? deps.getMainWindow()
    const detail = [
      permissions.origins?.length ? '网站权限：' + permissions.origins.join('、') : '',
      permissions.permissions?.length ? 'API 权限：' + permissions.permissions.join('、') : ''
    ]
      .filter(Boolean)
      .join('\n')
    const r = await (parent
      ? dialog.showMessageBox(parent, {
          type: 'question',
          title: '插件权限请求',
          message: `允许「${extension.name ?? extension.id}」使用以下权限？`,
          detail: detail || '（无详细权限说明）',
          buttons: ['拒绝', '允许'],
          defaultId: 0,
          cancelId: 0
        })
      : dialog.showMessageBox({
          type: 'question',
          title: '插件权限请求',
          message: `允许「${extension.name ?? extension.id}」使用以下权限？`,
          detail: detail || '（无详细权限说明）',
          buttons: ['拒绝', '允许'],
          defaultId: 0,
          cancelId: 0
        }))
    return r.response === 1
  }
  const paths = extensionsPaths()
  const manifest = createManifestStore(paths.manifestFile)
  const handle = getExtensionsHandle({
    requestPermissions: async (extension, permissions) => approve(extension, permissions)
  })
  const mountedSessions = (): Array<{ session: Session; partition: string }> => {
    const out: Array<{ session: Session; partition: string }> = []
    for (const [partition, session] of handle.mounted) out.push({ partition, session })
    return out
  }
  /** 安装后重挂载全部已挂载分区：loader 幂等去重，只补新插件 */
  const remountAll = async (): Promise<void> => {
    for (const { session, partition } of mountedSessions()) {
      await mountDevExtensions(session, partition)
    }
  }
  const confirmInstall = async (details: {
    id: string
    name: string
    version: string
  }): Promise<boolean> => {
    const parent = BrowserWindow.getFocusedWindow() ?? deps.getMainWindow()
    const r = await (parent
      ? dialog.showMessageBox(parent, {
          type: 'question',
          title: '安装插件',
          message: `安装插件 ${details.name}`,
          detail: `ID: ${details.id}${details.version !== 'store' ? ` · 版本 ${details.version}` : ''}\n安装后对全部会话生效。`,
          buttons: ['取消', '安装'],
          defaultId: 0,
          cancelId: 0
        })
      : dialog.showMessageBox({
          type: 'question',
          title: '安装插件',
          message: `安装插件 ${details.name}`,
          detail: `ID: ${details.id}${details.version !== 'store' ? ` · 版本 ${details.version}` : ''}\n安装后对全部会话生效。`,
          buttons: ['取消', '安装'],
          defaultId: 0,
          cancelId: 0
        }))
    return r.response === 1
  }
  const install = createInstallService({
    manifest,
    packagesRoot: paths.packagesRoot,
    onRemove: async (id) => {
      for (const { partition, session } of mountedSessions()) {
        try {
          // 分区副本加载 ID 与安装 ID 不同，按分区重映射后移除
          const loadedId = await handle.runtime.resolveLoadedId(partition, id)
          if (loadedId && session.extensions.getExtension(loadedId)) {
            await session.extensions.removeExtension(loadedId)
          }
        } catch {
          /* 未挂载该插件的分区幂等跳过 */
        }
      }
    }
  })
  const store = createStoreInstall({
    manifest,
    packagesRoot: paths.packagesRoot,
    downloadDir: join(paths.root, 'store-download'),
    allowlist: ['*'],
    confirmInstall
  })
  /** 读解包 manifest 的 popup 页面路径（MV3 action / MV2 browser_action） */
  const readPopupPath = (extensionId: string): string | undefined => {
    const record = manifestCache.get(extensionId)
    if (!record) return undefined
    let manifest: {
      action?: { default_popup?: string }
      browser_action?: { default_popup?: string }
    }
    try {
      const dir = join(paths.packagesRoot, `${record.id}-${record.version}`)
      manifest = JSON.parse(readManifestFileSync(dir))
    } catch {
      return undefined
    }
    const path = manifest.action?.default_popup ?? manifest.browser_action?.default_popup
    return typeof path === 'string' && path.length > 0 ? path : undefined
  }
  const manifestCache = new Map<string, InstallRecord>()
  // 清单缓存随每次 list/install 刷新（open-popup 查版本目录用）
  const refreshManifestCache = async (): Promise<void> => {
    const m = await manifest.read()
    manifestCache.clear()
    for (const r of m.installs) manifestCache.set(r.id, r)
  }

  /** 读解包目录 manifest：icons 最大 ≤48 → PNG dataURL；action/browser_action → 可弹窗 */
  const readManifestExtra = async (
    record: InstallRecord
  ): Promise<{ icon?: string; hasAction: boolean; displayName?: string }> => {
    const dir = join(paths.packagesRoot, `${record.id}-${record.version}`)
    try {
      const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as {
        name?: unknown
        icons?: Record<string, string>
        action?: { default_icon?: Record<string, string> | string }
        browser_action?: { default_icon?: Record<string, string> | string }
      }
      const pickIcon = (icons?: Record<string, string>): string | undefined => {
        if (!icons) return undefined
        const best = Object.entries(icons)
          .map(([size, path]) => ({ size: Number(size) || 0, path }))
          .filter((v) => v.size <= 48 && v.path.length > 0 && !v.path.includes('..'))
          .sort((a, b) => b.size - a.size)[0]
        return best?.path
      }
      const rel =
        pickIcon(manifest.action?.default_icon as Record<string, string> | undefined) ??
        pickIcon(manifest.browser_action?.default_icon as Record<string, string> | undefined) ??
        pickIcon(manifest.icons)
      let icon: string | undefined
      if (rel) {
        try {
          const bytes = await readFile(join(dir, rel))
          icon = `data:image/png;base64,${bytes.toString('base64')}`
        } catch {
          icon = undefined
        }
      }
      const displayName =
        typeof manifest.name === 'string' && manifest.name.length > 0 ? manifest.name : undefined
      return { icon, hasAction: !!(manifest.action || manifest.browser_action), displayName }
    } catch {
      return { hasAction: false }
    }
  }
  ipcMain.handle(EXTENSIONS_CHANNELS.list, async (): Promise<ExtensionListItem[]> => {
    await refreshManifestCache()
    const m = await manifest.read()
    return Promise.all(
      m.installs.map(async (r) => {
        const extra = await readManifestExtra(r)
        // 名称自愈：早期安装的记录无 name 字段（后加），从解包 manifest 回填清单
        if (!r.name && extra.displayName) {
          await manifest
            .update((cur) => ({
              ...cur,
              installs: cur.installs.map((v) =>
                v.id === r.id ? { ...v, name: extra.displayName } : v
              )
            }))
            .catch(() => undefined)
        }
        const displayName = r.name ?? extra.displayName ?? r.id
        return {
          id: r.id,
          name: displayName,
          version: r.version,
          source: r.source.kind,
          icon: extra.icon,
          hasAction: extra.hasAction,
          loadedPartitions: r.partitions.filter((p) => p.ok).length,
          totalPartitions: r.partitions.length
        }
      })
    )
  })
  /** 插件 action popup 窗口（自研，参数与定位算法照 electron-chrome-extensions
   *  PopupView 同源：无边框子窗 + preferred-size 自适应 + blur 关闭 + 父窗锚定） */
  const activePopup = { win: null as BrowserWindow | null, id: '' }
  const closeActivePopup = (destroy = true): void => {
    const w = activePopup.win
    activePopup.win = null
    activePopup.id = ''
    if (w && !w.isDestroyed()) destroy ? w.destroy() : w.close()
  }
  const openExtensionPopup = async (
    sender: WebContents,
    extensionId: string,
    anchor: { x: number; y: number }
  ): Promise<{ ok: boolean; error?: string }> => {
    const target = deps.getPopupTarget(sender)
    if (!target || target.wc.isDestroyed()) return { ok: false, error: 'NO_ACTIVE_TAB' }
    const { win: mainWin, wc, partition } = target
    const engine = handle.runtime.getEngine(partition)
    // 面板传安装 ID；实际加载 ID 是分区副本路径派生 ID（多分区隔离），先重映射
    const loadedId = await handle.runtime.resolveLoadedId(partition, extensionId)
    if (!engine || !loadedId || !wc.session.extensions.getExtension(loadedId))
      return { ok: false, error: 'EXTENSION_NOT_LOADED' }
    engine.addTab(wc, mainWin)
    engine.selectTab(wc)
    // 同插件重复点击 = 关闭（Chrome 切换语义）
    if (
      activePopup.win &&
      !activePopup.win.isDestroyed() &&
      activePopup.id === extensionId &&
      activePopup.win.getParentWindow() === mainWin
    ) {
      closeActivePopup()
      return { ok: true }
    }
    closeActivePopup()
    const popupPath = readPopupPath(extensionId)
    if (!popupPath) {
      // popup-less 插件（自研截图）：派发 chrome.action.onClicked（引擎
      // activateBrowserAction 无 popup 分支同构——tabDetails 供 SW 组装截图目标）。
      // tabDetailsCache 被导航失效删除后 getTabDetails 会按当前 URL 重建。
      const ctx = (
        engine as unknown as {
          ctx?: {
            store?: { getTabDetails?: (wc: Electron.WebContents) => unknown }
            router?: { sendEvent: (id: string, event: string, ...args: unknown[]) => void }
          }
        }
      ).ctx
      const details = ctx?.store?.getTabDetails?.(wc) ?? { id: wc.id, windowId: mainWin.id }
      if (!ctx?.router) return { ok: false, error: 'NO_ACTION_DISPATCH' }
      ctx.router.sendEvent(loadedId, 'browserAction.onClicked', details)
      return { ok: true }
    }
    const session = wc.session
    const url = `chrome-extension://${loadedId}/${popupPath.replace(/^\//, '')}`
    const win = new BrowserWindow({
      show: false,
      frame: false,
      parent: mainWin,
      movable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      resizable: false,
      skipTaskbar: true,
      backgroundColor: '#ffffff',
      roundedCorners: false,
      webPreferences: {
        session,
        sandbox: true,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        contextIsolation: true,
        enablePreferredSizeMode: true
      }
    })
    activePopup.win = win
    activePopup.id = extensionId
    const closeThisPopup = (): void => {
      if (activePopup.win === win) closeActivePopup()
    }
    const MIN = { w: 25, h: 25 }
    const MAX = { w: 800, h: 600 }
    const PADDING = 5
    const positionAt = (): void => {
      if (win.isDestroyed() || mainWin.isDestroyed()) return
      const winBounds = mainWin.getBounds()
      const viewBounds = win.getBounds()
      let x = winBounds.x + anchor.x + 30 - viewBounds.width
      let y = winBounds.y + anchor.y + 34 + PADDING
      // 屏幕工作区钳制：popup 永不越过屏幕右缘/下缘（内容自适应前先按 MAX 预留，
      // 自适应缩小后再次钳制，保证短内容弹出也不出屏）
      const workArea = screen.getDisplayMatching(mainWin.getBounds()).workArea
      const width = viewBounds.width
      x = Math.floor(Math.max(workArea.x + 4, Math.min(x, workArea.x + workArea.width - width - 4)))
      y = Math.floor(
        Math.max(workArea.y + 4, Math.min(y, workArea.y + workArea.height - viewBounds.height - 4))
      )
      const b = win.getBounds()
      win.setBounds({ ...b, x, y })
    }
    const applySize = (width: number, height: number): void => {
      if (win.isDestroyed()) return
      const w = Math.floor(Math.min(MAX.w, Math.max(width || 0, MIN.w)))
      const h = Math.floor(Math.min(MAX.h, Math.max(height || 0, MIN.h)))
      const b = win.getBounds()
      win.setBounds({ ...b, width: w, height: h })
    }
    win.webContents.on('preferred-size-changed', (_e, size) => {
      applySize(size.width, size.height)
      positionAt()
      if (!win.isVisible()) win.show()
    })
    win.on('blur', () => {
      // 与库PopupView一致：应用外的焦点切换、DevTools不销毁正在初始化的popup。
      if (win.webContents.isDevToolsOpened()) return
      if (!BrowserWindow.getAllWindows().some((window) => window.isFocused())) return
      closeThisPopup()
    })
    const unsubscribe = deps.onPopupTargetChanged(() => {
      try {
        const current = deps.getPopupTarget(sender)
        if (!current || current.wc !== wc || wc.isDestroyed()) closeThisPopup()
      } catch {
        closeThisPopup()
      }
    })
    const closeOnParent = (): void => closeThisPopup()
    mainWin.once('closed', closeOnParent)
    win.on('closed', () => {
      unsubscribe()
      mainWin.removeListener('closed', closeOnParent)
      if (activePopup.win === win) {
        activePopup.win = null
        activePopup.id = ''
      }
    })
    void win.loadURL(url).catch(() => closeThisPopup())
    return { ok: true }
  }
  ipcMain.handle(
    EXTENSIONS_CHANNELS.openPopup,
    async (
      event,
      payload: { id?: unknown; anchor?: { x: number; y: number } }
    ): Promise<{ ok: boolean; error?: string }> => {
      try {
        if (event.senderFrame !== event.sender.mainFrame)
          return { ok: false, error: 'UNAUTHORIZED' }
        if (typeof payload?.id !== 'string' || !/^[a-p]{32}$/.test(payload.id))
          return { ok: false, error: 'INVALID_ID' }
        const anchor = payload.anchor ?? { x: 0, y: 0 }
        if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.y))
          return { ok: false, error: 'INVALID_ANCHOR' }
        return await openExtensionPopup(event.sender, payload.id, anchor)
      } catch (error) {
        return { ok: false, error: String((error as Error).message ?? error).slice(0, 160) }
      }
    }
  )
  ipcMain.handle(
    EXTENSIONS_CHANNELS.installStore,
    async (_e, id: unknown): Promise<InstallOutcome> => {
      try {
        if (typeof id !== 'string' || !/^[a-p]{32}$/.test(id)) {
          return { ok: false, error: 'INVALID_ID' }
        }
        const outcome = await store.installFromStore(id)
        await remountAll()
        return { ok: true, record: await manifest.get(outcome.id), duplicate: outcome.duplicate }
      } catch (error) {
        return { ok: false, error: String((error as Error).message ?? error).slice(0, 160) }
      }
    }
  )
  ipcMain.handle(EXTENSIONS_CHANNELS.importCrx, async (): Promise<InstallOutcome> => {
    try {
      const parent = BrowserWindow.getFocusedWindow() ?? deps.getMainWindow()
      const picked = await (parent
        ? dialog.showOpenDialog(parent, {
            title: '选择 CRX 安装包',
            filters: [{ name: 'Chrome 插件包', extensions: ['crx'] }],
            properties: ['openFile']
          })
        : dialog.showOpenDialog({
            title: '选择 CRX 安装包',
            filters: [{ name: 'Chrome 插件包', extensions: ['crx'] }],
            properties: ['openFile']
          }))
      if (picked.canceled || picked.filePaths.length === 0) return { ok: false, error: 'CANCELED' }
      const buffer = await readFile(picked.filePaths[0])
      const outcome = await install.installFromBuffer(buffer)
      await refreshManifestCache()
      await remountAll()
      return { ok: true, record: outcome.record, duplicate: outcome.duplicate }
    } catch (error) {
      return { ok: false, error: String((error as Error).message ?? error).slice(0, 160) }
    }
  })
  ipcMain.handle(
    EXTENSIONS_CHANNELS.uninstall,
    async (_e, id: unknown): Promise<UninstallResult> => {
      try {
        if (typeof id !== 'string') return { ok: false, error: 'INVALID_ID' }
        const ok = await install.uninstall(id)
        return ok ? { ok: true } : { ok: false, error: 'NOT_FOUND' }
      } catch (error) {
        return { ok: false, error: String((error as Error).message ?? error).slice(0, 160) }
      }
    }
  )
  /** 面板底部「管理插件」：打开设置窗并定位插件版面 */
  ipcMain.handle(EXTENSIONS_CHANNELS.manage, async (): Promise<{ ok: boolean }> => {
    deps.openSettings?.('extensions')
    return { ok: true }
  })
}
