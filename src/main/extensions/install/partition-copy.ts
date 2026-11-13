/**
 * 分区副本（2026-11-12 修复轮）：Electron 的扩展运行时（runtime 消息、storage、事件
 * 路由）按扩展 ID 全局路由，多分区挂同一扩展时消息与存储会跨分区错位（复现：A 会话
 * 截图，编辑器在 B 分区 SW 里读 storage →「截图不存在」；录屏 start 消息投给别的分区
 * SW → 状态污染 → 无效果）。修复 = 每分区一份副本目录（路径即身份，manifest 去除
 * key → ID 由路径哈希派生，分区稳定跨重启一致），native 隔离天然成立。
 *
 * 目录：packagesRoot/<installId>.partitions/<partitionHash>/
 * 副本内容 = 安装解包目录剔除 .package.json，manifest.json 重写去除 key；
 * 副本标记 .msb-partition.json = { installId, version, sha256 }，一致即复用不重拷。
 */
import { createHash } from 'node:crypto'
import { cp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { extensionIdFromPath } from './crx'
import type { InstallRecord } from './manifest-store'

function partitionHash(partition: string): string {
  return createHash('sha256').update(partition, 'utf8').digest('hex').slice(0, 16)
}

/** 分区副本目录（installId + partitionHash 定位，路径不含版本号——升级不改 ID） */
export function partitionExtensionDir(
  packagesRoot: string,
  installId: string,
  partition: string
): string {
  return join(packagesRoot, `${installId}.partitions`, partitionHash(partition))
}

/** 分区副本的加载 ID（路径哈希派生；ensure 前调用即可得到确定性 ID） */
export function partitionExtensionId(
  packagesRoot: string,
  installId: string,
  partition: string
): string {
  return extensionIdFromPath(partitionExtensionDir(packagesRoot, installId, partition))
}

/**
 * 确保分区副本就绪并返回副本目录。标记一致复用；不一致（首装/升级/内容变化）重拷：
 * rm 后整体 cp 安装目录（剔除 .package.json），manifest 重写去除 key。
 */
/** 按 dir 为 key 的在途互斥（审查清单 2.3）：mount 挂载与 openPopup/卸载的
 *  resolveLoadedId 可并发进入同一分区换装，staging 路径互踩即半成品目录——
 *  manifest-store locked() 同款模式，mount 与 resolveLoadedId 共用。 */
const ensureInflight = new Map<string, Promise<{ dir: string; recopied: boolean }>>()

export function ensurePartitionExtensionCopy(
  record: InstallRecord,
  packagesRoot: string,
  partition: string
): Promise<{ dir: string; recopied: boolean }> {
  const dir = partitionExtensionDir(packagesRoot, record.id, partition)
  const existing = ensureInflight.get(dir)
  if (existing) return existing
  const task = ensurePartitionExtensionCopyImpl(record, packagesRoot, partition).finally(() => {
    ensureInflight.delete(dir)
  })
  ensureInflight.set(dir, task)
  return task
}

async function ensurePartitionExtensionCopyImpl(
  record: InstallRecord,
  packagesRoot: string,
  partition: string
): Promise<{ dir: string; recopied: boolean }> {
  const dir = partitionExtensionDir(packagesRoot, record.id, partition)
  const markerPath = join(dir, '.msb-partition.json')
  const expected = JSON.stringify({
    installId: record.id,
    version: record.version,
    sha256: record.sha256
  })
  let current = ''
  try {
    current = await readFile(markerPath, 'utf8')
  } catch {
    /* 无标记=首拷或标记缺失（历史缺陷：标记从未落盘，导致每次激活都 rm+cp——
     * 会话重激活时把运行中扩展的加载目录整个删重建，插件当场全废） */
  }
  if (current === expected) return { dir, recopied: false }
  // staging 换装：先在旁路目录完成拷贝与改写，再 rm+rename 上位，避免半成品目录
  const source = join(packagesRoot, `${record.id}-${record.version}`)
  const staging = `${dir}.staging`
  await rm(staging, { recursive: true, force: true })
  await cp(source, staging, {
    recursive: true,
    filter: (src) => !src.endsWith('.package.json')
  })
  // manifest 去除 key：ID 从「CRX 公钥」切换为「路径哈希」，实现分区独立身份
  const manifestPath = join(staging, 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>
  delete manifest.key
  await writeFile(manifestPath, JSON.stringify(manifest))
  await writeFile(join(staging, '.msb-partition.json'), expected)
  await rm(dir, { recursive: true, force: true })
  await rename(staging, dir)
  return { dir, recopied: true }
}
