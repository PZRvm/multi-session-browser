/**
 * 插件宿主运行时工厂（A1，M1 骨架）：
 * 每分区一个 ElectronChromeExtensions 引擎（chrome.* 桥与 action 支持），
 * 挂载时按清单加载已装扩展（loader 屏障语义），结果落清单分区记录。
 * Tab 表面回调由装配方注入（index.ts 守卫装配 / E 线 M3 全量接线）。
 */
import { join } from 'node:path'
import type { BaseWindow, Session, WebContents } from 'electron'
import { ElectronChromeExtensions } from 'electron-chrome-extensions'
import { classifyInstall, type InstallState, type ManifestStore } from '../install/manifest-store'
import { loadInstallsIntoSession, type ExtensionLoadResult, type LoaderSession } from './loader'
import { ensureGuardedPreload } from './preload-guard'

export interface EngineOptions {
  createTab?: (details: unknown) => Promise<[WebContents, BaseWindow]>
  selectTab?: (wc: unknown) => void
  removeTab?: (wc: unknown) => void
  requestPermissions?: (
    extension: { id: string },
    permissions: { origins?: string[]; permissions?: string[] }
  ) => Promise<boolean>
}

export interface RuntimeDeps {
  manifest: ManifestStore
  packagesRoot: string
  engineOptions?: EngineOptions
}

export interface MountResult {
  partition: string
  results: ExtensionLoadResult[]
  state: InstallState
}

export interface ExtensionRuntime {
  mountPartition(partition: string, session: Session): Promise<MountResult>
  getEngine(partition: string): ElectronChromeExtensions | undefined
}

export function createExtensionRuntime(deps: RuntimeDeps): ExtensionRuntime {
  const engines = new Map<string, ElectronChromeExtensions>()
  return {
    async mountPartition(partition, session) {
      if (!engines.has(partition)) {
        const options = { session, ...deps.engineOptions }
        engines.set(partition, new ElectronChromeExtensions(options))
        ensureGuardedPreload(session)
      }
      const bridge = (
        session as unknown as {
          extensions?: { loadExtension(p: string): Promise<{ id: string }> }
        }
      ).extensions
      const adapter: LoaderSession = {
        getAllExtensions: () => session.getAllExtensions(),
        loadExtension: (path) => (bridge ? bridge.loadExtension(path) : session.loadExtension(path))
      }
      const installs = (await deps.manifest.read()).installs
      const results = await loadInstallsIntoSession(adapter, installs, partition, {
        resolvePath: (record) =>
          record.source.kind === 'unpacked'
            ? (record.source.origin ?? '')
            : join(deps.packagesRoot, `${record.id}-${record.version}`),
        recordPartition: (id, p, ok) => deps.manifest.recordPartition(id, p, ok)
      })
      const records = (await deps.manifest.read()).installs
      const thisPartition = records
        .map((r) => r.partitions.find((p) => p.partition === partition))
        .filter((v) => v !== undefined)
      const state = classifyInstall(thisPartition)
      return { partition, results, state }
    },
    getEngine: (partition) => engines.get(partition)
  }
}
