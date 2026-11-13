/* eslint @typescript-eslint/explicit-function-return-type: off -- 固定厂商ZIP测试材料的有界读取 */
import { createHash } from 'node:crypto'
import { posix } from 'node:path'
import AdmZip from 'adm-zip'
export const MAX_VENDOR_DOWNLOAD = 8 * 1024 * 1024
export async function readBoundedResponse(response, limit = MAX_VENDOR_DOWNLOAD) {
  if (!response.ok || !response.body) throw new Error('厂商ZIP下载失败 ' + response.status)
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body.cancel()
    throw new Error('厂商ZIP下载过大')
  }
  const reader = response.body.getReader(),
    chunks = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) {
        await reader.cancel()
        throw new Error('厂商ZIP下载过大')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks, size)
}
export function inspectVendorZip(
  bytes,
  expectedHash,
  { maxEntries = 10000, maxExpanded = 32 * 1024 * 1024 } = {}
) {
  if (bytes.length > MAX_VENDOR_DOWNLOAD) throw new Error('厂商ZIP下载过大')
  if (createHash('sha256').update(bytes).digest('hex') !== expectedHash)
    throw new Error('厂商ZIP固定哈希不符')
  const zip = new AdmZip(bytes),
    entries = zip.getEntries(),
    seen = new Set()
  let expanded = 0
  if (!entries.length || entries.length > maxEntries) throw new Error('厂商ZIP条目数非法')
  for (const e of entries) {
    const name = e.entryName
    if (
      name.includes('\\') ||
      name.startsWith('/') ||
      /^[A-Za-z]:/.test(name) ||
      name.split('/').includes('..') ||
      name.includes('\0') ||
      ((e.header.attr >>> 16) & 0xf000) === 0xa000
    )
      throw new Error('厂商ZIP路径拒绝')
    const normalized = posix.normalize(name).replace(/\/$/, '').normalize('NFC').toLowerCase()
    if (normalized === '.' || seen.has(normalized)) throw new Error('厂商ZIP重复路径')
    seen.add(normalized)
    expanded += e.header.size
    if (expanded > maxExpanded) throw new Error('厂商ZIP展开过大')
  }
  return zip
}
