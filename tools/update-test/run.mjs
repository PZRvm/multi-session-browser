/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-empty-function -- Node 定向验证及无副作用替身 */
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import {
  renderAppcast,
  validateSigningKeys,
  validateAppcast
} from '../../scripts/sparkle-appcast.mjs'
import { validateUpdateAssets, prepareUpdateAssets } from '../../scripts/update-assets.mjs'
import { runMacTests } from './mac.mjs'
const require = createRequire(import.meta.url)
const temp = mkdtempSync(join(tmpdir(), 'msb-update-tests-'))
let count = 0
async function module(file, mocks = {}, define = {}) {
  const path = join(temp, `${count++}.cjs`)
  await build({
    entryPoints: [file],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: path,
    define: {
      ...(file === 'src/main/updates.ts' ? { 'process.platform': '"win32"' } : {}),
      ...define
    },
    plugins: [
      {
        name: 'test-deps',
        setup(b) {
          b.onResolve({ filter: /.*/ }, (args) => {
            if (Object.hasOwn(mocks, args.path)) return { path: args.path, namespace: 'test' }
          })
          b.onLoad({ filter: /.*/, namespace: 'test' }, (args) => ({
            contents: mocks[args.path],
            loader: 'js'
          }))
        }
      }
    ]
  })
  return require(path)
}
let checks = 0
async function test(name, run) {
  await run()
  checks++
  console.log(`通过 ${name}`)
}
const deferred = () => {
  let resolve
  const promise = new Promise((r) => {
    resolve = r
  })
  return { promise, resolve }
}
const tick = () => new Promise((r) => setImmediate(r))
try {
  const { createUpdateController } = await module('src/main/updateController.ts')
  const { createUpdateTestContext } = await module('src/main/updateTestContext.ts')
  await test('测试更新重启单次恢复同一目录，旧版本和其他应用路径不能消费', async () => {
    const launch = { userData: join(temp, 'isolated'), agentDebug: true, debugPort: '0' }
    const opts = {
      enabled: true,
      appData: join(temp, 'handoff'),
      executable: '/test/old.app/Contents/MacOS/test',
      currentVersion: '90.0.1'
    }
    const old = createUpdateTestContext(opts)
    assert.equal(old.restore(), null)
    old.prepare('90.0.2', launch)
    assert.equal(old.restore(), null)
    assert.equal(
      createUpdateTestContext({
        ...opts,
        executable: '/other/app',
        currentVersion: '90.0.2'
      }).restore(),
      null
    )
    const updated = createUpdateTestContext({ ...opts, currentVersion: '90.0.2' })
    const fs = await import('node:fs')
    const directory = join(opts.appData, 'multi-session-browser-update-test-handoff')
    if (process.platform !== 'win32') {
      fs.chmodSync(directory, 0o755)
      assert.equal(updated.restore(), null)
      assert.throws(() => old.prepare('90.0.2', launch))
      fs.chmodSync(directory, 0o700)
    }
    assert.deepEqual(updated.restore(), launch)
    assert.equal(updated.restore(), null)
    old.prepare('90.0.2', { ...launch, agentDebug: false })
    assert.deepEqual(updated.restore(), { ...launch, agentDebug: false })
    old.prepare('90.0.2', launch)
    old.clear()
    assert.equal(updated.restore(), null)
  })
  await test('正式构建零交接文件，记录过期和不安全路径拒绝', async () => {
    const fs = await import('node:fs')
    const appData = join(temp, 'disabled-context'),
      launch = { userData: join(temp, 'isolated'), agentDebug: false, debugPort: '9222' }
    const opts = { enabled: false, appData, executable: '/test/app', currentVersion: '90.0.2' }
    const disabled = createUpdateTestContext(opts)
    disabled.prepare('90.0.2', launch)
    disabled.clear()
    assert.equal(disabled.restore(), null)
    assert.equal(fs.existsSync(appData), false)
    const enabled = {
      ...opts,
      enabled: true,
      appData: join(temp, 'expired-context'),
      now: () => 1000
    }
    createUpdateTestContext(enabled).prepare('90.0.2', launch)
    assert.equal(createUpdateTestContext({ ...enabled, now: () => 1801001 }).restore(), null)
    assert.throws(() =>
      createUpdateTestContext(enabled).prepare('90.0.2', { ...launch, userData: 'relative' })
    )
    if (process.platform !== 'win32') {
      const linkRoot = join(temp, 'linked-context')
      fs.mkdirSync(linkRoot)
      fs.symlinkSync(
        join(enabled.appData, 'multi-session-browser-update-test-handoff'),
        join(linkRoot, 'multi-session-browser-update-test-handoff'),
        'dir'
      )
      const original = fs.readdirSync(
        join(enabled.appData, 'multi-session-browser-update-test-handoff')
      )
      const linked = createUpdateTestContext({ ...enabled, appData: linkRoot })
      assert.equal(linked.restore(), null)
      linked.clear()
      assert.deepEqual(
        fs.readdirSync(join(enabled.appData, 'multi-session-browser-update-test-handoff')),
        original
      )
      assert.throws(() =>
        createUpdateTestContext({ ...enabled, appData: linkRoot }).prepare('90.0.2', launch)
      )
    }
  })

  function fixture(overrides = {}) {
    const calls = { check: 0, download: 0, install: 0, confirm: 0, prepare: 0, resume: 0 }
    const changes = []
    const deps = {
      version: '1.1.1',
      policy: { showHeaderEntry: true, showSettingsEntry: true },
      enabled: true,
      engine: {
        async check() {
          calls.check++
        },
        async download() {
          calls.download++
        },
        install() {
          calls.install++
        }
      },
      publish(s) {
        changes.push(s)
      },
      async confirm() {
        calls.confirm++
        return true
      },
      busy() {
        return false
      },
      async prepare() {
        calls.prepare++
      },
      resume() {
        calls.resume++
      },
      beforeInstall() {},
      ...overrides
    }
    return { c: createUpdateController(deps), calls, changes, deps }
  }
  await test('四种策略组合，双隐藏零引擎调用', async () => {
    for (const header of [false, true])
      for (const settings of [false, true]) {
        const f = fixture({ policy: { showHeaderEntry: header, showSettingsEntry: settings } })
        await f.c.check()
        await f.c.download()
        await f.c.install()
        assert.equal(f.calls.check, header || settings ? 1 : 0)
        if (!header && !settings) assert.equal(f.c.getState().status, 'disabled')
      }
  })
  await test('开发态零请求', async () => {
    const f = fixture({ enabled: false })
    await f.c.check()
    assert.equal(f.calls.check, 0)
    assert.equal(f.c.getState().error, 'development')
  })
  await test('并发检查单飞，快照单调且不能被外部修改', async () => {
    const d = deferred()
    const f = fixture()
    f.deps.engine.check = async () => {
      f.calls.check++
      await d.promise
      f.c.available('1.1.2')
    }
    const a = f.c.check(),
      b = f.c.check()
    assert.equal(a, b)
    d.resolve()
    await a
    assert.equal(f.calls.check, 1)
    const s = f.c.getState()
    s.policy.showHeaderEntry = false
    assert.equal(f.c.getState().policy.showHeaderEntry, true)
    assert.ok(f.changes.every((s, i) => i === 0 || s.revision > f.changes[i - 1].revision))
  })
  await test('下载版本固定；就绪后检查不替换候选', async () => {
    const f = fixture()
    f.c.available('1.1.2')
    f.deps.engine.download = async () => {
      f.calls.download++
      f.c.downloaded('1.1.2')
    }
    await Promise.all([f.c.download(), f.c.download()])
    await f.c.check()
    assert.equal(f.calls.download, 1)
    assert.equal(f.calls.check, 0)
    await f.c.install()
    assert.equal(f.calls.install, 1)
  })
  await test('取消确认和录屏忙碌都不保存或安装', async () => {
    for (const overrides of [{ confirm: async () => false }, { busy: () => true }]) {
      const f = fixture(overrides)
      f.c.downloaded('1.1.2')
      await f.c.install()
      assert.equal(f.calls.install, 0)
      assert.equal(f.calls.prepare, 0)
    }
  })
  await test('严格保存失败恢复且可重试', async () => {
    const f = fixture({
      prepare: async () => {
        throw Error('disk')
      }
    })
    f.c.downloaded('1.1.2')
    await f.c.install()
    assert.equal(f.calls.install, 0)
    assert.equal(f.calls.resume, 1)
    f.deps.prepare = async () => {}
    await f.c.install()
    assert.equal(f.calls.install, 1)
  })
  await test('保存超时保持锁，落定后恢复且零安装', async () => {
    const d = deferred()
    const f = fixture({ prepare: () => d.promise, prepareTimeout: 5 })
    f.c.downloaded('1.1.2')
    const a = f.c.install()
    await new Promise((r) => setTimeout(r, 15))
    assert.equal(f.c.getState().status, 'preparing')
    assert.equal(f.calls.resume, 0)
    assert.equal(f.c.install(), a)
    d.resolve()
    await a
    assert.equal(f.calls.install, 0)
    assert.equal(f.calls.resume, 1)
    assert.equal(f.c.getState().error, 'save')
  })
  await test('安装同步和异步交接错误恢复', async () => {
    const f = fixture()
    f.c.downloaded('1.1.2')
    f.deps.engine.install = () => {
      throw Error('install')
    }
    await f.c.install()
    assert.equal(f.calls.resume, 1)
    assert.equal(f.c.getState().error, 'install')
    f.deps.engine.install = () => {}
    await f.c.install()
    f.c.engineError()
    assert.equal(f.calls.resume, 2)
  })
  await test('保存期间已下载版本失效时零安装', async () => {
    const f = fixture()
    f.c.downloaded('1.1.2')
    f.deps.prepare = async () => {
      f.c.engineError()
    }
    await f.c.install()
    assert.equal(f.calls.install, 0)
    assert.equal(f.calls.resume, 1)
  })
  await test('错误不是已最新，失败可重试', async () => {
    const f = fixture()
    f.deps.engine.check = async () => {
      throw Error('network')
    }
    await f.c.check()
    assert.equal(f.c.getState().error, 'check')
    f.deps.engine.check = async () => f.c.latest()
    await f.c.check()
    assert.equal(f.c.getState().status, 'up-to-date')
  })
  globalThis.updateTest = { handlers: new Map() }
  const electronMock = `export const ipcMain={handle:(channel,fn)=>globalThis.updateTest.handlers.set(channel,fn)};export const app={getPath:()=>${JSON.stringify(temp)}}`
  const gate = await module('src/main/updatePreparation.ts', {
    electron: electronMock,
    './i18n': 'export const t = x=>x'
  })
  await test('在途命令排空，准备期新命令拒绝，恢复后可执行', async () => {
    const d = deferred()
    gate.handleUpdateMutation('write', async () => d.promise)
    const write = globalThis.updateTest.handlers.get('write')({})
    await tick()
    let settled = false
    const prep = gate.beginUpdatePreparation().then(() => {
      settled = true
    })
    await tick()
    assert.equal(settled, false)
    assert.throws(() => globalThis.updateTest.handlers.get('write')({}))
    d.resolve()
    await write
    await prep
    gate.resumeAfterUpdate()
    await globalThis.updateTest.handlers.get('write')({})
  })
  // 真实 store + atomicWriteJson，注入 app 路径与文件系统写失败，不复写保存算法。
  const storePath = join(temp, 'sessions.json')
  const snapshot = {
    version: 5,
    sessions: [
      {
        id: 'sess-test',
        name: '测试',
        note: '',
        pageTitle: '',
        lastUrl: '',
        tabs: [],
        activeTabIndex: 0,
        workspaceId: null,
        proxy: null
      }
    ],
    activeId: 'sess-test',
    workspaces: [],
    activeWorkspaceId: 'all'
  }
  writeFileSync(storePath, JSON.stringify(snapshot))
  const persistence = await module('src/main/browser/persistence.ts', { electron: electronMock })
  let view = {
    windowId: 'main',
    sessionId: 'sess-test',
    tabs: [{ id: 't1', url: 'https://example.test/a', title: 'A' }],
    activeTabId: 't1',
    htmlFullscreen: false,
    devtoolsOpen: false
  }
  const p = persistence.createSessionPersistence({
    hasManager: () => true,
    listSessionSnapshots: () => [
      view,
      {
        ...view,
        windowId: 'independent',
        tabs: [{ id: 't2', url: 'https://example.test/b', title: 'B' }]
      }
    ]
  })
  await test('无待写 timer 仍保存全部存活窗归并恢复集', async () => {
    await p.prepareUpdate(['sess-test'])
    const saved = JSON.parse(readFileSync(storePath))
    assert.deepEqual(
      saved.sessions[0].tabs.map((x) => x.url),
      ['https://example.test/a', 'https://example.test/b']
    )
    p.resumeUpdate([])
  })
  await test('真实写盘故障严格上抛；恢复后导航仍落盘', async () => {
    rmSync(storePath)
    mkdirSync(storePath)
    await assert.rejects(p.prepareUpdate(['sess-test']))
    rmSync(storePath, { recursive: true })
    writeFileSync(storePath, JSON.stringify(snapshot))
    p.resumeUpdate(['sess-test'])
    view = { ...view, tabs: [{ id: 't1', url: 'https://example.test/new', title: 'New' }] }
    p.recordSnapshot('sess-test')
    await new Promise((r) => setTimeout(r, 650))
    assert.equal(
      JSON.parse(readFileSync(storePath)).sessions[0].tabs[0].url,
      'https://example.test/new'
    )
  })
  const history = await module('src/main/browser/history.ts', { '../i18n': 'export const t=x=>x' })
  const h = history.createBrowserHistory({ historyDir: () => join(temp, 'history') })
  await test('历史严格写盘、暂停事实重放与失败恢复', async () => {
    h.recordVisit('sess-test', {
      kind: 'visit',
      url: 'https://history.test',
      title: '',
      faviconUrl: null
    })
    await tick()
    await h.prepareUpdate()
    h.recordVisit('sess-test', {
      kind: 'visit',
      url: 'https://history.test/held',
      title: '',
      faviconUrl: null
    })
    h.resumeUpdate()
    await tick()
    await h.prepareUpdate()
    assert.equal(JSON.parse(readFileSync(join(temp, 'history/sess-test.json'))).entries.length, 2)
    rmSync(join(temp, 'history/sess-test.json'))
    mkdirSync(join(temp, 'history/sess-test.json'))
    await assert.rejects(h.prepareUpdate())
    rmSync(join(temp, 'history/sess-test.json'), { recursive: true })
    h.resumeUpdate()
    await h.prepareUpdate()
    assert.equal(JSON.parse(readFileSync(join(temp, 'history/sess-test.json'))).entries.length, 2)
  })
  const name = 'multi-session-browser',
    version = '1.1.1'
  const artifact = join(temp, 'artifacts'),
    out = join(temp, 'merged')
  const { dump, load } = require('js-yaml')
  const pair = generateKeyPairSync('ed25519')
  process.env.SPARKLE_PUBLIC_ED_KEY = pair.publicKey
    .export({ type: 'spki', format: 'der' })
    .subarray(-32)
    .toString('base64')
  process.env.SPARKLE_PRIVATE_KEY = pair.privateKey
    .export({ type: 'pkcs8', format: 'der' })
    .subarray(-32)
    .toString('base64')
  for (const [platform, arch] of [
    ['mac', 'arm64'],
    ['mac', 'x64'],
    ['win', 'x64']
  ]) {
    const dir = join(artifact, `installer-${platform}-${arch}`)
    mkdirSync(dir, { recursive: true })
    const file = `${name}-${version}-${platform}-${arch}${platform === 'win' ? '-setup.exe' : '.zip'}`
    const data = Buffer.from(file)
    writeFileSync(join(dir, file), data)
    if (platform === 'mac') {
      writeFileSync(join(dir, `${name}-${version}-mac-${arch}.dmg`), 'DMG')
      writeFileSync(join(dir, `release-notes-v${version}.md`), '本次测试更新')
      writeFileSync(
        join(dir, `appcast-${arch}.xml`),
        renderAppcast({
          name,
          version,
          arch,
          length: data.length,
          signature: sign(null, data, pair.privateKey).toString('base64'),
          date: new Date().toUTCString()
        })
      )
    } else {
      const sha512 = createHash('sha512').update(data).digest('base64')
      writeFileSync(
        join(dir, 'latest.yml'),
        dump({
          version,
          releaseNotes: '本次测试更新',
          files: [{ url: file, sha512, size: data.length }],
          path: file,
          sha512
        })
      )
    }
  }
  await test('独立 Mac feed 验签后合并，精确附件通过', async () => {
    prepareUpdateAssets(artifact, out, name, version)
    assert.equal(validateUpdateAssets(out, name, version).length, 9)
  })
  await test('平台日志缺失、不一致及偏离版本正文均拒绝', async () => {
    const winFile = join(out, 'latest.yml'),
      original = readFileSync(winFile, 'utf8'),
      win = load(original)
    for (const releaseNotes of [undefined, '另一份说明']) {
      writeFileSync(winFile, dump({ ...win, releaseNotes }))
      assert.throws(() => validateUpdateAssets(out, name, version))
    }
    writeFileSync(winFile, original)
    assert.throws(() => validateUpdateAssets(out, name, version, '正文被更改'))
    const armFile = join(artifact, `installer-mac-arm64/release-notes-v${version}.md`),
      armOriginal = readFileSync(armFile)
    writeFileSync(armFile, '另一份说明')
    assert.throws(() => prepareUpdateAssets(artifact, join(temp, 'notes-mismatch'), name, version))
    writeFileSync(armFile, armOriginal)
  })
  await test('错公钥、私钥不匹配、feed 注入和架构/版本/URL 混淆拒绝', async () => {
    validateSigningKeys()
    const originalKey = process.env.SPARKLE_PUBLIC_ED_KEY
    delete process.env.SPARKLE_PUBLIC_ED_KEY
    assert.throws(() => validateSigningKeys())
    process.env.SPARKLE_PUBLIC_ED_KEY = Buffer.alloc(32).toString('base64')
    assert.throws(() => validateSigningKeys())
    assert.throws(() => validateUpdateAssets(out, name, version))
    process.env.SPARKLE_PUBLIC_ED_KEY = originalKey
    const file = join(out, 'appcast-arm64.xml'),
      text = readFileSync(file, 'utf8')
    for (const bad of [
      text.replace('releases/download', 'evil/download'),
      text.replace('mac-arm64', 'mac-x64'),
      text.replace('<sparkle:version>1.1.1', '<sparkle:version>1.1.2'),
      text.replace('</channel>', '<item />\n</channel>'),
      text.replace('<rss', '<!DOCTYPE x [<!ENTITY a SYSTEM "file:///etc/passwd">]><rss')
    ]) {
      writeFileSync(file, bad)
      assert.throws(() => validateAppcast(out, name, version, 'arm64'))
    }
    writeFileSync(file, text)
  })
  await test('篡改更新包、缺架构、额外附件被拒绝', async () => {
    const file = join(out, `${name}-${version}-mac-arm64.zip`),
      original = readFileSync(file)
    writeFileSync(file, 'bad')
    assert.throws(() => validateUpdateAssets(out, name, version))
    writeFileSync(file, original)
    writeFileSync(join(out, 'extra.txt'), 'extra')
    assert.throws(() => validateUpdateAssets(out, name, version))
    rmSync(join(out, 'extra.txt'))
    rmSync(file)
    assert.throws(() => validateUpdateAssets(out, name, version))
  })
  await test('真实 IPC 注册拒绝网页、子 frame、销毁窗和额外参数', async () => {
    const { EventEmitter } = await import('node:events')
    const updater = new EventEmitter()
    let checks = 0
    updater.checkForUpdates = async () => {
      checks++
      updater.emit('update-not-available', {})
    }
    updater.downloadUpdate = async () => {}
    updater.quitAndInstall = () => {}
    const sender = { mainFrame: {}, send() {} }
    let destroyed = false
    const win = { webContents: sender, isDestroyed: () => destroyed }
    globalThis.updateTest = { handlers: new Map(), updater, native: new EventEmitter() }
    const { registerUpdates } = await module('src/main/updates.ts', {
      electron: `export const app={isPackaged:true,getVersion:()=>"1.1.1"};export const BrowserWindow={};export const dialog={showMessageBox:async()=>({response:0})};export const autoUpdater=globalThis.updateTest.native;export const ipcMain={handle:(c,f)=>globalThis.updateTest.handlers.set(c,f)}`,
      'electron-updater': 'exports.autoUpdater=globalThis.updateTest.updater',
      './updatePolicy': 'export const updatePolicy={showHeaderEntry:true,showSettingsEntry:true}',
      './i18n': 'export const t=x=>x',
      './dialogs': 'export const dialogIconForDarwin=()=>undefined'
    })
    registerUpdates({ windows: () => [win], busy: () => false, save: async () => {}, resume() {} })
    await tick()
    await tick()
    assert.equal(checks, 1)
    const get = globalThis.updateTest.handlers.get('updates:get-state'),
      check = globalThis.updateTest.handlers.get('updates:check')
    const event = { sender, senderFrame: sender.mainFrame }
    assert.equal(get(event).currentVersion, '1.1.1')
    assert.throws(() => get({ ...event, sender: { mainFrame: {} } }))
    assert.throws(() => get({ ...event, senderFrame: {} }))
    await assert.rejects(check(event, 'https://evil.test'))
    destroyed = true
    assert.throws(() => get(event))
    assert.equal(checks, 1)
    assert.equal(updater.autoDownload, false)
    assert.equal(updater.autoInstallOnAppQuit, false)
  })
  await test('下载成功自动原生确认：稍后、重启、并发、失败及窗口销毁边界', async () => {
    const { EventEmitter } = await import('node:events')
    for (const mode of [
      'later',
      'accept',
      'concurrent',
      'failed',
      'mismatch',
      'stale',
      'closed',
      'closed-busy',
      'no-window'
    ]) {
      const updater = new EventEmitter()
      const native = new EventEmitter()
      const dialogs = []
      const timers = new Map()
      const transfer = deferred()
      const confirmation = deferred()
      let alive = true,
        downloads = 0,
        installs = 0,
        saves = 0,
        resumes = 0
      let answer = mode === 'accept' || mode === 'closed-busy' ? 1 : 0
      const sender = { mainFrame: {}, send() {} }
      const fallbackSender = { mainFrame: {}, send() {} }
      const owner = { webContents: sender, isDestroyed: () => !alive }
      const fallback = { webContents: fallbackSender, isDestroyed: () => mode === 'no-window' }
      updater.checkForUpdates = async () => updater.emit('update-available', { version: '1.1.2' })
      updater.downloadUpdate = async () => {
        downloads++
        await transfer.promise
        if (mode === 'failed') throw Error('offline')
        updater.emit('update-downloaded', { version: mode === 'mismatch' ? '1.1.3' : '1.1.2' })
        if (mode === 'stale') updater.emit('update-not-available')
      }
      updater.quitAndInstall = () => installs++
      globalThis.updatePromptTest = {
        updater,
        native,
        handlers: new Map(),
        showMessageBox: async (win, options) => {
          dialogs.push({ win, ...options })
          if (options.type === 'question' && mode === 'concurrent') return confirmation.promise
          return { response: options.type === 'question' ? answer : 0 }
        },
        setTimeout: (run, delay) => {
          const token = {}
          timers.set(token, { run, delay })
          return token
        },
        clearTimeout: (token) => timers.delete(token)
      }
      const { registerUpdates } = await module(
        'src/main/updates.ts',
        {
          electron: `export const app={isPackaged:true,getVersion:()=>"1.1.1"};export const BrowserWindow={};export const dialog={showMessageBox:globalThis.updatePromptTest.showMessageBox};export const autoUpdater=globalThis.updatePromptTest.native;export const ipcMain={handle:(c,f)=>globalThis.updatePromptTest.handlers.set(c,f)}`,
          'electron-updater': 'exports.autoUpdater=globalThis.updatePromptTest.updater',
          './updatePolicy':
            'export const updatePolicy={showHeaderEntry:true,showSettingsEntry:true}',
          './i18n': 'export const t=x=>x',
          './dialogs': 'export const dialogIconForDarwin=()=>"project-logo"'
        },
        {
          setTimeout: 'globalThis.updatePromptTest.setTimeout',
          clearTimeout: 'globalThis.updatePromptTest.clearTimeout'
        }
      )
      registerUpdates({
        windows: () => [owner, fallback],
        busy: () => mode === 'closed-busy',
        save: async () => {
          saves++
        },
        resume: () => resumes++,
        showDetails: async () => ({ status: 'update-action', version: '1.1.2', action: 'download' })
      })
      await tick()
      const invoke = (channel, from = sender) =>
        globalThis.updatePromptTest.handlers.get(channel)({
          sender: from,
          senderFrame: from.mainFrame
        })
      const pending = invoke(mode === 'later' ? 'updates:show-details' : 'updates:download')
      const second = mode === 'concurrent' ? invoke('updates:download') : null
      await tick()
      assert.equal(dialogs.length, 0, '下载尚未完成时不得弹重启确认')
      if (mode.startsWith('closed') || mode === 'no-window') alive = false
      transfer.resolve()
      await tick()
      const questions = () => dialogs.filter((d) => d.type === 'question')
      if (mode === 'concurrent') {
        assert.equal(questions().length, 1)
        await invoke('updates:install')
        assert.equal(questions().length, 1, '自动确认期间手动安装不能叠框')
        assert.equal(installs, 0)
        confirmation.resolve({ response: 0 })
      }
      await pending
      if (second) await second
      assert.equal(downloads, 1)
      const expected = ['failed', 'mismatch', 'stale', 'no-window'].includes(mode) ? 0 : 1
      assert.equal(questions().length, expected, mode)
      if (expected) {
        assert.deepEqual(questions()[0].buttons, ['updates.later', 'updates.restart'])
        assert.equal(questions()[0].defaultId, 0)
        assert.equal(questions()[0].cancelId, 0)
        assert.equal(questions()[0].icon, 'project-logo')
        assert.equal(questions()[0].win, mode.startsWith('closed') ? fallback : owner)
      }
      assert.equal(installs, mode === 'accept' ? 1 : 0)
      assert.equal(saves, mode === 'accept' ? 1 : 0)
      if (mode === 'accept') {
        assert.equal((await invoke('updates:get-state')).status, 'installing')
        updater.emit('error', Error('Code signature did not pass validation'))
        await tick()
        assert.equal((await invoke('updates:get-state')).error, 'signature')
        assert.equal(dialogs.filter((d) => d.type === 'info').length, 1)
        assert.equal(resumes, 1)
        assert.equal(timers.size, 0)
      } else if (mode === 'later') {
        updater.emit('update-downloaded', { version: '1.1.2' })
        const ready = await invoke('updates:download')
        assert.equal(ready.status, 'ready')
        assert.equal(ready.downloadedVersion, '1.1.2')
        assert.equal(questions().length, 1, '重复事件及已缓存包不再次自动提示')
        answer = 1
        await invoke('updates:install')
        assert.equal(questions().length, 2, '稍后仍可手动确认安装')
        assert.equal(installs, 1)
      } else if (mode === 'failed') {
        assert.equal((await invoke('updates:get-state')).error, 'download')
        assert.equal(dialogs.filter((d) => d.type === 'info').length, 1)
      } else if (mode === 'closed-busy') {
        const state = await invoke('updates:get-state', fallbackSender)
        assert.equal(state.error, 'recording')
        const failure = dialogs.filter((d) => d.type === 'info')
        assert.equal(failure.length, 1, '回退窗口同样应收到无法安装的说明')
        assert.equal(failure[0].win, fallback)
      }
    }
  })
  await test('安装晚到验签错误、同步失败和交接超时各提示一次并恢复，销毁窗安全回退', async () => {
    const { EventEmitter } = await import('node:events')
    for (const mode of ['signature', 'sync', 'timeout', 'destroyed']) {
      const updater = new EventEmitter()
      const native = new EventEmitter()
      const dialogs = []
      const timers = new Map()
      let resumes = 0
      let destroyed = false
      let questions = 0
      const sender = { mainFrame: {}, send() {} }
      const fallbackSender = { mainFrame: {}, send() {} }
      const owner = { webContents: sender, isDestroyed: () => destroyed }
      const fallback = { webContents: fallbackSender, isDestroyed: () => false }
      updater.checkForUpdates = async () => updater.emit('update-available', { version: '1.1.2' })
      updater.downloadUpdate = async () => updater.emit('update-downloaded', { version: '1.1.2' })
      updater.quitAndInstall = () => {
        if (mode === 'sync') updater.emit('error', Error('handoff'))
      }
      globalThis.updateFeedbackTest = {
        updater,
        native,
        handlers: new Map(),
        showMessageBox: async (win, options) => {
          dialogs.push({ win, ...options })
          // 下载后先选稍后，再独立验证既有手动安装的晚到失败路径。
          return { response: options.type === 'question' && ++questions > 1 ? 1 : 0 }
        },
        setTimeout: (run, delay) => {
          const token = {}
          timers.set(token, { run, delay })
          return token
        },
        clearTimeout: (token) => timers.delete(token)
      }
      const { registerUpdates } = await module(
        'src/main/updates.ts',
        {
          electron: `export const app={isPackaged:true,getVersion:()=>"1.1.1"};export const BrowserWindow={};export const dialog={showMessageBox:globalThis.updateFeedbackTest.showMessageBox};export const autoUpdater=globalThis.updateFeedbackTest.native;export const ipcMain={handle:(c,f)=>globalThis.updateFeedbackTest.handlers.set(c,f)}`,
          'electron-updater': 'exports.autoUpdater=globalThis.updateFeedbackTest.updater',
          './updatePolicy':
            'export const updatePolicy={showHeaderEntry:true,showSettingsEntry:true}',
          './i18n': 'export const t=x=>x',
          './dialogs': 'export const dialogIconForDarwin=()=>undefined'
        },
        {
          setTimeout: 'globalThis.updateFeedbackTest.setTimeout',
          clearTimeout: 'globalThis.updateFeedbackTest.clearTimeout'
        }
      )
      registerUpdates({
        windows: () => [owner, fallback],
        busy: () => false,
        save: async () => {},
        resume: () => resumes++,
        showDetails: async () => ({ status: 'cancelled' })
      })
      await tick()
      const invoke = (channel, event = { sender, senderFrame: sender.mainFrame }) =>
        globalThis.updateFeedbackTest.handlers.get(channel)(event)
      await invoke('updates:download')
      await invoke('updates:install')
      if (mode === 'signature') {
        assert.equal(dialogs.filter((d) => d.type === 'info').length, 0)
        updater.emit(
          'error',
          Object.assign(Error('Code signature did not pass validation'), {
            domain: 'SQRLCodeSignatureErrorDomain'
          })
        )
      } else if (mode !== 'sync') {
        if (mode === 'destroyed') destroyed = true
        const timeout = [...timers.values()].find((t) => t.delay === 60000)
        assert.ok(timeout)
        timeout.run()
      }
      await tick()
      const state = await invoke('updates:get-state', {
        sender: fallbackSender,
        senderFrame: fallbackSender.mainFrame
      })
      assert.equal(state.status, 'error')
      assert.equal(
        state.error,
        mode === 'signature' ? 'signature' : mode === 'sync' ? 'install' : 'installTimeout'
      )
      const feedback = dialogs.filter((d) => d.type === 'info')
      assert.equal(feedback.length, 1)
      assert.equal(feedback[0].message, `updates.errors.${state.error}`)
      assert.equal(feedback[0].win, mode === 'destroyed' ? fallback : owner)
      assert.equal(resumes, 1)
      assert.equal(native.listenerCount('update-downloaded'), 0)
      assert.equal(timers.size, 0)
    }
  })
  await test('正式 EdDSA 配置缺材料失败，免费签名配置符合 builder schema', async () => {
    const { spawnSync } = await import('node:child_process')
    const env = { ...process.env }
    delete env.SPARKLE_PUBLIC_ED_KEY
    delete env.SPARKLE_PRIVATE_KEY
    const r = spawnSync(
      process.execPath,
      ['-e', "require('./scripts/electron-builder-release.cjs')"],
      { env, encoding: 'utf8' }
    )
    if (process.platform === 'darwin') {
      assert.notEqual(r.status, 0)
      assert.match(r.stderr, /SPARKLE_PUBLIC_ED_KEY/)
    }
    const { validateConfiguration } = require('app-builder-lib/out/util/config/config')
    const config = require('js-yaml').load(readFileSync('electron-builder.yml', 'utf8'))
    await validateConfiguration(config, { add() {}, debug() {}, warn() {} })
  })
  await test('更新日志字符串、版本数组、HTML、空值和长度边界', async () => {
    const { normalizeUpdateNotes, normalizeUpdateDate } = await module(
      'src/main/updateReleaseNotes.ts'
    )
    assert.equal(
      normalizeUpdateNotes(
        [
          { version: '1.1.2', note: '本次' },
          { version: '1.1.1', note: '旧版' }
        ],
        '1.1.2'
      ),
      '本次'
    )
    assert.equal(normalizeUpdateNotes([{ version: '1.1.1', note: '旧版' }], '1.1.2'), '')
    assert.equal(normalizeUpdateNotes(null, '1.1.2'), '')
    assert.equal(normalizeUpdateNotes('<p>变化</p><script>alert(1)</script>', '1.1.2'), '变化')
    assert.equal(normalizeUpdateNotes('x'.repeat(30000), '1.1.2').length, 12000)
    assert.equal(normalizeUpdateDate('bad'), null)
    assert.equal(normalizeUpdateDate('2026-11-14T00:00:00Z'), '2026-11-14T00:00:00.000Z')
  })
  await test('原生日志窗口关闭零下载，下载意图版本复核，禁用策略无弹窗', async () => {
    const { EventEmitter } = await import('node:events')
    let ownerAlive = true,
      downloads = 0,
      shown = 0,
      next = { status: 'cancelled' }
    const updater = new EventEmitter()
    updater.checkForUpdates = async () =>
      updater.emit('update-available', {
        version: '1.1.2',
        releaseNotes: '## 本次\n- 改进',
        releaseDate: '2026-11-14'
      })
    updater.downloadUpdate = async () => {
      downloads++
      updater.emit('update-downloaded', { version: '1.1.2' })
    }
    updater.quitAndInstall = () => {}
    const sender = { mainFrame: {}, send() {} }
    const owner = { webContents: sender, isDestroyed: () => !ownerAlive }
    const event = { sender, senderFrame: sender.mainFrame }
    globalThis.updateTest = { handlers: new Map(), updater, native: new EventEmitter() }
    const mocks = {
      electron: `export const app={isPackaged:true,getVersion:()=>'1.1.1'};export const BrowserWindow={};export const autoUpdater=globalThis.updateTest.native;export const dialog={showMessageBox:async()=>({response:0})};export const ipcMain={handle:(c,f)=>globalThis.updateTest.handlers.set(c,f)}`,
      'electron-updater': 'exports.autoUpdater=globalThis.updateTest.updater',
      './updatePolicy': 'export const updatePolicy={showHeaderEntry:true,showSettingsEntry:true}',
      './i18n': 'export const t=x=>x',
      './dialogs': 'export const dialogIconForDarwin=()=>undefined'
    }
    const { registerUpdates } = await module('src/main/updates.ts', mocks)
    registerUpdates({
      windows: () => [owner],
      busy: () => false,
      save: async () => {},
      resume() {},
      showDetails: async (_owner, state) => {
        shown++
        assert.equal(state.releaseNotes, '## 本次\n- 改进')
        return next
      }
    })
    await tick()
    await tick()
    const details = globalThis.updateTest.handlers.get('updates:show-details')
    await assert.rejects(details({ ...event, senderFrame: {} }))
    await assert.rejects(details(event, 'path'))
    await details(event)
    assert.equal(downloads, 0)
    next = { status: 'update-action', version: '1.1.1', action: 'download' }
    await details(event)
    assert.equal(downloads, 0)
    next = { status: 'update-action', version: '1.1.2', action: 'download' }
    await details(event)
    assert.equal(downloads, 1)
    ownerAlive = false
    await assert.rejects(details(event))
    assert.equal(shown, 3)
    globalThis.updateTest.handlers = new Map()
    const hidden = await module('src/main/updates.ts', {
      ...mocks,
      './updatePolicy': 'export const updatePolicy={showHeaderEntry:false,showSettingsEntry:false}'
    })
    ownerAlive = true
    hidden.registerUpdates({
      windows: () => [owner],
      busy: () => false,
      save: async () => {},
      resume() {},
      showDetails: async () => {
        throw Error('不应开窗')
      }
    })
    const state = await globalThis.updateTest.handlers.get('updates:show-details')(event)
    assert.equal(state.status, 'disabled')
  })
  await test('版本Markdown唯一、缺失/重复/超长拒绝，正文不带frontmatter', async () => {
    const { readVersionReleaseNotes } = require('../../scripts/release-notes.cjs')
    const root = join(temp, 'notes-root')
    mkdirSync(join(root, 'book/changelogs/2026-11'), { recursive: true })
    const file = join(root, 'book/changelogs/2026-11/release-notes-v1.1.2.md')
    assert.throws(() => readVersionReleaseNotes('1.1.2', root))
    writeFileSync(file, '---\ndescription: test\n---\n## 变化\n- 一项更新\n')
    assert.equal(readVersionReleaseNotes('1.1.2', root), '## 变化\n- 一项更新')
    mkdirSync(join(root, 'book/changelogs/2026-10'))
    const duplicate = join(root, 'book/changelogs/2026-10/release-notes-v1.1.2.md')
    writeFileSync(duplicate, '重复')
    assert.throws(() => readVersionReleaseNotes('1.1.2', root))
    rmSync(duplicate)
    writeFileSync(file, 'x'.repeat(12001))
    assert.throws(() => readVersionReleaseNotes('1.1.2', root))
  })
  await test('原生sheet仅信任本窗顶层frame，迟到版本拒绝，关闭返回取消', async () => {
    globalThis.updateWindowTest = { handlers: new Map(), windows: [] }
    const api = await module('src/main/workspacePickerWindow.ts', {
      electron: `import {EventEmitter} from 'node:events';
      export class BrowserWindow extends EventEmitter {
        constructor(options){super();this.options=options;this.dead=false;this.webContents={mainFrame:{}};globalThis.updateWindowTest.windows.push(this)}
        isDestroyed(){return this.dead}
        loadFile(){return Promise.resolve()}
        loadURL(){return Promise.resolve()}
        getContentSize(){return [480,420]}
        setContentSize(){}
        show(){}
        close(){this.dead=true;this.emit('closed')}
      }
      export const ipcMain={handle:(c,f)=>globalThis.updateWindowTest.handlers.set(c,f)}`,
      '@electron-toolkit/utils': 'export const is={dev:false}',
      './browser/chromeImport':
        'export const AVAILABLE_IMPORT_SCOPES=[];export const chromeDetector={};export const peekStagedScopes=()=>null',
      './appearance': "export const getAppearanceBackgroundColor=()=> '#ffffff'",
      './inputGuard': 'export const installShellInputGuard=()=>{}',
      './i18n': "export const t=x=>x;export const getCurrentLanguage=()=> 'zh-CN'",
      './store': 'export const loadSnapshot=async()=>({sessions:[],workspaces:[]})',
      './ipc-utils': 'export const logFailureAsync=async(_c,_p,run)=>run()'
    })
    const parent = { isDestroyed: () => false }
    const deps = {
      getMainWindow: () => parent,
      getResolvedTheme: () => 'light',
      getThemeColor: () => 'amber'
    }
    api.registerWorkspacePickerIpc(deps)
    const state = fixture().c.getState()
    state.candidateVersion = '1.1.2'
    state.status = 'available'
    state.releaseNotes = '本次变更'
    let result = api.showUpdateDetailsWindow(parent, state, deps)
    let win = globalThis.updateWindowTest.windows.at(-1)
    assert.equal(win.options.parent, parent)
    assert.equal(win.options.modal, true)
    assert.equal(win.options.width, 480)
    // 通道名以共享契约为准，防止测试给自己造一套名称。
    const shared = await module('src/shared/dialog.ts')
    const payloadFn = globalThis.updateWindowTest.handlers.get(
      shared.DIALOG_CHANNELS.workspacePickerPayload
    )
    const pickFn = globalThis.updateWindowTest.handlers.get(
      shared.DIALOG_CHANNELS.workspacePickerPick
    )
    assert.ok(payloadFn && pickFn)
    const event = { sender: win.webContents, senderFrame: win.webContents.mainFrame }
    assert.equal(payloadFn({ sender: {}, senderFrame: {} }), null)
    assert.equal(payloadFn({ ...event, senderFrame: {} }), null)
    let context = payloadFn(event)
    assert.equal(context.updateDetails.releaseNotes, '本次变更')
    assert.throws(() =>
      pickFn(
        { ...event, senderFrame: {} },
        { requestId: context.requestId, updateVersion: '1.1.2', updateAction: 'download' }
      )
    )
    assert.throws(() =>
      pickFn(event, {
        requestId: context.requestId,
        updateVersion: '1.1.1',
        updateAction: 'download'
      })
    )
    win.close()
    assert.equal((await result).status, 'cancelled')
    result = api.showUpdateDetailsWindow(parent, state, deps)
    win = globalThis.updateWindowTest.windows.at(-1)
    const current = { sender: win.webContents, senderFrame: win.webContents.mainFrame }
    context = payloadFn(current)
    pickFn(current, {
      requestId: context.requestId,
      updateVersion: '1.1.2',
      updateAction: 'download'
    })
    assert.deepEqual(await result, {
      status: 'update-action',
      version: '1.1.2',
      action: 'download'
    })
    assert.ok(win.dead)
  })
  await runMacTests(module, test)
  console.log(`全部 ${checks} 组定向验证通过`)
} finally {
  rmSync(temp, { recursive: true, force: true })
}
