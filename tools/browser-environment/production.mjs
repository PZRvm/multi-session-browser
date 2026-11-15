/* eslint @typescript-eslint/explicit-function-return-type: off -- 隔离生产应用验收 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { app, BrowserWindow, session } = require('electron')
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function wait(read, message) {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    const value = await read()
    if (value) return value
    await delay(100)
  }
  throw new Error(message)
}
const snapshot = `({ua:navigator.userAgent,brands:navigator.userAgentData?.brands,platform:navigator.userAgentData?.platform,process:typeof globalThis.process,require:typeof globalThis.require,electron:typeof globalThis.electron,shim:typeof globalThis.__msbShimBridge})`
const clean = (value) => {
  for (const key of ['process', 'require', 'electron', 'shim'])
    assert.equal(value[key], 'undefined', key)
}
export async function run({ registry, mainWindow, getExtensionsHandle, extractCrx }) {
  const directory = app.getPath('userData')
  assert(directory.startsWith('/tmp/msb-env-'), '仅允许独立诊断目录')
  const restart = process.env.MSB_BROWSER_ENV_RESTART === '1'
  const checks = [],
    requests = [],
    errors = [],
    registrations = []
  const output = join(directory, restart ? 'restart.json' : 'first.json')
  const watchdog = setTimeout(() => {
    console.error('BROWSER_ENV_TIMEOUT')
    app.exit(2)
  }, 120000)
  watchdog.unref()
  await mkdir(join(directory, 'downloads'), { recursive: true })
  app.setPath('downloads', join(directory, 'downloads'))
  const report = async () =>
    writeFile(
      output,
      JSON.stringify(
        {
          checks,
          requests,
          errors,
          registrations,
          versions: process.versions,
          ua: app.userAgentFallback,
          name: app.name,
          restart
        },
        null,
        2
      )
    )
  async function check(name, fn) {
    try {
      const detail = await fn()
      checks.push({ name, ok: true, detail })
      console.log('ENV_PASS', name)
    } catch (error) {
      checks.push({ name, ok: false, error: String(error) })
      console.error('ENV_FAIL', name, error)
    }
    await report()
  }
  await check('未受限注册的库构造被源头拒绝', () => {
    const { ElectronChromeExtensions } = require('electron-chrome-extensions')
    const isolated = session.fromPartition('environment-no-host')
    assert.throws(
      () => new ElectronChromeExtensions({ session: isolated }),
      /MSB_FILTERED_PRELOAD_REQUIRED/
    )
    assert.equal(ElectronChromeExtensions.fromSession(isolated), undefined)
    assert.deepEqual(isolated.getPreloadScripts(), [])
    return { rejectedBeforeSideEffects: true }
  })
  app.on('session-created', (target) => {
    const original = target.registerPreloadScript.bind(target)
    target.registerPreloadScript = (script) => {
      if (script.id?.startsWith('crx-')) {
        assert.deepEqual(script.includeGlobs, ['chrome-extension://*/*'])
        registrations.push({ event: 'first-register', ...script })
      }
      return original(script)
    }
  })
  const server = createServer((req, res) => {
    requests.push({ path: req.url, ua: req.headers['user-agent'], ch: req.headers['sec-ch-ua'] })
    res.setHeader('Cache-Control', 'no-store')
    if (req.url.startsWith('/sw.js')) {
      res.setHeader('Content-Type', 'text/javascript')
      res.end(
        `self.oninstall=()=>self.skipWaiting();self.onactivate=e=>e.waitUntil(self.clients.claim());self.onmessage=e=>e.ports[0].postMessage(${snapshot})`
      )
    } else if (req.url === '/worker.js') {
      res.setHeader('Content-Type', 'text/javascript')
      res.end(`self.postMessage(${snapshot})`)
    } else if (req.url === '/favicon.ico') {
      res.end('')
    } else {
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end(
        `<!doctype html><title>Browser environment fixture</title><link rel="icon" href="/favicon.ico"><body><h1>Environment</h1><script>window.fixture=(async()=>{await fetch('/fetch');const worker=await new Promise(r=>{const w=new Worker('/worker.js');w.onmessage=e=>{w.terminate();r(e.data)}});await navigator.serviceWorker.register('/sw.js');const reg=await navigator.serviceWorker.ready;const sw=await new Promise(r=>{const c=new MessageChannel();c.port1.onmessage=e=>r(e.data);reg.active.postMessage('probe',[c.port2])});return {top:${snapshot},worker,sw}})()</script></body>`
      )
    }
  })
  await new Promise((resolve) => server.listen(19491, '127.0.0.1', resolve))
  const url = 'http://localhost:19491'
  const shell = mainWindow.webContents
  await wait(() => shell.executeJavaScript('!!window.api?.sessions'), '壳未就绪')
  async function activate(name) {
    const existing = await shell.executeJavaScript('window.api.sessions.list()')
    const item =
      existing.sessions.find((s) => s.name === name) ??
      (await shell.executeJavaScript(`window.api.sessions.create({name:${JSON.stringify(name)}})`))
    await shell.executeJavaScript(`window.api.sessions.setActive({id:${JSON.stringify(item.id)}})`)
    await wait(
      () => registry.getActiveSessionId() === item.id && registry.getActiveWebContents(),
      '会话未激活'
    )
    const wc = registry.getActiveWebContents()
    wc.on('preload-error', (_e, path, error) => errors.push({ path, error: String(error) }))
    wc.session.serviceWorkers.on('console-message', (_e, details) => {
      if (
        /injectExtensionAPIs error|location is not defined|Unable to load preload/.test(
          details.message
        )
      )
        errors.push({ worker: details.message })
    })
    return wc
  }
  let a, b, ext
  await check('首次默认UA及会话网页/Worker/SW身份', async () => {
    a = await activate('environment-A')
    await a.loadURL(url)
    const values = await a.executeJavaScript('window.fixture')
    for (const value of Object.values(values)) {
      clean(value)
      assert.equal(value.ua, app.userAgentFallback)
    }
    assert(values.top.ua.includes(`Chrome/${process.versions.chrome.split('.')[0]}.0.0.0`))
    assert(!/Electron|多会话/.test(values.top.ua))
    assert(values.top.brands.some((x) => x.brand === 'Chromium'))
    assert(!values.top.brands.some((x) => x.brand === 'Google Chrome'))
    const entropy = await a.executeJavaScript(
      "navigator.userAgentData.getHighEntropyValues(['fullVersionList'])"
    )
    assert.equal(
      entropy.fullVersionList.find((item) => item.brand === 'Chromium').version,
      process.versions.chrome
    )
    if (restart) assert.equal(await a.executeJavaScript('localStorage.envPersist'), 'A')
    await a.executeJavaScript(
      "localStorage.envPersist='A';document.cookie='envPersist=A;max-age=3600'"
    )
    const regs = a.session.getPreloadScripts().filter((s) => s.id.startsWith('crx-'))
    assert.equal(regs.length, 2)
    for (const reg of regs) assert.deepEqual(reg.includeGlobs, ['chrome-extension://*/*'])
    registrations.push(...regs)
    return values
  })
  await check('跨源iframe与about/blob/data上下文', async () => {
    const frame = await a.executeJavaScript(
      `new Promise(r=>{const f=document.createElement('iframe');f.src='http://127.0.0.1:19491/iframe';f.onload=()=>r(true);document.body.append(f)})`
    )
    assert(frame)
    const iframe = a.mainFrame.frames.find((f) => f.url.includes('/iframe'))
    const value = await iframe.executeJavaScript(snapshot)
    clean(value)
    assert.equal(value.ua, app.userAgentFallback)
    for (const target of ['about:blank', 'data:text/html,<h1>data</h1>']) {
      const win = new BrowserWindow({
        show: false,
        webPreferences: { session: a.session, backgroundThrottling: false }
      })
      try {
        await win.loadURL(target)
        clean(await win.webContents.executeJavaScript(snapshot))
      } finally {
        win.destroy()
      }
    }
    await a.executeJavaScript(
      `new Promise(r=>{const f=document.createElement('iframe');f.src=URL.createObjectURL(new Blob(['<h1>blob</h1>'],{type:'text/html'}));f.onload=()=>r(true);document.body.append(f)})`
    )
    clean(
      await a.mainFrame.frames.find((f) => f.url.startsWith('blob:')).executeJavaScript(snapshot)
    )
    return value
  })
  await check('第二会话分区与存储隔离', async () => {
    b = await activate('environment-B')
    await b.loadURL(url)
    assert.notEqual(a.session, b.session)
    const values = await b.executeJavaScript('window.fixture')
    for (const v of Object.values(values)) clean(v)
    assert.equal(await b.executeJavaScript("localStorage.getItem('envPersist')"), null)
    assert(!(await b.session.cookies.get({ url })).some((c) => c.name === 'envPersist'))
    assert(
      (await a.session.cookies.get({ url })).some((c) => c.name === 'envPersist' && c.value === 'A')
    )
    return { partitionIsolated: true }
  })
  await check('请求UA覆盖文档/fetch/favicon/Worker脚本', async () => {
    // 重启会复用持久 SW 的脚本缓存；显式检查更新以触发真实网络请求，不清存储。
    await a.executeJavaScript('navigator.serviceWorker.getRegistration().then(reg => reg.update())')
    for (const path of ['/', '/fetch', '/favicon.ico', '/worker.js', '/sw.js']) {
      await wait(() => requests.some((r) => r.path === path), '等待真实请求 ' + path)
      const rows = requests.filter((r) => r.path === path)
      assert(rows.length, path)
      for (const row of rows) assert.equal(row.ua, app.userAgentFallback, path)
    }
    return { requests: requests.length }
  })
  const extensionDir = join(directory, 'mv3')
  await mkdir(extensionDir, { recursive: true })
  await writeFile(
    join(extensionDir, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'Environment probe',
      version: '1.0',
      background: { service_worker: 'background.js' },
      permissions: ['storage', 'downloads', 'offscreen', 'tabCapture', 'tabs'],
      host_permissions: ['http://localhost/*'],
      content_scripts: [{ matches: ['http://localhost/*'], js: ['content.js'] }],
      action: { default_popup: 'popup.html' }
    })
  )
  await writeFile(
    join(extensionDir, 'background.js'),
    `chrome.runtime.onMessage.addListener((m,s,r)=>{if(m==='snapshot')r(${snapshot});if(m==='ping')r('pong');if(m==='contexts'){chrome.runtime.getContexts({}).then(r);return true}})`
  )
  await writeFile(
    join(extensionDir, 'content.js'),
    `chrome.runtime.sendMessage('ping').then(v=>document.documentElement.dataset.extensionPing=v)`
  )
  await writeFile(
    join(extensionDir, 'popup.html'),
    '<!doctype html><title>Extension probe</title><body>Extension</body>'
  )
  await writeFile(
    join(extensionDir, 'offscreen.html'),
    '<!doctype html><title>Offscreen probe</title><body>Offscreen</body>'
  )
  let popup
  await check('MV3后台/popup/content script及消息', async () => {
    await activate('environment-A')
    ext = await a.session.extensions.loadExtension(extensionDir)
    await a.reload()
    await wait(
      () => a.executeJavaScript("document.documentElement.dataset.extensionPing==='pong'"),
      '内容脚本消息失败'
    )
    popup = new BrowserWindow({
      show: false,
      parent: mainWindow,
      webPreferences: { session: a.session, backgroundThrottling: false }
    })
    await popup.loadURL(`chrome-extension://${ext.id}/popup.html`)
    const sw = await popup.webContents.executeJavaScript("chrome.runtime.sendMessage('snapshot')")
    assert.equal(sw.ua, app.userAgentFallback)
    assert.equal(
      await popup.webContents.executeJavaScript('typeof chrome.tabs.captureVisibleTab'),
      'function'
    )
    assert.equal(
      await popup.webContents.executeJavaScript('typeof chrome.offscreen.createDocument'),
      'function'
    )
    assert.deepEqual(
      await popup.webContents.executeJavaScript("chrome.runtime.sendMessage('contexts')"),
      []
    )
    return sw
  })
  await check('扩展下载保留且写入隔离目录', async () => {
    const id = await popup.webContents.executeJavaScript(
      "chrome.downloads.download({url:'data:text/plain;base64,aGVsbG8=',filename:'environment.txt'})"
    )
    assert.equal(typeof id, 'number')
    const files = await import('node:fs/promises').then((fs) =>
      fs.readdir(join(directory, 'downloads'))
    )
    const text = await readFile(
      join(
        directory,
        'downloads',
        files.find((f) => f.startsWith('environment'))
      ),
      'utf8'
    )
    assert.equal(text, 'hello')
    return { downloaded: true }
  })
  await check('扩展截图与offscreen链路', async () => {
    const png = await popup.webContents.executeJavaScript('chrome.tabs.captureVisibleTab()')
    assert(png.startsWith('data:image/png;base64,'))
    await popup.webContents.executeJavaScript('chrome.tabCapture.getMediaStreamId()')
    await popup.webContents.executeJavaScript(
      "chrome.offscreen.createDocument({url:'offscreen.html',reasons:['USER_MEDIA'],justification:'environment test'})"
    )
    const contexts = await popup.webContents.executeJavaScript('chrome.runtime.getContexts({})')
    assert(contexts.some((c) => c.contextType === 'OFFSCREEN_DOCUMENT'))
    const offscreen = BrowserWindow.getAllWindows().find(
      (w) => w.webContents.getURL() === `chrome-extension://${ext.id}/offscreen.html`
    )
    assert(offscreen)
    assert.equal(
      await offscreen.webContents.executeJavaScript('typeof chrome.runtime.sendMessage'),
      'function'
    )
    offscreen.destroy()
    return { png: true, offscreen: true }
  })
  await check('普通网页伪报扩展ID仍被IPC拒绝', async () => {
    const preload = join(directory, 'unauthorized-probe.cjs')
    await writeFile(
      preload,
      `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('__envInvoke',(extId)=>ipcRenderer.invoke('msb-ext-shim-contexts',{extId}));`
    )
    for (const target of [a.session, b.session]) {
      const win = new BrowserWindow({ show: false, webPreferences: { session: target, preload } })
      try {
        await win.loadURL(url)
        const response = await win.webContents.executeJavaScript(
          `window.__envInvoke(${JSON.stringify(ext.id)})`
        )
        assert.deepEqual(response, { ok: false, error: 'UNAUTHORIZED' })
      } finally {
        win.destroy()
      }
    }
    return { sameSession: 'UNAUTHORIZED', otherSession: 'UNAUTHORIZED' }
  })
  await check('MV2页面与后台消息兼容', async () => {
    const mv2dir = join(directory, 'mv2')
    await mkdir(mv2dir, { recursive: true })
    await writeFile(
      join(mv2dir, 'manifest.json'),
      JSON.stringify({
        manifest_version: 2,
        name: 'MV2 probe',
        version: '1.0',
        background: { scripts: ['background.js'] },
        permissions: ['storage']
      })
    )
    await writeFile(
      join(mv2dir, 'background.js'),
      "chrome.runtime.onMessage.addListener((m,s,r)=>{if(m==='ping')r('mv2-pong')})"
    )
    await writeFile(join(mv2dir, 'popup.html'), '<!doctype html><title>MV2</title>')
    const mv2 = await a.session.extensions.loadExtension(mv2dir)
    const win = new BrowserWindow({ show: false, webPreferences: { session: a.session } })
    try {
      await win.loadURL(`chrome-extension://${mv2.id}/popup.html`)
      assert.equal(
        await win.webContents.executeJavaScript("chrome.runtime.sendMessage('ping')"),
        'mv2-pong'
      )
    } finally {
      win.destroy()
    }
    return { mv2: true }
  })
  await check('原版DarkReader页面及内容脚本', async () => {
    const source = process.env.MSB_ENV_DARK_READER
    if (!source) throw new Error('需用 MSB_ENV_DARK_READER 提供原版解包目录')
    const dark = await a.session.extensions.loadExtension(source)
    const win = new BrowserWindow({ show: false, webPreferences: { session: a.session } })
    try {
      await win.loadURL(`chrome-extension://${dark.id}/ui/popup/index.html`)
      assert.equal(await win.webContents.executeJavaScript('typeof chrome.tabs.query'), 'function')
      await a.loadURL(url)
      await wait(
        () => a.executeJavaScript("!!document.querySelector('style.darkreader')"),
        'DarkReader内容脚本未运行'
      )
    } finally {
      win.destroy()
    }
    return { darkReader: dark.version }
  })
  await check('原版CookieEditor popup与Cookie读写', async () => {
    let source = process.env.MSB_ENV_COOKIE_EDITOR
    if (!source) throw new Error('需用 MSB_ENV_COOKIE_EDITOR 提供原版解包目录')
    if (source.endsWith('.crx'))
      source = (await extractCrx(await readFile(source), join(directory, 'cookie-packages'))).path
    const cookie = await a.session.extensions.loadExtension(source)
    const popupPath =
      cookie.manifest.action?.default_popup ?? cookie.manifest.browser_action?.default_popup
    const win = new BrowserWindow({ show: false, webPreferences: { session: a.session } })
    try {
      await win.loadURL(`chrome-extension://${cookie.id}/${popupPath}`)
      const values = await win.webContents.executeJavaScript(
        `chrome.cookies.getAll({url:${JSON.stringify(url)}})`
      )
      assert(values.some((c) => c.name === 'envPersist' && c.value === 'A'))
    } finally {
      win.destroy()
    }
    return { cookieEditor: cookie.version }
  })
  await check('自研录屏插件完整音视频收尾与下载', async () => {
    await activate('environment-A')
    await a.loadURL(url)
    await a.executeJavaScript(
      `(async()=>{const context=new AudioContext();const oscillator=context.createOscillator();oscillator.frequency.value=440;oscillator.connect(context.destination);oscillator.start();await context.resume();window.envAudio=context})()`,
      true
    )
    const recorderExtension = await a.session.extensions.loadExtension(
      join(app.getAppPath(), 'extensions/recorder')
    )
    const win = new BrowserWindow({
      show: false,
      parent: mainWindow,
      webPreferences: { session: a.session, backgroundThrottling: false }
    })
    try {
      await win.loadURL(`chrome-extension://${recorderExtension.id}/popup.html`)
      await win.webContents.executeJavaScript("document.getElementById('start').click()", true)
      await wait(
        () =>
          win.webContents.executeJavaScript(
            "chrome.storage.local.get('rec').then(x=>x.rec?.state==='recording')"
          ),
        '录屏未进入recording'
      )
      const deleting = registry.getActiveSessionId()
      const nativeDialog = require('electron').dialog
      const originalDialog = nativeDialog.showMessageBox
      let blockedDialog = false
      nativeDialog.showMessageBox = async () => {
        blockedDialog = true
        return { response: 0 }
      }
      try {
        await assert.rejects(
          shell.executeJavaScript(`window.api.sessions.delete({id:${JSON.stringify(deleting)}})`),
          /EXTENSION_CAPTURE_BUSY/
        )
        const retained = await shell.executeJavaScript('window.api.sessions.list()')
        assert(retained.sessions.some((item) => item.id === deleting))
        assert(blockedDialog)
        checks.push({ name: '录制中拒绝永久删除且保留元数据', ok: true })
      } finally {
        nativeDialog.showMessageBox = originalDialog
      }
      await delay(1800)
      await win.webContents.executeJavaScript("document.getElementById('pause').click()")
      await wait(
        () =>
          win.webContents.executeJavaScript(
            "chrome.storage.local.get('rec').then(x=>x.rec?.state==='paused')"
          ),
        '录屏未暂停'
      )
      await win.webContents.executeJavaScript("document.getElementById('resume').click()")
      await wait(
        () =>
          win.webContents.executeJavaScript(
            "chrome.storage.local.get('rec').then(x=>x.rec?.state==='recording')"
          ),
        '录屏未恢复'
      )
      await delay(600)
      await win.webContents.executeJavaScript("document.getElementById('stop').click()")
      const rec = await wait(
        () =>
          win.webContents.executeJavaScript(
            "chrome.storage.local.get('rec').then(x=>x.rec?.state==='idle'&&x.rec?.info?.filename?x.rec:null)"
          ),
        '录屏未保存'
      )
      assert.equal(rec.error, null)
      assert.equal(rec.info.audioIncluded, true)
      const bytes = await readFile(join(directory, 'downloads', rec.info.filename))
      assert(bytes.length > 1000)
      assert.equal(bytes.subarray(4, 8).toString(), 'ftyp')
      return { ...rec.info, bytes: bytes.length }
    } finally {
      win.destroy()
      await a.executeJavaScript('window.envAudio?.close()')
    }
  })
  await check('插件卸载重装及再次挂载保持受限', async () => {
    popup?.destroy()
    await a.session.extensions.removeExtension(ext.id)
    const reloaded = await a.session.extensions.loadExtension(extensionDir)
    assert.equal(reloaded.id, ext.id)
    await getExtensionsHandle().runtime.mountPartition(
      `persist:sess-${registry.getActiveSessionId()}`,
      a.session
    )
    assert.equal(a.session.getPreloadScripts().filter((s) => s.id.startsWith('crx-')).length, 2)
    await a.loadURL(url)
    const values = await a.executeJavaScript('window.fixture')
    clean(values.sw)
    return { reloaded: true }
  })
  await check('两会话并发重挂载不重复注册', async () => {
    const handle = getExtensionsHandle()
    const entries = [...handle.mounted.entries()].filter(
      ([, target]) => target === a.session || target === b.session
    )
    assert.equal(entries.length, 2)
    await Promise.all(
      entries.flatMap(([partition, target]) => [
        handle.runtime.mountPartition(partition, target),
        handle.runtime.mountPartition(partition, target)
      ])
    )
    for (const [, target] of entries) {
      const regs = target.getPreloadScripts().filter((s) => s.id.startsWith('crx-'))
      assert.equal(regs.length, 2)
      for (const reg of regs) assert.deepEqual(reg.includeGlobs, ['chrome-extension://*/*'])
    }
    return { simultaneousMounts: 4 }
  })
  await check('Worker停止后恢复仍保持网站隔离与扩展消息', async () => {
    a.debugger.attach('1.3')
    try {
      await a.debugger.sendCommand('ServiceWorker.enable')
      await a.debugger.sendCommand('ServiceWorker.stopAllWorkers')
    } finally {
      a.debugger.detach()
    }
    const win = new BrowserWindow({ show: false, webPreferences: { session: a.session } })
    try {
      await win.loadURL(`chrome-extension://${ext.id}/popup.html`)
      const sw = await win.webContents.executeJavaScript("chrome.runtime.sendMessage('snapshot')")
      assert.equal(sw.ua, app.userAgentFallback)
      assert.deepEqual(
        await win.webContents.executeJavaScript("chrome.runtime.sendMessage('contexts')"),
        []
      )
      await a.loadURL(url)
      clean((await a.executeJavaScript('window.fixture')).sw)
    } finally {
      win.destroy()
    }
    return { restarted: true }
  })
  await check('真实库构造中段失败后封闭Session并撤销注册', async () => {
    const target = session.fromPartition('persist:environment-constructor-failure')
    const originalOn = target.serviceWorkers.on
    let faultHits = 0
    target.serviceWorkers.on = function (event, listener) {
      if (event === 'running-status-changed') {
        faultHits++
        throw new Error('INJECTED_NATIVE_CONSTRUCTOR_FAILURE')
      }
      return originalOn.call(this, event, listener)
    }
    const runtime = getExtensionsHandle().runtime
    let first
    try {
      await runtime.mountPartition('persist:environment-constructor-failure', target)
    } catch (error) {
      first = error
    } finally {
      target.serviceWorkers.on = originalOn
    }
    assert.equal(first?.name, 'ExtensionRuntimeRestartRequiredError')
    assert.equal(first.cause?.message, 'INJECTED_NATIVE_CONSTRUCTOR_FAILURE')
    assert.equal(runtime.getEngine('persist:environment-constructor-failure'), undefined)
    assert.equal(target.getPreloadScripts().filter((s) => s.id.startsWith('crx-')).length, 0)
    await assert.rejects(
      runtime.mountPartition('persist:environment-constructor-failure', target),
      (error) => error === first
    )
    assert.equal(faultHits, 1)
    return { requiresRestart: true, constructorAttempts: faultHits, remainingRegistrations: 0 }
  })
  await check('DevTools模拟可覆盖默认UA', async () => {
    a.debugger.attach('1.3')
    try {
      await a.debugger.sendCommand('Network.setUserAgentOverride', {
        userAgent: 'EnvironmentDevice/1.0'
      })
      await a.reload()
      await wait(() => !a.isLoading(), '模拟页未加载')
      assert.equal(await a.executeJavaScript('navigator.userAgent'), 'EnvironmentDevice/1.0')
    } finally {
      a.debugger.detach()
    }
    return { overridePreserved: true }
  })
  await check('网站和扩展无preload异常', () => {
    assert.deepEqual(errors, [])
    return { errors: 0 }
  })
  a.session.flushStorageData()
  b.session.flushStorageData()
  await Promise.all([a.session.cookies.flushStore(), b.session.cookies.flushStore()])
  await report()
  server.close()
  clearTimeout(watchdog)
  console.log(
    'BROWSER_ENV_RESULT',
    JSON.stringify({
      passed: checks.filter((c) => c.ok).length,
      failed: checks.filter((c) => !c.ok).length,
      output
    })
  )
  app.exit(checks.every((c) => c.ok) ? 0 : 1)
}
