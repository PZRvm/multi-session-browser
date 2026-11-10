/**
 * 插件宿主 dev 装配入口（A6）：
 * 提供默认路径与一次性挂载，供生产 index.ts 守卫装配与 host-smoke harness 共用。
 * M3/E 正式接线时扩展为多会话生命周期管理，不改变 runtime/install 模块边界。
 */
import { join } from 'node:path'
import { app, type Session } from 'electron'
import { createManifestStore } from './install/manifest-store'
import { createExtensionRuntime, type EngineOptions, type ExtensionRuntime, type MountResult } from './runtime'

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
  mounted: Map<string, string>
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
export async function mountDevExtensions(session: Session, partition: string): Promise<MountResult | { partition: string; error: string }> {
  const h = getExtensionsHandle()
  try {
    const result = await h.runtime.mountPartition(partition, session)
    h.mounted.set(partition, 'ok')
    return result
  } catch (error) {
    h.mounted.set(partition, 'error')
    return { partition, error: String(error).slice(0, 200) }
  }
}

export { extractCrx } from './install/crx'
export { createManifestStore } from './install/manifest-store'
