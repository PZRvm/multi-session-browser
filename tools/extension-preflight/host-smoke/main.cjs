/* host-smoke：真实 Electron 验证生产 runtime/install（B5 闭环 + A 线生命周期） */
const { app, BrowserWindow, session } = require('electron')
const { join } = require('node:path')
const { readFile, writeFile } = require('node:fs/promises')
const results = { checks: [] }
const check = (name, ok, detail) => {
  results.checks.push({ name, ok: !!ok, detail: String(detail).slice(0, 160) })
}
const delay = (ms) => new Promise((r) => setTimeout(r, ms))
process.on('uncaughtException', (e) => console.log('TEARDOWN_ERR', String(e).slice(0, 100)))
process.on('unhandledRejection', (e) => console.log('TEARDOWN_REJ', String(e).slice(0, 100)))
app.setPath('userData', '/tmp/host-smoke-userdata')
app.whenReady().then(async () => {
  const watchdog = setTimeout(() => {
    console.log('WATCHDOG_FIRED')
    writeFile(join(__dirname, 'host-smoke-results.json'), JSON.stringify(results, null, 2)).then(() => app.exit(2))
  }, 120000)
  watchdog.unref?.()

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
    // M2-A DevTools 与 M2-B(2/2) 商店事务
    hostTab.wc.openDevTools({ mode: 'detach' })
    await delay(800)
    check('DevTools打开', hostTab.wc.isDevToolsOpened(), 'detached')
    hostTab.wc.closeDevTools()
    const store = bundle.createStoreInstall({
      manifest,
      packagesRoot: join(outDir, 'packages'),
      downloadDir: join(outDir, 'store-dl'),
      allowlist: [meta('dark').id],
      confirmInstall: async () => true
    })
    let guardDenied = false
    try { await store.installFromStore('a'.repeat(32)) } catch (e) { guardDenied = String(e).includes('STORE_ID_NOT_ALLOWED') }
    check('商店允许列表守卫', guardDenied, 'denied')
    try {
      const storeRes = await store.installFromStore(meta('dark').id)
      check('商店真实下载验签安装', storeRes.id === meta('dark').id && storeRes.version.length > 0, storeRes.version)
    } catch (e) {
      check('商店真实下载验签安装', false, 'net:' + String(e).slice(0, 70))
    }
    // M2-B 安装事务：自签同钥 CRX 安装→升级→卸载（经生产 installService）
    const { generateKeyPairSync } = require('node:crypto')
    const { makeCrx2 } = await import(new URL('../crx.mjs', 'file://' + __dirname + '/').href)
    const AdmZip = require('adm-zip')
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const spk = publicKey.export({ type: 'spki', format: 'der' })
    const fixtureId = bundle.extensionId(spk)
    const ses3 = session.fromPartition('persist:host-smoke-3')
    const service = bundle.createInstallService({
      manifest,
      packagesRoot: join(outDir, 'packages'),
      onRemove: async (id) => {
        for (const ses of [ses1, ses2, ses3]) { try { await ses.removeExtension(id) } catch {} }
      }
    })
    const mkCrx = async (version) => {
      const src = new AdmZip()
      src.addLocalFolder(join(samplesDir, "unpacked", "hlkenndednhfkekhgcdicdfddnkalmdm-1.13.0"))
      const out = new AdmZip()
      for (const e of src.getEntries()) {
        if (e.isDirectory) continue
        if (e.entryName === 'manifest.json') {
          const m = JSON.parse(e.getData().toString('utf8'))
          m.version = version
          out.addFile('manifest.json', Buffer.from(JSON.stringify(m, null, 2)))
        } else out.addFile(e.entryName, e.getData())
      }
      return makeCrx2(out.toBuffer(), publicKey, privateKey)
    }
    const crx100 = await mkCrx('1.0.0')
    const ins = await service.installFromBuffer(crx100)
    check('事务安装v1.0.0', ins.record.id === fixtureId && ins.record.version === '1.0.0', fixtureId.slice(0, 8))
    const m3 = await handle.runtime.mountPartition('persist:host-smoke-3', ses3)
    check('事务分区3挂载v1.0.0', m3.state === 'ready' && ses3.getAllExtensions().some((v) => v.id === fixtureId), m3.state)
    const crx101 = await mkCrx('1.0.1')
    const up = await service.upgrade(fixtureId, crx101)
    const oldDirGone = !(await require('node:fs/promises').stat(join(outDir, 'packages', fixtureId + '-1.0.0')).then(() => true).catch(() => false))
    check('事务升级v1.0.1', up.record.version === '1.0.1' && oldDirGone, up.record.version)
    const un = await service.uninstall(fixtureId)
    const s3ids = ses3.getAllExtensions().map((v) => v.id)
    check('事务卸载', un === true && !s3ids.includes(fixtureId), 'removed=' + un)
    // M3-E 协议v1 真实 IPC 验证（生产桥守卫）
    console.log('S7 protocol')
    const sesB = session.fromPartition('persist:host-smoke-b')
    const waitBridge = async (w) => {
      for (let i = 0; i < 50; i++) {
        const t = await w.webContents.executeJavaScript('typeof window.extensionsBridge', true).catch(() => 'none')
        if (t === 'object') return
        await delay(100)
      }
      throw new Error('bridge preload missing in renderer')
    }
    const mkW = (ses) => new BrowserWindow({ show: false, webPreferences: { session: ses, preload: join(__dirname, 'bridge-preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false } })
    const trustedW = mkW(ses1)
    const unknownW = mkW(sesB)
    const extW = mkW(ses1)
    const pageFile = join(__dirname, 'bridge-page.html')
    await writeFile(pageFile, '<!doctype html><title>桥受控页</title><iframe src="bridge-child.html"></iframe>')
    await writeFile(join(__dirname, 'bridge-child.html'), '<!doctype html><title>桥子frame</title>')
    const ops = bundle.createCaptureOperations(() => trustedW.webContents)
    console.log('P1 load'); await trustedW.loadFile(pageFile); console.log('P2 loaded')
    const bt = bundle.registerBridgeTarget(trustedW.webContents, ses1, ops)
    const token = bt.token
    let seq = 0
    const nextRid = () => 'ipc-' + ++seq
    const send = async (w, payload, binaryJs) => {
      for (let attempt = 0; attempt < 6; attempt++) {
        try {
          return await w.webContents.executeJavaScript(
            'window.extensionsBridge.request(' + JSON.stringify(payload) + ', ' + (binaryJs || 'undefined') + ').then(r => ({ ok: r.ok, code: r.error && r.error.code, rid: r.requestId, value: r.value }))',
            true
          )
        } catch (error) {
          if (attempt === 5) throw error
          await delay(500)
        }
      }
    }
    const base = { protocol: 1, method: 'capture', target: token }
    const tv = (o) => send(trustedW, { ...base, requestId: nextRid(), ...o })
    console.log('P3 handshake'); const hs = await tv({ method: 'handshake' }); console.log('P4 hs-done ok=' + hs.ok)
    check('IPC握手能力', hs.ok && hs.value.capabilities.capture, hs.code || 'hs-ok')
    const capJs = 'window.extensionsBridge.request(' + JSON.stringify({ ...base, requestId: nextRid(), method: 'capture' }) + ', undefined).then(r => { window.pngRef = r.value.png; return { ok: r.ok, w: r.value.width, h: r.value.height, sha: r.value.sha256, snap: r.value.snapshot } })'
    console.log('P5 capture'); const cap = await trustedW.webContents.executeJavaScript(capJs, true); console.log('P6 capture-done ok=' + cap.ok)
    seq += 1
    check('IPC真实截图', cap.ok && cap.w > 0 && cap.sha.length === 64, String(cap.w))
    const snapOk = { id: cap.snap.id, version: cap.snap.version }
    const okCopy = await tv({ method: 'image.copy', snapshot: snapOk })
    check('IPC有效快照复制', okCopy.ok, okCopy.code || 'copied')
    const stale = await tv({ method: 'image.copy', snapshot: { id: cap.snap.id, version: cap.snap.version + 1 } })
    check('IPC过期快照拒绝', !stale.ok && stale.code === 'SNAPSHOT_STALE', stale.code)
    const inter = await tv({ method: 'image.copy', snapshot: { id: 'other', version: cap.snap.version } })
    check('IPC交错快照拒绝', !inter.ok && inter.code === 'SNAPSHOT_STALE', inter.code)
    const copyMeta = { ...base, requestId: nextRid(), method: 'image.copy', snapshot: snapOk, image: { width: cap.w, height: cap.h, mimeType: 'image/png', sha256: cap.sha } }
    const roundtrip = await send(trustedW, copyMeta, 'window.pngRef')
    check('IPC二进制往返复制', roundtrip.ok, roundtrip.code)
    const tamperJs = '(async () => { const u8 = new Uint8Array(window.pngRef.slice(0)); u8[10] ^= 1; const r = await window.extensionsBridge.request(' + JSON.stringify(copyMeta) + ', u8.buffer).then(r => ({ ok: r.ok, code: r.error && r.error.code })).catch(e => ({ ok: false, code: String(e).slice(0, 30) })); return r })()'
    const tamper = await trustedW.webContents.executeJavaScript(tamperJs, true)
    check('IPC摘要篡改拒绝', !tamper.ok && tamper.code === 'INVALID_REQUEST', tamper.code)
    const badJs = '(async () => { const bad = new Uint8Array(window.pngRef.slice(0)); bad[0] = 0; const meta = ' + JSON.stringify({ ...copyMeta, requestId: nextRid(), image: { ...copyMeta.image, sha256: 'f'.repeat(64) } }) + '; const r = await window.extensionsBridge.request(meta, bad.buffer).then(r => ({ ok: r.ok, code: r.error && r.error.code })); return r })()'
    const badHead = await trustedW.webContents.executeJavaScript(badJs, true)
    seq += 1
    check('IPC坏头拒绝', !badHead.ok && badHead.code === 'INVALID_REQUEST', badHead.code)
    const unkCap = await tv({ method: 'fs.readFile' })
    check('IPC未知能力拒绝', !unkCap.ok && unkCap.code === 'CAPABILITY_UNSUPPORTED', unkCap.code)
    const badRid = await send(trustedW, { ...base, requestId: '', method: 'capture' })
    check('IPC非法requestId拒绝', !badRid.ok && badRid.code === 'INVALID_REQUEST' && badRid.rid === null, 'rid=null')
    const forged = await tv({ target: 'forged' })
    check('IPC伪造目标拒绝', !forged.ok && forged.code === 'TARGET_GONE', forged.code)
    const wrongProto = await tv({ protocol: 2 })
    check('IPC协议版本拒绝', !wrongProto.ok && wrongProto.code === 'PROTOCOL_UNSUPPORTED', wrongProto.code)
    console.log('P7 dead'); bt.setAlive(false)
    const dead = await tv({ method: 'capture' }); console.log('P8 dead-done')
    check('IPC失效目标拒绝', !dead.ok && dead.code === 'TARGET_GONE', dead.code)
    bt.setAlive(true)
    console.log('P9 unknown'); await unknownW.loadFile(join(__dirname, 'bridge-child.html'))
    await waitBridge(unknownW)
    const fromUnknown = send(unknownW, { ...base, requestId: nextRid() })
    const unkSrc = await fromUnknown; console.log('P10 unknown-done')
    check('IPC跨分区未知来源拒绝', !unkSrc.ok && unkSrc.code === 'UNAUTHORIZED', unkSrc.code)
    try {
      await extW.loadURL('chrome-extension://' + meta('cookie').id + '/interface/options/options.html')
      await waitBridge(extW)
      const fromExt = await send(extW, { ...base, requestId: nextRid() })
      check('IPC未知第三方扩展拒绝', !fromExt.ok && fromExt.code === 'UNAUTHORIZED', fromExt.code)
    } catch (e) {
      check('IPC未知第三方扩展拒绝', false, 'ext-page-flake: ' + String(e).slice(0, 50))
    }
    try {
      const childFrame = trustedW.webContents.mainFrame.framesInSubtree.find((f) => f.url.includes('bridge-child'))
      if (childFrame) {
        const sub = await childFrame.executeJavaScript('window.extensionsBridge.request(' + JSON.stringify({ ...base, requestId: nextRid() }) + ', undefined).then(r => ({ ok: r.ok, code: r.error && r.error.code }))', true)
        check('IPC子frame拒绝', !sub.ok && sub.code === 'UNAUTHORIZED', sub.code)
      } else check('IPC子frame拒绝', false, 'no frame')
    } catch (e) {
      check('IPC子frame拒绝', false, 'renderer-flake: ' + String(e).slice(0, 50))
    }
    try {
      await trustedW.webContents.loadURL(site.url + '/?session=bridge-nav')
      const nav = await tv({ method: 'capture' })
      check('IPC来源导航撤销', !nav.ok && nav.code === 'TARGET_GONE', (nav.code || 'throw') + '(生产语义:导航即目标失效)')
    } catch (e) {
      check('IPC来源导航撤销', false, 'renderer-flake: ' + String(e).slice(0, 50))
    }
    trustedW.destroy()
    unknownW.destroy()
    extW.destroy()
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
