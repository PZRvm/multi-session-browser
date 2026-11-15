/* eslint @typescript-eslint/explicit-function-return-type: off -- 代理控制权与落盘失败回归 */
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rename, mkdir, rm, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
const dir = await mkdtemp(join(tmpdir(), 'msb-proxy-unit-'))
const fixtures = new Map(),
  calls = []
const extensionA = 'a'.repeat(32),
  extensionB = 'b'.repeat(32)
function target() {
  const extensions = new EventEmitter()
  extensions.getExtension = (id) =>
    [extensionA, extensionB].includes(id) ? { id, manifest: { permissions: ['proxy'] } } : undefined
  return {
    extensions,
    calls: [],
    async setProxy(config) {
      this.calls.push(config)
      if (this.fail) {
        this.fail = false
        throw Error('NATIVE_FAILED')
      }
      this.current = config
    },
    async closeAllConnections() {
      /* 不模拟连接池 */
    },
    webRequest: {
      onBeforeRequest(_filter, listener) {
        this.before = listener
      },
      onErrorOccurred() {
        /* 单元层无网络 */
      }
    },
    storagePath: '/unused'
  }
}
globalThis.__proxyUnit = {
  session: {
    fromPartition: (key) => {
      calls.push(key)
      if (!fixtures.has(key)) fixtures.set(key, target())
      return fixtures.get(key)
    }
  },
  net: {
    request: () => {
      const request = new EventEmitter()
      request.end = () =>
        queueMicrotask(() => {
          const response = new EventEmitter()
          response.statusCode = 200
          request.emit('response', response)
          response.emit('data', Buffer.from('203.0.113.8'))
          response.emit('end')
        })
      request.abort = () => {}
      return request
    }
  }
}
await build({
  entryPoints: ['src/main/browser/proxy.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: join(dir, 'proxy.mjs'),
  plugins: [
    {
      name: 'electron',
      setup(b) {
        b.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'mock' }))
        b.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({
          contents:
            'export const session=globalThis.__proxyUnit.session;export const net=globalThis.__proxyUnit.net'
        }))
      }
    }
  ]
})
const { createSessionProxyEngine } = await import(pathToFileURL(join(dir, 'proxy.mjs')).href)
const file = join(dir, 'state.json'),
  id = 'sess-test-1',
  other = 'sess-test-2'
const deps = {
  partitionFor: (id) => 'persist:' + id,
  idsProvider: () => [id, other],
  extensionProxyFile: file
}
const engine = createSessionProxyEngine(deps)
await engine.applySessionProxy(id, null)
const a = fixtures.get('persist:' + id)
const config = (port) => ({
  mode: 'fixed_servers',
  rules: { singleProxy: { scheme: 'http', host: '127.0.0.1', port } }
})
const get = (ext) => engine.extensionProxy(a, ext, 'get', {}, 0)
await engine.extensionProxy(a, extensionA, 'set', { value: config(8101) }, 1)
assert.equal((await get(extensionA)).levelOfControl, 'controlled_by_this_extension')
await engine.extensionProxy(a, extensionB, 'set', { value: config(8102) }, 2)
assert.equal((await get(extensionA)).levelOfControl, 'controlled_by_other_extensions')
assert.match(a.current.proxyRules, /8102/)
await engine.applySessionProxy(id, {
  protocol: 'http',
  host: '127.0.0.1',
  port: 8200,
  username: 'a',
  password: 'b'
})
assert.equal((await get(extensionB)).levelOfControl, 'not_controllable')
await engine.extensionProxy(a, extensionA, 'set', { value: config(8103) }, 1)
assert.match(a.current.proxyRules, /8200/)
await engine.applySessionProxy(id, null)
assert.match(a.current.proxyRules, /8102/)
assert.equal(engine.getCredentials(id), null)
await engine.removeExtensionProxy(a, extensionB)
assert.match(a.current.proxyRules, /8103/)
a.resolveProxy = async () => {
  const script = Buffer.from(a.current.pacScript.split(',')[1], 'base64').toString()
  return 'DIRECT; ' + script.match(/PROXY [0-9a-f-]+\.invalid:9/)[0]
}
await engine.extensionProxy(
  a,
  extensionA,
  'set',
  {
    value: {
      mode: 'pac_script',
      pacScript: { data: 'function FindProxyForURL(){return "DIRECT"}', mandatory: true }
    }
  },
  1
)
const errors = []
engine.onExtensionProxyError((_target, error) => errors.push(error))
a.resolveProxy = () => new Promise(() => {})
assert.equal(
  (await new Promise((r) => a.webRequest.before({ url: 'http://timeout.test/' }, r))).cancel,
  true
)
assert(errors.includes('ERR_PAC_TIMEOUT'))
await engine.extensionProxy(a, extensionA, 'set', { value: config(8103) }, 1)
assert.equal((await stat(file)).mode & 0o777, 0o600)
const before = await readFile(file, 'utf8')
for (const bad of [
  config(0),
  config(65536),
  { mode: 'fixed_servers', rules: { singleProxy: { host: 'a;b', port: 80 } } },
  { mode: 'pac_script', pacScript: { url: 'file:///etc/hosts' } },
  { mode: 'unknown' }
])
  await assert.rejects(engine.extensionProxy(a, extensionA, 'set', { value: bad }, 1))
await assert.rejects(
  engine.extensionProxy(
    a,
    extensionA,
    'set',
    { scope: 'incognito_persistent', value: config(8300) },
    1
  ),
  /SCOPE/
)
assert.equal(await readFile(file, 'utf8'), before)
a.fail = true
await assert.rejects(
  engine.extensionProxy(a, extensionA, 'set', { value: config(8300) }, 1),
  /NATIVE_FAILED/
)
assert.match(a.current.proxyRules, /8103/)
assert.equal(await readFile(file, 'utf8'), before)
await rename(file, file + '.old')
await mkdir(file)
await assert.rejects(engine.extensionProxy(a, extensionA, 'set', { value: config(8400) }, 1))
assert.match(a.current.proxyRules, /8103/)
await rm(file, { recursive: true })
await rename(file + '.old', file)
const probe = await engine.probeExitIpForId(id, {
  protocol: 'http',
  host: '127.0.0.1',
  port: 8500,
  username: '',
  password: ''
})
assert(probe.ok)
assert.match(a.current.proxyRules, /8103/)
await engine.applySessionProxy(other, null)
assert.equal(fixtures.get('persist:' + other).current.mode, 'direct')
// 以新 Session/引擎模拟进程重启，原扩展配置从文件恢复。
fixtures.set('persist:' + id, target())
const reopened = createSessionProxyEngine(deps)
await reopened.applySessionProxy(id, null)
assert.match(fixtures.get('persist:' + id).current.proxyRules, /8103/)
const cold = fixtures.get('persist:' + id)
const nativeLookup = cold.extensions.getExtension
cold.extensions.getExtension = () => undefined
assert.equal(
  await new Promise((r) => cold.webRequest.before({ url: 'http://example.test/' }, r)).then(
    (x) => x.cancel
  ),
  true,
  '持久控制扩展缺失时不能直连'
)
assert.equal(
  await new Promise((r) =>
    cold.webRequest.before({ url: 'chrome-extension://' + extensionA + '/background.js' }, r)
  ).then((x) => x.cancel),
  undefined,
  '插件自身资源不得被代理屏障拦截'
)
await assert.rejects(
  reopened.extensionProxy(cold, extensionA, 'set', { value: config(9000) }, 1),
  /PERMISSION/
)
cold.extensions.getExtension = nativeLookup
await reopened.forgetUnloadedExtensionProxies([extensionA])
assert(
  !JSON.parse(await readFile(file, 'utf8')).sessions[id]?.[extensionA],
  '全局卸载清除未加载会话持久记录'
)
await reopened.dropSession(id)
const count = calls.length
await assert.rejects(reopened.applySessionProxy(id, null), /RETIRED/)
await assert.rejects(
  reopened.probeExitIpForId(id, {
    protocol: 'http',
    host: '127.0.0.1',
    port: 80,
    username: '',
    password: ''
  }),
  /RETIRED/
)
assert.equal(calls.length, count, '退休后不得通过探测创建 Session')
await writeFile(file, 'bad-json')
const corrupt = createSessionProxyEngine(deps)
await assert.rejects(corrupt.applySessionProxy(id, null))
assert.equal(await readFile(file, 'utf8'), 'bad-json')
console.log(
  'PROXY_UNIT_PASS 控制权/手动优先/范围与配置边界/原生失败/落盘失败回滚/探测恢复/重启/删除/坏文件拒绝'
)
delete globalThis.__proxyUnit
