/* eslint-disable @typescript-eslint/no-empty-function -- 更新准备跨模块回归 */
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const dir = mkdtempSync(join(tmpdir(), 'msb-r1-'))
globalThis.r1dir = dir
const mock = `import {EventEmitter} from 'node:events';export const app={getPath:()=>globalThis.r1dir};export const ipcMain={handle(){}};export const session={fromPartition:()=>({flushStorageData(){},cookies:{flushStore:async()=>{}}})};export const webContents={getAllWebContents:()=>[]};export const BrowserWindow={fromWebContents:()=>null};export class WebContentsView{constructor(){this.webContents=new EventEmitter();Object.assign(this.webContents,{id:1,isDestroyed:()=>false,loadURL:async()=>{},focus(){},stopFindInPage(){},close(){},setWindowOpenHandler(){},navigationHistory:{canGoBack:()=>false,canGoForward:()=>false}})}setBackgroundColor(){}setBounds(){}}
const unexpected=()=>{throw Error('R1 恢复集回归不应打开原生窗口或查询显示器')};export const screen={getDisplayMatching:unexpected};export const dialog={showMessageBox:unexpected};export class BaseWindow{constructor(){unexpected()}}`
try {
  const file = join(dir, 'test.cjs')
  await build({
    stdin: {
      contents: `export * from './src/main/browser/registry';export * from './src/main/updatePreparation'`,
      resolveDir: process.cwd()
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: file,
    plugins: [
      {
        name: 'r1',
        setup(b) {
          b.onResolve({ filter: /.*/ }, (a) => {
            if (
              ['electron', './permissions', '../extensions/dev-entry', '../i18n'].includes(a.path)
            )
              return { path: a.path, namespace: 'mock' }
          })
          b.onLoad({ filter: /.*/, namespace: 'mock' }, (a) => ({
            loader: 'js',
            contents:
              a.path === 'electron'
                ? mock
                : a.path === './permissions'
                  ? 'export const createCameraPermissionBroker=()=>({install(){},disposeSession(){}})'
                  : a.path === '../i18n'
                    ? 'export const t=x=>x'
                    : 'export const invalidateEngineTabUrl=()=>{};export const notifyEngineTab=()=>{}'
          }))
        }
      }
    ]
  })
  const api = createRequire(import.meta.url)(file)
  const urls = ['https://r1.test/one', 'https://r1.test/two']
  writeFileSync(
    join(dir, 'sessions.json'),
    JSON.stringify({
      version: 5,
      sessions: [
        {
          id: 'sess-test',
          name: 'B',
          note: '',
          pageTitle: 'two',
          lastUrl: urls[1],
          tabs: urls.map((url) => ({ url, title: url })),
          activeTabIndex: 1,
          workspaceId: null,
          proxy: null
        }
      ],
      activeId: null,
      workspaces: [],
      activeWorkspaceId: 'all'
    })
  )
  let release, entered
  const waiting = new Promise((r) => {
      entered = r
    }),
    blocked = new Promise((r) => {
      release = r
    })
  const registry = api.createSessionBrowserRegistry({
    getWindow: () => null,
    ensureMainWindow: () => null,
    windows: { listForSession: () => [], listAll: () => [] },
    onMergeSessionsChanged() {},
    getHomepageUrl: () => '',
    getFallbackBackground: () => '#fff',
    getResolvedTheme: () => 'light',
    proxy: { noteKnownIds() {}, applySessionProxy: async () => {} },
    prepareExtensions: async () => {
      entered()
      await blocked
    }
  })
  // 不预热恢复缓存，固定走空白占位页的异步补载路径。
  registry.switchSession('sess-test')
  await waiting
  let finishOther
  api.trackUpdateWork(
    new Promise((r) => {
      finishOther = r
    })
  )
  const preparing = api.beginUpdatePreparation()
  assert.throws(() => api.assertUpdateWritable())
  release()
  for (let i = 0; i < 30 && registry.getSnapshot().tabs.length !== 2; i++)
    await new Promise((r) => setImmediate(r))
  assert.equal(registry.getSnapshot().tabs.length, 2)
  registry.newTab('https://r1.test/blocked-during-drain')
  assert.equal(registry.getSnapshot().tabs.length, 2)
  assert.throws(() =>
    api.completeUpdateRestore(() => {
      throw Error('restore failed')
    })
  )
  registry.newTab('https://r1.test/no-leaked-permission')
  assert.equal(registry.getSnapshot().tabs.length, 2)
  finishOther()
  await preparing
  assert.throws(() => api.completeUpdateRestore(() => registry.newTab('https://r1.test/late')))
  await registry.prepareUpdate()
  const saved = JSON.parse(readFileSync(join(dir, 'sessions.json'), 'utf8')).sessions[0]
  assert.deepEqual(
    saved.tabs.map((t) => t.url),
    urls,
    'R1: 在途激活完成后不能把恢复集写成空数组'
  )
  assert.equal(saved.activeTabIndex, 1)
  const before = registry.getSnapshot().tabs.length
  registry.newTab('https://r1.test/external')
  assert.equal(registry.getSnapshot().tabs.length, before, '冻结后外部 newTab 必须被拒绝')
  api.resumeAfterUpdate()
  registry.resumeUpdate()
  await registry.flushPendingReports()
  registry.dispose()
  console.log('通过 R1 真实 registry / manager / persistence / store 交错及激活位回归')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
