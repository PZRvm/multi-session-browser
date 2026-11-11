/* eslint @typescript-eslint/explicit-function-return-type: off -- 隔离生产进程功能验收 */
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { exerciseCookie } from './cookie-check.mjs'
const require = createRequire(import.meta.url)
const { app, BrowserWindow, clipboard, dialog, nativeImage } = require('electron')
const delay = (ms) => new Promise((r) => setTimeout(r, ms))
async function wait(read, message, timeout = 15000) {
  const end = Date.now() + timeout
  do {
    const v = await read()
    if (v) return v
    await delay(100)
  } while (Date.now() < end)
  throw new Error(message)
}
export async function run({
  registry,
  mainWindow,
  getExtensionsHandle,
  createManifestStore,
  createInstallService
}) {
  assert(app.getPath('userData').startsWith('/tmp/msb-'), '只允许运行隔离数据目录')
  const checks = []
  const watchdog = setTimeout(() => {
    console.error('PLUGINS_TIMEOUT')
    app.exit(2)
  }, 150000)
  watchdog.unref?.()
  const output = join(app.getPath('userData'), 'production-plugins.json')
  async function check(name, fn) {
    if (process.env.MSB_PLUGINS_ONLY === 'translate' && !/CRX|新建A|后建B|翻译/.test(name)) return
    if (process.env.MSB_PLUGINS_ONLY === 'capture' && !/CRX|新建A|后建B|截图/.test(name)) return
    try {
      const detail = await fn()
      checks.push({ name, ok: true, detail })
      console.log('PLUGIN_PASS', name, JSON.stringify(detail))
    } catch (e) {
      checks.push({ name, ok: false, error: String(e) })
      console.error('PLUGIN_FAIL', name, e)
    }
    await writeFile(output, JSON.stringify({ checks }, null, 2))
  }
  const server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end(
      '<!doctype html><html lang="en"><head><title>English test article</title></head><body style="background:white;color:black"><h1>Learning about nature</h1><article><p>The sun rises in the east every morning. Birds sing in the trees and flowers grow in the garden.</p><p>Reading books is a wonderful way to learn about the world. Every day brings a new opportunity to explore and discover.</p></article></body></html>'
    )
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const url = `http://localhost:${server.address().port}`
  const handle = getExtensionsHandle()
  const manifest = createManifestStore(handle.paths.manifestFile)
  const installer = createInstallService({ manifest, packagesRoot: handle.paths.packagesRoot })
  const samples = join(app.getAppPath(), 'tools/extension-preflight/out/.artifacts/samples')
  const ids = [
    'hlkenndednhfkekhgcdicdfddnkalmdm',
    'eimadpbcbfnmbkopoojfekhnkhdbieeh',
    'ddkjiahejlhfcafbddmgiahcphecmpfh',
    'bpoadfkcbjbfhfodiogcnhhhpibjhbnh'
  ]
  await check('四个原版CRX验签安装', async () => {
    const files = [
      join(samples, 'cookie.crx'),
      join(samples, 'dark.crx'),
      '/tmp/msb-crx-test/ddkjiahejlhfcafbddmgiahcphecmpfh.crx',
      '/tmp/msb-crx-test/immersive-translate.crx'
    ]
    const versions = []
    for (let i = 0; i < ids.length; i++) {
      const result = await installer.installFromFile(files[i], ids[i])
      versions.push({ id: result.record.id, version: result.record.version })
    }
    return versions
  })
  const shell = mainWindow.webContents
  await wait(() => shell.executeJavaScript('!!window.api?.sessions'), '壳页未就绪')
  const created = new Map()
  async function activate(label) {
    if (!created.has(label)) {
      const existing = await shell.executeJavaScript('window.api.sessions.list()')
      const found = existing.sessions.find((s) => s.name === label)
      if (found) created.set(label, found)
    }
    if (!created.has(label)) {
      const before = await shell.executeJavaScript('window.api.sessions.list()')
      await shell.executeJavaScript("document.querySelector('button.new-session').click()", true)
      const added = await wait(async () => {
        const state = await shell.executeJavaScript('window.api.sessions.list()')
        return state.sessions.find((s) => !before.sessions.some((old) => old.id === s.id))
      }, '新建会话按钮没有创建会话')
      await shell.executeJavaScript(
        `window.api.sessions.rename({id:${JSON.stringify(added.id)},name:${JSON.stringify(label)}})`
      )
      created.set(label, added)
    }
    const id = created.get(label).id
    const rowSelector = '.session-row[data-session-id="' + id + '"]'
    await wait(
      () => shell.executeJavaScript(`!!document.querySelector(${JSON.stringify(rowSelector)})`),
      '会话行没有显示'
    )
    await shell.executeJavaScript(
      `document.querySelector(${JSON.stringify(rowSelector)}).click()`,
      true
    )
    await wait(
      () => registry.getActiveSessionId() === id && registry.getActiveWebContents(),
      '会话没有激活'
    )
    const wc = registry.getActiveWebContents()
    // 即使首个空白 Tab，也必须已挂载全部扩展。
    assert.deepEqual(
      wc.session.extensions
        .getAllExtensions()
        .map((e) => e.id)
        .sort(),
      [...ids].sort()
    )
    if (!wc.getURL().startsWith(url))
      await shell.executeJavaScript(`window.api.browser.navigate({url:${JSON.stringify(url)}})`)
    await wait(() => !wc.isLoading() && wc.getURL().startsWith(url), '首导航未结束')
    return wc
  }
  let a, b
  await check('安装后新建A会话首导航已加载四插件', async () => {
    a = await activate('a')
    return a.session.extensions.getAllExtensions().map((e) => e.id)
  })
  await check('后建B会话自动挂载且分区隔离', async () => {
    b = await activate('b')
    assert.notEqual(a.session, b.session)
    await a.session.cookies.set({ url, name: 'msb_fixture', value: 'A' })
    await b.session.cookies.set({ url, name: 'msb_fixture', value: 'B' })
    assert.equal((await a.session.cookies.get({ url, name: 'msb_fixture' }))[0].value, 'A')
    return b.session.extensions.getAllExtensions().length
  })
  await activate('a')
  const popups = []
  async function popup(id) {
    app.focus({ steal: true })
    mainWindow.show()
    mainWindow.focus()
    await wait(() => mainWindow.isFocused(), '测试主窗未获得焦点')
    const names = await shell.executeJavaScript('window.api.extensions.list()')
    const name = names.find((e) => e.id === id)?.name
    await shell.executeJavaScript(
      `document.querySelector('.chrome-tools button[aria-expanded]').click()`,
      true
    )
    await wait(
      () =>
        shell.executeJavaScript(
          `Array.from(document.querySelectorAll('.chrome-ext-panel-row')).some(e=>e.textContent.trim()===${JSON.stringify(name)})`
        ),
      '工具栏插件列表未出现'
    )
    await shell.executeJavaScript(
      `Array.from(document.querySelectorAll('.chrome-ext-panel-row')).find(e=>e.textContent.trim()===${JSON.stringify(name)}).click()`,
      true
    )
    const w = await wait(
      () =>
        BrowserWindow.getAllWindows().find((w) =>
          w.webContents.getURL().startsWith(`chrome-extension://${id}/`)
        ),
      '工具栏未打开popup'
    )
    popups.push(w)
    await wait(
      () => !w.webContents.isLoading() && w.isVisible() && w.isFocused(),
      'popup未显示或未获焦'
    )
    const target = registry.getActiveWebContents()
    assert.equal(w.webContents.session, target.session, 'popup串到其他会话')
    const tab = await w.webContents.executeJavaScript(
      'chrome.tabs.query({active:true,currentWindow:true})',
      true
    )
    assert.equal(tab[0]?.id, target.id, 'popup当前Tab不正确')
    await delay(250)
    return w
  }
  await check('原生sync与local分离且会话隔离', async () => {
    const w = await popup(ids[1])
    if (process.env.MSB_PLUGINS_RESTART === '1') {
      const persisted = await w.webContents.executeJavaScript(
        "chrome.storage.sync.get('__msb_probe')"
      )
      assert.equal(persisted.__msb_probe, 'persist-A', '重启后插件设置丢失')
    }
    await w.webContents.executeJavaScript(
      "Promise.all([chrome.storage.sync.set({__msb_probe:'persist-A'}),chrome.storage.local.set({__msb_probe:'local-A'})])"
    )
    const values = await w.webContents.executeJavaScript(
      "Promise.all([chrome.storage.sync.get('__msb_probe'),browser.storage.local.get('__msb_probe')])"
    )
    assert.equal(values[0].__msb_probe, 'persist-A')
    assert.equal(values[1].__msb_probe, 'local-A')
    w.destroy()
    await activate('b')
    const other = await popup(ids[1])
    const isolated = await other.webContents.executeJavaScript(
      "chrome.storage.sync.get('__msb_probe')"
    )
    assert.equal(isolated.__msb_probe, undefined)
    other.destroy()
    await activate('a')
    return { separate: true, isolated: true, restart: process.env.MSB_PLUGINS_RESTART === '1' }
  })
  await check('同会话新Tab工具栏绑定与切换关闭popup', async () => {
    const before = registry.getSnapshot().activeTabId
    await shell.executeJavaScript(
      `window.api.browser.newTab({url:${JSON.stringify(url + '/?tab=second')}})`
    )
    const current = registry.getActiveWebContents()
    await wait(
      () => !current.isLoading() && current.getURL().includes('tab=second'),
      '新Tab没有完成导航'
    )
    const w = await popup(ids[1])
    assert.equal(w.webContents.session, a.session)
    await shell.executeJavaScript(`window.api.browser.switchTab({id:${JSON.stringify(before)}})`)
    await wait(() => w.isDestroyed(), '切Tab后旧popup没有关闭')
    assert.equal(registry.getActiveWebContents(), a)
    return { newTab: current.id, originalTab: a.id, closed: true }
  })
  await check('原截图及编辑复制使用异步图片剪贴板', async () => {
    app.focus({ steal: true })
    mainWindow.show()
    mainWindow.focus()
    await wait(() => {
      const view = mainWindow.contentView.children.find(
        (v) => v.webContents === registry.getActiveWebContents()
      )
      const rect = view?.getBounds()
      return mainWindow.isFocused() && rect?.width > 0 && rect?.height > 0
    }, '浏览器区还没有显示')
    await delay(500)
    const captured = await shell.executeJavaScript('window.api.capture.capture()')
    assert(captured.captureId)
    assert(await clipboard.has('image/png'))
    await shell.executeJavaScript('window.api.capture.openEditor()')
    const editor = await wait(
      () =>
        BrowserWindow.getAllWindows().find((w) =>
          w.webContents.getURL().includes('role=capture-editor')
        ),
      '截图编辑窗未出现'
    )
    await wait(
      () => editor.webContents.executeJavaScript('!!window.api?.capture'),
      '截图编辑窗未就绪'
    )
    const image = await editor.webContents.executeJavaScript('window.api.capture.getEditImage()')
    await editor.webContents.executeJavaScript(
      `window.api.capture.editCopy(${JSON.stringify({ captureId: image.captureId, dataUrl: image.dataUrl })})`
    )
    const items = await clipboard.read()
    const item = items.find((i) => i.types.includes('image/png'))
    assert(item)
    const blob = await item.getType('image/png')
    const png = Buffer.from(await blob.arrayBuffer())
    const size = nativeImage.createFromBuffer(png).getSize()
    assert(size.width > 0 && size.height > 0)
    editor.destroy()
    return { capture: true, editCopy: true, size }
  })
  // 隔离验收中的原生权限确认：只允许 Cookie-Editor 的本地测试站点。
  const originalDialog = dialog.showMessageBox
  dialog.showMessageBox = async (...args) => {
    const options = args.at(-1)
    const granted = options.title === '插件权限请求' && options.detail?.includes('localhost')
    return { response: granted ? 1 : 0, checkboxChecked: false }
  }
  await check('Cookie-Editor真实新增修改删除导入导出与隔离', async () => {
    const w = await popup(ids[0])
    const evaluate = (s) => w.webContents.executeJavaScript(s, true)
    await evaluate("document.getElementById('request-permission')?.click()")
    const result = await exerciseCookie({
      evaluate,
      getCookies: (f) => a.session.cookies.get(f),
      getOtherCookies: (f) => b.session.cookies.get(f),
      removeCookie: (u, n) => a.session.cookies.remove(u, n),
      readClipboard: () => clipboard.readText(),
      resetClipboard: () => clipboard.clear(),
      url
    })
    w.destroy()
    return result
  })
  await check('切到B会话从工具栏读取B的Cookie', async () => {
    await activate('b')
    const w = await popup(ids[0])
    await w.webContents.executeJavaScript(
      "document.getElementById('request-permission')?.click()",
      true
    )
    await wait(
      () => w.webContents.executeJavaScript("document.body.innerText.includes('msb_fixture')"),
      'B的Cookie列表未就绪'
    )
    const cookie = await w.webContents.executeJavaScript(
      `chrome.cookies.get({url:${JSON.stringify(url)},name:'msb_fixture'})`
    )
    assert.equal(cookie.value, 'B')
    w.destroy()
    await activate('a')
    return { value: cookie.value, isolated: true }
  })
  dialog.showMessageBox = originalDialog
  await check('Dark Reader可操作且开关改变网页', async () => {
    const w = await popup(ids[1])
    const evaluate = (s) => w.webContents.executeJavaScript(s, true)
    const state = await evaluate(
      `({text:document.body.innerText.slice(0,50), controls:document.querySelectorAll('input,button,select').length, loader:document.querySelector('.loader')?.outerHTML, color:getComputedStyle(document.querySelector('.loader__message')).color})`
    )
    await writeFile(
      join(app.getPath('userData'), 'dark.png'),
      (await w.webContents.capturePage()).toPNG()
    )
    assert(state.controls > 2)
    const bMode = await b.executeJavaScript(
      "document.documentElement.getAttribute('data-darkreader-mode')"
    )
    await evaluate("document.querySelector('.toggle__off').click()")
    await wait(
      async () =>
        !(await a.executeJavaScript(
          "document.documentElement.getAttribute('data-darkreader-mode')"
        )),
      '关闭无效'
    )
    assert.equal(
      await b.executeJavaScript("document.documentElement.getAttribute('data-darkreader-mode')"),
      bMode,
      'Dark Reader修改污染了B会话'
    )
    await evaluate("document.querySelector('.toggle__on').click()")
    await wait(
      () => a.executeJavaScript("document.documentElement.getAttribute('data-darkreader-mode')"),
      '开启无效'
    )
    w.destroy()
    return state
  })
  await check('uBO Lite真实广告请求拦截', async () => {
    const w = await popup(ids[2])
    const evaluate = (s) => w.webContents.executeJavaScript(s, true)
    await writeFile(
      join(app.getPath('userData'), 'ubo-dom.txt'),
      await evaluate('document.body.outerHTML')
    )
    const tabs = await evaluate('chrome.tabs.query({active:true,currentWindow:true})')
    const sw = await evaluate(
      `Promise.race([chrome.runtime.sendMessage({what:'popupPanelData', origin: ${JSON.stringify(url)}, hostname:'localhost'}), new Promise((_,reject)=>setTimeout(()=>reject(new Error('worker response timeout')),8000))])`
    )
    assert(sw && typeof sw.level === 'number', '广告插件background没有回复')
    a.debugger.attach('1.3')
    await a.debugger.sendCommand('Network.enable')
    const failures = []
    a.debugger.on('message', (_e, method, p) => {
      if (method === 'Network.loadingFailed') failures.push(p)
    })
    const before = await a.executeJavaScript(
      `new Promise(resolve=>{const img=new Image();img.onload=()=>resolve('loaded');img.onerror=()=>resolve('error');img.src='https://000491b06a.com/msb-ad-test.png';document.body.append(img);setTimeout(()=>resolve('timeout'),8000)})`
    )
    await delay(300)
    a.debugger.detach()
    console.log(
      'UBO_PROBE',
      JSON.stringify({
        before,
        sw,
        tabs,
        failures,
        rules: await evaluate('chrome.declarativeNetRequest.getEnabledRulesets()')
      })
    )
    assert(
      failures.some((f) => f.errorText === 'net::ERR_BLOCKED_BY_CLIENT'),
      '广告请求没有被插件拦截'
    )
    w.destroy()
    return { before, sw, tabs, failures }
  })
  await check('沉浸式翻译实际页面操作', async () => {
    const translationUrl = url.replace('localhost', 'msb-fixture.test')
    await shell.executeJavaScript(
      `window.api.browser.navigate({url:${JSON.stringify(translationUrl)}})`
    )
    await wait(() => !a.isLoading() && a.getURL().startsWith(translationUrl), '外网页面未就绪')
    const w = await popup(ids[3])
    const evaluate = (s) => w.webContents.executeJavaScript(s, true)
    await writeFile(
      join(app.getPath('userData'), 'translate-dom.txt'),
      await evaluate('document.body.outerHTML')
    )
    await wait(
      () =>
        evaluate(
          "!!document.querySelector('.popup-container:not(.popup-presentation--inert) #translate-button:not(:disabled)')"
        ),
      '翻译popup未就绪'
    )
    await writeFile(
      join(app.getPath('userData'), 'translate-ready-dom.txt'),
      await evaluate('document.body.outerHTML')
    )
    await writeFile(
      join(app.getPath('userData'), 'translate-ready.png'),
      (await w.webContents.capturePage()).toPNG()
    )
    // 使用不需要账号的谷歌翻译，以实际UI选择服务。
    await evaluate(
      "document.querySelector('.popup-container:not(.popup-presentation--inert) .translate-service').click()"
    )
    await wait(
      () =>
        evaluate(
          "Array.from(document.querySelectorAll('.custom-select-item')).some(e=>e.getAttribute('value')==='google-free' && e.getClientRects().length)"
        ),
      '谷歌翻译选项未出现'
    )
    await evaluate(
      "Array.from(document.querySelectorAll('.custom-select-item')).find(e=>e.getAttribute('value')==='google-free' && e.getClientRects().length).click()"
    )
    const text = await evaluate('document.body.innerText')
    const beforeText = await a.executeJavaScript('document.body.innerText')
    assert(!/[\u4e00-\u9fff]/.test(beforeText), '原文应为纯英文')
    void evaluate(
      "document.querySelector('.popup-container:not(.popup-presentation--inert) #translate-button').click()"
    ).catch(() => undefined)
    await wait(
      () =>
        a.executeJavaScript(
          "document.querySelectorAll('.immersive-translate-target-wrapper').length>0 && /[\u4e00-\u9fff]/.test(document.querySelector('.immersive-translate-target-wrapper')?.textContent || '')"
        ),
      '未出现中文译文',
      60000
    ).catch(async (e) => {
      console.log(
        'TRANSLATE_ERROR_PAGE',
        await a.executeJavaScript('document.body.innerText.slice(0,1800)')
      )
      throw e
    })
    const page = await a.executeJavaScript(
      `({text:document.body.innerText, wrappers:document.querySelectorAll('[class*=immersive-translate]').length, html:document.body.innerHTML.slice(0,4000)})`
    )
    console.log('TRANSLATE_PROBE', JSON.stringify(page))
    await writeFile(
      join(app.getPath('userData'), 'translated-page.json'),
      JSON.stringify(page, null, 2)
    )
    assert(page.wrappers > 0 && /[\u4e00-\u9fff]/.test(page.text), '没有出现插件生成的中文译文')
    return { text, page }
  })
  for (const w of popups) if (!w.isDestroyed()) w.destroy()
  await check('重复激活挂载幂等', async () => {
    await activate('b')
    await activate('a')
    assert.equal(a.session.extensions.getAllExtensions().length, 4)
    return 4
  })
  server.close()
  console.log('PLUGINS_RESULT', JSON.stringify(checks))
  app.exit(checks.every((c) => c.ok) ? 0 : 1)
}
