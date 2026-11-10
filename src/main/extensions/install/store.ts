/**
 * 商店安装事务（M2-B 收口）：
 * 自有 omaha CRX 下载（URL 构造与 electron-chrome-web-store 同源）→ 自有 crx.ts
 * 验签解包 → 清单 upsert（source=store）→ 清理下载临时文件。
 * 信任边界：允许列表 + 用户确认 + 自有验签，不经上游安装器解包结果。
 * 商店页点击安装流（页内 IPC 守卫）属 E 线 UI 接线；本模块交付事务 API 与守卫。
 */
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { extractCrx } from './crx'
import type { ManifestStore } from './manifest-store'

const STORE_ORIGIN = 'https://chromewebstore.google.com'

export interface StoreInstallDeps {
  manifest: ManifestStore
  packagesRoot: string
  downloadDir: string
  allowlist: readonly string[]
  confirmInstall(details: { id: string; name: string; version: string }): Promise<boolean>
}

export interface StoreInstallOutcome {
  id: string
  version: string
  sha256: string
  duplicate: boolean
}

export interface StoreInstallHandle {
  installFromStore(id: string): Promise<StoreInstallOutcome>
}

function crxUrl(id: string): string {
  const url = new URL('https://clients2.google.com/service/update2/crx')
  url.searchParams.append('response', 'redirect')
  url.searchParams.append('acceptformat', 'crx2,crx3')
  const x = new URLSearchParams({ id, uc: '' })
  url.searchParams.append('x', x.toString())
  url.searchParams.append('prodversion', process.versions.chrome ?? '120')
  return url.toString()
}

export function createStoreInstall(deps: StoreInstallDeps): StoreInstallHandle {
  const installFromStore = async (id: string): Promise<StoreInstallOutcome> => {
    if (!deps.allowlist.includes('*') && !deps.allowlist.includes(id))
      throw new Error('STORE_ID_NOT_ALLOWED: ' + id)
    const approved = await deps
      .confirmInstall({ id, name: id, version: 'store' })
      .catch(() => false)
    if (!approved) throw new Error('STORE_CONFIRM_DENIED')
    const response = await fetch(crxUrl(id), { redirect: 'follow' })
    if (!response.ok) throw new Error('STORE_DOWNLOAD_HTTP_' + response.status)
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length < 16) throw new Error('STORE_DOWNLOAD_EMPTY')
    const extracted = await extractCrx(bytes, deps.packagesRoot, id)
    await deps.manifest.upsertInstall({
      id: extracted.id,
      version: extracted.version,
      name: extracted.name,
      sha256: extracted.sha256,
      source: { kind: 'store', origin: STORE_ORIGIN },
      partitions: []
    })
    const stale = join(deps.downloadDir, id)
    await rm(stale, { recursive: true, force: true })
    return {
      id: extracted.id,
      version: extracted.version,
      sha256: extracted.sha256,
      duplicate: extracted.duplicate
    }
  }
  return { installFromStore }
}
