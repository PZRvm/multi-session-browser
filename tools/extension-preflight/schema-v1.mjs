/* eslint @typescript-eslint/explicit-function-return-type: off -- 前置契约数据校验，不接入生产 */
import { createHash } from 'node:crypto'
import { classifyInstall } from './contracts.mjs'
export const MAX_IMAGE_BYTES = 32 * 1024 * 1024
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
function demand(value) {
  if (!value) throw Object.assign(new Error('INVALID_REQUEST'), { code: 'INVALID_REQUEST' })
}
export function checkImagePayload(meta, bytes) {
  demand(
    meta?.mimeType === 'image/png' &&
      Buffer.isBuffer(bytes) &&
      bytes.length >= 24 &&
      bytes.length <= MAX_IMAGE_BYTES
  )
  demand(bytes.subarray(0, 8).equals(PNG) && bytes.toString('ascii', 12, 16) === 'IHDR')
  const width = bytes.readUInt32BE(16),
    height = bytes.readUInt32BE(20)
  demand(
    width > 0 &&
      height > 0 &&
      width <= 32768 &&
      height <= 32768 &&
      width * height <= 64 * 1024 * 1024
  )
  demand(
    meta.width === width &&
      meta.height === height &&
      /^[a-f0-9]{64}$/.test(meta.sha256) &&
      createHash('sha256').update(bytes).digest('hex') === meta.sha256
  )
  return { width, height, mimeType: 'image/png', sha256: meta.sha256 }
}
export function checkInstallRecord(record) {
  demand(
    record &&
      /^[a-p]{32}$/.test(record.id) &&
      (record.name === undefined ||
        (typeof record.name === 'string' && record.name.length > 0 && record.name.length <= 100)) &&
      /^\d+(\.\d+){0,3}$/.test(record.version) &&
      /^[a-f0-9]{64}$/.test(record.sha256)
  )
  demand(
    Number.isSafeInteger(record.generation) &&
      record.generation > 0 &&
      ['crx', 'store', 'unpacked'].includes(record.source?.kind)
  )
  demand(Array.isArray(record.partitions) && record.partitions.length <= 1024)
  const ids = new Set()
  for (const row of record.partitions) {
    demand(
      row &&
        typeof row.partition === 'string' &&
        row.partition.length > 0 &&
        row.partition.length <= 256 &&
        !ids.has(row.partition) &&
        typeof row.ok === 'boolean' &&
        row.generation === record.generation
    )
    ids.add(row.partition)
  }
  return classifyInstall(record.partitions)
}
