/* eslint @typescript-eslint/explicit-function-return-type: off -- 独立验证脚本使用原生 JavaScript */
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildReactFork, UPSTREAM_CRX_SHA256 } from './react-fork.mjs'
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const samples = JSON.parse(
  await readFile(new URL('./out/.artifacts/samples/samples.json', import.meta.url), 'utf8')
).samples
const original = samples.find((s) => s.name === 'react')
const originalMain = hash(await readFile(join(original.path, 'build/main.js')))
const scratch = await mkdtemp(join(tmpdir(), 'msb-fork-check-'))
try {
  const first = await buildReactFork(samples, scratch)
  const zipHash = hash(await readFile(first.zip))
  const second = await buildReactFork(samples, scratch)
  assert.equal(first.id, second.id)
  assert.notEqual(first.id, original.id)
  assert.equal(hash(await readFile(second.zip)), zipHash)
  const manifest = JSON.parse(await readFile(join(first.path, 'manifest.json'), 'utf8'))
  assert.equal(manifest.version, '8.0.0.1')
  assert.equal(manifest.update_url, undefined)
  assert(manifest.name.includes('MSB SVG Fix'))
  assert.equal(hash(await readFile(original.file)), UPSTREAM_CRX_SHA256)
  assert.equal(hash(await readFile(join(original.path, 'build/main.js'))), originalMain)
  await writeFile(join(first.path, 'build/background.js'), 'tampered')
  await assert.rejects(buildReactFork(samples, scratch), /被修改/)
  console.log(
    JSON.stringify({
      status: 'pass',
      checks: [
        '独立ID与名称/版本',
        'ZIP重复构建一致',
        '禁用原商店自动覆盖',
        '原始CRX与解包源码未改',
        '背景脚本缓存篡改拒绝'
      ]
    })
  )
} finally {
  await rm(scratch, { recursive: true, force: true })
}
