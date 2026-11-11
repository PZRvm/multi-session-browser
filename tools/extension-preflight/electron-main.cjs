/* eslint @typescript-eslint/explicit-function-return-type: off, @typescript-eslint/no-require-imports: off -- 独立验证脚本使用原生 JavaScript，sandbox preload 使用 CommonJS */
const {
  app,
  BrowserWindow,
  WebContentsView,
  session,
  ipcMain,
  clipboard,
  nativeImage,
  Menu
} = require('electron')
const { join } = require('node:path')
const { pathToFileURL } = require('node:url')
const { mkdir, readFile, writeFile } = require('node:fs/promises')
const { createRequire } = require('node:module')
const { ElectronChromeExtensions } = require('electron-chrome-extensions')
const rootRequire = createRequire(join(__dirname, '../../package.json'))
const output = process.argv[2]
if (!output || !output.includes('.artifacts')) throw new Error('必须指定工具专属证据目录')
const mode = process.argv[3] || 'auto'
app.setPath('userData', join(output, 'profile-electron'))
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
app.on('window-all-closed', () => {})
const results = {
  platform: process.platform,
  versions: process.versions,
  checks: [],
  pending: ['Windows real-device verification', 'Overall admission: see current book Todo']
}
const diagnostics = []
app.on('web-contents-created', (_event, wc) => {
  wc.on('preload-error', (_event, path, error) =>
    diagnostics.push({
      kind: 'preload-error',
      type: wc.getType(),
      url: wc.getURL(),
      path,
      stack: error.stack
    })
  )
  wc.on('console-message', (details) => {
    if (details.level === 'error')
      diagnostics.push({
        kind: 'console',
        type: wc.getType(),
        url: wc.getURL(),
        message: details.message,
        source: details.sourceId
      })
  })
})
const windows = [],
  engines = [],
  pages = []
let site, collector, currentPopup
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
async function waitFor(read, message, timeout = 5000) {
  const deadline = Date.now() + timeout
  do {
    const value = await read()
    if (value) return value
    await delay(50)
  } while (Date.now() < deadline)
  throw new Error(message)
}
function assert(ok, message) {
  if (!ok) throw new Error(message)
}
async function record(name, fn) {
  try {
    const detail = await fn()
    results.checks.push({ name, status: 'pass', detail })
    console.log(JSON.stringify({ name, status: 'pass' }))
  } catch (error) {
    results.checks.push({ name, status: 'fail', error: String(error) })
    console.error(JSON.stringify({ name, status: 'fail', error: String(error) }))
  }
  await writeFile(join(output, 'electron-results.json'), JSON.stringify(results, null, 2))
}
function createPage(owner, targetSession, partition, engine, label) {
  const view = new WebContentsView({
    webPreferences: {
      session: targetSession,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  owner.contentView.addChildView(view)
  view.setBounds({ x: 0, y: 70, width: 1024, height: 650 })
  owner.on('resize', () => {
    if (!owner.isDestroyed()) {
      const [width, height] = owner.getContentSize()
      view.setBounds({ x: 0, y: 70, width, height: Math.max(1, height - 70) })
    }
  })
  if (engine) {
    engine.addTab(view.webContents, owner)
    engine.selectTab(view.webContents)
  }
  const value = { owner, view, wc: view.webContents, targetSession, partition, engine, label }
  pages.push(value)
  return value
}
async function openAction(page, extensionId) {
  currentPopup = null
  page.owner.focus()
  page.wc.focus()
  await page.owner.webContents.executeJavaScript(
    `window.browserAction.activate(${JSON.stringify(page.partition)},{eventType:'click',extensionId:${JSON.stringify(extensionId)},tabId:${page.wc.id},alignment:'bottom left',anchorRect:{x:20,y:20,width:30,height:30}})`,
    true
  )
  for (let i = 0; i < 30 && !currentPopup; i++) await delay(100)
  assert(currentPopup, '没有创建标准 action popup')
  await currentPopup.whenReady()
  await delay(500)
  const wc = currentPopup.browserWindow?.webContents
  assert(wc && !wc.isDestroyed(), 'popup 已销毁')
  return wc
}
async function main() {
  await mkdir(app.getPath('userData'), { recursive: true })
  await app.whenReady()
  const { startSite } = await import(pathToFileURL(join(__dirname, 'server.mjs')).href)
  site = await startSite()
  results.site = site.url
  const samples = JSON.parse(
    await readFile(join(__dirname, 'out/.artifacts/samples/samples.json'), 'utf8')
  ).samples
  if (mode.endsWith('-fixed')) {
    const { buildReactFork } = await import(pathToFileURL(join(__dirname, 'react-fork.mjs')).href)
    const fixed = await buildReactFork(samples)
    samples.splice(
      samples.findIndex((s) => s.name === 'react'),
      1,
      fixed
    )
    results.reactVariant = {
      variant: fixed.variant,
      id: fixed.id,
      version: fixed.version,
      upstream: fixed.upstream
    }
  } else
    results.reactVariant = {
      variant: 'official',
      id: samples.find((s) => s.name === 'react').id,
      version: '8.0.0'
    }
  const reactId = samples.find((s) => s.name === 'react').id
  const { build } = rootRequire('esbuild')
  const preload = join(output, 'action-preload.cjs')
  await build({
    stdin: {
      contents:
        "import {injectBrowserAction} from 'electron-chrome-extensions/browser-action';injectBrowserAction()",
      resolveDir: __dirname
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
    outfile: preload
  })
  const compatibilityPreload = require.resolve('electron-chrome-extensions/preload')
  const guardedPreload = join(output, 'guarded-extension-preload.cjs')
  await writeFile(
    guardedPreload,
    `if (process.type === 'service-worker' || process.isMainFrame) {\n${await readFile(compatibilityPreload, 'utf8')}\n}`
  )
  ElectronChromeExtensions.handleCRXProtocol(session.defaultSession)
  const shell = join(output, 'shell.html')
  await writeFile(
    shell,
    '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>插件前置验证宿主</title><body><browser-action-list></browser-action-list></body></html>'
  )
  async function attachSession(label) {
    const partition = `persist:preflight-${label.toLowerCase()}`
    const ses = session.fromPartition(partition)
    let owner
    const engine = new ElectronChromeExtensions({
      session: ses,
      createTab: async (details) => {
        const p = createPage(owner, ses, partition, engine, label)
        await p.wc.loadURL(details.url || site.url)
        return [p.wc, owner]
      },
      selectTab: (wc) => {
        wc.focus()
      },
      removeTab: (wc) => {
        if (!wc.isDestroyed()) wc.close()
      },
      requestPermissions: async (extension, permissions) => {
        console.log('权限请求', JSON.stringify({ id: extension.id, permissions }))
        return (
          extension.id === 'hlkenndednhfkekhgcdicdfddnkalmdm' &&
          (permissions.origins ?? []).every(
            (origin) =>
              /^http:\/\/(?:\*\.)?(?:[a-z0-9-]+\.)*localhost\/\*$/.test(origin) ||
              origin === `${site.url}/*`
          ) &&
          (permissions.permissions ?? []).every((permission) => permission === 'cookies')
        )
      }
    })
    for (const script of ses
      .getPreloadScripts()
      .filter((s) => s.filePath === compatibilityPreload)) {
      ses.unregisterPreloadScript(script.id)
      ses.registerPreloadScript({ id: script.id, type: script.type, filePath: guardedPreload })
    }
    engine.on('browser-action-popup-created', (popup) => {
      currentPopup = popup
    })
    engines.push(engine)
    for (const sample of samples.filter((v) => v.path)) {
      await record(`加载 ${sample.name} / ${label}`, async () => {
        const ext = await ses.extensions.loadExtension(sample.path)
        assert(ext.id === sample.id, '扩展ID漂移')
        return { id: ext.id, version: ext.version }
      })
    }
    owner = new BrowserWindow({
      width: 1024,
      height: 760,
      title: `前置验证 ${label}`,
      show: true,
      webPreferences: { preload, sandbox: true, nodeIntegration: false, contextIsolation: true }
    })
    windows.push(owner)
    owner.webContents.on('will-navigate', (event, url) => {
      if (url !== pathToFileURL(shell).href) event.preventDefault()
    })
    owner.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    await owner.loadFile(shell)
    const page = createPage(owner, ses, partition, engine, label)
    if (label === 'C')
      assert(
        samples
          .filter((v) => v.path)
          .every((sample) => ses.extensions.getExtension(sample.id)?.version === sample.version),
        '后建分区首导航前插件未全部加载'
      )
    await page.wc.loadURL(`${site.url}/?session=${label}`)
    await owner.webContents.executeJavaScript(
      `document.querySelector('browser-action-list').setAttribute('partition',${JSON.stringify(partition)});document.querySelector('browser-action-list').setAttribute('tab','${page.wc.id}')`
    )
    await ses.cookies.set({ url: site.url, name: 'msb_fixture', value: label })
  }
  await attachSession('A')
  await attachSession('B')
  await delay(1500)
  const [a, b] = pages
  await Promise.all([
    a.wc.loadURL(`${site.url}/?session=A${mode.startsWith('sync') ? '&avsync=1' : ''}`),
    b.wc.loadURL(`${site.url}/?session=B`)
  ])
  await delay(1000)
  await record('同源Cookie及输入隔离', async () => {
    await a.wc.executeJavaScript("document.getElementById('draft').value='仅A'", true)
    const left = await a.wc.executeJavaScript('document.cookie'),
      right = await b.wc.executeJavaScript('document.cookie')
    assert(left.includes('msb_fixture=A') && right.includes('msb_fixture=B'), 'Cookie串分区')
    assert(
      (await b.wc.executeJavaScript("document.getElementById('draft').value")) === '',
      '输入串分区'
    )
    assert(
      (await a.wc.executeJavaScript("typeof window.api + '/' + typeof require")) ===
        'undefined/undefined',
      '普通页面获得Node或应用桥'
    )
    return { left, right }
  })
  for (const sampleName of ['dark', 'cookie', 'react']) {
    const sample = samples.find((v) => v.name === sampleName)
    await record(`${sampleName} 标准 action popup`, async () => {
      const wc = await openAction(a, sample.id)
      if (sampleName === 'cookie') {
        await wc.executeJavaScript("document.getElementById('request-permission')?.click()", true)
        await waitFor(
          () => wc.executeJavaScript("document.body.innerText.includes('msb_fixture')"),
          'Cookie权限后列表未就绪'
        )
      }
      const state = await wc.executeJavaScript(
        `({url:location.href,text:document.body.innerText.slice(0,5000),controls:[...document.querySelectorAll('button,input,select')].map(e=>({tag:e.tagName,id:e.id,title:e.title,text:e.innerText,type:e.type})).slice(0,40)})`
      )
      await writeFile(join(output, `${sampleName}-popup.png`), (await wc.capturePage()).toPNG())
      await writeFile(join(output, `${sampleName}-popup.json`), JSON.stringify(state, null, 2))
      assert(state.url.startsWith(`chrome-extension://${sample.id}/`), '弹出页来源不符')

      if (sampleName === 'cookie') {
        const { exerciseCookie } = await import(
          pathToFileURL(join(__dirname, 'cookie-check.mjs')).href
        )
        state.functional = await exerciseCookie({
          evaluate: (expression) => wc.executeJavaScript(expression, true),
          getCookies: (filter) => a.targetSession.cookies.get(filter),
          getOtherCookies: (filter) => b.targetSession.cookies.get(filter),
          removeCookie: (url, name) => a.targetSession.cookies.remove(url, name),
          readClipboard: () => clipboard.readText(),
          resetClipboard: () => clipboard.writeText('preflight-empty'),
          url: site.url
        })
      }
      if (sampleName === 'dark') {
        const before = await a.wc.executeJavaScript(
          "document.documentElement.getAttribute('data-darkreader-mode')"
        )
        await wc.executeJavaScript("document.querySelector('.toggle__off')?.click()", true)
        await delay(500)
        const off = await a.wc.executeJavaScript(
          "document.documentElement.getAttribute('data-darkreader-mode')"
        )
        await wc.executeJavaScript("document.querySelector('.toggle__on')?.click()", true)
        await delay(500)
        const on = await a.wc.executeJavaScript(
          "document.documentElement.getAttribute('data-darkreader-mode')"
        )
        state.functionalToggle = { before, off, on }
        assert(off !== on && on, 'Dark Reader On/Off没有改变目标页面')
        const bBefore = await b.wc.executeJavaScript(
          "document.documentElement.getAttribute('data-darkreader-mode')"
        )
        const clickSite = `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(new URL(site.url).host)}).click()`
        await wc.executeJavaScript(clickSite, true)
        await waitFor(
          async () =>
            !(await a.wc.executeJavaScript(
              "document.documentElement.getAttribute('data-darkreader-mode')"
            )),
          '站点例外未生效'
        )
        assert(
          (await b.wc.executeJavaScript(
            "document.documentElement.getAttribute('data-darkreader-mode')"
          )) === bBefore,
          '站点例外污染B分区'
        )
        await wc.executeJavaScript(clickSite, true)
        await waitFor(
          () =>
            a.wc.executeJavaScript("document.documentElement.getAttribute('data-darkreader-mode')"),
          '站点例外恢复失败'
        )
        state.siteException = { disabled: true, restored: true, isolated: true }
      }
      currentPopup.destroy()
      return state
    })

  await record('dark popup background 存活探针', async () => {
    const target = samples.find((v) => v.name === 'dark')
    const manifest = JSON.parse(await readFile(join(target.path, 'manifest.json'), 'utf8'))
    const pp = manifest.browser_action?.default_popup || manifest.action?.default_popup
    const w = new BrowserWindow({
      show: false,
      frame: false,
      parent: a.owner,
      resizable: false,
      skipTaskbar: true,
      webPreferences: { session: a.targetSession, sandbox: true, contextIsolation: true }
    })
    await w.loadURL('chrome-extension://' + target.id + '/' + String(pp).replace(/^\//, '')).catch(() => {})
    await delay(3000)
    const bgProbe = await w.webContents.executeJavaScript(
      'new Promise((res) => { chrome.runtime.getBackgroundPage((bg) => res(bg ? "ALIVE" : "NULL")) })',
      true
    ).catch((e) => 'EXEC:' + String(e).slice(0, 50))
    const text = await w.webContents.executeJavaScript(
      '(document.body.innerText || "").slice(0, 50)',
      true
    ).catch(() => 'EXEC')
    w.destroy()
    assert(bgProbe === 'ALIVE', 'background 页未运行: ' + String(bgProbe))
    assert(!/Loading/i.test(String(text)), 'popup 卡 Loading: ' + String(text))
    return { bgProbe, text }
  })

  await record('dark popup 自研窗口对照（生产同构）', async () => {
    // 生产 management.ts openExtensionPopup 的同构窗口（参数逐项一致）
    const manifest = JSON.parse(await readFile(join(samples.find((v) => v.name === 'dark').path, 'manifest.json'), 'utf8'))
    const pp = manifest.browser_action?.default_popup || manifest.action?.default_popup
    const w = new BrowserWindow({
      show: false,
      frame: false,
      parent: a.owner,
      movable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      resizable: false,
      skipTaskbar: true,
      backgroundColor: '#ffffff',
      roundedCorners: false,
      webPreferences: {
        session: a.targetSession,
        sandbox: true,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        contextIsolation: true,
        enablePreferredSizeMode: true
      }
    })
    await w.loadURL('chrome-extension://' + samples.find((v) => v.name === 'dark').id + '/' + String(pp).replace(/^\//, '')).catch(() => {})
    await delay(4000)
    const text = await w.webContents.executeJavaScript(
      '(document.body.innerText || "").slice(0, 60)',
      true
    ).catch((e) => 'EXEC:' + String(e).slice(0, 50))
    const port = await w.webContents.executeJavaScript(
      'new Promise((res) => { try { const p = chrome.runtime.connect({ name: "ui-bg-subscribe-to-changes" }); let got = null; p.onMessage.addListener(() => { got = "MSG" }); p.onDisconnect.addListener(() => { if (!got) got = "DISCONNECTED" }); setTimeout(() => res(got || "SILENT"), 2000) } catch (e) { res("THROW") } })',
      true
    ).catch(() => 'EXEC')
    w.destroy()
    return { text, port }
  })
  }
  async function inspectReact(a, expected, output) {
    await mkdir(output, { recursive: true })

    a.wc.openDevTools({ mode: 'detach', activate: false })
    await waitFor(
      async () => {
        const wc = a.wc.devToolsWebContents
        if (!wc) return false
        try {
          return await wc.executeJavaScript(
            `(async()=>{const UI=await import('devtools://devtools/bundled/ui/legacy/legacy.js');return UI.InspectorView.InspectorView.instance().tabbedPane.tabIds().some(id=>id.includes('${reactId}Profiler'))})()`
          )
        } catch {
          return false
        }
      },
      'React DevTools面板未注册',
      10000
    )
    const hook = await a.wc.executeJavaScript(
      '({present:!!window.__REACT_DEVTOOLS_GLOBAL_HOOK__,renderers:window.__REACT_DEVTOOLS_GLOBAL_HOOK__?.renderers?.size||0})'
    )
    assert(hook.present && hook.renderers > 0, 'React渲染器未检出')
    const devtools = a.wc.devToolsWebContents
    assert(devtools && !devtools.isDestroyed(), 'DevTools在验证前关闭')
    if (devtools) {
      await writeFile(join(output, 'devtools.png'), (await devtools.capturePage()).toPNG())
      results.devtoolsText = await devtools.executeJavaScript(
        'document.body.innerText.slice(0,8000)'
      )
    }
    if (devtools) {
      await writeFile(
        join(output, 'devtools-frames.json'),
        JSON.stringify(
          devtools.mainFrame.framesInSubtree.map((f) => ({ url: f.url, name: f.name })),
          null,
          2
        )
      )
      results.devtoolsPanelRegistry = await devtools.executeJavaScript(
        `(async()=>{const UI=await import('devtools://devtools/bundled/ui/legacy/legacy.js');const inspector=UI.InspectorView.InspectorView.instance();return {ids:inspector.tabbedPane.tabIds()}})()`
      )
      const componentsId = results.devtoolsPanelRegistry.ids.find((id) =>
        id.includes(reactId + 'Components')
      )
      const profilerId = results.devtoolsPanelRegistry.ids.find((id) =>
        id.includes(reactId + 'Profiler')
      )
      assert(componentsId && profilerId, 'React Components/Profiler未注册')
      await devtools.executeJavaScript(
        `(async()=>{const UI=await import('devtools://devtools/bundled/ui/legacy/legacy.js');await UI.InspectorView.InspectorView.instance().showPanel(${JSON.stringify(componentsId)})})()`
      )
      const componentsFrame = await waitFor(async () => {
        for (const frame of devtools.mainFrame.framesInSubtree.filter(
          (f) => f.url === `chrome-extension://${reactId}/panel.html`
        )) {
          if (
            await frame.executeJavaScript(
              `!![...document.querySelectorAll('[data-testname="ComponentTreeListItem"]')].find(e=>e.textContent.includes('Fixture'))`
            )
          )
            return frame
        }
        return false
      }, 'Components未显示Fixture组件')
      await componentsFrame.executeJavaScript(
        `{const row=[...document.querySelectorAll('[data-testname="ComponentTreeListItem"]')].find(e=>e.textContent.includes('Fixture'));if(!row)throw new Error('Fixture未显示');row.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));row.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));row.click()}`,
        true
      )
      results.reactInspectedProps = await waitFor(async () => {
        const value = await componentsFrame.executeJavaScript(
          "({text:document.body.innerText,inputs:[...document.querySelectorAll('input')].map(e=>({value:e.value,label:e.getAttribute('aria-label')}))})"
        )
        results.reactPropsObserved = value
        return value.inputs.some(
          (input, index) =>
            input.value === 'session' && value.inputs[index + 1]?.value === JSON.stringify(expected)
        )
          ? value
          : false
      }, 'Components未显示Fixture.session=A')
      results.invalidSvgPaths = await componentsFrame.executeJavaScript(
        "[...document.querySelectorAll('path')].filter(p=>p.getAttribute('d')==='[object Object]').length"
      )
      results.restoredIconPolygons = await componentsFrame.executeJavaScript(
        "document.querySelectorAll('svg g polygon').length"
      )
      await writeFile(join(output, 'react-components.png'), (await devtools.capturePage()).toPNG())
      await devtools.executeJavaScript(
        `(async()=>{const UI=await import('devtools://devtools/bundled/ui/legacy/legacy.js');await UI.InspectorView.InspectorView.instance().showPanel(${JSON.stringify(profilerId)})})()`
      )
      const profilerFrame = await waitFor(async () => {
        for (const frame of devtools.mainFrame.framesInSubtree.filter(
          (f) => f.url === `chrome-extension://${reactId}/panel.html`
        )) {
          if (
            await frame.executeJavaScript(
              `!![...document.querySelectorAll('button')].find(e=>e.textContent==='Start recording')`
            )
          )
            return frame
        }
        return false
      }, 'Profiler未显示开始录制按钮')
      await profilerFrame.executeJavaScript(
        `{const start=[...document.querySelectorAll('button')].find(e=>e.textContent==='Start recording');if(!start)throw new Error('录制按钮不存在');start.click()}`,
        true
      )
      await waitFor(
        () =>
          profilerFrame.executeJavaScript(
            "document.body.innerText.includes('Profiling is in progress')"
          ),
        'Profiler未开始'
      )
      await delay(2500)
      await profilerFrame.executeJavaScript(
        `{const stop=[...document.querySelectorAll('button')].find(e=>e.textContent==='Stop recording');if(!stop)throw new Error('结束按钮不存在');stop.click()}`,
        true
      )
      results.reactProfile = await waitFor(async () => {
        const text = await profilerFrame.executeJavaScript('document.body.innerText')
        results.reactProfilerObserved = text
        return text.includes('Commit information') &&
          text.includes('Committed at:') &&
          text.includes('Fixture')
          ? text
          : false
      }, 'Profiler未产生提交结果')
      await writeFile(join(output, 'react-profiler.png'), (await devtools.capturePage()).toPNG())
    }
    a.wc.closeDevTools()
    return { hook, inspectedProps: results.reactInspectedProps, profile: results.reactProfile }
  }
  await record('React DevTools 组件属性与Profiler', () => inspectReact(a, 'A', output))
  await record('多窗口、导航与重载的三插件主功能', async () => {
    const owner = new BrowserWindow({
      width: 1024,
      height: 760,
      show: true,
      webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    windows.push(owner)
    await owner.loadFile(shell)
    const second = createPage(owner, a.targetSession, a.partition, a.engine, 'A2')
    await second.wc.loadURL(site.url + '/?session=A2')
    await waitFor(
      () =>
        second.wc.executeJavaScript(
          '!!window.__REACT_DEVTOOLS_GLOBAL_HOOK__ && window.__REACT_DEVTOOLS_GLOBAL_HOOK__.renderers.size>0'
        ),
      '第二窗口React渲染器未检出'
    )
    const cookie = samples.find((s) => s.name === 'cookie')
    const cookiePopup = await openAction(second, cookie.id)
    await waitFor(
      () => cookiePopup.executeJavaScript("document.body.innerText.includes('msb_fixture')"),
      '第二窗口Cookie列表缺失'
    )
    const { exerciseCookie } = await import(pathToFileURL(join(__dirname, 'cookie-check.mjs')).href)
    const cookies = await exerciseCookie({
      evaluate: (e) => cookiePopup.executeJavaScript(e, true),
      getCookies: (f) => a.targetSession.cookies.get(f),
      getOtherCookies: (f) => b.targetSession.cookies.get(f),
      removeCookie: (url, name) => a.targetSession.cookies.remove(url, name),
      readClipboard: () => clipboard.readText(),
      resetClipboard: () => clipboard.writeText('preflight-empty'),
      url: site.url
    })
    currentPopup.destroy()
    await inspectReact(second, 'A2', join(output, 'react-second-window'))
    const dark = samples.find((s) => s.name === 'dark'),
      darkPopup = await openAction(second, dark.id)
    await darkPopup.executeJavaScript("document.querySelector('.toggle__off').click()", true)
    await waitFor(
      async () =>
        !(await second.wc.executeJavaScript(
          "document.documentElement.getAttribute('data-darkreader-mode')"
        )),
      '第二窗口Dark开关失败'
    )
    await darkPopup.executeJavaScript("document.querySelector('.toggle__on').click()", true)
    await waitFor(
      () =>
        second.wc.executeJavaScript(
          "document.documentElement.getAttribute('data-darkreader-mode')"
        ),
      '第二窗口Dark恢复失败'
    )
    currentPopup.destroy()
    await second.wc.loadURL(site.url + '/?session=A2-navigation')
    await waitFor(
      () =>
        second.wc.executeJavaScript(
          "document.documentElement.getAttribute('data-darkreader-mode') && window.__REACT_DEVTOOLS_GLOBAL_HOOK__?.renderers?.size>0"
        ),
      '导航后注入未恢复'
    )
    second.wc.reload()
    await waitFor(
      () =>
        second.wc.executeJavaScript(
          "document.readyState==='complete' && document.cookie.includes('msb_fixture=A') && window.__REACT_DEVTOOLS_GLOBAL_HOOK__?.renderers?.size>0"
        ),
      '重载后Cookie/React未恢复'
    )
    assert(
      (await b.targetSession.cookies.get({ url: site.url, name: 'msb_fixture' }))[0]?.value === 'B',
      '跨窗操作污染B分区'
    )
    a.engine.selectTab(a.wc)
    return {
      cookies,
      react: '第二窗口实际属性A2及Profiler提交',
      dark: '第二窗口切换及导航重载注入',
      otherSession: 'B保持独立'
    }
  })
  await record('后建分区加载屏障与三插件可用', async () => {
    await attachSession('C')
    const c = pages.find((p) => p.label === 'C')
    await c.wc.loadURL(site.url + '/?session=C')
    await waitFor(
      () => c.wc.executeJavaScript('window.__REACT_DEVTOOLS_GLOBAL_HOOK__?.renderers?.size>0'),
      '后建分区React未注入'
    )
    const cookie = samples.find((v) => v.name === 'cookie'),
      dark = samples.find((v) => v.name === 'dark')
    let popup = await openAction(c, cookie.id)
    await popup.executeJavaScript("document.getElementById('request-permission')?.click()", true)
    await waitFor(
      () =>
        popup.executeJavaScript(
          "!!document.querySelector('li[data-name=msb_fixture] .header')&&document.getElementById('cookie-container').style.transition===''"
        ),
      '后建分区Cookie列表未就绪'
    )
    await popup.executeJavaScript(
      "document.querySelector('li[data-name=msb_fixture] .header').click()",
      true
    )
    await waitFor(
      () =>
        popup.executeJavaScript(
          "document.querySelector('li[data-name=msb_fixture] textarea[name=value]')?.value==='C'"
        ),
      '后建分区Cookie值串会话'
    )
    popup.close()
    const aMode = await a.wc.executeJavaScript(
      "document.documentElement.getAttribute('data-darkreader-mode')"
    )
    popup = await openAction(c, dark.id)
    await popup.executeJavaScript("document.querySelector('.toggle__off').click()", true)
    await waitFor(
      async () =>
        !(await c.wc.executeJavaScript(
          "document.documentElement.getAttribute('data-darkreader-mode')"
        )),
      '后建分区Dark未关闭'
    )
    await popup.executeJavaScript("document.querySelector('.toggle__on').click()", true)
    await waitFor(
      () => c.wc.executeJavaScript("document.documentElement.getAttribute('data-darkreader-mode')"),
      '后建分区Dark未开启'
    )
    assert(
      (await a.wc.executeJavaScript(
        "document.documentElement.getAttribute('data-darkreader-mode')"
      )) === aMode,
      'C设置污染A'
    )
    popup.close()
    await inspectReact(c, 'C', join(output, 'react-late-session'))
    assert(
      (await a.targetSession.cookies.get({ url: site.url, name: 'msb_fixture' }))[0]?.value === 'A',
      'C污染A Cookie'
    )
    assert(
      (await b.targetSession.cookies.get({ url: site.url, name: 'msb_fixture' }))[0]?.value === 'B',
      'C污染B Cookie'
    )
    a.engine.selectTab(a.wc)
    return {
      firstNavigationBarrier: true,
      cookieValue: 'C',
      react: '实际属性C和Profiler',
      dark: 'C开关且A不变',
      scope: '隔离工具从同一已验签清单加载新分区，非生产安装器已接线'
    }
  })
  if (mode.endsWith('-fixed')) {
    await record('sandbox与SVG零目标错误', async () => {
      const errors = diagnostics.filter(
        (e) =>
          e.source === 'node:electron/js2c/sandbox_bundle' ||
          /<path> attribute d:/.test(e.message ?? '')
      )
      assert(
        errors.length === 0 && results.invalidSvgPaths === 0 && results.restoredIconPolygons >= 3,
        '目标错误仍存在：' + JSON.stringify(errors)
      )
      return { errors: 0, invalidSvgPaths: 0, restoredIconPolygons: results.restoredIconPolygons }
    })
  } else results.pending.push('原版React DevTools SVG图标错误，仅修复版修正')
  await writeFile(join(output, 'extension-diagnostics.json'), JSON.stringify(diagnostics, null, 2))
  if (mode.startsWith('extensions')) {
    await cleanup()
    return
  }
  await record('目标页面 PNG 与复制', async () => {
    a.owner.show()
    a.owner.focus()
    a.wc.focus()
    await delay(500)
    const image = await a.wc.capturePage()
    assert(!image.isEmpty() && image.getSize().width > 0, '截图为空')
    await writeFile(join(output, 'target-A.png'), image.toPNG())
    clipboard.writeImage(image)
    const copied = clipboard.readImage()
    assert(!copied.isEmpty(), '剪贴板写入失败')
    // 最小编辑适配：在页面Canvas上标注/裁剪，两个图像快照独立保存。
    const original = image.toDataURL()
    const edited = await a.wc.executeJavaScript(
      `(async()=>{const im=new Image();im.src=${JSON.stringify(original)};await im.decode();const c=document.createElement('canvas');c.width=400;c.height=300;const x=c.getContext('2d');x.drawImage(im,0,0);x.strokeStyle='red';x.lineWidth=5;x.strokeRect(30,30,100,100);return c.toDataURL('image/png')})()`
    )
    await writeFile(join(output, 'edited-crop.png'), nativeImage.createFromDataURL(edited).toPNG())
    return {
      size: image.getSize(),
      clipboardSize: copied.getSize(),
      editedSize: nativeImage.createFromDataURL(edited).getSize(),
      actualEditorMigration: 'pending'
    }
  })
  await record('真实IPC来源、目标与协议拒绝', async () => {
    const { checkRequest, checkSnapshot } = await import(
      pathToFileURL(join(__dirname, 'contracts.mjs')).href
    )
    const protocolFile = join(output, 'protocol.html')
    const childFile = join(output, 'protocol-child.html')
    await writeFile(childFile, '<!doctype html><title>协议子frame夹具</title>')
    await writeFile(
      protocolFile,
      `<!doctype html><title>协议受控页</title><iframe src="${site.url}/?session=protocol-child"></iframe>`
    )
    const probeUrls = [pathToFileURL(protocolFile).href, pathToFileURL(childFile).href]
    const trusted = new BrowserWindow({
      show: false,
      webPreferences: {
        session: a.targetSession,
        preload: join(__dirname, 'collector-preload.cjs'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false
      }
    })
    const unknown = new BrowserWindow({
      show: false,
      webPreferences: {
        session: b.targetSession,
        preload: join(__dirname, 'collector-preload.cjs'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false
      }
    })
    const unknownExtension = new BrowserWindow({
      show: false,
      webPreferences: {
        session: a.targetSession,
        preload: join(__dirname, 'collector-preload.cjs'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false
      }
    })
    const token = require('node:crypto').randomUUID(),
      target = { token, alive: true }
    const { createEndpoint, errorReply } = await import('./protocol-v1.mjs')
    let snapshotImage, trustedFrameToken
    const { checkImagePayload, MAX_IMAGE_BYTES } = await import('./schema-v1.mjs')
    const { createHash } = require('node:crypto')
    const binaryRequests = new Map()
    let binaryBytes = 0
    const endpoint = createEndpoint(
      () => {
        const alive = !trusted.isDestroyed()
        return {
          trusted:
            alive &&
            probeUrls.includes(trusted.webContents.getURL()) &&
            trusted.webContents.mainFrame.frameToken === trustedFrameToken,
          topFrame: true,
          sameSession: alive && trusted.webContents.session === a.targetSession,
          target
        }
      },
      {
        handshake: () => ({
          protocol: 1,
          capabilities: { capture: true, imageCopy: true, tabAudio: false, subscription: false },
          limits: {
            requestBytes: 4096,
            entries: 128,
            imageBytes: MAX_IMAGE_BYTES,
            imageInFlightBytes: 64 * 1024 * 1024
          },
          scope: 'preflight IPC fixture only'
        }),
        capture: async () => {
          snapshotImage = await a.wc.capturePage()
          const size = snapshotImage.getSize()
          assert(!snapshotImage.isEmpty(), '真实截图为空')
          const bytes = snapshotImage.toPNG()
          assert(bytes.length <= MAX_IMAGE_BYTES, '截图超过上限')
          return {
            snapshot: { id: 'snapshot-A', version: 2 },
            ...size,
            mimeType: 'image/png',
            sha256: createHash('sha256').update(bytes).digest('hex'),
            png: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
          }
        },
        'image.copy': (request) => {
          checkSnapshot({ id: 'snapshot-A', version: 2 }, request.snapshot)
          assert(snapshotImage, '没有有效图像')
          let image = snapshotImage
          if (request.image) {
            const bytes = binaryRequests.get(request.requestId)
            assert(bytes, '没有二进制图像')
            image = nativeImage.createFromBuffer(bytes)
            assert(!image.isEmpty(), 'PNG解码失败')
          }
          clipboard.writeImage(image)
          return { copied: !clipboard.readImage().isEmpty() }
        }
      }
    )
    ipcMain.handle('preflight:contract', (event, request, binary) => {
      try {
        checkRequest(request, {
          trusted:
            event.sender === trusted.webContents && probeUrls.includes(event.senderFrame?.url),
          topFrame: event.senderFrame === event.senderFrame?.top,
          sameSession: event.sender.session === a.targetSession,
          target
        })
        let staged = false
        if (binary !== undefined) {
          if (!(binary instanceof ArrayBuffer) || request.method !== 'image.copy')
            throw Object.assign(new Error(), { code: 'INVALID_REQUEST' })
          const bytes = Buffer.from(binary)
          checkImagePayload(request.image, bytes)
          if (!binaryRequests.has(request.requestId)) {
            if (binaryBytes + bytes.length > 64 * 1024 * 1024)
              throw Object.assign(new Error(), { code: 'BUSY' })
            binaryRequests.set(request.requestId, bytes)
            binaryBytes += bytes.length
            staged = true
          }
        } else if (request.image) throw Object.assign(new Error(), { code: 'INVALID_REQUEST' })
        return endpoint.request(request).finally(() => {
          if (staged) {
            const bytes = binaryRequests.get(request.requestId)
            if (bytes) {
              binaryBytes -= bytes.length
              binaryRequests.delete(request.requestId)
            }
          }
        })
      } catch (error) {
        return errorReply(request, error)
      }
    })
    try {
      await trusted.loadFile(protocolFile)
      trustedFrameToken = trusted.webContents.mainFrame.frameToken
      trusted.webContents.once('did-navigate', () => {
        target.alive = false
        endpoint.close()
      })
      await unknown.loadFile(protocolFile)
      const request = { protocol: 1, requestId: 'ipc-1', method: 'capture', target: token }
      let ipcSequence = 0
      const invoke = (window, payload, binary) =>
        window.webContents.executeJavaScript(
          `window.preflightCollector.request(${JSON.stringify({ ...payload, requestId: payload.requestId ? payload.requestId + '-' + ++ipcSequence : payload.requestId })},${binary ? 'new Uint8Array(' + JSON.stringify([...binary]) + ').buffer' : 'undefined'}).then(value=>({accepted:value.ok===true,value})).catch(error=>({accepted:false,error:String(error)}))`
        )
      const handshake = await invoke(trusted, { ...request, method: 'handshake' })
      assert(handshake.accepted && handshake.value.value.capabilities.capture, '真实握手未返回能力')
      const captured = await invoke(trusted, request)
      assert(captured.accepted, '合法请求被拒')
      const { png, ...imageMeta } = captured.value.value
      const imageBytes = Buffer.from(png)
      checkImagePayload(imageMeta, imageBytes)
      const imageRequest = {
        ...request,
        method: 'image.copy',
        snapshot: imageMeta.snapshot,
        image: {
          width: imageMeta.width,
          height: imageMeta.height,
          mimeType: imageMeta.mimeType,
          sha256: imageMeta.sha256
        }
      }
      const copied = await invoke(trusted, imageRequest, imageBytes)
      assert(copied.accepted && copied.value.value.copied, 'PNG真实二进制往返复制失败')
      const broken = Buffer.from(imageBytes)
      broken[0] ^= 1
      const altered = await invoke(trusted, imageRequest, broken)
      assert(!altered.accepted && altered.value.error.code === 'INVALID_REQUEST', '摘要篡改未拒绝')
      const badHeader = await invoke(
        trusted,
        {
          ...imageRequest,
          image: {
            ...imageRequest.image,
            sha256: createHash('sha256').update(broken).digest('hex')
          }
        },
        broken
      )
      assert(
        !badHeader.accepted && badHeader.value.error.code === 'INVALID_REQUEST',
        '坏PNG头未拒绝'
      )
      const child = await waitFor(
        async () =>
          trusted.webContents.mainFrame.framesInSubtree.find((f) =>
            f.url.includes('session=protocol-child')
          ),
        '真实子frame未加载'
      )
      const childResult = await child.executeJavaScript(
        `(()=>{try{if(typeof window.preflightCollector!=='undefined')return{accepted:true};const api=top.preflightCollector;return{accepted:!!api}}catch(error){return{accepted:false,error:String(error),stage:'cross-origin-bridge-denied'}}})()`
      )
      assert(!childResult.accepted, '真实跨源子frame获得顶层桥')
      assert(
        await child.executeJavaScript(
          "typeof require==='undefined' && typeof window.api==='undefined'"
        ),
        '子frame暴露Node或生产桥'
      )
      assert(
        (
          await invoke(trusted, {
            ...request,
            method: 'image.copy',
            snapshot: { id: 'snapshot-A', version: 2 }
          })
        ).accepted,
        '有效图像快照被拒'
      )
      assert(
        !(
          await invoke(trusted, {
            ...request,
            method: 'image.copy',
            snapshot: { id: 'snapshot-A', version: 1 }
          })
        ).accepted,
        '旧图像快照被放行'
      )
      assert(
        !(
          await invoke(trusted, {
            ...request,
            method: 'image.copy',
            snapshot: { id: 'snapshot-B', version: 2 }
          })
        ).accepted,
        '交错快照被放行'
      )
      assert(
        !(await invoke(trusted, { ...request, method: 'fs.readFile' })).accepted,
        '未知能力被放行'
      )
      assert(
        !(await invoke(trusted, { ...request, requestId: '' })).accepted,
        '非法requestId被放行'
      )

      assert(!(await invoke(unknown, request)).accepted, '跨分区未知来源被放行')
      await unknownExtension.loadURL(
        'chrome-extension://' +
          samples.find((v) => v.name === 'cookie').id +
          '/interface/options/options.html'
      )
      const foreign = await invoke(unknownExtension, request)
      assert(
        !foreign.accepted && foreign.value.error.code === 'UNAUTHORIZED',
        '同分区未知第三方扩展获得私有桥'
      )
      assert(!(await invoke(trusted, { ...request, target: 'forged' })).accepted, '伪造目标被放行')
      assert(!(await invoke(trusted, { ...request, protocol: 2 })).accepted, '错误协议被放行')
      target.alive = false
      assert(!(await invoke(trusted, request)).accepted, '失效目标被放行')
      target.alive = true
      await trusted.loadURL(site.url + '/?session=unknown-source')
      const navigated = await invoke(trusted, request)
      assert(
        !navigated.accepted && navigated.value.error.code === 'UNAUTHORIZED',
        '来源实际导航后未撤销'
      )
      return {
        realIpcChecks: 16,
        navigation: navigated.value.error,
        subframe: childResult,
        snapshots: '有效/过期/交错实际IPC检查'
      }
    } finally {
      endpoint.close()
      binaryRequests.clear()
      binaryBytes = 0
      ipcMain.removeHandler('preflight:contract')
      trusted.destroy()
      unknown.destroy()
      unknownExtension.destroy()
    }
  })
  await record('目标Tab带音频MP4', async () => {
    const ses = a.targetSession
    collector = new BrowserWindow({
      show: false,
      width: 10,
      height: 10,
      webPreferences: {
        session: ses,
        preload: join(__dirname, 'collector-preload.cjs'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false
      }
    })
    const collectorWc = collector.webContents
    const collectorUrl = pathToFileURL(join(__dirname, 'collector.html')).href
    collectorWc.on('will-navigate', (event, url) => {
      if (url !== collectorUrl) event.preventDefault()
    })
    collectorWc.setWindowOpenHandler(() => ({ action: 'deny' }))
    ses.setPermissionCheckHandler(
      (wc, permission) =>
        wc?.id === collectorWc.id && ['media', 'display-capture'].includes(permission)
    )
    ses.setPermissionRequestHandler((wc, permission, callback) =>
      callback(wc.id === collectorWc.id && ['media', 'display-capture'].includes(permission))
    )
    ses.setDisplayMediaRequestHandler((request, callback) => {
      const allowed =
        request.frame &&
        !collectorWc.isDestroyed() &&
        request.frame.url === collectorUrl &&
        request.frame.frameToken === collectorWc.mainFrame.frameToken &&
        request.frame === request.frame.top &&
        !a.wc.isDestroyed()
      if (allowed) callback({ video: a.wc.mainFrame, audio: a.wc.mainFrame, enableLocalEcho: true })
      else callback({})
    })
    const mediaDenied = await a.wc.executeJavaScript(
      'navigator.mediaDevices.getDisplayMedia({video:true,audio:true}).then(s=>{s.getTracks().forEach(t=>t.stop());return false}).catch(e=>({name:e.name}))',
      true
    )
    assert(mediaDenied && mediaDenied.name, '普通页面媒体请求未拒绝')
    await a.wc.executeJavaScript(
      `new Promise(resolve=>{const f=document.createElement('iframe');f.src=${JSON.stringify(site.url + '/?session=media-child')};f.id='media-child';f.onload=()=>resolve(true);document.body.append(f)})`
    )
    const mediaChild = a.wc.mainFrame.framesInSubtree.find((f) =>
      f.url.includes('session=media-child')
    )
    assert(mediaChild, '媒体子frame未加载')
    const subMediaDenied = await mediaChild.executeJavaScript(
      'navigator.mediaDevices.getDisplayMedia({video:true,audio:true}).then(s=>{s.getTracks().forEach(t=>t.stop());return false}).catch(e=>({name:e.name}))',
      true
    )
    assert(subMediaDenied && subMediaDenied.name, '子frame媒体请求未拒绝')
    await a.wc.executeJavaScript("document.getElementById('media-child').remove()")
    results.mediaPermissionChecks = { top: mediaDenied, subframe: subMediaDenied }
    ipcMain.handle('preflight:collector', async (event, payload) => {
      assert(
        event.sender === collectorWc &&
          event.senderFrame?.url === collectorUrl &&
          event.senderFrame?.frameToken === collectorWc.mainFrame.frameToken,
        '采集结果来源不符'
      )
      if (!payload.ok) return { ok: false, error: payload.error }
      assert(
        Array.isArray(payload.bytes) &&
          payload.bytes.length > 0 &&
          payload.bytes.length <= 32 * 1024 * 1024,
        '媒体大小非法'
      )
      const file = join(output, 'tab-audio.mp4')
      await writeFile(file, Buffer.from(payload.bytes))
      const { bytes, ...info } = payload
      return { ...info, byteLength: bytes.length, file }
    })
    await collector.loadFile(join(__dirname, 'collector.html'))
    if (mode.startsWith('sync')) {
      results.syncGeometry = await a.wc.executeJavaScript('window.testSite.syncGeometry()')
      await writeFile(
        join(output, 'sync-geometry.json'),
        JSON.stringify(results.syncGeometry, null, 2)
      )
    }
    await a.wc.executeJavaScript('window.testSite.startAudio(440)', true)
    await b.wc.executeJavaScript('window.testSite.startAudio(733)', true)
    const duration = mode.startsWith('long') ? 64000 : 12000
    const value = await collectorWc.executeJavaScript(
      `window.recordTarget(${duration},4000,3000)`,
      true
    )
    assert(value.ok, value.error || '录制失败')
    assert(
      value.tracks.some((v) => v.kind === 'audio'),
      '没有音轨'
    )
    await a.wc.executeJavaScript('window.testSite.stopAudio()')
    await b.wc.executeJavaScript('window.testSite.stopAudio()')
    return value
  })
  if (mode === 'manual') {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: '验证',
          submenu: [
            {
              label: '打开商店（A）',
              click: () => a.wc.loadURL('https://chromewebstore.google.com/')
            },
            { label: '目标A DevTools', click: () => a.wc.openDevTools({ mode: 'detach' }) },
            ...samples
              .filter((v) => ['dark', 'cookie', 'react'].includes(v.name))
              .map((v) => ({
                label: `打开 ${v.name}`,
                click: () => {
                  void openAction(a, v.id).catch(console.error)
                }
              })),
            {
              label: '结束验证',
              click: () => {
                void cleanup()
              }
            }
          ]
        }
      ])
    )
    console.log('手动验证窗口保持打开，使用“验证”原生菜单')
    return
  }
  await cleanup()
}
let cleaning = false
async function cleanup() {
  if (cleaning) return
  cleaning = true
  ipcMain.removeHandler('preflight:collector')
  for (const p of pages) {
    try {
      p.targetSession.setDisplayMediaRequestHandler(null)
      p.targetSession.setPermissionCheckHandler(null)
      p.targetSession.setPermissionRequestHandler(null)
    } catch {
      /* 窗口退出竞态 */
    }
  }
  if (collector && !collector.isDestroyed()) collector.destroy()
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.destroy()
  if (site) await site.close()
  await writeFile(join(output, 'electron-results.json'), JSON.stringify(results, null, 2))
  app.exit(
    results.fatal || results.timeout || results.checks.some((v) => v.status === 'fail') ? 1 : 0
  )
}
main().catch(async (error) => {
  console.error(error)
  results.fatal = String(error)
  await cleanup()
})
setTimeout(
  () => {
    if (mode !== 'manual') {
      results.timeout = true
      void cleanup()
    }
  },
  mode.startsWith('long') ? 140000 : 90000
).unref()
