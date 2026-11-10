/* eslint @typescript-eslint/explicit-function-return-type: off -- 独立验证脚本使用原生 JavaScript，sandbox preload 使用 CommonJS */
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile, cp, copyFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CDP } from './cdp.mjs'
import { isInside } from './outcomes.mjs'
import { exerciseCookie } from './cookie-check.mjs'
import { startSite } from './server.mjs'
const here = dirname(fileURLToPath(import.meta.url))
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
function demand(ok, reason) {
  if (!ok) throw new Error(reason)
}
export async function runChrome(output, artifacts, duration = 12000, fixed = false, sync = false) {
  const chrome =
    process.env.PREFLIGHT_CHROME_BINARY ??
    (process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : 'C:/Program Files/Google/Chrome/Application/chrome.exe')
  const profile = join(output, 'profile-chrome')
  await mkdir(profile, { recursive: true })
  if (fixed) {
    await mkdir(join(profile, 'Default'), { recursive: true })
    await writeFile(
      join(profile, 'Default/Preferences'),
      JSON.stringify({ devtools: { preferences: { currentDockState: '"undocked"' } } })
    )
  }
  const site = await startSite()
  const result = {
    platform: process.platform,
    checks: [],
    pending: ['Windows real-device verification', 'Overall admission: see current book Todo']
  }
  let child,
    cdp,
    log = ''
  async function record(name, fn) {
    try {
      const detail = await fn()
      result.checks.push({ name, status: 'pass', detail })
      console.log(JSON.stringify({ name, status: 'pass' }))
    } catch (error) {
      result.checks.push({ name, status: 'fail', error: String(error) })
      console.error(name, String(error))
    }
    await writeFile(join(output, 'chrome-results.json'), JSON.stringify(result, null, 2))
  }
  try {
    child = spawn(
      chrome,
      [
        `--user-data-dir=${profile}`,
        '--remote-debugging-address=127.0.0.1',
        '--remote-debugging-port=0',
        '--enable-unsafe-extension-debugging',
        ...(fixed ? ['--auto-open-devtools-for-tabs'] : []),
        '--no-first-run',
        '--no-default-browser-check',
        'about:blank'
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    )
    child.on('error', (error) => {
      log += String(error)
    })
    for (const stream of [child.stdout, child.stderr])
      stream.on('data', (data) => {
        log += data
      })
    let debug
    for (let i = 0; i < 100; i++) {
      try {
        debug = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).trim().split('\n')
        break
      } catch {
        await delay(100)
      }
    }
    demand(debug, '专用Chrome未启动远程调试；未接触默认profile')
    cdp = await CDP.connect(`ws://127.0.0.1:${debug[0]}${debug[1]}`)
    result.browser = await cdp.send('Browser.getVersion')
    await cdp.send('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: output,
      eventsEnabled: true
    })
    const samples = JSON.parse(
      await readFile(join(artifacts, 'samples/samples.json'), 'utf8')
    ).samples
    if (fixed) {
      const { buildReactFork } = await import('./react-fork.mjs')
      const fork = await buildReactFork(samples)
      samples.splice(
        samples.findIndex((s) => s.name === 'react'),
        1,
        fork
      )
      result.reactVariant = { variant: fork.variant, id: fork.id, version: fork.version }
    }
    for (const sample of samples.filter((v) => v.path))
      await record(`Chrome加载 ${sample.name}`, async () => {
        const loaded = await cdp.send('Extensions.loadUnpacked', { path: sample.path })
        demand(loaded.id === sample.id, 'Chrome扩展ID与验签结果不同')
        return loaded
      })
    const created = await cdp.send('Target.createTarget', {
      url: `${site.url}/?session=A${sync ? '&avsync=1' : ''}`
    })
    const target = await cdp.attach(created.targetId)
    await cdp.send('Network.setCookie', { url: site.url, name: 'msb_fixture', value: 'A' }, target)
    await delay(1200)
    await cdp.send('Page.reload', {}, target)
    await delay(1800)
    const inventory = await cdp.send('Target.getTargets', { filter: [{}] })
    await writeFile(join(output, 'targets.json'), JSON.stringify(inventory, null, 2))
    const tabId = inventory.targetInfos.find(
      (v) => v.type === 'tab' && v.url === `${site.url}/?session=A${sync ? '&avsync=1' : ''}`
    )?.targetId
    result.tabTarget = tabId
    await record('Chrome React 渲染器检出', async () => {
      const value = await cdp.evaluate(
        '({hook:!!window.__REACT_DEVTOOLS_GLOBAL_HOOK__,renderers:window.__REACT_DEVTOOLS_GLOBAL_HOOK__?.renderers?.size||0})',
        target
      )
      demand(value.hook && value.renderers > 0, 'Chrome React渲染器未检出')
      return value
    })
    if (fixed) {
      const { checkChromeReact } = await import('./chrome-react-check.mjs')
      await record(
        fixed
          ? 'Chrome修复版真实属性、Profiler与零SVG错误'
          : 'Chrome原版真实属性与Profiler（保留SVG诊断）',
        () =>
          checkChromeReact(
            cdp,
            output,
            site.url,
            result.reactVariant?.id ?? samples.find((s) => s.name === 'react').id,
            fixed
          )
      )
      if (result.checks.at(-1)?.status === 'pass') {
        result.pending = result.pending.filter((v) => v !== 'React Profiler 交互')
        await writeFile(join(output, 'chrome-results.json'), JSON.stringify(result, null, 2))
      }
      if (fixed) return
    }
    for (const name of ['dark', 'cookie', 'react']) {
      const sample = samples.find((v) => v.name === name)
      await record(`Chrome ${name} action popup`, async () => {
        await cdp.send('Target.activateTarget', { targetId: created.targetId })
        await cdp.send('Extensions.triggerAction', {
          id: sample.id,
          targetId: tabId ?? created.targetId
        })
        await delay(600)
        const { targetInfos } = await cdp.send('Target.getTargets')
        let popup = targetInfos.find(
          (v) => v.url.startsWith(`chrome-extension://${sample.id}/`) && v.type === 'page'
        )
        demand(popup, 'Chrome未打开popup')
        let popupSession = await cdp.attach(popup.targetId)
        const value = await cdp.evaluate(
          '({url:location.href,text:document.body.innerText.slice(0,5000)})',
          popupSession
        )
        const shot = await cdp.send('Page.captureScreenshot', {}, popupSession)
        await writeFile(join(output, `${name}-popup.png`), Buffer.from(shot.data, 'base64'))
        await writeFile(join(output, `${name}-popup.json`), JSON.stringify(value, null, 2))
        if (name === 'cookie') {
          const workers = await cdp.send('Target.getTargets')
          const worker = workers.targetInfos.find(
            (v) =>
              v.type === 'service_worker' && v.url.startsWith(`chrome-extension://${sample.id}/`)
          )
          demand(worker, 'Cookie后台未运行')
          const workerSession = await cdp.attach(worker.targetId)
          const permissionQuery = JSON.stringify({
            origins: ['http://localhost/*', 'http://*.undefined.localhost/*']
          })
          await cdp.evaluate("document.getElementById('request-permission')?.click()", popupSession)
          console.log('等待Chrome原生站点授权；后台只读取permissions.contains，不重新打开弹出页')
          let permissionReady = false
          for (let i = 0; i < 900; i++) {
            if (
              await cdp.evaluate(`chrome.permissions.contains(${permissionQuery})`, workerSession)
            ) {
              permissionReady = true
              break
            }
            await delay(100)
          }
          demand(permissionReady, 'Chrome本地站点Cookie权限未完成')
          await cdp.send('Target.activateTarget', { targetId: created.targetId })
          await cdp.send('Extensions.triggerAction', {
            id: sample.id,
            targetId: tabId ?? created.targetId
          })
          await delay(500)
          const current = await cdp.send('Target.getTargets')
          popup = current.targetInfos.find(
            (v) => v.type === 'page' && v.url.startsWith(`chrome-extension://${sample.id}/`)
          )
          demand(popup, '授权后Cookie弹窗未恢复')
          popupSession = await cdp.attach(popup.targetId)
          await cdp.send('Browser.grantPermissions', {
            origin: `chrome-extension://${sample.id}`,
            permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite']
          })
          await cdp.send('Page.bringToFront', {}, popupSession)
          await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }, popupSession)
          value.functional = await exerciseCookie({
            evaluate: (expression) => cdp.evaluate(expression, popupSession),
            getCookies: async (filter) =>
              (await cdp.send('Network.getCookies', { urls: [filter.url] }, target)).cookies.filter(
                (c) => c.name === filter.name
              ),
            removeCookie: (url, name) => cdp.send('Network.deleteCookies', { url, name }, target),
            readClipboard: () => cdp.evaluate('navigator.clipboard.readText()', popupSession),
            resetClipboard: () =>
              cdp.evaluate("navigator.clipboard.writeText('preflight-empty')", popupSession),
            url: site.url
          })
        }
        if (name === 'dark') {
          await cdp.evaluate("document.querySelector('.toggle__off').click()", popupSession)
          await delay(500)
          const off = await cdp.evaluate(
            "document.documentElement.getAttribute('data-darkreader-mode')",
            target
          )
          await cdp.evaluate("document.querySelector('.toggle__on').click()", popupSession)
          await delay(500)
          const on = await cdp.evaluate(
            "document.documentElement.getAttribute('data-darkreader-mode')",
            target
          )
          demand(!off && on, 'Chrome Dark Reader开关没有改变目标页面')
          value.functionalToggle = { off, on }
        }

        await cdp.send('Target.closeTarget', { targetId: popup.targetId })
        return value
      })
    }
    const other = await cdp.send('Target.createTarget', { url: `${site.url}/?session=B` })
    const otherSession = await cdp.attach(other.targetId)
    await delay(500)
    await cdp.evaluate('window.testSite.startAudio(733)', otherSession)
    await cdp.evaluate('window.testSite.startAudio(440)', target)
    const fixture = join(output, 'media-fixture')
    await cp(join(here, 'chrome-fixture'), fixture, { recursive: true })
    await copyFile(join(here, 'media.js'), join(fixture, 'media.js'))
    await writeFile(join(fixture, 'config.js'), `window.preflightDuration=${duration}`)
    const loaded = await cdp.send('Extensions.loadUnpacked', { path: fixture })
    await record('Chrome真实截图与Tab音频录制', async () => {
      if (sync)
        await writeFile(
          join(output, 'sync-geometry.json'),
          JSON.stringify(await cdp.evaluate('window.testSite.syncGeometry()', target), null, 2)
        )
      await cdp.send('Target.activateTarget', { targetId: created.targetId })
      let worker
      for (let i = 0; i < 40; i++) {
        const inventory = await cdp.send('Target.getTargets', { filter: [{}] })
        worker = inventory.targetInfos.find(
          (v) => v.type === 'service_worker' && v.url.startsWith(`chrome-extension://${loaded.id}/`)
        )
        if (worker) break
        await delay(100)
      }
      demand(worker, '自有夹具service worker未启动')
      const control = await cdp.attach(worker.targetId)
      for (let i = 0; i < 30; i++) {
        if (await cdp.evaluate('chrome.action.onClicked.hasListeners()', control)) break
        await delay(100)
      }
      await cdp.send('Extensions.triggerAction', {
        id: loaded.id,
        targetId: tabId ?? created.targetId
      })
      await delay(500)
      let state
      for (let i = 0; i < Math.ceil(duration / 250) + 60; i++) {
        state = await cdp.evaluate(
          'chrome.storage.local.get(["recording","error","info","downloadId"])',
          control
        )
        if (state.recording === 'failed') throw new Error(state.error)
        if (state.recording === 'done') break
        await delay(250)
      }
      await writeFile(join(output, 'media-state.json'), JSON.stringify(state, null, 2))
      demand(state?.recording === 'done', 'Chrome录制没有完成：' + JSON.stringify(state))
      const controller = await cdp.send('Target.createTarget', {
        url: `chrome-extension://${loaded.id}/controller.html`
      })
      const pageControl = await cdp.attach(controller.targetId)
      await cdp.send('Page.bringToFront', {}, pageControl)
      await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }, pageControl)
      await delay(300)
      await cdp.send('Page.bringToFront', {}, pageControl)
      await cdp.send('Browser.grantPermissions', {
        origin: `chrome-extension://${loaded.id}`,
        permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite']
      })
      const copy = await cdp.evaluate(
        '(async()=>{const {capturePNG}=await chrome.storage.local.get("capturePNG");const blob=await(await fetch(capturePNG)).blob();await navigator.clipboard.write([new ClipboardItem({"image/png":blob})]);return {type:blob.type,size:blob.size}})()',
        pageControl
      )
      state.clipboard = copy
      await delay(600)
      const downloads = await cdp.evaluate(
        'chrome.downloads.search({limit:10,orderBy:["-startTime"]})',
        control
      )
      demand(downloads.filter((v) => v.state === 'complete').length >= 2, '媒体下载未完成')
      const video = downloads.find((v) => v.id === state.downloadId),
        png = downloads.find((v) => v.mime === 'image/png')
      demand(
        isInside(output, video?.filename) && isInside(output, png?.filename),
        '下载证据不在本次目录'
      )
      await copyFile(video.filename, join(output, 'msb-preflight-tab-audio.mp4'))
      await copyFile(png.filename, join(output, 'msb-preflight-target.png'))
      state.downloads = downloads.map(({ filename, state, error }) => ({ filename, state, error }))
      return state
    })
    await cdp.evaluate('window.testSite.stopAudio()', target)
    await cdp.evaluate('window.testSite.stopAudio()', otherSession)
  } catch (error) {
    result.fatal = String(error)
    console.error(error)
  } finally {
    if (cdp) {
      try {
        await cdp.send('Browser.close')
      } catch {
        /* 关闭时连接可先断 */
      }
      cdp.close()
    }
    if (child && child.exitCode === null) {
      await delay(500)
      if (child.exitCode === null) child.kill('SIGTERM')
    }
    await site.close()
    await writeFile(join(output, 'process.log'), log)
    await writeFile(join(output, 'chrome-results.json'), JSON.stringify(result, null, 2))
    await writeFile(join(artifacts, 'latest-chrome.txt'), output)
    console.log(`Chrome证据目录：${output}`)
    if (result.fatal || result.checks.some((v) => v.status === 'fail')) process.exitCode = 1
  }
}
