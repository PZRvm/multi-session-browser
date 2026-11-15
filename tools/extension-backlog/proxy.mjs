/* eslint @typescript-eslint/explicit-function-return-type: off -- 隔离开发应用诊断，非产品实现 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { createServer as createTLSOrigin } from 'node:https'
import { createServer as createTCPServer, connect as connectTCP } from 'node:net'
import { readFileSync } from 'node:fs'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const require = createRequire(join(process.cwd(), 'package.json'))
const { app, BrowserWindow, webContents } = require('electron')
const delay = (ms) => new Promise((r) => setTimeout(r, ms))
async function wait(fn, label, ms = 20000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const x = await fn()
    if (x) return x
    await delay(100)
  }
  throw Error(label)
}
export async function run({ registry, mainWindow, getExtensionsHandle }) {
  assert(process.env.MSB_PROBE_OMEGA && process.env.MSB_PROBE_COOKIE, '缺少固定 CRX 样本路径')
  const dir = app.getPath('userData')
  assert(dir.startsWith('/tmp/msb-backlog-'))
  const output = join(dir, 'probe.json'),
    report = {
      baseline: execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: app.getAppPath(),
        encoding: 'utf8'
      }).trim(),
      platform: process.platform,
      versions: process.versions,
      checks: [],
      dialogs: [],
      errors: []
    }
  const save = () => writeFileSync(output, JSON.stringify(report, null, 2))
  mkdirSync(dir, { recursive: true })
  const watchdog = setTimeout(() => {
    report.errors.push('timeout')
    save()
    app.exit(2)
  }, 150000)
  app.on('web-contents-created', (_event, wc) => {
    wc.on('console-message', (event) => {
      if (event.level === 'error')
        report.errors.push({ url: wc.getURL(), message: event.message.slice(0, 500) })
    })
  })
  const shell = mainWindow.webContents
  const api = (expr) => shell.executeJavaScript(expr)
  await wait(() => api('!!window.api?.extensions?.importCrxFromPath'), 'shell ready')
  const create = async (name) => {
    const item = await api(`window.api.sessions.create({name:${JSON.stringify(name)}})`)
    await api(`window.api.sessions.setActive({id:${JSON.stringify(item.id)}})`)
    await wait(
      () => registry.getActiveSessionId() === item.id && registry.getActiveWebContents(),
      'activate'
    )
    return { item, wc: registry.getActiveWebContents(), partition: 'persist:sess-' + item.id }
  }
  const a = await create('Backlog-A'),
    b = await create('Backlog-B')
  const handle = getExtensionsHandle()
  const omega = await api(
    `window.api.extensions.importCrxFromPath(${JSON.stringify(process.env.MSB_PROBE_OMEGA)})`
  )
  assert(omega.ok, JSON.stringify(omega))
  report.sample = {
    id: omega.record.id,
    version: omega.record.version,
    sha256: omega.record.sha256
  }
  const loaded = await handle.runtime.resolveLoadedId(a.partition, omega.record.id)
  assert(a.wc.session.extensions.getExtension(loaded))
  let win = new BrowserWindow({
    show: false,
    webPreferences: {
      session: a.wc.session,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  win.webContents.on('console-message', (_event, details) => {
    if (details?.level === 'error') report.errors.push(String(details.message).slice(0, 300))
  })
  await win.loadURL(`chrome-extension://${loaded}/options.html`)
  const rpc = (method, args = []) =>
    win.webContents.executeJavaScript(
      `new Promise((resolve,reject)=>{chrome.runtime.sendMessage({method:${JSON.stringify(method)},args:${JSON.stringify(args)}},r=>{if(chrome.runtime.lastError)reject(Error(chrome.runtime.lastError.message));else if(r?.error)reject(Error(JSON.stringify(r.error)));else resolve(r?.result)});setTimeout(()=>reject(Error('RPC_TIMEOUT')),8000)})`
    )
  await wait(() => rpc('getAll').catch(() => null), '原版后台初始化')
  await rpc('applyProfile', ['direct'])
  const state = await win.webContents.executeJavaScript(
    `(()=>({url:location.href,title:document.title,body:document.body.innerText.slice(0,300),proxy:typeof chrome.proxy,settings:typeof chrome.proxy?.settings,set:typeof chrome.proxy?.settings?.set,runtime:chrome.runtime.id,manifest:chrome.runtime.getManifest().version}))()`
  )
  const origin = createServer((req, res) =>
    res.end(JSON.stringify({ via: 'origin', url: req.url }))
  )
  const proxy = createServer((req, res) => res.end(JSON.stringify({ via: 'proxy', url: req.url })))
  await new Promise((r) => origin.listen(0, '127.0.0.1', r))
  await new Promise((r) => proxy.listen(0, '127.0.0.1', r))
  const target = `http://msb-fixture.test:${origin.address().port}/probe`,
    proxyPort = proxy.address().port
  const before = await a.wc.session.resolveProxy(target)
  const attempted = await win.webContents.executeJavaScript(
    `(async()=>{try {return await new Promise((resolve,reject)=>{chrome.proxy.settings.set({value:{mode:'fixed_servers',rules:{singleProxy:{scheme:'http',host:'127.0.0.1',port:${proxyPort}}}},scope:'regular'},()=>resolve({ok:!chrome.runtime.lastError,error:chrome.runtime.lastError?.message}));setTimeout(()=>resolve({ok:false,error:'callback timeout'}),3000)})}catch(e){return {ok:false,error:String(e)}}})()`
  )
  await delay(300)
  const afterExtension = await a.wc.session.resolveProxy(target)
  const actualAfterExtension = await (await a.wc.session.fetch(target)).json()
  await api(
    `window.api.sessions.setProxy({id:${JSON.stringify(a.item.id)},proxy:{protocol:'http',host:'127.0.0.1',port:${proxyPort},username:'',password:''}})`
  )
  const controlResolved = await a.wc.session.resolveProxy(target)
  const actualControl = await (await a.wc.session.fetch(target + '?native-control')).json()
  assert.equal(actualControl.via, 'proxy', 'native proxy positive control')
  const bResolved = await b.wc.session.resolveProxy(target)
  assert.equal(bResolved, 'DIRECT', 'B stays isolated')
  report.checks.push({
    name: 'SwitchyOmega真实加载与代理控制',
    state,
    before,
    attempted,
    afterExtension,
    actualAfterExtension,
    controlResolved,
    actualControl,
    bResolved,
    needsWork: !attempted.ok || actualAfterExtension.via !== 'proxy'
  })

  const extEval = (script) => win.webContents.executeJavaScript(script)
  const config = {
    mode: 'fixed_servers',
    rules: { singleProxy: { scheme: 'http', host: '127.0.0.1', port: proxyPort } }
  }
  const set = (value) => extEval(`chrome.proxy.settings.set({value:${JSON.stringify(value)}})`)
  const get = () => extEval('chrome.proxy.settings.get({})')
  const clearManual = () =>
    api(`window.api.sessions.setProxy({id:${JSON.stringify(a.item.id)},proxy:null})`)
  const route = async (suffix) => (await (await a.wc.session.fetch(target + suffix)).json()).via
  const matrix = []
  async function test(name, fn) {
    try {
      await fn()
    } catch (error) {
      report.failure = { name, error: String(error) }
      save()
      throw error
    }
    matrix.push(name)
    report.proxyMatrix = matrix
    save()
    console.log('PROXY_PASS', name)
  }
  await extEval(
    'globalThis.proxyEvents=[];chrome.proxy.settings.onChange.addListener(x=>proxyEvents.push(x))'
  )
  await test('手动优先与清除后恢复插件', async () => {
    await set({ mode: 'direct' })
    assert.equal((await get()).levelOfControl, 'not_controllable')
    assert.equal(await route('?manual'), 'proxy')
    await clearManual()
    assert.equal(await route('?extension-direct'), 'origin')
    assert.equal((await get()).levelOfControl, 'controlled_by_this_extension')
    await set(config)
    assert.equal(await route('?promise-set'), 'proxy')
  })
  await test('callback错误语义与scope拒绝', async () => {
    const error = await extEval(
      `new Promise(resolve=>chrome.proxy.settings.set({scope:'incognito_session_only',value:{mode:'direct'}},()=>resolve(chrome.runtime.lastError?.message)))`
    )
    assert.match(error, /UNSUPPORTED_PROXY_SCOPE/)
    assert.equal(await extEval('chrome.runtime.lastError'), undefined)
    await assert.rejects(
      set({ mode: 'fixed_servers', rules: { singleProxy: { host: '127.0.0.1', port: 0 } } }),
      /INVALID/
    )
    assert.equal(await route('?after-invalid'), 'proxy')
  })
  await test('onChange有效且同值不重复广播', async () => {
    await set({ mode: 'direct' })
    await delay(200)
    const before = await extEval('proxyEvents.length')
    assert(before > 0)
    await set({ mode: 'direct' })
    await delay(100)
    assert.equal(await extEval('proxyEvents.length'), before)
    await set(config)
  })
  await test('browser命名空间与无权限扩展拒绝', async () => {
    await extEval("browser.proxy.settings.set({value:{mode:'direct'}})")
    assert.equal(await route('?browser-direct'), 'origin')
    await extEval(`browser.proxy.settings.set({value:${JSON.stringify(config)}})`)
    assert.equal(await route('?browser-api'), 'proxy')
    const fixture = join(dir, 'no-proxy-extension')
    mkdirSync(fixture, { recursive: true })
    writeFileSync(
      join(fixture, 'manifest.json'),
      JSON.stringify({ manifest_version: 3, name: 'No proxy permission', version: '1.0' })
    )
    writeFileSync(join(fixture, 'index.html'), '<title>No proxy</title>')
    const ext = await a.wc.session.extensions.loadExtension(fixture)
    const page = new BrowserWindow({
      show: false,
      webPreferences: { session: a.wc.session, contextIsolation: true }
    })
    try {
      await page.loadURL(`chrome-extension://${ext.id}/index.html`)
      const denial = await page.webContents.executeJavaScript(
        "__msbShimBridge.proxy('set',{value:{mode:'direct'}}).then(()=>({ok:true}),error=>({ok:false,error:String(error.message)}))"
      )
      assert.equal(denial.ok, false)
      assert.match(denial.error, /PROXY_PERMISSION_REQUIRED/)
    } finally {
      page.destroy()
      await a.wc.session.extensions.removeExtension(ext.id)
    }
  })
  await test('HTTPS隧道与SOCKS4/5真实请求', async () => {
    const key = join(dir, 'fixture-key.pem'),
      cert = join(dir, 'fixture-cert.pem')
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        key,
        '-out',
        cert,
        '-days',
        '1',
        '-subj',
        '/CN=msb-fixture.test'
      ],
      { stdio: 'ignore' }
    )
    const tls = createTLSOrigin({ key: readFileSync(key), cert: readFileSync(cert) }, (_q, res) =>
      res.end(JSON.stringify({ via: 'tls-origin' }))
    )
    await new Promise((r) => tls.listen(0, '127.0.0.1', r))
    a.wc.session.setCertificateVerifyProc((request, callback) =>
      callback(request.hostname === 'msb-fixture.test' ? 0 : -3)
    )
    let connects = 0
    proxy.on('connect', (_req, socket, head) => {
      connects++
      const upstream = connectTCP(tls.address().port, '127.0.0.1', () => {
        socket.write('HTTP/1.1 200 Connection established\r\n\r\n')
        if (head.length) upstream.write(head)
        socket.pipe(upstream)
        upstream.pipe(socket)
      })
      upstream.on('error', () => socket.destroy())
      socket.on('error', () => upstream.destroy())
    })
    try {
      await set(config)
      assert.equal(
        (
          await (
            await a.wc.session.fetch(`https://msb-fixture.test:${tls.address().port}/tls`)
          ).json()
        ).via,
        'tls-origin'
      )
      assert(connects > 0, 'HTTPS请求必须经过代理CONNECT')
      for (const version of [4, 5]) {
        let tunnels = 0
        const socks = createTCPServer((socket) => {
          let phase = 0,
            buffer = Buffer.alloc(0)
          const read = (chunk) => {
            buffer = Buffer.concat([buffer, chunk])
            if (version === 5 && phase === 0) {
              if (buffer.length < 2 + buffer[1]) return
              buffer = buffer.subarray(2 + buffer[1])
              socket.write(Buffer.from([5, 0]))
              phase = 1
              if (!buffer.length) return
            }
            let bytes, port
            if (version === 5) {
              if (buffer.length < 5) return
              const type = buffer[3],
                addressLength = type === 1 ? 4 : type === 3 ? buffer[4] + 1 : type === 4 ? 16 : 0
              if (!addressLength) {
                socket.destroy()
                return
              }
              bytes = 4 + addressLength + 2
              if (buffer.length < bytes) return
              port = buffer.readUInt16BE(bytes - 2)
            } else {
              if (buffer.length < 9) return
              const end = buffer.indexOf(0, 8)
              if (end < 0) return
              bytes = end + 1
              if (buffer[4] === 0 && buffer[5] === 0 && buffer[6] === 0 && buffer[7] !== 0) {
                const hostEnd = buffer.indexOf(0, bytes)
                if (hostEnd < 0) return
                bytes = hostEnd + 1
              }
              port = buffer.readUInt16BE(2)
            }
            if (port !== origin.address().port) {
              socket.destroy()
              return
            }
            const extra = buffer.subarray(bytes)
            socket.off('data', read)
            const upstream = connectTCP(port, '127.0.0.1', () => {
              tunnels++
              socket.write(
                version === 5
                  ? Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0])
                  : Buffer.from([0, 90, 0, 0, 127, 0, 0, 1])
              )
              if (extra.length) upstream.write(extra)
              socket.pipe(upstream)
              upstream.pipe(socket)
            })
            upstream.on('error', () => socket.destroy())
            socket.on('error', () => upstream.destroy())
          }
          socket.on('data', read)
        })
        await new Promise((r) => socks.listen(0, '127.0.0.1', r))
        try {
          await set({
            mode: 'fixed_servers',
            rules: {
              singleProxy: {
                scheme: 'socks' + version,
                host: '127.0.0.1',
                port: socks.address().port
              }
            }
          })
          assert.equal(await route('?socks=' + version), 'origin')
          assert(tunnels > 0, '请求必须经过SOCKS握手')
        } finally {
          await set(config)
          socks.close()
        }
      }
    } finally {
      a.wc.session.setCertificateVerifyProc(null)
      tls.close()
    }
  })
  const pac = `function FindProxyForURL(url,host){return "PROXY 127.0.0.1:${proxyPort}"}`
  const pacServer = createServer((_q, res) => {
    res.setHeader('Content-Type', 'application/x-ns-proxy-autoconfig')
    res.end(pac)
  })
  await new Promise((r) => pacServer.listen(0, '127.0.0.1', r))
  await test('mandatory内联PAC和URL PAC真实路由', async () => {
    for (const pacScript of [
      { data: pac, mandatory: true },
      { url: `http://127.0.0.1:${pacServer.address().port}/p.pac`, mandatory: true }
    ]) {
      await set({ mode: 'pac_script', pacScript })
      assert.equal(await route('?pac=' + matrix.length), 'proxy')
    }
  })
  await test('mandatory坏脚本拒绝并保留原路线', async () => {
    await assert.rejects(
      set({ mode: 'pac_script', pacScript: { data: 'this is not JavaScript', mandatory: true } }),
      /PAC_VALIDATION_FAILED/
    )
    assert.equal(await route('?bad-pac-rollback'), 'proxy')
  })
  await test('mandatory按URL抛错时取消请求不直连', async () => {
    await set({
      mode: 'pac_script',
      pacScript: {
        data: `function FindProxyForURL(url,host){if(url.indexOf('must-block')>=0)throw Error('blocked');return 'DIRECT'}`,
        mandatory: true
      }
    })
    assert.equal(await route('?valid-direct'), 'origin')
    await assert.rejects(route('?must-block'))
  })
  pacServer.close()
  await test('代理认证失败不伪造成功路由', async () => {
    let authHits = 0
    const authProxy = createServer((_q, res) => {
      authHits++
      res.writeHead(407, { 'Proxy-Authenticate': 'Basic realm="MSB test"' })
      res.end('Auth required')
    })
    await new Promise((r) => authProxy.listen(0, '127.0.0.1', r))
    try {
      await set({
        mode: 'fixed_servers',
        rules: {
          singleProxy: { scheme: 'http', host: '127.0.0.1', port: authProxy.address().port }
        }
      })
      const response = await a.wc.session
        .fetch(target + '?auth-failure=' + Date.now(), { cache: 'no-store' })
        .catch(() => null)
      report.authFailure = {
        status: response?.status,
        hits: authHits,
        body: response ? await response.text() : null
      }
      save()
      assert(authHits > 0, '认证请求必须触达代理')
      assert(!response || response.status === 407)
    } finally {
      authProxy.close()
      await set(config)
    }
  })
  await test('SwitchyOmega原版后台配置与选择主流程', async () => {
    report.backgrounds = []
    for (const wc of webContents.getAllWebContents()) {
      if (
        wc.session === a.wc.session &&
        wc.getURL().startsWith(`chrome-extension://${loaded}/`) &&
        wc !== win.webContents
      ) {
        report.backgrounds.push({
          url: wc.getURL(),
          snapshot: await wc
            .executeJavaScript(
              `({bridge:typeof __msbShimBridge,set:String(chrome.proxy?.settings?.set).slice(0,120),storage:Object.keys(localStorage).slice(0,10)})`
            )
            .catch((error) => String(error))
        })
      }
    }
    const options = await rpc('getAll')
    report.rawOptions = options ?? 'UNDEFINED'
    save()
    report.optionKeys = Object.keys(options)
    options['+msb-test'] = {
      name: 'msb-test',
      profileType: 'FixedProfile',
      color: '#99ccee',
      fallbackProxy: { scheme: 'http', host: '127.0.0.1', port: proxyPort },
      bypassList: [],
      revision: Date.now().toString(16)
    }
    await rpc('reset', [options])
    await rpc('applyProfile', ['msb-test'])
    assert.equal(await route('?omega-fixed'), 'proxy')
    await rpc('applyProfile', ['direct'])
    assert.equal(await route('?omega-direct'), 'origin')
    options['+msb-auto'] = {
      name: 'msb-auto',
      profileType: 'SwitchProfile',
      color: '#aabbcc',
      defaultProfileName: 'msb-test',
      rules: [],
      revision: Date.now().toString(16)
    }
    await rpc('reset', [options])
    await rpc('applyProfile', ['msb-auto'])
    assert.equal(await route('?omega-auto'), 'proxy')
  })
  await test('临时关闭后重新激活保持插件可用', async () => {
    await registry.closeSession(a.item.id)
    assert(getExtensionsHandle().runtime.getEngine(a.partition), '临时关闭不得永久终止引擎')
    await api(`window.api.sessions.setActive({id:${JSON.stringify(a.item.id)}})`)
    await wait(
      () => registry.getActiveSessionId() === a.item.id && registry.getActiveWebContents(),
      'close/reopen'
    )
    a.wc = registry.getActiveWebContents()
    win = new BrowserWindow({
      show: false,
      webPreferences: { session: a.wc.session, contextIsolation: true }
    })
    await win.loadURL(`chrome-extension://${loaded}/options.html`)
    report.afterReopen = []
    for (const wc of webContents.getAllWebContents()) {
      if (wc.session !== a.wc.session) continue
      report.afterReopen.push({
        id: wc.id,
        url: wc.getURL(),
        state: await wc
          .executeJavaScript(
            `({chrome:typeof chrome,storage:typeof chrome?.storage,runtime:chrome?.runtime?.id,log:typeof localStorage==='object'?localStorage.getItem('log')?.slice(-4000):null})`
          )
          .catch(String)
      })
    }
    save()
    const options = await wait(() => rpc('getAll').catch(() => null), '原版后台重新就绪')
    assert(options, '原版后台仍可读取配置')
    await rpc('applyProfile', ['msb-test'])
    assert.equal(await route('?after-close'), 'proxy')
  })
  await test('清除插件控制与持久化准备', async () => {
    await extEval('chrome.proxy.settings.clear({})')
    assert.equal(await route('?clear'), 'origin')
    assert.equal((await get()).levelOfControl, 'controllable_by_this_extension')
    await set(config)
    const state = await get()
    assert.equal(state.levelOfControl, 'controlled_by_this_extension')
    report.restart = {
      id: a.item.id,
      partition: a.partition,
      extension: loaded,
      originPort: origin.address().port,
      proxyPort,
      config,
      target
    }
  })
  report.focusedWindows = BrowserWindow.getAllWindows().filter((w) => w.isFocused()).length
  save()
  console.log('PROXY_MATRIX_COMPLETE', JSON.stringify(matrix))
  win.destroy()
  origin.close()
  proxy.close()
  clearTimeout(watchdog)
  app.exit(0)
}
