/**
 * 分区扩展加载编排（A1，electron 无关，可 mock 测试）：
 * 幂等去重（已加载跳过）→ 逐条加载 → 每条结果落清单分区记录 → 全部 settle 才返回（屏障）。
 * 真实 media/api 能力由 ElectronChromeExtensions 引擎提供（index.ts 工厂负责接线）。
 */
import type { InstallRecord } from '../install/manifest-store'

export interface LoaderSession {
  /** 已加载扩展（幂等去重依据） */
  getAllExtensions(): Array<{ id: string }>
  loadExtension(path: string): Promise<{ id: string }>
}

export interface ExtensionLoadResult {
  id: string
  path: string
  ok: boolean
  /** loaded / already-loaded / 截断错误串 */
  detail: 'loaded' | 'already-loaded' | 'error'
  /** detail 为 error 时给出截断消息 */
  message?: string
}

export interface LoaderDeps {
  /** 安装记录 → 解包目录（crx/store 按 packagesRoot 约定；unpacked 用 source.origin） */
  resolvePath(record: InstallRecord): string
  /** 分区加载结果落清单（可选，缺省仅返回结果） */
  recordPartition?(id: string, partition: string, ok: boolean): Promise<unknown>
}

/** 全部 settle 才返回（首导航屏障语义：调用方 await 后才放行导航） */
export async function loadInstallsIntoSession(
  session: LoaderSession,
  installs: InstallRecord[],
  partition: string,
  deps: LoaderDeps
): Promise<ExtensionLoadResult[]> {
  const loadedIds = new Set(session.getAllExtensions().map((v) => v.id))
  const results: ExtensionLoadResult[] = []
  await Promise.all(
    installs.map(async (record) => {
      try {
        if (loadedIds.has(record.id)) {
          results.push({ id: record.id, path: '', ok: true, detail: 'already-loaded' })
          await deps.recordPartition?.(record.id, partition, true)
          return
        }
        const path = deps.resolvePath(record)
        const ext = await session.loadExtension(path)
        results.push({ id: ext.id, path, ok: true, detail: 'loaded' })
        await deps.recordPartition?.(ext.id, partition, true)
      } catch (error) {
        results.push({
          id: record.id,
          path: '',
          ok: false,
          detail: 'error',
          message: String(error).slice(0, 120)
        })
        await deps.recordPartition?.(record.id, partition, false)
      }
    })
  )
  results.sort((a, b) => a.id.localeCompare(b.id))
  return results
}
