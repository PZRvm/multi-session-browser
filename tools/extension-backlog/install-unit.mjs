/* eslint @typescript-eslint/explicit-function-return-type: off -- 卸载失败清单与固定顺序回归 */
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, mkdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
const root = await mkdtemp(join(tmpdir(), 'msb-uninstall-'))
await build({
  entryPoints: ['src/main/extensions/install/service.ts'],
  outfile: join(root, 'service.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  plugins: [
    {
      name: 'crx',
      setup(b) {
        b.onResolve({ filter: /^\.\/crx$/ }, () => ({ path: 'crx', namespace: 'mock' }))
        b.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({
          contents: 'export function extractCrx(){throw Error("UNUSED")}'
        }))
      }
    }
  ]
})
const { createInstallService } = await import(pathToFileURL(join(root, 'service.mjs')).href)
const id = 'a'.repeat(32),
  other = 'b'.repeat(32),
  record = { id, version: '1.0', source: { kind: 'crx' }, generation: 1 }
let value = { version: 1, generation: 2, installs: [record], pins: [other, id] },
  fail = true
const manifest = {
  get: async (id) => value.installs.find((r) => r.id === id),
  read: async () => structuredClone(value),
  update: async (fn) => {
    value = await fn(value)
    return value
  },
  removeInstall: async (id) => {
    value.installs = value.installs.filter((r) => r.id !== id)
    value.pins = value.pins.filter((r) => r !== id)
    return true
  }
}
await mkdir(join(root, id + '-1.0'))
await mkdir(join(root, id + '.partitions'))
const service = createInstallService({
  manifest,
  packagesRoot: root,
  onRemove: async (received, original) => {
    assert.equal(received, id)
    assert.equal(original, record)
    assert(!value.installs.some((r) => r.id === id), '运行时回调仍能拿到已从清单移除的原记录')
    if (fail) throw Error('NATIVE_UNLOAD_FAILED')
  }
})
await assert.rejects(service.uninstall(id), /NATIVE_UNLOAD_FAILED/)
assert(value.installs.some((r) => r === record))
assert.deepEqual(value.pins, [other, id])
assert((await stat(join(root, id + '-1.0'))).isDirectory())
fail = false
assert(await service.uninstall(id))
assert(!value.installs.length)
await assert.rejects(stat(join(root, id + '-1.0')))
assert.equal(await service.uninstall(id), false)
console.log(
  'UNINSTALL_UNIT_PASS 原记录传入运行时、失败恢复安装记录与pins、成功清文件、重复卸载幂等'
)
