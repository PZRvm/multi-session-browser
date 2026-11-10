/**
 * 插件管理 IPC（用户入口层）：
 * list/install-store/import-crx/uninstall 四通道；商店安装经允许列表('*'=开放)
 * 与原生确认框；安装后对全部已挂载分区重挂载（loader 幂等去重，新插件即装即用）。
 * 确认框父窗取焦点窗口回退主窗。模块单例注册。
 */
import { BrowserWindow, dialog, ipcMain, type Session } from 'electron'
import { readFile } from 'node:fs/promises'
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
  ipcMain.handle(EXTENSIONS_CHANNELS.list, async (): Promise<ExtensionListItem[]> => {
    const m = await manifest.read()
    return m.installs.map((r) => ({
      id: r.id,
      name: r.name ?? r.id,
      version: r.version,
      source: r.source.kind,
      loadedPartitions: r.partitions.filter((p) => p.ok).length,
      totalPartitions: r.partitions.length
    }))
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
