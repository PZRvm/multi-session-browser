/**
 * 插件管理 IPC（用户入口层）：
 * list/install-store/import-crx/uninstall 四通道；商店安装经允许列表('*'=开放)
 * 与原生确认框；安装后对全部已挂载分区重挂载（loader 幂等去重，新插件即装即用）。
 * 确认框父窗取焦点窗口回退主窗。模块单例注册。
 */
import { BrowserWindow, dialog, ipcMain, type Session } from 'electron'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { attachShellTab } from './dev-entry'
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
  /** 打开设置窗并定位版面（工具栏面板「管理插件」入口） */
  openSettings?: (pane?: string) => void
  /** 应用壳页 webContents（引擎 tab 注册用） */
  getShellWebContents?: () => BrowserWindow | null
}

interface InstallOutcome extends InstallResult {
  record?: InstallRecord
}

let registered = false

export function registerExtensionsManagement(deps: ManagementDeps): void {
  if (registered) return
  registered = true
  const paths = extensionsPaths()
  const manifest = createManifestStore(paths.manifestFile)
  const handle = getExtensionsHandle()
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
      for (const { session } of mountedSessions()) {
        try {
          await session.removeExtension(id)
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
  /** 读解包目录 manifest：icons 最大 ≤48 → PNG dataURL；action/browser_action → 可弹窗 */
  const readManifestExtra = async (
    record: InstallRecord
  ): Promise<{ icon?: string; hasAction: boolean }> => {
    const dir = join(paths.packagesRoot, `${record.id}-${record.version}`)
    try {
      const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as {
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
      return { icon, hasAction: !!(manifest.action || manifest.browser_action) }
    } catch {
      return { hasAction: false }
    }
  }
  ipcMain.handle(EXTENSIONS_CHANNELS.list, async (): Promise<ExtensionListItem[]> => {
    const m = await manifest.read()
    return Promise.all(
      m.installs.map(async (r) => {
        const extra = await readManifestExtra(r)
        return {
          id: r.id,
          name: r.name ?? r.id,
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
  /** 工具栏面板行点击：打开插件 action popup（锚定工具栏拼图按钮） */
  ipcMain.handle(
    EXTENSIONS_CHANNELS.openPopup,
    async (_e, payload: { id?: unknown; anchor?: { x: number; y: number } }): Promise<{ ok: boolean; error?: string }> => {
      try {
        if (typeof payload?.id !== 'string') return { ok: false, error: 'INVALID_ID' }
        const anchor = payload.anchor
        for (const { partition } of mountedSessions()) {
          const engine = handle.runtime.getEngine(partition)
          if (!engine) continue
          const shellWin = deps.getShellWebContents?.() ?? deps.getMainWindow()
          if (!shellWin) return { ok: false, error: 'NO_SHELL' }
          attachShellTab(handle, partition, shellWin.webContents)
          const request = {
            eventType: 'click',
            extensionId: payload.id,
            alignment: 'bottom right',
            anchorRect: { x: anchor?.x ?? shellWin.getContentSize()[0] - 80, y: anchor?.y ?? 8, width: 36, height: 36 }
          }
          ;(engine as unknown as { browserAction: { activateClick: (d: typeof request) => void } }).browserAction.activateClick(request)
          return { ok: true }
        }
        return { ok: false, error: 'NO_MOUNTED_PARTITION' }
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
}
