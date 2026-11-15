/* eslint @typescript-eslint/explicit-function-return-type: off -- 历史规范修复的定向回归 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { build, transform } from 'esbuild'

async function bundle(entry, plugins = []) {
  const r = await build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    plugins
  })
  const module = { exports: {} }
  new Function('module', 'exports', r.outputFiles[0].text)(module, module.exports)
  return module.exports
}
const { createIpcGuards, summarize, logFailureAsync } = await bundle('src/main/ipc-utils.ts')
let language = '中文'
const guards = createIpcGuards(() => language)
assert.equal(guards.optionalString(undefined), undefined)
assert.equal(guards.optionalString(''), '')
for (const value of [null, 1, [], {}]) assert.throws(() => guards.optionalString(value), /中文/)
language = 'English'
assert.throws(() => guards.optionalString(false), /English/)
assert.equal(createIpcGuards('固定').invalidParams().message, '固定')
for (const value of [null, [], 'x', { x: -1, y: 0, width: 1, height: 1 }]) {
  assert.throws(() => guards.parseRect(value))
}
assert.deepEqual(guards.parseRect({ x: 0, y: 0, width: 0, height: 0 }), {
  x: 0,
  y: 0,
  width: 0,
  height: 0
})
for (const value of [NaN, Infinity, '1', undefined])
  assert.throws(() => guards.requiredNumber(value))
assert.equal(summarize('x'.repeat(300)), '"' + 'x'.repeat(199) + '...(截断，总长 302)')
assert.equal(summarize(undefined), 'undefined')
const circular = {}
circular.self = circular
assert.equal(summarize(circular), '[object Object]')
const failure = new Error('失败')
const warnings = []
const warn = console.warn
console.warn = (s) => warnings.push(s)
try {
  assert.equal(await logFailureAsync('create', {}, async () => 7, 'sessions'), 7)
  await assert.rejects(
    logFailureAsync(
      'create',
      {},
      async () => {
        throw failure
      },
      'sessions'
    ),
    (error) => error === failure
  )
  await assert.rejects(
    logFailureAsync(
      'create',
      {},
      () => {
        throw failure
      },
      'sessions'
    ),
    (error) => error === failure
  )
} finally {
  console.warn = warn
}
assert.deepEqual(warnings, Array(2).fill('[sessions] create 失败: 失败 payload={}'))

// 格式化工具的编译结果须与本轮基线完全相同，防止格式调整夹带执行逻辑变化。
for (const file of [
  'check-host-install.mjs',
  'check-host-runtime.mjs',
  'electron-main.cjs',
  'host-smoke/main.cjs',
  'host-smoke/run.mjs'
]) {
  const path = `tools/extension-preflight/${file}`
  const before = execFileSync('git', ['show', `3f70a30:${path}`], { encoding: 'utf8' })
  const after = await readFile(path, 'utf8')
  const options = { minify: true, target: 'es2022', legalComments: 'none' }
  assert.equal(
    (await transform(after, options)).code,
    (await transform(before, options)).code,
    path
  )
}

// 指示器的直订阅、边界位置、去重与卸载清理；沿用真实hook代码，只替换React和store宿主。
const state = { listener: null, cleanup: null, unsubscribed: false }
globalThis.issueAudit = state
const plugin = {
  name: 'indicator-host',
  setup(b) {
    b.onResolve({ filter: /^(react|\.\.\/\.\.\/stores\/browser)$/ }, (a) => ({
      path: a.path,
      namespace: 'audit'
    }))
    b.onLoad({ filter: /.*/, namespace: 'audit' }, (a) => ({
      contents:
        a.path === 'react'
          ? 'export function useEffect(fn){globalThis.issueAudit.cleanup=fn()}'
          : `export const windowIdentity={windowId:'main'};export const useBrowserStore={subscribe(fn){globalThis.issueAudit.listener=fn;return()=>{globalThis.issueAudit.unsubscribed=true}}}`
    }))
  }
}
const { useTabInsertIndicator } = await bundle(
  'src/renderer/src/components/browser/useTabInsertIndicator.ts',
  [plugin]
)
const calls = []
globalThis.window = { api: { browser: { dragInsert: async (p) => calls.push(p) } } }
const indicator = { hidden: true, style: {} }
let tabs = [
  { left: 10, right: 50, width: 40 },
  { left: 54, right: 94, width: 40 }
]
const container = {
  querySelectorAll: () => tabs.map((r) => ({ getBoundingClientRect: () => r })),
  getBoundingClientRect: () => ({ left: 10 })
}
useTabInsertIndicator({ current: container }, { current: indicator })
const hover = (x, prev = {}) =>
  state.listener(
    {
      hoverWindowId: 'main',
      dragCursorX: x,
      dragHoverTabId: 'tab-1'
    },
    prev
  )
hover(0)
assert.deepEqual(calls.at(-1), { tabId: 'tab-1', index: 0 })
assert.equal(indicator.style.left, '-2px')
hover(52)
assert.equal(indicator.style.left, '42px')
hover(100)
assert.deepEqual(calls.at(-1), { tabId: 'tab-1', index: 2 })
const count = calls.length
hover(100)
assert.equal(calls.length, count)
state.listener({ hoverWindowId: null, dragCursorX: null, dragHoverTabId: null }, {})
assert.equal(indicator.hidden, true)
tabs = []
hover(0)
assert.equal(calls.length, count)
state.cleanup()
assert.equal(state.unsubscribed, true)
assert.equal(indicator.hidden, true)
delete globalThis.window
delete globalThis.issueAudit
console.log('ISSUE_AUDIT_PASS 动态语言/IPC坏参/摘要与异步异常/五工具编译等价/指示器位置与清理')
