/* eslint @typescript-eslint/explicit-function-return-type: off -- 构造失败与恢复边界验证 */
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
const directory = await mkdtemp(join(tmpdir(), 'msb-init-unit-'))
const runtimeFile = join(directory, 'runtime.mjs')
const probe = (globalThis.__msbInitProbe = {
  attempts: 0,
  prepared: 0,
  registered: 0,
  rollbacks: 0,
  wired: 0,
  sessions: new WeakSet()
})
const stubs = {
  'electron-chrome-extensions': `export class ElectronChromeExtensions {
    static toString(){return 'MSB_FILTERED_PRELOAD_REQUIRED'}
    static fromSession(session){return globalThis.__msbInitProbe.sessions.has(session)?{}:undefined}
    constructor({session}){const p=globalThis.__msbInitProbe;p.attempts++;if(p.sessions.has(session))throw Error('DEPENDENCY_SINGLETON_RETAINED');p.sessions.add(session);if(session.fail)throw session.failure;}
  }`,
  './preload-guard': `export async function prepareGuardedPreload(){globalThis.__msbInitProbe.prepared++;return '/guarded'}
    export function installGuardedPreload(session){const p=globalThis.__msbInitProbe;if(session.registrationFails){session.registrationFails=false;throw Error('REGISTER_FAILED')};p.registered++;session.scripts=2;return ()=>{p.rollbacks++;session.scripts=0;if(session.rollbackFails)throw Error('ROLLBACK_FAILED')}}`,
  '../shims': 'export function registerSessionShimIpc(){globalThis.__msbInitProbe.wired++}',
  '../install/crx': 'export function extensionIdFromPath(){return ""}',
  '../install/manifest-store': 'export function classifyInstall(){return "ready"}',
  '../install/partition-copy':
    'export function ensurePartitionExtensionCopy(){};export function partitionExtensionDir(){};export function partitionExtensionId(){}',
  './loader': 'export async function loadInstallsIntoSession(){return []}'
}
await build({
  entryPoints: ['src/main/extensions/runtime/index.ts'],
  outfile: runtimeFile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  plugins: [
    {
      name: 'runtime-faults',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, (args) =>
          Object.hasOwn(stubs, args.path) ? { path: args.path, namespace: 'mock' } : undefined
        )
        builder.onLoad({ filter: /.*/, namespace: 'mock' }, (args) => ({
          contents: stubs[args.path]
        }))
      }
    }
  ]
})
const runtimeModule = await import(pathToFileURL(runtimeFile).href)
const deps = { manifest: { read: async () => ({ installs: [] }) }, packagesRoot: '/unused' }
const target = (extra = {}) => ({ extensions: { getAllExtensions: () => [] }, ...extra })
const runtime = runtimeModule.createExtensionRuntime(deps)
const original = new Error('INJECTED_CONSTRUCTOR_FAILURE')
const failed = target({ fail: true, failure: original })
const results = await Promise.allSettled(
  Array.from({ length: 3 }, () => runtime.mountPartition('failed', failed))
)
assert.equal(probe.attempts, 1, '并发/重复请求不得再次进入半初始化的依赖构造器')
const failure = results[0].reason
assert(failure instanceof runtimeModule.ExtensionRuntimeRestartRequiredError)
assert.equal(failure.cause, original)
assert(results.every((r) => r.status === 'rejected' && r.reason === failure))
assert.equal(failed.scripts, 0)
assert.equal(runtime.getEngine('failed'), undefined)
const before = { ...probe }
await assert.rejects(
  runtimeModule.createExtensionRuntime(deps).mountPartition('new-factory', failed),
  (error) => error === failure
)
assert.equal(probe.prepared, before.prepared)
assert.equal(probe.registered, before.registered)
assert.equal(probe.attempts, before.attempts)
const healthy = target()
await runtime.mountPartition('healthy', healthy)
assert(runtime.getEngine('healthy'))
await assert.rejects(
  runtimeModule.createExtensionRuntime(deps).mountPartition('duplicate', healthy),
  /其他运行时/
)
await runtime.mountPartition('healthy', healthy)
assert(runtime.getEngine('healthy'), '工厂冲突不能把原有健康会话标成需要重启')
const raced = target({ fail: true, failure: original })
const attemptsBeforeRace = probe.attempts
const raceResults = await Promise.allSettled([
  runtimeModule.createExtensionRuntime(deps).mountPartition('race-a', raced),
  runtimeModule.createExtensionRuntime(deps).mountPartition('race-b', raced)
])
assert.equal(probe.attempts - attemptsBeforeRace, 1)
assert(
  raceResults.every(
    (result) => result.status === 'rejected' && result.reason === raceResults[0].reason
  )
)
const recoverable = target({ registrationFails: true })
await assert.rejects(runtime.mountPartition('recoverable', recoverable), /REGISTER_FAILED/)
await runtime.mountPartition('recoverable', recoverable)
assert(runtime.getEngine('recoverable'))
const rollbackFailed = target({ fail: true, failure: original, rollbackFails: true })
await assert.rejects(
  runtime.mountPartition('rollback', rollbackFailed),
  (error) =>
    error instanceof runtimeModule.ExtensionRuntimeRestartRequiredError && error.cause === original
)
await assert.rejects(
  runtime.mountPartition('rollback', rollbackFailed),
  (error) => error instanceof runtimeModule.ExtensionRuntimeRestartRequiredError
)
console.log(
  'INIT_PASS 构造失败封闭状态、原始原因、并发/新工厂拒绝、其他Session正常、注册失败可重试、回滚异常'
)

const feedbackFile = join(directory, 'feedback.mjs')
const feedback = (globalThis.__msbFeedbackProbe = {
  dialogs: [],
  async show(options) {
    this.dialogs.push(options)
    return new Promise(() => {})
  },
  runtime: {
    async mountPartition() {
      throw failure
    }
  }
})
const feedbackStubs = {
  electron: `export const app={getPath:()=>'/tmp/msb-init-feedback'};export const BrowserWindow={};export const clipboard={};export const ClipboardItem={};export const nativeImage={};export const dialog={showMessageBox:options=>globalThis.__msbFeedbackProbe.show(options)};`,
  './runtime': `export {ExtensionRuntimeRestartRequiredError} from ${JSON.stringify(pathToFileURL(runtimeFile).href)};export function createExtensionRuntime(){return globalThis.__msbFeedbackProbe.runtime}`,
  './install/manifest-store': 'export function createManifestStore(){return {}}',
  '../../shared/extensions/protocol': 'export const STAGED_IMAGE=Symbol()',
  '../i18n': 'export function t(key){return key}',
  './install/crx': 'export function extractCrx(){};export function extensionId(){}',
  './install/service': 'export function createInstallService(){}',
  './install/store': 'export function createStoreInstall(){}',
  './bridge': 'export function registerBridgeTarget(){}'
}
await build({
  entryPoints: ['src/main/extensions/dev-entry.ts'],
  outfile: feedbackFile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  external: [pathToFileURL(runtimeFile).href],
  plugins: [
    {
      name: 'native-feedback',
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, (args) =>
          Object.hasOwn(feedbackStubs, args.path)
            ? { path: args.path, namespace: 'mock' }
            : undefined
        )
        builder.onLoad({ filter: /.*/, namespace: 'mock' }, (args) => ({
          contents: feedbackStubs[args.path]
        }))
      }
    }
  ]
})
const { mountDevExtensions } = await import(pathToFileURL(feedbackFile).href)
const session = {}
const repeated = await Promise.all([
  mountDevExtensions(session, 'one'),
  mountDevExtensions(session, 'one')
])
assert(repeated.every((r) => r.error))
assert.equal(feedback.dialogs.length, 1, '原生框未关闭时也只显示一次且不阻塞挂载返回')
assert.equal(feedback.dialogs[0].type, 'error')
assert.equal(feedback.dialogs[0].message, 'dialogs.extensions.restartRequiredMessage')
feedback.show = async (options) => {
  feedback.dialogs.push(options)
  throw Error('DIALOG_FAILED')
}
await mountDevExtensions({}, 'other')
await new Promise((resolve) => setImmediate(resolve))
feedback.runtime.mountPartition = async () => {
  throw Error('REGISTER_FAILED')
}
await mountDevExtensions({}, 'recoverable')
assert.equal(feedback.dialogs.length, 2, '可恢复错误不应提示必须重启')
console.log('INIT_PASS 原生提示去重/不阻塞、提示失败处理、普通失败不误报需重启')
delete globalThis.__msbInitProbe
delete globalThis.__msbFeedbackProbe
