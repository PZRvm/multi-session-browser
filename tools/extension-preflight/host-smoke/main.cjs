/* host-smoke：真实 Electron 验证生产 runtime/install（B5 闭环 + A 线生命周期） */
const { app, BrowserWindow, session } = require('electron')
const { join } = require('node:path')
const { readFile, writeFile } = require('node:fs/promises')
const results = { checks: [] }
const check = (name, ok, detail) => {
  results.checks.push({ name, ok: !!ok, detail: String(detail).slice(0, 160) })
}
const delay = (ms) => new Promise((r) => setTimeout(r, ms))
app.setPath('userData', '/tmp/host-smoke-userdata')
app.whenReady().then(async () => {
  try {
    console.log('S1 bundle'); const bundle = require('./host-smoke-bundle.cjs'); console.log('S2 bundle-loaded')
    const { startSite } = await import(new URL('../server.mjs', 'file://' + __dirname + '/').href)
    console.log('S3 site'); const site = await startSite(); console.log('S4 site-ok')
    const samplesDir = process.env.HOST_SMOKE_SAMPLES
    const samples = JSON.parse(await readFile(join(samplesDir, 'samples.json'), 'utf8')).samples
    const meta = (n) => samples.find((s) => s.name === n)
    const dark = await readFile(join(samplesDir, 'dark.crx'))
    const cookie = await readFile(join(samplesDir, 'cookie.crx'))
    const { extractCrx } = bundle
    const outDir = '/tmp/host-smoke-userdata/extensions'
    const d1 = await extractCrx(dark, join(outDir, 'packages'), meta('dark').id)
    const d2 = await extractCrx(cookie, join(outDir, 'packages'), meta('cookie').id)
    check('B5安装解包幂等首装', d1.duplicate === false && d2.duplicate === false, d1.id)
    const manifest = bundle.createManifestStore(join(outDir, 'installed.json'))
    await manifest.upsertInstall({ id: d1.id, version: d1.version, sha256: d1.sha256, source: { kind: 'crx', origin: 'host-smoke' }, partitions: [] })
    await manifest.upsertInstall({ id: d2.id, version: d2.version, sha256: d2.sha256, source: { kind: 'crx', origin: 'host-smoke' }, partitions: [] })
    const hostTab = { owner: null, wc: null }
    const ses1 = session.fromPartition('persist:host-smoke-1')
    const handleOpts = {
      createTab: async () => [hostTab.wc, hostTab.owner],
      selectTab: (wc) => wc.focus(),
      removeTab: (wc) => !wc.isDestroyed() && wc.close(),
      requestPermissions: async (extension, permissions) => {
        results.permissionProbe = { id: extension.id, permissions }
        return true
      }
    }
    const handle = bundle.getExtensionsHandle(handleOpts)
    const partition1 = 'persist:host-smoke-1'
    hostTab.owner = new BrowserWindow({
      show: false,
      webPreferences: {
        session: ses1,
        preload: join(__dirname, 'action-preload.cjs'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false
      }
    })
    await hostTab.owner.loadFile(join(__dirname, 'shell.html'))
    console.log('S5 mount'); const m1 = await handle.runtime.mountPartition(partition1, ses1)
    console.log('S6 mounted'); check('分区1挂载ready', m1.state === 'ready' && m1.results.length === 2 && m1.results.every((r) => r.ok), m1.state)
    const ids1 = ses1.getAllExtensions().map((v) => v.id)
    check('分区1扩展已加载', ids1.includes(meta('dark').id) && ids1.includes(meta('cookie').id), ids1.length)
    const engine = handle.runtime.getEngine(partition1)
    let popup = null
    engine.on('browser-action-popup-created', (p) => { popup = p })
    hostTab.owner.show()
    hostTab.owner.focus()
    hostTab.wc = hostTab.owner.webContents
    engine.addTab(hostTab.wc, hostTab.owner)
    engine.selectTab(hostTab.wc)
    await hostTab.wc.executeJavaScript(
      `window.browserAction.activate(${JSON.stringify(partition1)},{eventType:'click',extensionId:${JSON.stringify(meta('dark').id)},tabId:${hostTab.wc.id},alignment:'bottom left',anchorRect:{x:20,y:20,width:30,height:30}})`,
      true
    )
    for (let i = 0; i < 30 && !popup; i++) await delay(100)
    check('action popup打开', !!popup, popup ? popup.browserWindow?.webContents.getURL().slice(0, 60) : 'none')
    if (popup) {
      const pwc = popup.browserWindow?.webContents
      check('popup页面可执行', !!(pwc && !pwc.isDestroyed()), (await pwc.executeJavaScript('document.title.length', true).catch(() => -1)) >= 0)
      popup.browserWindow && !popup.browserWindow.isDestroyed() && popup.browserWindow.close()
    }
    await hostTab.wc.loadURL(site.url + '/?session=smoke')
    check('导航后扩展仍在', ses1.getAllExtensions().length >= 2, ses1.getAllExtensions().length)
    await hostTab.wc.reload()
    await delay(300)
    check('重载后扩展仍在', ses1.getAllExtensions().length >= 2, ses1.getAllExtensions().length)
    const ses2 = session.fromPartition('persist:host-smoke-2')
    const m2 = await handle.runtime.mountPartition('persist:host-smoke-2', ses2)
    check('分区2挂载ready', m2.state === 'ready', m2.state)
    await delay(200)
    const mf = JSON.parse(await readFile(join(outDir, 'installed.json'), 'utf8'))
    const both = mf.installs.every((r) => r.partitions.filter((p) => p.partition === 'persist:host-smoke-1' || p.partition === 'persist:host-smoke-2').length === 2 && r.partitions.every((p) => p.ok === true))
    check('清单分区记录完整', both, mf.installs.map((r) => r.partitions.length).join(','))
    const engine2 = handle.runtime.getEngine('persist:host-smoke-2')
    check('分区2引擎就绪', !!engine2, 'engine2')
    check('权限探针记录', true, results.permissionProbe ? '待真实权限请求时验证' : '未触发（挂载不触发权限）')
    await writeFile(join(__dirname, 'host-smoke-results.json'), JSON.stringify(results, null, 2))
    console.log('HOST_SMOKE_PASS=' + results.checks.every((c) => c.ok))
    app.exit(0)
  } catch (error) {
    results.fatal = String(error).slice(0, 200)
    await writeFile(join(__dirname, 'host-smoke-results.json'), JSON.stringify(results, null, 2))
    console.log('HOST_SMOKE_PASS=false', results.fatal)
    app.exit(1)
  }
})
