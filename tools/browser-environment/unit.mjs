/* eslint @typescript-eslint/explicit-function-return-type: off -- Node 验证脚本 */
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'

const directory = await mkdtemp(join(tmpdir(), 'msb-env-unit-'))
const output = join(directory, 'userAgent.mjs')
await build({
  entryPoints: ['src/main/browser/userAgent.ts'],
  outfile: output,
  bundle: true,
  platform: 'node',
  format: 'esm'
})
const { buildDefaultUserAgent } = await import(pathToFileURL(output).href)
for (const platform of [
  'Macintosh; Intel Mac OS X 10_15_7',
  'Windows NT 10.0; Win64; x64',
  'X11; Linux x86_64'
]) {
  for (const product of ['多会话浏览器', 'MultiSessionBrowser', 'multi-session-browser']) {
    const prefix = `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko)`
    const original = `${prefix} ${product}/1.1.0 Chrome/156.0.8078.96 Electron/45.3.0 Safari/537.36`
    assert.equal(
      buildDefaultUserAgent(original, '156.0.8078.96'),
      `${prefix} Chrome/156.0.0.0 Safari/537.36`
    )
    assert.equal(
      buildDefaultUserAgent(buildDefaultUserAgent(original, '156.0.8078.96'), '157.1.2.3'),
      `${prefix} Chrome/157.0.0.0 Safari/537.36`
    )
  }
}
for (const ua of [
  '',
  'broken',
  'Mozilla/5.0 (平台) AppleWebKit/537.36 (KHTML, like Gecko) x',
  'Mozilla/5.0 (X11\r\nBad: 1) AppleWebKit/537.36 (KHTML, like Gecko) x'
]) {
  assert.throws(() => buildDefaultUserAgent(ua, '156.0.1.2'))
}
const original =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36'
for (const version of ['', '0.1.2.3', '156', '156.1.2.3\n', '99999999999999999.0.0.0'])
  assert.throws(() => buildDefaultUserAgent(original, version))
const { patchSource } = await import('../../scripts/patch-extension-preloads.mjs')
for (const kind of ['cjs/index.js', 'esm/index.mjs']) {
  const source = await readFile(`node_modules/electron-chrome-extensions/dist/${kind}`, 'utf8')
  const patched = patchSource(source)
  assert.equal(patchSource(patched), patched, '补丁须幂等')
  assert(patched.includes('MSB_FILTERED_PRELOAD_REQUIRED'))
  assert(!patched.includes('this.prependPreload(opts.modulePath);'))
  assert.throws(() => patchSource(source.replace('checkVersion();', 'changed();')), /锚点|补丁/)
}
console.log('ENV_UNIT_PASS UA 三平台/三个产品名、升级/幂等、非法输入；双入口补丁锚点/幂等')
const guardOutput = join(directory, 'guard.mjs')
await build({
  entryPoints: ['src/main/extensions/runtime/preload-guard.ts'],
  outfile: guardOutput,
  bundle: true,
  platform: 'node',
  format: 'esm',
  plugins: [
    {
      name: 'isolated-guard-deps',
      setup(builder) {
        builder.onResolve({ filter: /^electron$|^\.\.\/shims$/ }, (args) => ({
          path: args.path,
          namespace: 'stub'
        }))
        builder.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({
          contents:
            args.path === 'electron'
              ? 'export const app = {}'
              : 'export const EXT_SHIM_CAPTURE_TAB="capture", EXT_SHIM_CONTEXTS="contexts", EXT_SHIM_DOWNLOAD="download", EXT_SHIM_OFFSCREEN_CREATE="offscreen", EXT_SHIM_TAB_STREAM="stream"'
        }))
      }
    }
  ]
})
const { installGuardedPreload } = await import(pathToFileURL(guardOutput).href)
const rows = new Map()
let fail = true
const fake = {
  getPreloadScripts: () => [...rows.values()],
  registerPreloadScript: (script) => {
    if (fail && script.type === 'service-worker') throw new Error('injected-register-failure')
    rows.set(script.id, script)
  },
  unregisterPreloadScript: (id) => rows.delete(id)
}
rows.set('unrelated', { id: 'unrelated', type: 'frame', filePath: '/other' })
assert.throws(() => installGuardedPreload(fake, '/guarded'), /injected-register-failure/)
assert.deepEqual([...rows.keys()], ['unrelated'], '失败回滚不能残留半注册或删除其他脚本')
fail = false
installGuardedPreload(fake, '/guarded')
installGuardedPreload(fake, '/guarded')
assert.equal(rows.size, 3)
assert.throws(() => installGuardedPreload(fake, '/unexpected'), /预期不符/)
installGuardedPreload(fake, '/guarded')
rows.get('crx-mv3-preload').includeGlobs.push('https://*/*')
assert.throws(() => installGuardedPreload(fake, '/guarded'), /预期不符/)
assert.deepEqual([...rows.keys()], ['unrelated'], '拒绝未知过滤约束后不得留下本库的宽泛注册')
console.log('ENV_UNIT_PASS 注册失败回滚、其他脚本保留、幂等重试、路径及过滤约束拒绝')
