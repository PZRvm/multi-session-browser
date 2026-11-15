/* eslint @typescript-eslint/explicit-function-return-type: off -- 隔离开发应用诊断，非产品实现 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const require = createRequire(join(process.cwd(), 'package.json'))
const { app, BrowserWindow } = require('electron')
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
  const win = new BrowserWindow({
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
  save()
  win.destroy()
  origin.close()
  proxy.close()
  const ses = a.wc.session,
    partitionDir = ses.getStoragePath()
  report.deleted = {
    id: a.item.id,
    partition: a.partition,
    partitionDir,
    before: {
      mounted: handle.mounted.has(a.partition),
      engine: !!handle.runtime.getEngine(a.partition),
      extensions: ses.extensions.getAllExtensions().map((e) => e.id)
    }
  }
  await api(`window.api.sessions.delete({id:${JSON.stringify(a.item.id)}})`)
  await wait(
    async () => !(await api('window.api.sessions.list()')).sessions.some((s) => s.id === a.item.id),
    'metadata removal'
  )
  await wait(() => !existsSync(partitionDir), 'partition directory removal', 15000)
  await delay(200)
  report.deleted.afterDelete = {
    mounted: handle.mounted.has(a.partition),
    engine: !!handle.runtime.getEngine(a.partition),
    directoryExists: existsSync(partitionDir),
    loadedExtensions: ses.extensions.getAllExtensions().map((e) => e.id)
  }
  const cookie = await api(
    `window.api.extensions.importCrxFromPath(${JSON.stringify(process.env.MSB_PROBE_COOKIE)})`
  )
  assert(cookie.ok, JSON.stringify(cookie))
  // 只按已知路径纯计算 ID，删除后不调用会建立分区副本的 resolveLoadedId。
  const partitionHash = createHash('sha256').update(a.partition).digest('hex').slice(0, 16)
  const copyPath = join(handle.paths.packagesRoot, `${cookie.record.id}.partitions`, partitionHash)
  const cookieLoaded = createHash('sha256')
    .update(copyPath)
    .digest('hex')
    .slice(0, 32)
    .replace(/[0-9a-f]/g, (v) => String.fromCharCode(97 + parseInt(v, 16)))
  await delay(1500)
  report.deleted.afterNewInstall = {
    installOk: cookie.ok,
    metadataAbsent: !(await api('window.api.sessions.list()')).sessions.some(
      (s) => s.id === a.item.id
    ),
    mounted: handle.mounted.has(a.partition),
    engine: !!handle.runtime.getEngine(a.partition),
    directoryExists: existsSync(partitionDir),
    cookieLoadedIntoDeletedSession: !!ses.extensions.getExtension(cookieLoaded),
    loadedExtensions: ses.extensions.getAllExtensions().map((e) => e.id)
  }
  report.checks.push({
    name: '删除会话后扩展回收',
    needsWork:
      report.deleted.afterNewInstall.cookieLoadedIntoDeletedSession ||
      report.deleted.afterDelete.mounted
  })
  report.focusedWindows = BrowserWindow.getAllWindows().filter((w) => w.isFocused()).length
  save()
  console.log('BACKLOG_PROBE_COMPLETE', JSON.stringify(report))
  clearTimeout(watchdog)
  app.exit(0)
}
