/**
 * 分区扩展加载编排（A1，electron 无关，可 mock 测试）：
 * 幂等去重（期望 ID 已加载跳过——分区副本 ID 由路径派生，跨重启持久化一致）→
 * 逐条加载 → 每条结果落清单分区记录（按安装 ID 记账，loadedId 单独返回）→
 * 全部 settle 才返回（屏障）。
 * 真实 media/api 能力由 ElectronChromeExtensions 引擎提供（index.ts 工厂负责接线）。
 */
import type { InstallRecord } from '../install/manifest-store'

export interface LoaderSession {
  /** 已加载扩展（幂等去重依据，含持久化恢复的历史实例） */
  getAllExtensions(): Array<{ id: string }>
  loadExtension(path: string): Promise<{ id: string }>
}

export interface ExtensionLoadResult {
  /** 安装记录 ID（清单记账维度） */
  id: string
  /** 实际加载的扩展 ID（分区副本路径派生，可与 id 不同） */
  loadedId?: string
  path: string
  ok: boolean
  /** loaded / already-loaded / 截断错误串 */
  detail: 'loaded' | 'already-loaded' | 'error'
  /** detail 为 error 时给出截断消息 */
  message?: string
}

export interface LoaderDeps {
  /** 安装记录 → 解包目录（分区副本路径由调用方预解析注入） */
  resolvePath(record: InstallRecord): string
  /** 安装记录 → 本分区期望的加载 ID（路径派生；缺省退回 record.id 比对） */
  resolveExpectedId?(record: InstallRecord): string
  /** 分区加载结果落清单（可选，缺省仅返回结果；恒按安装 ID 记账） */
  recordPartition?(installId: string, partition: string, ok: boolean): Promise<unknown>
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
        const expectedId = deps.resolveExpectedId?.(record) ?? record.id
        if (loadedIds.has(expectedId)) {
          results.push({
            id: record.id,
            loadedId: expectedId,
            path: '',
            ok: true,
            detail: 'already-loaded'
          })
          await deps.recordPartition?.(record.id, partition, true)
          return
        }
        const path = deps.resolvePath(record)
        const ext = await session.loadExtension(path)
        results.push({ id: record.id, loadedId: ext.id, path, ok: true, detail: 'loaded' })
        await deps.recordPartition?.(record.id, partition, true)
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
