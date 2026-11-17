/* eslint @typescript-eslint/explicit-function-return-type: off -- 商店网页桥定向回归 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { EventEmitter } from 'node:events'
import { transform } from 'esbuild'

async function load(path, imports) {
  const code = (await transform(await readFile(path, 'utf8'), { loader: 'ts', format: 'cjs' })).code
  const module = { exports: {} }
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require: (name) => {
      assert.ok(name in imports, name)
      return imports[name]
    },
    URL,
    __dirname: '/app/out/main'
  })
  return module.exports
}
const shared = await load('src/shared/extensions/storePage.ts', {})
const { THEME_SYSTEMS } = await load('src/shared/themeSystems.ts', {})
let theme = THEME_SYSTEMS.amber.light
const id = 'eimadpbcbfnmbkopoojfekhnkhdbieeh'
const url = `https://chromewebstore.google.com/detail/dark-reader/${id}`
assert.equal(shared.storeDetailId(url), id)
assert.equal(shared.storeDetailId(url + '?hl=zh-CN'), id)
for (const value of [
  url.replace('https:', 'http:'),
  url.replace('.com/', '.com.evil/'),
  url.replace('.com/', '.com:9443/'),
  url.replace('https://', 'https://x@'),
  'about:blank',
  url.replace(id, 'A'.repeat(32)),
  'https://chromewebstore.google.com/search/test'
])
  assert.equal(shared.storeDetailId(value), null)
const handlers = new Map()
const dialogs = []
let response = 0,
  retired = false,
  preparing = false,
  installed = false,
  calls = 0,
  fail = false
let onDialog = () => {}
const bridge = await load('src/main/extensions/store-page.ts', {
  '../../../resources/icon.png?asset': '/project/icon.png',
  electron: {
    nativeImage: { createFromPath: (path) => ({ path }) },
    ipcMain: { handle: (key, fn) => handlers.set(key, fn) },
    dialog: {
      showMessageBox: async (...args) => {
        dialogs.push(args)
        onDialog()
        return { response }
      }
    }
  },
  'node:path': { join: (...parts) => parts.join('/') },
  '../../shared/extensions/storePage': shared,
  '../i18n': { t: (key) => key },
  '../updatePreparation': { isUpdatePreparing: () => preparing },
  './runtime/lifecycle': {
    assertExtensionSessionLive: () => {
      if (retired) throw Error('retired')
    }
  },
  '../dialogs': { dialogIconForDarwin: () => undefined }
})
const wc = new EventEmitter()
Object.assign(wc, {
  session: {},
  isDestroyed: () => false,
  mainFrame: { url, isDestroyed: () => false },
  getURL: () => wc.mainFrame.url
})
const win = { isDestroyed: () => false }
bridge.attachStorePageTarget(wc, () => win)
bridge.registerStorePageIpc({
  theme: () => theme,
  installed: async () => installed,
  installing: () => false,
  install: async (_id, approve) => {
    calls++
    if (!(await approve())) throw Error('STORE_CONFIRM_DENIED')
    if (fail) throw Error('download')
    installed = true
  }
})
const event = { sender: wc, senderFrame: wc.mainFrame }
const status = () => handlers.get(shared.STORE_PAGE_CHANNELS.status)(event, id)
const install = () => handlers.get(shared.STORE_PAGE_CHANNELS.install)(event, id)
assert.equal((await status()).installed, false)
assert.equal((await status()).theme.accent, THEME_SYSTEMS.amber.light.accent)
assert.equal(Object.keys((await status()).theme).length, 6)
theme = THEME_SYSTEMS.mist.dark
assert.equal((await status()).theme.accent, THEME_SYSTEMS.mist.dark.accent)
assert.equal(
  await handlers.get(shared.STORE_PAGE_CHANNELS.status)({ ...event, senderFrame: { url } }, id),
  null
)
wc.mainFrame.url = url.replace('.com/', '.com.evil/')
assert.equal(await install(), false)
wc.mainFrame.url = url
retired = true
assert.equal(await install(), false)
retired = false
preparing = true
assert.equal(await status(), null)
preparing = false
assert.equal(await install(), false)
assert.equal(dialogs.length, 1, '取消后不弹错误')
assert.equal(installed, false)
response = 1
onDialog = () => wc.emit('did-start-navigation', {}, url, true, true)
assert.equal(await install(), false, '确认期间导航必须撤销')
assert.equal(installed, false)
onDialog = () => {}
fail = true
assert.equal(await install(), false)
assert.equal(dialogs.at(-1).at(-1).type, 'error')
fail = false
assert.equal(await install(), true)
assert.equal(dialogs.at(-1).at(-1).icon.path, '/project/icon.png')
assert.equal((await status()).installed, true)
const prior = calls
assert.equal(await install(), true)
assert.equal(calls, prior, '已安装不重复安装')
wc.emit('destroyed')
assert.equal(await status(), null)
const registrations = []
const session = { registerPreloadScript: (value) => registrations.push(value) }
bridge.prepareStorePageSession(session)
bridge.prepareStorePageSession(session)
assert.equal(registrations.length, 1)
assert.deepEqual(Array.from(registrations[0].includeGlobs), ['https://chromewebstore.google.com/*'])
console.log(
  'PASS: URL边界、主frame授权、退休/更新拒绝、取消、确认时导航、失败反馈、成功/已安装与受限注册'
)

const locks = await load('src/main/extensions/install/mutex.ts', {})
const lock = locks.createKeyedLock()
let count = 0
let release
const pending = new Promise((resolve) => {
  release = resolve
})
const one = lock('same', async () => {
  count++
  await pending
  return 42
})
const two = lock('same', async () => {
  count++
  return 1
})
release()
assert.equal(await one, 42)
assert.equal(await two, 42)
assert.equal(count, 1)
assert.equal(await lock('same', async () => 7), 7)
console.log('PASS: 同ID单飞共享结果，落定后可重试')
