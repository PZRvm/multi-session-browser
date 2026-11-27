/**
 * 插件宿主运行时工厂（A1，M1 骨架）：
 * 每分区一个 ElectronChromeExtensions 引擎（chrome.* 桥与 action 支持），
 * 挂载时按清单加载已装扩展（loader 屏障语义），结果落清单分区记录。
 * 分区副本（2026-11-12）：crx/store 安装的扩展以「分区副本目录」加载——路径即身份，
 * native 消息/存储/事件按扩展 ID 全局路由，分区独立 ID 是多会话隔离的前提。
 * Tab 表面回调由装配方注入（index.ts 守卫装配 / E 线 M3 全量接线）。
 */
import type { BaseWindow, Session, WebContents } from 'electron'
import { rm } from 'node:fs/promises'
import {
  assertExtensionSessionLive,
  retireExtensionSession,
  suspendExtensionSession,
  resumeExtensionSession
} from './lifecycle'
import { ElectronChromeExtensions } from 'electron-chrome-extensions'
import { extensionIdFromPath } from '../install/crx'
import { classifyInstall, type InstallState, type ManifestStore } from '../install/manifest-store'
import {
  ensurePartitionExtensionCopy,
  partitionExtensionDir,
  partitionExtensionId
} from '../install/partition-copy'
import { loadInstallsIntoSession, type ExtensionLoadResult, type LoaderSession } from './loader'
import { installGuardedPreload, prepareGuardedPreload } from './preload-guard'
import { registerSessionShimIpc, disposeSessionShims } from '../shims'
import { releaseSessionBridgeTargets } from '../bridge'

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
  createWindowForSession?: (session: Session, details: unknown) => Promise<BaseWindow>
  createTabForSession?: (session: Session, details: unknown) => Promise<[WebContents, BaseWindow]>
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
  suspendPartition(partition: string, session: Session): Promise<void>
  resumePartition(partition: string, session: Session): void
  terminatePartition(partition: string, session: Session): Promise<void>
  getEngine(partition: string): ElectronChromeExtensions | undefined
  /** 安装 ID → 本分区实际加载 ID（分区副本路径派生，确定性；无安装记录返回 undefined） */
  resolveLoadedId(partition: string, installId: string): Promise<string | undefined>
}

/** 依赖没有完整释放接口，构造中段失败后只能通过完整退出恢复。 */
export class ExtensionRuntimeRestartRequiredError extends Error {
  constructor(cause: unknown) {
    super('EXTENSION_RUNTIME_RESTART_REQUIRED', { cause })
    this.name = 'ExtensionRuntimeRestartRequiredError'
  }
}

// 跨工厂保留失败状态；Session 生命周期结束后由 WeakMap 释放，不持久化。
const constructionFailures = new WeakMap<Session, ExtensionRuntimeRestartRequiredError>()

export function createExtensionRuntime(deps: RuntimeDeps): ExtensionRuntime {
  const engines = new Map<string, ElectronChromeExtensions>()
  const pending = new Map<string, Promise<MountResult>>()
  const terminating = new Map<string, Promise<void>>()
  const wiredSessions = new WeakSet<Session>()
  const retiredPartitions = new Set<string>()
  const suspendedPartitions = new Set<string>()
  const resolving = new Map<string, Set<Promise<unknown>>>()
  const demandLive = (partition: string, session?: Session): void => {
    if (retiredPartitions.has(partition)) throw new Error('EXTENSION_SESSION_RETIRED')
    if (suspendedPartitions.has(partition)) throw new Error('EXTENSION_SESSION_SUSPENDED')
    if (session) assertExtensionSessionLive(session)
  }
  async function drain(partition: string): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        Promise.allSettled(
          [pending.get(partition), ...(resolving.get(partition) ?? [])].filter(Boolean)
        ),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('EXTENSION_DISPOSE_TIMEOUT')), 15000)
        })
      ])
    } finally {
      clearTimeout(timer)
    }
  }
  async function mount(partition: string, session: Session): Promise<MountResult> {
    demandLive(partition, session)
    let previousFailure = constructionFailures.get(session)
    if (previousFailure) throw previousFailure
    // 安装/构建补丁从源头取消库的裸注册；缺少补丁时在库构造前拒绝。
    if (!ElectronChromeExtensions.toString().includes('MSB_FILTERED_PRELOAD_REQUIRED')) {
      throw new Error('扩展注册补丁缺失，请重新安装依赖并构建')
    }
    const guarded = await prepareGuardedPreload()
    // 异步准备期间其他工厂也可能将同一 Session 标为失败。
    previousFailure = constructionFailures.get(session)
    if (previousFailure) throw previousFailure
    demandLive(partition, session)
    const rollback = installGuardedPreload(session, guarded)
    if (!engines.has(partition)) {
      // 工厂误复用已初始化的 Session 是前置冲突，不应污染原有健康引擎。
      if (ElectronChromeExtensions.fromSession(session)) {
        rollback()
        throw new Error('该会话的插件引擎已由其他运行时初始化')
      }
      try {
        const options = {
          session,
          ...deps.engineOptions,
          ...(deps.createWindowForSession && !deps.engineOptions?.createWindow
            ? { createWindow: (details: unknown) => deps.createWindowForSession!(session, details) }
            : {}),
          ...(deps.createTabForSession && !deps.engineOptions?.createTab
            ? { createTab: (details: unknown) => deps.createTabForSession!(session, details) }
            : {})
        }
        engines.set(partition, new ElectronChromeExtensions(options))
      } catch (error) {
        const failure = new ExtensionRuntimeRestartRequiredError(error)
        constructionFailures.set(session, failure)
        try {
          rollback()
        } catch (rollbackError) {
          console.warn(
            '[extensions] 构造失败后的 preload 撤销失败，需要完整退出应用:',
            rollbackError
          )
        }
        throw failure
      }
    }
    // SW invoke 不进 ipcMain（Electron35+ 走 ServiceWorkerMain.ipc，逐实例注册）；
    // 每会话接线一次，SW 启动时由 shims 侧按 running-status-changed 挂 handler。
    const firstMountOfSession = !wiredSessions.has(session)
    if (firstMountOfSession) {
      wiredSessions.add(session)
      registerSessionShimIpc(session)
    }
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
    demandLive(partition, session)
    const adapter: LoaderSession = {
      getAllExtensions: () => session.extensions.getAllExtensions(),
      loadExtension: async (path) => {
        demandLive(partition, session)
        const loaded = await session.extensions.loadExtension(path)
        demandLive(partition, session)
        return loaded
      }
    }
    const installs = (await deps.manifest.read()).installs
    // 分区副本路径预解析（cp + manifest 去 key；标记一致复用），随记录挂期望 ID
    const pathsById = new Map<string, string>()
    const recopied = new Set<string>()
    demandLive(partition, session)
    for (const record of installs) {
      demandLive(partition, session)
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
      recordPartition: (id, p, ok) => {
        demandLive(partition, session)
        return deps.manifest.recordPartition(id, p, ok)
      }
    })
    demandLive(partition, session)
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
    demandLive(partition, session)
    const records = (await deps.manifest.read()).installs
    const thisPartition = records
      .map((r) => r.partitions.find((p) => p.partition === partition))
      .filter((v) => v !== undefined)
    const state = classifyInstall(thisPartition)
    return { partition, results, state }
  }
  return {
    async suspendPartition(partition, session) {
      suspendedPartitions.add(partition)
      suspendExtensionSession(session)
      await drain(partition)
      disposeSessionShims(session)
      wiredSessions.delete(session)
      for (const extension of session.extensions.getAllExtensions()) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            session.extensions.off('extension-unloaded', unloaded)
            reject(new Error('EXTENSION_SUSPEND_TIMEOUT'))
          }, 10000)
          const unloaded = (_event: unknown, removed: Electron.Extension): void => {
            if (removed.id !== extension.id) return
            clearTimeout(timer)
            session.extensions.off('extension-unloaded', unloaded)
            resolve()
          }
          session.extensions.on('extension-unloaded', unloaded)
          try {
            session.extensions.removeExtension(extension.id)
          } catch (error) {
            clearTimeout(timer)
            session.extensions.off('extension-unloaded', unloaded)
            reject(error)
          }
        })
      }
    },
    resumePartition(partition, session) {
      if (retiredPartitions.has(partition)) throw new Error('EXTENSION_SESSION_RETIRED')
      resumeExtensionSession(session)
      suspendedPartitions.delete(partition)
    },
    terminatePartition(partition, session) {
      const previous = terminating.get(partition)
      if (previous) return previous
      const task = (async () => {
        retiredPartitions.add(partition)
        retireExtensionSession(session)
        await drain(partition)
        disposeSessionShims(session)
        releaseSessionBridgeTargets(session)
        for (const extension of session.extensions.getAllExtensions()) {
          await session.extensions.removeExtension(extension.id)
        }
        for (const script of session.getPreloadScripts()) {
          if (script.id === 'crx-mv2-preload' || script.id === 'crx-mv3-preload')
            session.unregisterPreloadScript(script.id)
        }
        engines.delete(partition)
        wiredSessions.delete(session)
        for (const record of (await deps.manifest.read()).installs) {
          await rm(partitionExtensionDir(deps.packagesRoot, record.id, partition), {
            recursive: true,
            force: true
          })
        }
        await deps.manifest.dropPartition(partition)
      })()
      terminating.set(partition, task)
      void task.finally(() => terminating.delete(partition)).catch(() => undefined)
      return task
    },
    mountPartition(partition, session) {
      try {
        demandLive(partition, session)
      } catch (error) {
        return Promise.reject(error)
      }
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
    getEngine: (partition) =>
      retiredPartitions.has(partition) ? undefined : engines.get(partition),
    resolveLoadedId: (partition, installId) => {
      try {
        demandLive(partition)
      } catch (error) {
        return Promise.reject(error)
      }
      const task = (async () => {
        const record = await deps.manifest.get(installId)
        demandLive(partition)
        if (!record) return undefined
        // unpacked 的实际加载 ID 同为路径哈希（manifest 无 key 时），与 crx/store 同构推导
        if (record.source.kind === 'unpacked')
          return extensionIdFromPath(record.source.origin ?? '')
        await ensurePartitionExtensionCopy(record, deps.packagesRoot, partition)
        demandLive(partition)
        return partitionExtensionId(deps.packagesRoot, installId, partition)
      })()
      const tasks = resolving.get(partition) ?? new Set<Promise<unknown>>()
      resolving.set(partition, tasks)
      tasks.add(task)
      void task
        .finally(() => {
          tasks.delete(task)
          if (!tasks.size) resolving.delete(partition)
        })
        .catch(() => undefined)
      return task
    }
  }
}

/** 分区副本目录（导出供卸载清理用） */
export { partitionExtensionDir }
