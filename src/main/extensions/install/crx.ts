/* eslint @typescript-eslint/explicit-function-return-type: off -- 移植自前置验证工具，保持同源便于对账 */
/**
 * CRX2/CRX3 验签与有界解包（移植自 tools/extension-preflight/crx.mjs）。
 * 与前置实现保持同源；生产差异仅两处：夹具标记改 .package.json、移除测试专用 makeCrx2。
 */
import { createHash, createPublicKey, verify } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join, posix, isAbsolute } from 'node:path'
import { randomUUID } from 'node:crypto'
import AdmZip from 'adm-zip'

const MAX_PACKAGE = 32 * 1024 * 1024
const MAX_EXPANDED = 64 * 1024 * 1024
function demand(value: unknown, reason: string): asserts value {
  if (!value) throw new Error(reason)
}
export function extensionId(publicKey: Buffer): string {
  return createHash('sha256')
    .update(publicKey)
    .digest('hex')
    .slice(0, 32)
    .replace(/[0-9a-f]/g, (v) => String.fromCharCode(97 + parseInt(v, 16)))
}
function fields(data: Buffer): Array<{ field: number; data: Buffer }> {
  let cursor = 0
  const result: Array<{ field: number; data: Buffer }> = []
  function varint() {
    let value = 0
    for (let i = 0; i < 10; i++) {
      demand(cursor < data.length, '截断 protobuf')
      const byte = data[cursor++]
      value += (byte & 127) * 2 ** (7 * i)
      demand(Number.isSafeInteger(value), 'protobuf 整数溢出')
      if (!(byte & 128)) return value
    }
    throw new Error('protobuf varint 过长')
  }
  while (cursor < data.length) {
    const tag = varint(),
      wire = tag % 8,
      field = Math.floor(tag / 8)
    demand(field > 0, 'protobuf 字段非法')
    if (wire === 0) {
      varint()
      continue
    }
    const length = wire === 2 ? varint() : wire === 1 ? 8 : wire === 5 ? 4 : -1
    demand(length >= 0 && cursor + length <= data.length, 'protobuf 长度非法')
    result.push({ field, data: data.subarray(cursor, cursor + length) })
    cursor += length
  }
  return result
}
function keyFromDer(der: Buffer) {
  return createPublicKey({ key: der, format: 'der', type: 'spki' })
}
export function inspectCrx(buffer: Buffer, expectedId?: string) {
  demand(
    Buffer.isBuffer(buffer) && buffer.length >= 16 && buffer.length <= MAX_PACKAGE,
    'CRX 大小非法'
  )
  demand(buffer.subarray(0, 4).toString() === 'Cr24', 'CRX 魔数非法')
  const version = buffer.readUInt32LE(4)
  let publicKey: Buffer | undefined
  let archive!: Buffer
  let signedPayload: Buffer | undefined
  let proofs: Array<{ field: number; data: Buffer }> | undefined
  if (version === 2) {
    const keySize = buffer.readUInt32LE(8),
      sigSize = buffer.readUInt32LE(12)
    const offset = 16 + keySize + sigSize
    demand(keySize > 0 && sigSize > 0 && offset < buffer.length, 'CRX2 长度非法')
    publicKey = buffer.subarray(16, 16 + keySize)
    archive = buffer.subarray(offset)
    demand(
      verify('sha1', archive, keyFromDer(publicKey), buffer.subarray(16 + keySize, offset)),
      'CRX2 签名无效'
    )
  } else if (version === 3) {
    const size = buffer.readUInt32LE(8)
    demand(size > 0 && size < 1024 * 1024 && 12 + size < buffer.length, 'CRX3 长度非法')
    const header = fields(buffer.subarray(12, 12 + size))
    const signed = header.filter((v) => v.field === 10000)
    demand(signed.length === 1, 'CRX3 signed_header_data 非法')
    const ids = fields(signed[0].data).filter((v) => v.field === 1)
    demand(ids.length === 1 && ids[0].data.length === 16, 'CRX3 ID 非法')
    const declared = [...ids[0].data]
      .map((v) => String.fromCharCode(97 + (v >> 4), 97 + (v & 15)))
      .join('')
    const length = Buffer.alloc(4)
    length.writeUInt32LE(signed[0].data.length)
    archive = buffer.subarray(12 + size)
    signedPayload = Buffer.concat([
      Buffer.from('CRX3 SignedData\0'),
      length,
      signed[0].data,
      archive
    ])
    proofs = header.filter((v) => v.field === 2 || v.field === 3)
    for (const proof of proofs) {
      const parts = fields(proof.data)
      const keys = parts.filter((v) => v.field === 1),
        signatures = parts.filter((v) => v.field === 2)
      if (keys.length !== 1 || signatures.length !== 1) continue
      const key = keys[0].data
      if (extensionId(key) !== declared) continue
      if (verify('sha256', signedPayload, keyFromDer(key), signatures[0].data)) {
        publicKey = key
        break
      }
    }
    demand(publicKey, 'CRX3 发布者签名无效')
  } else throw new Error('不支持的 CRX 格式')
  const id = extensionId(publicKey)
  demand(!expectedId || expectedId === id, '扩展 ID 不匹配')
  const zip = new AdmZip(archive),
    entries = zip.getEntries()
  demand(entries.length > 0 && entries.length <= 10000, 'ZIP 条目数非法')
  let expanded = 0
  const paths = new Set()
  for (const entry of entries) {
    const name = entry.entryName
    demand(
      !name.includes('\\') &&
        !isAbsolute(name) &&
        !/^[A-Za-z]:/.test(name) &&
        !name.split('/').includes('..') &&
        !name.includes('\0'),
      'ZIP 路径逃逸'
    )
    const normalized = posix.normalize(name).replace(/\/$/, '').normalize('NFC').toLowerCase()
    demand(normalized !== '.' && !paths.has(normalized), 'ZIP 重复路径')
    paths.add(normalized)
    demand(((entry.header.attr >>> 16) & 0xf000) !== 0xa000, 'ZIP 符号链接拒绝')
    expanded += entry.header.size
    demand(expanded <= MAX_EXPANDED, 'ZIP 展开过大')
  }
  const manifestEntry = zip.getEntry('manifest.json')
  demand(manifestEntry, '缺少 manifest')
  demand(manifestEntry.header.size <= 2 * 1024 * 1024, '过大的 manifest')
  const manifest = JSON.parse(manifestEntry.getData().toString('utf8'))
  demand([2, 3].includes(manifest.manifest_version), 'manifest 版本不支持')
  demand(
    typeof manifest.name === 'string' &&
      typeof manifest.version === 'string' &&
      /^\d+(\.\d+){0,3}$/.test(manifest.version),
    'manifest 信息非法'
  )
  return {
    version,
    id,
    publicKey,
    manifest,
    zip,
    sha256: createHash('sha256').update(buffer).digest('hex')
  }
}
export async function extractCrx(buffer: Buffer, root: string, expectedId?: string) {
  const inspected = inspectCrx(buffer, expectedId)
  const destination = join(root, `${inspected.id}-${inspected.manifest.version}`)
  try {
    const existing = JSON.parse(await readFile(join(destination, '.package.json'), 'utf8'))
    demand(existing.sha256 === inspected.sha256, '同版本包内容冲突')
    return { ...existing, path: destination, duplicate: true }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const staging = join(root, `.staging-${randomUUID()}`)
  await mkdir(staging, { recursive: true })
  try {
    for (const entry of inspected.zip.getEntries()) {
      const target = join(staging, entry.entryName)
      if (entry.isDirectory) await mkdir(target, { recursive: true })
      else {
        await mkdir(join(target, '..'), { recursive: true })
        await writeFile(target, entry.getData(), { flag: 'wx' })
      }
    }
    // 保留原始下载包，只在解包副本补入公钥，稳定 Electron 的扩展 ID。
    const manifest = { ...inspected.manifest, key: inspected.publicKey.toString('base64') }
    await writeFile(join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2))
    const info = {
      id: inspected.id,
      version: manifest.version,
      crxVersion: inspected.version,
      sha256: inspected.sha256
    }
    await writeFile(join(staging, '.package.json'), JSON.stringify(info, null, 2))
    await rename(staging, destination)
    return { ...info, path: destination, duplicate: false }
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    throw error
  }
}
