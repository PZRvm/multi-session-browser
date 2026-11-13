/**
 * 插件宿主运行时工厂（A1，M1 骨架）：
 * 每分区一个 ElectronChromeExtensions 引擎（chrome.* 桥与 action 支持），
 * 挂载时按清单加载已装扩展（loader 屏障语义），结果落清单分区记录。
 * 分区副本（2026-11-12）：crx/store 安装的扩展以「分区副本目录」加载——路径即身份，
 * native 消息/存储/事件按扩展 ID 全局路由，分区独立 ID 是多会话隔离的前提。
 * Tab 表面回调由装配方注入（index.ts 守卫装配 / E 线 M3 全量接线）。
 */
import type { BaseWindow, Session, WebContents } from 'electron'
import { ElectronChromeExtensions } from 'electron-chrome-extensions'
import { extensionIdFromPath } from '../install/crx'
import { classifyInstall, type InstallState, type ManifestStore } from '../install/manifest-store'
import {
  ensurePartitionExtensionCopy,
  partitionExtensionDir,
  partitionExtensionId
} from '../install/partition-copy'
import { loadInstallsIntoSession, type ExtensionLoadResult, type LoaderSession } from './loader'
import { ensureGuardedPreload } from './preload-guard'
import { registerSessionShimIpc } from '../shims'

export interface EngineOptions {
  createTab?: (details: unknown) => Promise<[WebContents, BaseWindow]>
  /** 库 windows.create 依赖宿主 impl.createWindow（自研截图编辑器窗走此链） */
  createWindow?: (details: unknown) => Promise<BaseWindow>
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
  /** 安装 ID → 本分区实际加载 ID（分区副本路径派生，确定性；无安装记录返回 undefined） */
  resolveLoadedId(partition: string, installId: string): Promise<string | undefined>
}

export function createExtensionRuntime(deps: RuntimeDeps): ExtensionRuntime {
  const engines = new Map<string, ElectronChromeExtensions>()
  const pending = new Map<string, Promise<MountResult>>()
  const wiredSessions = new WeakSet<Session>()
  async function mount(partition: string, session: Session): Promise<MountResult> {
    if (!engines.has(partition)) {
      const options = { session, ...deps.engineOptions }
      engines.set(partition, new ElectronChromeExtensions(options))
    }
    // SW invoke 不进 ipcMain（Electron35+ 走 ServiceWorkerMain.ipc，逐实例注册）；
    // 每会话接线一次，SW 启动时由 shims 侧按 running-status-changed 挂 handler。
    const firstMountOfSession = !wiredSessions.has(session)
    if (firstMountOfSession) {
      wiredSessions.add(session)
      registerSessionShimIpc(session)
    }
    await ensureGuardedPreload(session)
    // 持久化恢复的扩展/SW 可能在本轮 preload 注册前就已自启（分区持久化跨重启），
    // SW 主世界为 native/lib-only——shim 不完备，offscreen/下载全走错实现。会话对象
    // 首次挂载时：凡已按分区 ID 加载的实例强制移除重载（SW 以当前守卫 preload 重启，
    // shim 完备）；同进程后续重激活跳过（WeakSet），保护录制中的会话。
    if (firstMountOfSession) {
      const persisted = (await deps.manifest.read()).installs
      for (const record of persisted) {
        if (record.source.kind === 'unpacked') continue
        const loadedId = partitionExtensionId(deps.packagesRoot, record.id, partition)
        if (session.extensions.getExtension(loadedId)) {
          try {
            await session.extensions.removeExtension(loadedId)
          } catch {
            /* 已卸载/分区销毁竞态：跳过 */
          }
        }
      }
    }
    const adapter: LoaderSession = {
      getAllExtensions: () => session.extensions.getAllExtensions(),
      loadExtension: (path) => session.extensions.loadExtension(path)
    }
    const installs = (await deps.manifest.read()).installs
    // 分区副本路径预解析（cp + manifest 去 key；标记一致复用），随记录挂期望 ID
    const pathsById = new Map<string, string>()
    const recopied = new Set<string>()
    for (const record of installs) {
      if (record.source.kind === 'unpacked') {
        pathsById.set(record.id, record.source.origin ?? '')
        continue
      }
      const copy = await ensurePartitionExtensionCopy(record, deps.packagesRoot, partition)
      pathsById.set(record.id, copy.dir)
      if (copy.recopied) recopied.add(record.id)
    }
    const results = await loadInstallsIntoSession(adapter, installs, partition, {
      resolvePath: (record) => pathsById.get(record.id) ?? '',
      resolveExpectedId: (record) =>
        record.source.kind === 'unpacked'
          ? extensionIdFromPath(record.source.origin ?? '')
          : partitionExtensionId(deps.packagesRoot, record.id, partition),
      recordPartition: (id, p, ok) => deps.manifest.recordPartition(id, p, ok)
    })
    // 自愈重载：换装发生在已加载实例之下时（历史缺陷标记缺失/升级），移除后重载新目录
    for (const result of results) {
      if (result.detail !== 'already-loaded' || !recopied.has(result.id)) continue
      const loadedId = result.loadedId
      const path = pathsById.get(result.id)
      if (!loadedId || !path) continue
      try {
        await session.extensions.removeExtension(loadedId)
        await session.extensions.loadExtension(path)
      } catch {
        /* 分区销毁竞态：跳过 */
      }
    }
    // 迁移清理：历史全局 ID 实例（旧版按 CRX 公钥 ID 加载并随分区持久化）与分区副本
    // 并存会串消息/存储——按安装记录 ID 命中即移除
    const installIds = new Set(
      installs.filter((r) => r.source.kind !== 'unpacked').map((r) => r.id)
    )
    for (const ext of session.extensions.getAllExtensions()) {
      if (installIds.has(ext.id)) {
        try {
          await session.extensions.removeExtension(ext.id)
        } catch {
          /* 已卸载/分区销毁竞态：跳过 */
        }
      }
    }
    const records = (await deps.manifest.read()).installs
    const thisPartition = records
      .map((r) => r.partitions.find((p) => p.partition === partition))
      .filter((v) => v !== undefined)
    const state = classifyInstall(thisPartition)
    return { partition, results, state }
  }
  return {
    mountPartition(partition, session) {
      const previous = pending.get(partition) ?? Promise.resolve()
      const task = previous.catch(() => undefined).then(() => mount(partition, session))
      pending.set(partition, task)
      void task
        .finally(() => {
          if (pending.get(partition) === task) pending.delete(partition)
        })
        .catch(() => undefined)
      return task
    },
    getEngine: (partition) => engines.get(partition),
    resolveLoadedId: async (partition, installId) => {
      const record = await deps.manifest.get(installId)
      if (!record) return undefined
      // unpacked 的实际加载 ID 同为路径哈希（manifest 无 key 时），与 crx/store 同构推导
      if (record.source.kind === 'unpacked') return extensionIdFromPath(record.source.origin ?? '')
      await ensurePartitionExtensionCopy(record, deps.packagesRoot, partition)
      return partitionExtensionId(deps.packagesRoot, installId, partition)
    }
  }
}

/** 分区副本目录（导出供卸载清理用） */
export { partitionExtensionDir }
