/* eslint @typescript-eslint/explicit-function-return-type: off -- 独立验证脚本使用原生 JavaScript，sandbox preload 使用 CommonJS */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash, generateKeyPairSync } from 'node:crypto'
import AdmZip from 'adm-zip'
import { extractCrx, inspectCrx, makeCrx2 } from './crx.mjs'

async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error(`下载失败 ${response.status}: ${url}`)
  const parts = []
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.length
    if (size > 32 * 1024 * 1024) throw new Error('下载超过32MB')
    parts.push(chunk)
  }
  return Buffer.concat(parts)
}
export const SAMPLE_IDS = {
  dark: 'eimadpbcbfnmbkopoojfekhnkhdbieeh',
  react: 'fmkadmapgofadopljbjfkapdkoienihi',
  cookie: 'hlkenndednhfkekhgcdicdfddnkalmdm'
}
export async function prepareSamples(root, chromeVersion) {
  await mkdir(root, { recursive: true })
  const index = join(root, 'samples.json')
  try {
    const previous = JSON.parse(await readFile(index, 'utf8'))
    for (const item of previous.samples) {
      const bytes = await readFile(item.file)
      if (createHash('sha256').update(bytes).digest('hex') !== item.sha256)
        throw new Error('固定样本哈希改变')
    }
    return previous
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const samples = []
  for (const [name, id] of Object.entries(SAMPLE_IDS)) {
    const url = new URL('https://clients2.google.com/service/update2/crx')
    url.searchParams.set('response', 'redirect')
    url.searchParams.set('acceptformat', 'crx3')
    url.searchParams.set('prodversion', chromeVersion)
    url.searchParams.set('x', `id=${id}&uc`)
    const buffer = await download(url)
    const file = join(root, `${name}.crx`)
    await writeFile(file, buffer)
    const extracted = await extractCrx(buffer, join(root, 'unpacked'), id)
    const manifest = inspectCrx(buffer).manifest
    samples.push({
      name,
      ...extracted,
      file,
      source: url.href,
      manifestVersion: manifest.manifest_version,
      minimumChromeVersion: manifest.minimum_chrome_version ?? null,
      permissions: manifest.permissions ?? [],
      background: manifest.background ?? null
    })
  }
  const legacySource =
    'https://raw.githubusercontent.com/chromium/chromium/main/chrome/test/data/extensions/legacy_crx_package.crx'
  const legacy = await download(legacySource),
    legacyFile = join(root, 'legacy-crx2.crx')
  await writeFile(legacyFile, legacy)
  let legacyResult = 'unexpected-success'
  try {
    inspectCrx(legacy)
  } catch (error) {
    legacyResult = error.message
  }
  samples.push({
    name: 'legacy-crx2',
    source: legacySource,
    file: legacyFile,
    sha256: createHash('sha256').update(legacy).digest('hex'),
    crxVersion: legacy.readUInt32LE(4),
    expectedRejection: legacyResult
  })
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const archive = new AdmZip()
  archive.addFile(
    'manifest.json',
    Buffer.from(
      JSON.stringify({
        manifest_version: 3,
        name: 'MSB 自有 CRX2 正向夹具',
        version: '1.0.0',
        action: { default_popup: 'page.html' }
      })
    )
  )
  archive.addFile(
    'page.html',
    Buffer.from(
      '<!doctype html><meta charset="utf-8"><title>自有CRX2夹具</title><p>仅验证旧包格式，不是市售插件</p>'
    )
  )
  const own = makeCrx2(archive.toBuffer(), publicKey, privateKey),
    ownFile = join(root, 'own-positive-crx2.crx')
  await writeFile(ownFile, own)
  samples.push({
    name: 'own-positive-crx2',
    source: 'self-generated-fixture-not-market-extension',
    file: ownFile,
    ...(await extractCrx(own, join(root, 'unpacked')))
  })
  const result = { createdAt: new Date().toISOString(), chromeVersion, samples }
  await writeFile(index, JSON.stringify(result, null, 2))
  return result
}
