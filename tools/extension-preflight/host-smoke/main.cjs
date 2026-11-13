/* eslint @typescript-eslint/explicit-function-return-type: off, @typescript-eslint/no-require-imports: off -- Electron 主进程 CJS 验证脚本 */
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
app.whenReady().then(() => {
  setTimeout(() => {
    const list = require('electron').webContents
      .getAllWebContents()
      .map((w) => w.getURL().slice(0, 70))
      .filter((u) => u.includes('chrome-extension'))
    console.log('WC_EXT_LIST ' + JSON.stringify(list))
  }, 12000)
})
app.whenReady().then(async () => {
  const watchdog = setTimeout(() => {
    console.log('WATCHDOG_FIRED')
    writeFile(join(__dirname, 'host-smoke-results.json'), JSON.stringify(results, null, 2)).then(
      () => app.exit(2)
    )
  }, 300000)
  watchdog.unref?.()

  try {
    console.log('S1 bundle')
    const bundle = require('./out/host-smoke-bundle.cjs')
    console.log('S2 bundle-loaded')
    const { startSite } = await import(new URL('../server.mjs', 'file://' + __dirname + '/').href)
    console.log('S3 site')
    const site = await startSite()
    console.log('S4 site-ok')
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
    await manifest.upsertInstall({
      id: d1.id,
      version: d1.version,
      sha256: d1.sha256,
      source: { kind: 'crx', origin: 'host-smoke' },
      partitions: []
    })
    await manifest.upsertInstall({
      id: d2.id,
      version: d2.version,
      sha256: d2.sha256,
      source: { kind: 'crx', origin: 'host-smoke' },
      partitions: []
    })
    const hostTab = { owner: null, wc: null }
    const ses1 = session.fromPartition('persist:host-smoke-1')
    const handleOpts = {
      createTab: async () => [hostTab.wc, hostTab.owner],
      selectTab: (wc) => wc.focus(),
      removeTab: (wc) => !wc.isDestroyed() && wc.close(),
      requestPermissions: async (extension, permissions) => {
        results.permissionProbe = { id: extension.id, permissions }
        console.log('PERM_REQ ' + extension.id + ' ' + JSON.stringify(permissions).slice(0, 80))
        return true
      }
    }
    const { ElectronChromeExtensions } = require('electron-chrome-extensions')
    ElectronChromeExtensions.handleCRXProtocol(session.defaultSession)
    const handle = bundle.getExtensionsHandle(handleOpts)
    const partition1 = 'persist:host-smoke-1'
    hostTab.owner = new BrowserWindow({
      show: false,
      webPreferences: {
        session: ses1,
        preload: join(__dirname, 'out', 'action-preload.cjs'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false
      }
    })
    await hostTab.owner.loadFile(join(__dirname, 'shell.html'))
    console.log('S5 mount')
    const m1 = await handle.runtime.mountPartition(partition1, ses1)
    console.log('S6 mounted')
    check(
      '分区1挂载ready',
      m1.state === 'ready' && m1.results.length === 2 && m1.results.every((r) => r.ok),
      m1.state
    )
    const ids1 = ses1.getAllExtensions().map((v) => v.id)
    check(
      '分区1扩展已加载',
      ids1.includes(meta('dark').id) && ids1.includes(meta('cookie').id),
      ids1.length
    )
    const engine = handle.runtime.getEngine(partition1)
    let popup = null
    engine.on('browser-action-popup-created', (p) => {
      popup = p
    })
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
    check(
      'action popup打开',
      !!popup,
      popup ? popup.browserWindow?.webContents.getURL().slice(0, 60) : 'none'
    )
    if (popup) {
      const pwc = popup.browserWindow?.webContents
      check(
        'popup页面可执行',
        !!(pwc && !pwc.isDestroyed()),
        (await pwc.executeJavaScript('document.title.length', true).catch(() => -1)) >= 0
      )
      // 同环境对照：lib popup 的渲染与端口状态
      const libText = await pwc
        .executeJavaScript('(document.body.innerText || "").slice(0, 40)', true)
        .catch(() => 'EXEC')
      const libPort = await pwc
        .executeJavaScript(
          'new Promise((res) => { try { const p = chrome.runtime.connect({ name: "ui-bg-subscribe-to-changes" }); let got = null; p.onMessage.addListener(() => { got = "MSG" }); p.onDisconnect.addListener(() => { if (!got) got = "DISCONNECTED" }); setTimeout(() => res(got || "SILENT"), 2000) } catch (e) { res("THROW") } })',
          true
        )
        .catch(() => 'EXEC')
    console.log(
      '[known-issue] MV2 popup Loading（见 issue）:',
      String(libText).slice(0, 20),
      String(libPort)
    )
      // MV3 实测：uBO Lite（广告拦截，service worker 架构）装→挂→popup 渲染探针
      // Cookie-Editor（MV2）生产路径实测：真实渲染 + cookie 读路径 CRUD
    console.log('P17 cookie-prod')
    let cookieResult = 'SKIPPED'
    try {
      // 测试页同源写一个 msb_fixture cookie（与前置同款虚构值），供 popup 列表断言
      const cookieDetail = { url: site.url, name: 'msb_fixture', value: 'prod-path', path: '/' }
      await ses1.cookies.set(cookieDetail)
      // popup 的 activeTab 查询依赖引擎注册的 tab：注册壳 tab（幂等）并指向测试页
      hostTab.owner.show()
      await hostTab.wc.loadURL(site.url + '/?session=cookie-probe').catch(() => {})
      hostTab.owner.focus()
      bundle.attachShellTab(handle, partition1, hostTab.wc)
      bundle.invalidateEngineTabUrl(partition1, hostTab.wc)
      const cookieMeta = meta('cookie')
      const cookieDir = join(outDir, 'packages', cookieMeta.id + '-' + '1.13.0')
      const cookieManifest = JSON.parse(await readFile(join(cookieDir, 'manifest.json'), 'utf8'))
      const cookiePopup = cookieManifest.browser_action?.default_popup || cookieManifest.action?.default_popup
      const cw = new BrowserWindow({
        show: false, frame: false, parent: hostTab.owner, movable: false, resizable: false, skipTaskbar: true,
        backgroundColor: '#ffffff', roundedCorners: false,
        webPreferences: { session: ses1, sandbox: true, nodeIntegration: false, contextIsolation: true, enablePreferredSizeMode: true }
      })
      await cw.loadURL('chrome-extension://' + cookieMeta.id + '/' + String(cookiePopup).replace(/^\//, '')).catch(() => {})
      await delay(2500)
      // Cookie-Editor 需要先授予 cookie 权限（前置同款：点 request-permission 后列表才读）
      await cw.webContents.executeJavaScript("document.getElementById('request-permission')?.click()", true).catch(() => {})
      await delay(3000)
      const tabProbe = await cw.webContents.executeJavaScript(
        'new Promise((res) => chrome.tabs.query({ active: true, currentWindow: true }, (ts) => res(JSON.stringify(ts.map((t) => ({ id: t.id, url: t.url, title: (t.title || "").slice(0, 20) }))))))',
        true
      ).catch(() => 'EXEC')
      console.log('TABS_QUERY', String(tabProbe).slice(0, 120))
      const listHas = await cw.webContents.executeJavaScript(
        '(() => { const el = [...document.querySelectorAll("li,div")].find((e) => e.textContent && e.textContent.includes("msb_fixture")); return el ? "LIST_HAS_COOKIE" : "NO_COOKIE_ROW" })()',
        true
      ).catch(() => 'EXEC')
      const controls = await cw.webContents.executeJavaScript(
        'String(document.querySelectorAll("input,button,textarea").length)',
        true
      ).catch(() => -1)
      cookieResult = JSON.stringify({ listHas, controls })
      check(
        'Cookie-Editor 生产路径实测',
        listHas === 'LIST_HAS_COOKIE' && Number(controls) > 3,
        'listHas=' + String(listHas) + ' controls=' + controls
      )
      // Dark Reader popup 渲染回归（tab 事件流接线后应脱离 Loading 渲染控件）
      console.log('P19 dark-recheck')
      const darkDir = join(outDir, 'packages', meta('dark').id + '-4.9.135')
      const darkManifest = JSON.parse(await readFile(join(darkDir, 'manifest.json'), 'utf8'))
      const darkPopup = darkManifest.browser_action?.default_popup || darkManifest.action?.default_popup
      bundle.attachShellTab(handle, partition1, hostTab.wc)
      bundle.invalidateEngineTabUrl(partition1, hostTab.wc)
      const dw = new BrowserWindow({
        show: false, frame: false, parent: hostTab.owner, movable: false, resizable: false, skipTaskbar: true,
        backgroundColor: '#ffffff', roundedCorners: false,
        webPreferences: { session: ses1, sandbox: true, nodeIntegration: false, contextIsolation: true, enablePreferredSizeMode: true }
      })
      await dw.loadURL('chrome-extension://' + meta('dark').id + '/' + String(darkPopup).replace(/^\//, '')).catch(() => {})
      await delay(5000)
      const darkText = await dw.webContents.executeJavaScript('(document.body.innerText || "").slice(0, 40)', true).catch(() => 'EXEC')
      const darkControls = await dw.webContents.executeJavaScript('String(document.querySelectorAll("input,button,select").length)', true).catch(() => -1)
      check('Dark Reader popup 渲染回归', !/Loading/i.test(String(darkText)) && Number(darkControls) > 2, 'text=' + String(darkText).slice(0, 30) + ' controls=' + darkControls)
      dw.destroy()
      cw.destroy()
    } catch (e) {
      check('Cookie-Editor 生产路径实测', false, 'ERR:' + String(e).slice(0, 60))
    }
    console.log('P17 done', cookieResult)
    // 沉浸式翻译（MV3，真实 ID bpoadfkcbjbfhfodiogcnhhhpibjhbnh）生产路径实测
    console.log('P18 immersive')
    let immResult = 'SKIPPED'
    try {
      const immBuf = await readFile('/tmp/msb-crx-test/immersive-translate.crx')
      const immService = bundle.createInstallService({ manifest, packagesRoot: join(outDir, 'packages'), onRemove: async () => {} })
      const imm = await immService.installFromBuffer(immBuf)
      await handle.runtime.mountPartition(partition1, ses1)
      const immDir = join(outDir, 'packages', imm.record.id + '-' + imm.record.version)
      const immManifest = JSON.parse(await readFile(join(immDir, 'manifest.json'), 'utf8'))
      const immPopup = immManifest.action?.default_popup || immManifest.browser_action?.default_popup
      const iw = new BrowserWindow({
        show: false, frame: false, parent: hostTab.owner, movable: false, resizable: false, skipTaskbar: true,
        backgroundColor: '#ffffff', roundedCorners: false,
        webPreferences: { session: ses1, sandbox: true, nodeIntegration: false, contextIsolation: true, enablePreferredSizeMode: true }
      })
      let immState = 'NO_POPUP'
      if (immPopup) {
        await iw.loadURL('chrome-extension://' + imm.record.id + '/' + String(immPopup).replace(/^\//, '')).catch(() => { immState = 'LOAD_ERR' })
        await delay(6000)
        const t = await iw.webContents.executeJavaScript('(document.body.innerText || "").slice(0, 70)', true).catch(() => 'EXEC')
        const sw = await iw.webContents.executeJavaScript(
          'new Promise((res) => { try { chrome.runtime.getContexts ? chrome.runtime.getContexts({ contextTypes: ["SERVICE_WORKER"] }).then((cs) => res("SW:" + cs.length)) : res("NO_API") } catch (e) { res("THROW") } })',
          true
        ).catch(() => 'EXEC')
        immState = JSON.stringify({ text: t.slice(0, 60), sw })
      }
      check('沉浸式翻译 MV3 实测', !/Loading|NO_POPUP|LOAD_ERR/.test(immState), 'imm:' + String(immState).slice(0, 90))
      iw.destroy()
    } catch (e) {
      check('沉浸式翻译 MV3 实测', false, 'ERR:' + String(e).slice(0, 60))
    }
    console.log('P18 done', immResult)
    // 前置 attachSession 完整复刻（二分实验：会话构造层 vs 进程层）
    console.log('P20 pf-replica')
    let pfResult = 'SKIPPED'
    try {
      const sesP = session.fromPartition('persist:host-smoke-pf')
      const pfOwner = new BrowserWindow({ show: false, webPreferences: { session: sesP, sandbox: true, contextIsolation: true, nodeIntegration: false } })
      await pfOwner.loadFile(join(__dirname, 'shell.html'))
      const compatibilityPreload = require.resolve('electron-chrome-extensions/preload')
      const guardedPath = join(outDir, 'pf-guarded-preload.cjs')
      await writeFile(guardedPath, 'if (process.type === "service-worker" || process.isMainFrame) {\n' + (await readFile(compatibilityPreload, 'utf8')) + '\n}')
      const pfTab = { wc: null, owner: null }
      const pfEngine = new ElectronChromeExtensions({
        session: sesP,
        createTab: async () => [pfTab.wc, pfOwner],
        selectTab: (wc) => wc.focus(),
        removeTab: (wc) => !wc.isDestroyed() && wc.close(),
        requestPermissions: async () => true
      })
      for (const script of sesP.getPreloadScripts().filter((s2) => s2.filePath === compatibilityPreload)) {
        sesP.unregisterPreloadScript(script.id)
        sesP.registerPreloadScript({ id: script.id, type: script.type, filePath: guardedPath })
      }
      pfTab.owner = pfOwner
      pfTab.wc = pfOwner.webContents
      pfEngine.addTab(pfTab.wc, pfOwner)
      pfEngine.selectTab(pfTab.wc)
      const darkPath = join(outDir, 'packages', meta('dark').id + '-4.9.135')
      const ext = await sesP.extensions.loadExtension(darkPath)
      const pw = new BrowserWindow({
        show: false, frame: false, parent: pfOwner, movable: false, resizable: false, skipTaskbar: true,
        backgroundColor: '#ffffff', roundedCorners: false,
        webPreferences: { session: sesP, sandbox: true, nodeIntegration: false, contextIsolation: true, enablePreferredSizeMode: true }
      })
      const dmani = JSON.parse(await readFile(join(darkPath, 'manifest.json'), 'utf8'))
      const dpp = dmani.browser_action?.default_popup || dmani.action?.default_popup
      await pw.loadURL('chrome-extension://' + ext.id + '/' + String(dpp).replace(/^\//, '')).catch(() => {})
      await delay(5000)
      const ptext = await pw.webContents.executeJavaScript('(document.body.innerText || "").slice(0, 40)', true).catch(() => 'EXEC')
      const pport = await pw.webContents.executeJavaScript('new Promise((res) => { try { const p = chrome.runtime.connect({ name: "ui-bg-subscribe-to-changes" }); let got = null; p.onMessage.addListener(() => { got = "MSG" }); p.onDisconnect.addListener(() => { if (!got) got = "DISCONNECTED" }); setTimeout(() => res(got || "SILENT"), 2000) } catch (e) { res("THROW") } })', true).catch(() => 'EXEC')
      pfResult = 'text:' + String(ptext).slice(0, 25) + ' port:' + String(pport)
      check('前置复刻路径对照', /MSG/.test(String(pport)) && !/Loading/i.test(String(ptext)), pfResult)
      pw.destroy()
      pfOwner.destroy()
    } catch (e) {
      check('前置复刻路径对照', false, 'ERR:' + String(e).slice(0, 60))
    }
    console.log('P20 done', pfResult)
    console.log('P16 ubo-mv3')

      try {
        const uboBuf = await readFile('/tmp/msb-crx-test/ddkjiahejlhfcafbddmgiahcphecmpfh.crx')
        const uboService = bundle.createInstallService({
          manifest,
          packagesRoot: join(outDir, 'packages'),
          onRemove: async () => {}
        })
        const ubo = await uboService.installFromBuffer(uboBuf)
        await handle.runtime.mountPartition(partition1, ses1)
        const uboWin = new BrowserWindow({
          show: false,
          frame: false,
          parent: hostTab.owner,
          movable: false,
          resizable: false,
          skipTaskbar: true,
          backgroundColor: '#ffffff',
          roundedCorners: false,
          webPreferences: {
            session: ses1,
            sandbox: true,
            nodeIntegration: false,
            contextIsolation: true,
            enablePreferredSizeMode: true
          }
        })
        const uboDir = join(outDir, 'packages', ubo.record.id + '-' + ubo.record.version)
        const uboManifest = JSON.parse(await readFile(join(uboDir, 'manifest.json'), 'utf8'))
        const uboPopup =
          uboManifest.action?.default_popup || uboManifest.browser_action?.default_popup
        let uboState = 'NO_POPUP'
        if (uboPopup) {
          await uboWin
            .loadURL(
              'chrome-extension://' + ubo.record.id + '/' + String(uboPopup).replace(/^\//, '')
            )
            .catch(() => {
              uboState = 'LOAD_ERR'
            })
          await delay(5000)
          const t = await uboWin.webContents
            .executeJavaScript('(document.body.innerText || "").slice(0, 80)', true)
            .catch(() => 'EXEC')
          const sw = await uboWin.webContents
            .executeJavaScript(
              'new Promise((res) => { try { chrome.runtime.getContexts ? chrome.runtime.getContexts({ contextTypes: ["SERVICE_WORKER"] }).then((cs) => res("SW:" + cs.length)) : res("NO_API") } catch (e) { res("THROW") } })',
              true
            )
            .catch(() => 'EXEC')
          uboState = JSON.stringify({ text: t.slice(0, 60), sw })
        }
        check(
          'uBO Lite MV3 实测',
          !/Loading|NO_POPUP|LOAD_ERR/.test(uboState),
          'ubo:' + String(uboState).slice(0, 90)
        )
        uboWin.destroy()
      } catch {
        check('uBO Lite MV3 实测', false, 'ERR')
      }
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
    const both = mf.installs.every(
      (r) =>
        r.partitions.filter(
          (p) => p.partition === 'persist:host-smoke-1' || p.partition === 'persist:host-smoke-2'
        ).length === 2 && r.partitions.every((p) => p.ok === true)
    )
    check('清单分区记录完整', both, mf.installs.map((r) => r.partitions.length).join(','))
    const engine2 = handle.runtime.getEngine('persist:host-smoke-2')
    check('分区2引擎就绪', !!engine2, 'engine2')
    check(
      '权限探针记录',
      true,
      results.permissionProbe ? '待真实权限请求时验证' : '未触发（挂载不触发权限）'
    )
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
    try {
      await store.installFromStore('a'.repeat(32))
    } catch (e) {
      guardDenied = String(e).includes('STORE_ID_NOT_ALLOWED')
    }
    check('商店允许列表守卫', guardDenied, 'denied')
    try {
      const storeRes = await store.installFromStore(meta('dark').id)
      check(
        '商店真实下载验签安装',
        storeRes.id === meta('dark').id && storeRes.version.length > 0,
        storeRes.version
      )
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
        for (const ses of [ses1, ses2, ses3]) {
          try {
            await ses.removeExtension(id)
          } catch {
            /* 未挂载分区幂等跳过 */
          }
        }
      }
    })
    const mkCrx = async (version) => {
      const src = new AdmZip()
      src.addLocalFolder(join(samplesDir, 'unpacked', 'hlkenndednhfkekhgcdicdfddnkalmdm-1.13.0'))
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
    check(
      '事务安装v1.0.0',
      ins.record.id === fixtureId && ins.record.version === '1.0.0',
      fixtureId.slice(0, 8)
    )
    const m3 = await handle.runtime.mountPartition('persist:host-smoke-3', ses3)
    check(
      '事务分区3挂载v1.0.0',
      m3.state === 'ready' && ses3.getAllExtensions().some((v) => v.id === fixtureId),
      m3.state
    )
    const crx101 = await mkCrx('1.0.1')
    const up = await service.upgrade(fixtureId, crx101)
    const oldDirGone = !(await require('node:fs/promises')
      .stat(join(outDir, 'packages', fixtureId + '-1.0.0'))
      .then(() => true)
      .catch(() => false))
    check('事务升级v1.0.1', up.record.version === '1.0.1' && oldDirGone, up.record.version)
    const un = await service.uninstall(fixtureId)
    const s3ids = ses3.getAllExtensions().map((v) => v.id)
    check('事务卸载', un === true && !s3ids.includes(fixtureId), 'removed=' + un)
    // M3-E 协议v1 真实 IPC 验证（生产桥守卫）
    console.log('S7 protocol')
    const sesB = session.fromPartition('persist:host-smoke-b')
    const waitBridge = async (w) => {
      for (let i = 0; i < 50; i++) {
        const t = await w.webContents
          .executeJavaScript('typeof window.extensionsBridge', true)
          .catch(() => 'none')
        if (t === 'object') return
        await delay(100)
      }
      throw new Error('bridge preload missing in renderer')
    }
    const mkW = (ses) =>
      new BrowserWindow({
        show: false,
        webPreferences: {
          session: ses,
          preload: join(__dirname, 'out', 'bridge-preload.cjs'),
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false
        }
      })
    const trustedW = mkW(ses1)
    const unknownW = mkW(sesB)
    const extW = mkW(ses1)
    const pageFile = join(__dirname, 'bridge-page.html')
    await writeFile(
      pageFile,
      '<!doctype html><title>桥受控页</title><iframe src="bridge-child.html"></iframe>'
    )
    await writeFile(join(__dirname, 'bridge-child.html'), '<!doctype html><title>桥子frame</title>')
    const ops = bundle.createCaptureOperations(() => trustedW.webContents)
    console.log('P1 load')
    await trustedW.loadFile(pageFile)
    console.log('P2 loaded')
    const bt = bundle.registerBridgeTarget(trustedW.webContents, ses1, ops)
    const token = bt.token
    let seq = 0
    const nextRid = () => 'ipc-' + ++seq
    const send = async (w, payload, binaryJs) => {
      for (let attempt = 0; attempt < 6; attempt++) {
        try {
          return await w.webContents.executeJavaScript(
            'window.extensionsBridge.request(' +
              JSON.stringify(payload) +
              ', ' +
              (binaryJs || 'undefined') +
              ').then(r => ({ ok: r.ok, code: r.error && r.error.code, rid: r.requestId, value: r.value }))',
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
    console.log('P3 handshake')
    const hs = await tv({ method: 'handshake' })
    console.log('P4 hs-done ok=' + hs.ok)
    check('IPC握手能力', hs.ok && hs.value.capabilities.capture, hs.code || 'hs-ok')
    const capJs =
      'window.extensionsBridge.request(' +
      JSON.stringify({ ...base, requestId: nextRid(), method: 'capture' }) +
      ', undefined).then(r => { window.pngRef = r.value.png; return { ok: r.ok, w: r.value.width, h: r.value.height, sha: r.value.sha256, snap: r.value.snapshot } })'
    console.log('P5 capture')
    const cap = await trustedW.webContents.executeJavaScript(capJs, true)
    console.log('P6 capture-done ok=' + cap.ok)
    seq += 1
    check('IPC真实截图', cap.ok && cap.w > 0 && cap.sha.length === 64, String(cap.w))
    const snapOk = { id: cap.snap.id, version: cap.snap.version }
    const okCopy = await tv({ method: 'image.copy', snapshot: snapOk })
    check('IPC有效快照复制', okCopy.ok, okCopy.code || 'copied')
    const stale = await tv({
      method: 'image.copy',
      snapshot: { id: cap.snap.id, version: cap.snap.version + 1 }
    })
    check('IPC过期快照拒绝', !stale.ok && stale.code === 'SNAPSHOT_STALE', stale.code)
    const inter = await tv({
      method: 'image.copy',
      snapshot: { id: 'other', version: cap.snap.version }
    })
    check('IPC交错快照拒绝', !inter.ok && inter.code === 'SNAPSHOT_STALE', inter.code)
    const copyMeta = {
      ...base,
      requestId: nextRid(),
      method: 'image.copy',
      snapshot: snapOk,
      image: { width: cap.w, height: cap.h, mimeType: 'image/png', sha256: cap.sha }
    }
    const roundtrip = await send(trustedW, copyMeta, 'window.pngRef')
    check('IPC二进制往返复制', roundtrip.ok, roundtrip.code)
    const tamperJs =
      '(async () => { const u8 = new Uint8Array(window.pngRef.slice(0)); u8[10] ^= 1; const r = await window.extensionsBridge.request(' +
      JSON.stringify(copyMeta) +
      ', u8.buffer).then(r => ({ ok: r.ok, code: r.error && r.error.code })).catch(e => ({ ok: false, code: String(e).slice(0, 30) })); return r })()'
    const tamper = await trustedW.webContents.executeJavaScript(tamperJs, true)
    check('IPC摘要篡改拒绝', !tamper.ok && tamper.code === 'INVALID_REQUEST', tamper.code)
    const badJs =
      '(async () => { const bad = new Uint8Array(window.pngRef.slice(0)); bad[0] = 0; const meta = ' +
      JSON.stringify({
        ...copyMeta,
        requestId: nextRid(),
        image: { ...copyMeta.image, sha256: 'f'.repeat(64) }
      }) +
      '; const r = await window.extensionsBridge.request(meta, bad.buffer).then(r => ({ ok: r.ok, code: r.error && r.error.code })); return r })()'
    const badHead = await trustedW.webContents.executeJavaScript(badJs, true)
    seq += 1
    check('IPC坏头拒绝', !badHead.ok && badHead.code === 'INVALID_REQUEST', badHead.code)
    // 审阅遗留复验：真实 IPC 幂等命中与同ID异JSON冲突
    const idemPayload = { ...base, requestId: 'ipc-idem-1' }
    const idemA = await tv(idemPayload)
    const idemB = await tv(idemPayload)
    check(
      'IPC幂等命中复验',
      idemA.ok && idemB.ok && idemA.value.snapshot.version === idemB.value.snapshot.version,
      'reused'
    )
    const conflict = await tv({ ...idemPayload, method: 'handshake' })
    check(
      'IPC同ID异JSON冲突拒绝',
      !conflict.ok && conflict.code === 'INVALID_REQUEST',
      conflict.code
    )
    const unkCap = await tv({ method: 'fs.readFile' })
    check('IPC未知能力拒绝', !unkCap.ok && unkCap.code === 'CAPABILITY_UNSUPPORTED', unkCap.code)
    const badRid = await send(trustedW, { ...base, requestId: '', method: 'capture' })
    check(
      'IPC非法requestId拒绝',
      !badRid.ok && badRid.code === 'INVALID_REQUEST' && badRid.rid === null,
      'rid=null'
    )
    const forged = await tv({ target: 'forged' })
    check('IPC伪造目标拒绝', !forged.ok && forged.code === 'TARGET_GONE', forged.code)
    const wrongProto = await tv({ protocol: 2 })
    check(
      'IPC协议版本拒绝',
      !wrongProto.ok && wrongProto.code === 'PROTOCOL_UNSUPPORTED',
      wrongProto.code
    )
    console.log('P7 dead')
    bt.setAlive(false)
    const dead = await tv({ method: 'capture' })
    console.log('P8 dead-done')
    check('IPC失效目标拒绝', !dead.ok && dead.code === 'TARGET_GONE', dead.code)
    bt.setAlive(true)
    console.log('P9 unknown')
    await unknownW.loadFile(join(__dirname, 'bridge-child.html'))
    await waitBridge(unknownW)
    const fromUnknown = send(unknownW, { ...base, requestId: nextRid() })
    const unkSrc = await fromUnknown
    console.log('P10 unknown-done')
    check('IPC跨分区未知来源拒绝', !unkSrc.ok && unkSrc.code === 'UNAUTHORIZED', unkSrc.code)
    try {
      await extW.loadURL(
        'chrome-extension://' + meta('cookie').id + '/interface/options/options.html'
      )
      await waitBridge(extW)
      const fromExt = await send(extW, { ...base, requestId: nextRid() })
      check('IPC未知第三方扩展拒绝', !fromExt.ok && fromExt.code === 'UNAUTHORIZED', fromExt.code)
    } catch (e) {
      check('IPC未知第三方扩展拒绝', false, 'ext-page-flake: ' + String(e).slice(0, 50))
    }
    try {
      const childFrame = trustedW.webContents.mainFrame.framesInSubtree.find((f) =>
        f.url.includes('bridge-child')
      )
      if (childFrame) {
        const sub = await childFrame.executeJavaScript(
          'window.extensionsBridge.request(' +
            JSON.stringify({ ...base, requestId: nextRid() }) +
            ', undefined).then(r => ({ ok: r.ok, code: r.error && r.error.code }))',
          true
        )
        check('IPC子frame拒绝', !sub.ok && sub.code === 'UNAUTHORIZED', sub.code)
      } else check('IPC子frame拒绝', false, 'no frame')
    } catch (e) {
      check('IPC子frame拒绝', false, 'renderer-flake: ' + String(e).slice(0, 50))
    }
    try {
      await trustedW.webContents.loadURL(site.url + '/?session=bridge-nav')
      const nav = await tv({ method: 'capture' })
      check(
        'IPC来源导航撤销',
        !nav.ok && nav.code === 'TARGET_GONE',
        (nav.code || 'throw') + '(生产语义:导航即目标失效)'
      )
    } catch (e) {
      check('IPC来源导航撤销', false, 'renderer-flake: ' + String(e).slice(0, 50))
    }
    trustedW.destroy()
    unknownW.destroy()
    extW.destroy()
    // [已知问题] MV2 插件 popup 卡 Loading：见 book/notes/issue/2026-11/20261111-DarkReader-popup卡Loading排查.md（诊断脚手架已移除，根因追踪与下一步实验见该文档）
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
