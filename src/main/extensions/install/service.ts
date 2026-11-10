/**
 * 安装事务服务（M2-B）：
 * install：验签解包→清单 upsert（同版本同内容幂等复用，冲突拒绝）。
 * uninstall：清单移除→运行时移除→解包目录清理（顺序固定，清单为准）。
 * upgrade：新版解包→ID 一致校验→清单 upsert→旧版目录清理。
 * 商店安装经 store 模块取包后复用 installFromBuffer。
 */
import { join } from 'node:path'
import type { InstallRecord, InstallSourceKind, ManifestStore } from './manifest-store'
import { readFile, rm } from 'node:fs/promises'
import { extractCrx } from './crx'

export interface InstallServiceDeps {
  manifest: ManifestStore
  packagesRoot: string
  /** 运行时移除回调（宿主在挂载会话中 removeExtension；可省略＝仅清单操作） */
  onRemove?: (id: string) => Promise<void>
}

export interface InstallOutcome {
  record: InstallRecord
  extracted: Awaited<ReturnType<typeof extractCrx>>
  /** true＝同版本同内容已存在，复用未重复安装 */
  duplicate: boolean
}

export interface InstallService {
  installFromBuffer(buffer: Buffer, expectedId?: string): Promise<InstallOutcome>
  installFromFile(path: string, expectedId?: string): Promise<InstallOutcome>
  uninstall(id: string): Promise<boolean>
  upgrade(id: string, buffer: Buffer): Promise<InstallOutcome>
}

export function createInstallService(deps: InstallServiceDeps): InstallService {
  const root = deps.packagesRoot
  const installFromBuffer = async (
    buffer: Buffer,
    expectedId?: string
  ): Promise<InstallOutcome> => {
    const extracted = await extractCrx(buffer, root, expectedId)
    const record = await deps.manifest.upsertInstall({
      id: extracted.id,
      version: extracted.version,
      name: extracted.name,
      sha256: extracted.sha256,
      source: { kind: 'crx' satisfies InstallSourceKind, origin: 'package' },
      partitions: []
    })
    return { record, extracted, duplicate: extracted.duplicate }
  }
  const removeDir = async (path: string): Promise<void> => {
    await rm(path, { recursive: true, force: true })
  }
  const service: InstallService = {
    installFromBuffer,
    installFromFile: (path, expectedId) =>
      readFile(path).then((b) => installFromBuffer(b, expectedId)),
    uninstall: async (id) => {
      const record = await deps.manifest.get(id)
      if (!record) return false
      const removed = await deps.manifest.removeInstall(id)
      if (!removed) return false
      await deps.onRemove?.(id)
      await removeDir(join(root, `${id}-${record.version}`))
      return true
    },
    upgrade: async (id, buffer) => {
      const prior = await deps.manifest.get(id)
      if (!prior) throw new Error('UPGRADE_TARGET_MISSING: ' + id)
      const outcome = await installFromBuffer(buffer, id)
      if (outcome.record.version === prior.version && outcome.record.sha256 === prior.sha256)
        return outcome
      await removeDir(join(root, `${id}-${prior.version}`))
      return outcome
    }
  }
  return service
}
