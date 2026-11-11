/* eslint @typescript-eslint/explicit-function-return-type: off -- 插件真机检查使用原生 JavaScript */
// 会话2 M1 检查：Chrome 真机验证 extensions/screenshot 与 extensions/recorder。
// 复用前置工具链（CDP/测试站点），不修改其源码；不接触日常 profile。
import { spawn, execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { CDP } from '../extension-preflight/cdp.mjs'
import { startSite } from '../extension-preflight/server.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '../..')
const delay = (ms) => new Promise((ok) => setTimeout(ok, ms))

/** 本机 Chrome for Testing（前置验证下载的官方独立浏览器），可用时优先，不接触日常Chrome */
function pickChrome() {
  if (process.env.PREFLIGHT_CHROME_BINARY) return process.env.PREFLIGHT_CHROME_BINARY
  const cft =
    '/Users/pangzerui/foreunit/multi-session-browser-wt/feature-chrome-extension-preflight/tools/extension-preflight/out/.artifacts/cft/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
  if (existsSync(cft)) return cft
  return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
}

const output = join(here, 'out', new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, ''))
await mkdir(output, { recursive: true })
const results = { platform: process.platform, checks: [], output }
async function record(name, fn) {
  try {
    const detail = await fn()
    results.checks.push({ name, status: 'pass', detail })
    console.log(JSON.stringify({ name, status: 'pass' }))
  } catch (error) {
    results.checks.push({ name, status: 'fail', error: String(error).slice(0, 2000) })
    console.error(name, String(error))
  }
  await writeFile(join(output, 'results.json'), JSON.stringify(results, null, 2))
}

let cdp,
  child,
  site,
  log = ''
try {
  // 编辑器 bundle 构建（esbuild 与前置同链路）
  await import(join(root, 'extensions/build.mjs'))

  child = spawn(
    pickChrome(),
    [
      `--user-data-dir=${join(output, 'profile')}`,
      '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=0',
      '--enable-unsafe-extension-debugging',
      '--no-first-run',
      '--no-default-browser-check',
      '--force-device-scale-factor=2',
      'about:blank'
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  )
  child.on('error', (e) => (log += String(e)))
  for (const s of [child.stdout, child.stderr]) s.on('data', (d) => (log += d.toString()))
  let debug
  for (let i = 0; i < 100; i++) {
    try {
      debug = (await readFile(join(output, 'profile/DevToolsActivePort'), 'utf8'))
        .trim()
        .split('\n')
      break
    } catch {
      await delay(100)
    }
  }
  assert(debug, 'Chrome未启动远程调试')
  cdp = await CDP.connect(`ws://127.0.0.1:${debug[0]}${debug[1]}`)
  await cdp.send('Browser.getVersion')
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: output })

  const shotExt = await cdp.send('Extensions.loadUnpacked', {
    path: join(root, 'extensions/screenshot')
  })
  const recExt = await cdp.send('Extensions.loadUnpacked', {
    path: join(root, 'extensions/recorder')
  })
  const shotUrl = `chrome-extension://${shotExt.id}/`,
    recUrl = `chrome-extension://${recExt.id}/`

  await record('双插件图标资源与manifest接入', async () => {
    for (const plugin of ['screenshot', 'recorder']) {
      const manifest = JSON.parse(await readFile(join(root, 'extensions', plugin, 'manifest.json')))
      for (const icons of [manifest.icons, manifest.action.default_icon]) {
        assert(icons && Object.keys(icons).length >= 2, '图标缺少多分辨率映射')
        for (const [size, path] of Object.entries(icons)) {
          const png = await readFile(join(root, 'extensions', plugin, path))
          assert.equal(png.readUInt32BE(16), Number(size), '图标宽度不符')
          assert.equal(png.readUInt32BE(20), Number(size), '图标高度不符')
        }
      }
    }
    return { plugins: 2, designs: 4 }
  })

  // 测试站点 + 固定视口（控制截图体积，避免storage.local配额压力）。
  // 本 Chrome 中 filter 列表同一标签页出现 tab/page 两个 target：tab 型只用于
  // Extensions.triggerAction；attach/Emulation/evaluate 用 page 型。
  site = await startSite()
  await cdp.send('Target.createTarget', { url: `${site.url}/?session=A` })
  let tabId, pageTargetId
  for (let i = 0; i < 50; i++) {
    const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{}] })
    tabId = targetInfos.find(
      (v) => v.type === 'tab' && v.url === `${site.url}/?session=A`
    )?.targetId
    pageTargetId = targetInfos.find(
      (v) => v.type === 'page' && v.url === `${site.url}/?session=A`
    )?.targetId
    if (tabId && pageTargetId) break
    await delay(100)
  }
  assert(tabId && pageTargetId, 'tab/page目标未找齐')
  const target = await cdp.attach(pageTargetId)
  const siteHasTestSite = () =>
    cdp.evaluate('({href:location.href.slice(0,80),hasSite:typeof window.testSite})', target)
  // 先等页面就绪再套视口指标，指标可能触发重载，套完再复查
  for (let i = 0; i < 100; i++) {
    if ((await siteHasTestSite()).hasSite === 'object') break
    await delay(100)
  }
  await cdp.send(
    'Emulation.setDeviceMetricsOverride',
    { width: 1280, height: 900, deviceScaleFactor: 2, mobile: false },
    target
  )
  let siteReady = null
  for (let i = 0; i < 100; i++) {
    siteReady = await siteHasTestSite()
    if (siteReady.hasSite === 'object') break
    await delay(100)
  }
  assert(siteReady.hasSite === 'object', '测试站点未就绪：' + JSON.stringify(siteReady))
  const pageErrors = []
  cdp.socket.on('message', (raw) => {
    const m = JSON.parse(raw)
    if (m.sessionId === target && m.method === 'Runtime.exceptionThrown')
      pageErrors.push(m.params.exceptionDetails.text)
  })
  await cdp.send('Runtime.enable', {}, target)

  // ===== 截图插件 =====
  const editorSessions = []
  let expectedExportSize
  const skipEditor = process.env.PLUGIN_CHECK_SKIP_EDITOR === '1'
  /** 直接附着 Chrome popup。popup 无浏览器标签栏，但仍保留系统标题栏。 */
  async function attachEditor(urlPrefix, excludeIds) {
    let editorTarget
    for (let i = 0; i < 120; i++) {
      const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{}] })
      editorTarget = targetInfos.find(
        (v) => v.type === 'page' && v.url.startsWith(urlPrefix) && !excludeIds.includes(v.targetId)
      )
      if (editorTarget) break
      await delay(100)
    }
    assert(editorTarget, '编辑器页未打开')
    const session = await cdp.attach(editorTarget.targetId)
    await cdp.send('Page.bringToFront', {}, session)
    for (let i = 0; i < 80; i++) {
      if (await cdp.evaluate("!!document.querySelector('canvas')", session)) break
      await delay(100)
    }
    assert(await cdp.evaluate("!!document.querySelector('canvas')", session), '编辑器未挂载画布')
    return { targetId: editorTarget.targetId, session, url: editorTarget.url }
  }
  if (!skipEditor)
    await record('截图插件直接打开编辑器且无浮动与PiP', async () => {
      await cdp.send('Target.activateTarget', { targetId: tabId })
      await cdp.send('Extensions.triggerAction', { id: shotExt.id, targetId: tabId })
      const attached = await attachEditor(`${shotUrl}editor.html?captureId=`, [])
      editorSessions.push(attached)
      const layout = await cdp.evaluate(
        `(async () => {
        const c = document.querySelector('canvas'), rect = c.getBoundingClientRect()
        return { type: (await chrome.windows.getCurrent()).type,
          toolsTop: document.querySelector('.chrome-capture-editor-topbar').getBoundingClientRect().top,
          floating: !!document.querySelector('#pip-fallback, .pip-lights'),
          pip: !!window.documentPictureInPicture?.window,
          canvas: { width: c.width, displayWidth: rect.width, dpr: devicePixelRatio } }
      })()`,
        attached.session
      )
      assert.equal(layout.type, 'popup', '应使用直接编辑的 popup')
      assert.equal(layout.toolsTop, 0, '页内工具区应贴顶，无额外空白行')
      assert.equal(layout.floating, false, '不应有浮动入口或仿三灯')
      assert.equal(layout.pip, false, '不应迁移到 PiP')
      assert(
        Math.abs(layout.canvas.width / layout.canvas.displayWidth - layout.canvas.dpr) < 0.02,
        '画布设备像素密度不匹配'
      )
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }, attached.session)
      await writeFile(join(output, 'editor-popup.png'), Buffer.from(shot.data, 'base64'))
      await writeFile(join(output, 'editor-layout.json'), JSON.stringify(layout, null, 2))
      return { editorUrl: attached.url, layout, nativeTitleBar: 'Chrome管理，未隐藏' }
    })

  if (!skipEditor)
    await record('画布滚轮缩放重绘与边界', async () => {
      const session = editorSessions[0].session
      const inspect = () =>
        cdp.evaluate(
          `(() => {
        const d = document, c = d.querySelector('canvas')
        return { width: c.width, height: c.height, displayWidth: c.getBoundingClientRect().width,
          zoom: getComputedStyle(d.querySelector('.chrome-capture-editor-stage')).zoom }
      })()`,
          session
        )
      const wheel = async (deltaY, ctrlKey, count = 1) => {
        await cdp.evaluate(
          `(() => {
          const host = document.querySelector('.chrome-capture-editor-canvas')
          for (let i = 0; i < ${count}; i++) host.dispatchEvent(new WheelEvent('wheel',
            { deltaY: ${deltaY}, ctrlKey: ${ctrlKey}, bubbles: true, cancelable: true }))
        })()`,
          session
        )
        await delay(200)
      }
      const before = await inspect()
      await wheel(-100, false)
      assert.deepEqual(await inspect(), before, '普通滚轮不应缩放')
      await wheel(-100, true)
      const enlarged = await inspect()
      assert(
        enlarged.width > before.width && enlarged.displayWidth > before.displayWidth,
        '放大必须增大 backing canvas，不能只 CSS 放大'
      )
      assert.equal(Number(enlarged.zoom), 1, '不允许 CSS zoom')
      await wheel(100, true, 50)
      const minimum = await inspect()
      assert(Math.abs(minimum.width / before.width - 0.25) < 0.01, '最小缩放边界错误')
      await wheel(-100, true, 50)
      const maximum = await inspect()
      assert(Math.abs(maximum.width / before.width - 4) < 0.01, '最大缩放边界错误')
      // 恢复一个放大的比例，接下来整套编辑/导出检查在缩放后执行。
      await wheel(100, true, 12)
      return { before, enlarged, minimum, maximum }
    })

  if (!skipEditor)
    await record('编辑器复用生产组件：绘制/撤销/重做/文字/裁剪', async () => {
      const session = editorSessions[0].session
      await cdp.evaluate('window.focus()', session)
      const evaluate = (expr) => cdp.evaluate(expr, session)
      // 在当前 popup 直接交互；焦点模拟供真实剪贴板验证。
      await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }, session)
      const DOC = 'document'
      const click = (label) =>
        evaluate(
          `(() => { const b = [...${DOC}.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === ${JSON.stringify(label)} || b.textContent === ${JSON.stringify(label)}); if (!b) throw new Error('按钮未找到：' + ${JSON.stringify(label)}); b.click() })()`
        )
      const canvasData = () =>
        evaluate(`[...${DOC}.querySelectorAll('canvas')].map(c=>c.toDataURL()).join('')`)
      const canUndoRedo = () =>
        evaluate(
          `(() => { const b = (l) => ${DOC}.querySelector('button[aria-label=' + JSON.stringify(l) + ']'); return { undo: !b('撤销').disabled, redo: !b('重做').disabled } })()`
        )
      /** 向画布派发指针事件，坐标按当前显示比例现算。 */
      async function draw(x, y, w, h) {
        const r = await evaluate(`${DOC}.querySelector('canvas').getBoundingClientRect().toJSON()`)
        const sx = r.x + x,
          sy = r.y + y
        const fire = (type, px, py, buttons) =>
          evaluate(
            `(() => { ${DOC}.querySelector('canvas').dispatchEvent(new MouseEvent('${type}', { clientX: ${px}, clientY: ${py}, button: 0, buttons: ${buttons}, bubbles: true })) })()`
          )
        await fire('mousedown', sx, sy, 1)
        for (let i = 1; i <= 8; i++) await fire('mousemove', sx + (w * i) / 8, sy + (h * i) / 8, 1)
        await fire('mouseup', sx + w, sy + h, 0)
        // Konva 拖拽态结算 + 重绘节拍
        await delay(260)
      }
      const before = await canvasData()
      await click('矩形')
      await draw(40, 120, 360, 55)
      let drawn = await canvasData()
      for (let i = 0; i < 25 && drawn === before; i++) {
        await delay(100)
        drawn = await canvasData()
      }
      assert.notEqual(drawn, before, '矩形没有绘制结果')
      const afterDraw = await canUndoRedo()
      assert(afterDraw.undo, '矩形后撤销钮不可用')
      await click('撤销')
      await delay(200)
      const undone = await canUndoRedo()
      assert(undone.redo && !undone.undo, '撤销未生效：' + JSON.stringify(undone))
      await click('重做')
      await delay(200)
      const redone = await canUndoRedo()
      assert(redone.undo && !redone.redo, '重做未生效：' + JSON.stringify(redone))
      await click('文字')
      // 文字落点必须在矩形标注之外（落点在可拖拽标注上会触发 Konva 原生拖拽而非开文本框）
      await draw(520, 320, 0, 0)
      // 文字框偶发慢挂载：等待后仍未出现则换点补击一次
      for (let i = 0; i < 40; i++) {
        if (await evaluate('!!' + DOC + ".querySelector('textarea')")) break
        await delay(100)
      }
      if (!(await evaluate('!!' + DOC + ".querySelector('textarea')"))) {
        await draw(560, 360, 0, 0)
        for (let i = 0; i < 60; i++) {
          if (await evaluate('!!' + DOC + ".querySelector('textarea')")) break
          await delay(100)
        }
      }
      assert(await evaluate('!!' + DOC + ".querySelector('textarea')"), '文字输入框未出现')
      // 文本注入：textarea.value 现填 + input 事件 + 合成 Enter keydown（React
      // onKeyDown 读 e.key，commitTextEdit 从 ref 现读 textarea.value）
      await evaluate(`(() => {
        const ta = ${DOC}.querySelector('textarea')
        ta.value = '插件M1'
        ta.dispatchEvent(new Event('input', { bubbles: true }))
        ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      })()`)
      await delay(120)
      await click('裁剪')
      const displayScale = await evaluate(`(async () => {
        const win = window
        const image = await win.api.capture.getEditImage()
        return win.document.querySelector('canvas').getBoundingClientRect().width / image.width
      })()`)
      expectedExportSize = {
        width: Math.round(500 / displayScale),
        height: Math.round(300 / displayScale)
      }
      await draw(20, 120, 500, 300)
      for (let i = 0; i < 40; i++) {
        if (
          await evaluate('!!' + DOC + ".querySelector('.chrome-capture-editor-cropbtn.is-primary')")
        )
          break
        await delay(100)
      }
      await evaluate(DOC + ".querySelector('.chrome-capture-editor-cropbtn.is-primary').click()")
      await delay(300)
      // 保存编辑成品，另保留真实 popup 界面截图。
      const dataUrl = await evaluate(`${DOC}.querySelector('canvas').toDataURL('image/png')`)
      await writeFile(
        join(output, 'plugin-editor.png'),
        Buffer.from(dataUrl.split(',')[1], 'base64')
      )
      assert.equal(pageErrors.length, 0, '编辑器页有运行时异常：' + pageErrors.join(';'))
      return { annotated: true }
    })

  if (!skipEditor)
    await record('编辑器复制与下载PNG', async () => {
      const session = editorSessions[0].session
      await cdp.evaluate(
        `(() => {
        const win = window
        win.focus()
        const original = win.api.capture.editCopy
        win.api.capture.editCopy = async (input) => {
          try { return await original(input) } catch(error) {
            win.copyFailure = String(error)
            throw error
          }
        }
      })()`,
        session
      )
      await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }, session)
      await cdp.send('Browser.grantPermissions', {
        origin: shotUrl,
        permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite']
      })
      // popup 内操作与读取真实系统剪贴板，不替换复制/下载的实际行为。
      const click = (label) =>
        cdp.evaluate(
          `(() => { const d = document; const b = [...d.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === ${JSON.stringify(label)} || b.textContent === ${JSON.stringify(label)}); if (!b) throw new Error('按钮未找到：' + ${JSON.stringify(label)}); b.click() })()`,
          session
        )
      await click('复制到剪贴板')
      let clipboard = null
      for (let i = 0; i < 50; i++) {
        clipboard = await cdp.evaluate(
          `(async()=>{try{const items=await navigator.clipboard.read();const blob=await items[0].getType('image/png');const image=await createImageBitmap(blob);return {width:image.width,height:image.height,size:blob.size}}catch{return null}})()`,
          session
        )
        if (clipboard) break
        await delay(100)
      }
      const exportError = await cdp.evaluate(
        "document.querySelector('.chrome-capture-editor-errorbar')?.textContent",
        session
      )
      const focus = await cdp.evaluate(
        `({ focused: document.hasFocus(), error: window.copyFailure })`,
        session
      )
      assert(clipboard, '剪贴板没有PNG：' + exportError + ' ' + JSON.stringify(focus))
      assert(
        Math.abs(clipboard.width - expectedExportSize.width) <= 1,
        '放大后导出宽度应还原图像像素：' + JSON.stringify({ clipboard, expectedExportSize })
      )
      assert(
        Math.abs(clipboard.height - expectedExportSize.height) <= 1,
        '放大后导出高度应还原图像像素：' + JSON.stringify({ clipboard, expectedExportSize })
      )
      const downloadsBefore = await cdp.evaluate(
        'chrome.downloads.search({limit:100})',
        await attachWorker(shotExt.id)
      )
      await click('下载')
      let download
      for (let i = 0; i < 50; i++) {
        const rows = await cdp.evaluate(
          'chrome.downloads.search({limit:100,orderBy:["-startTime"]})',
          await attachWorker(shotExt.id)
        )
        download = rows.find((v) => v.state === 'complete' && v.mime === 'image/png')
        if (download) break
        await delay(100)
      }
      assert(download, '下载未完成')
      const png = await readFile(download.filename)
      assert.equal(png.readUInt32BE(16), clipboard.width, '下载PNG宽度不符')
      assert.equal(png.readUInt32BE(20), clipboard.height, '下载PNG高度不符')
      await copyFile(download.filename, join(output, 'plugin-edited.png'))
      return { clipboard, downloadsBefore: downloadsBefore.length }
    })

  if (!skipEditor)
    await record('过期captureId拒绝', async () => {
      const stale = await cdp.send('Target.createTarget', {
        url: `${shotUrl}editor.html?captureId=stale-bogus`
      })
      const session = await cdp.attach(stale.targetId)
      let text = ''
      for (let i = 0; i < 50; i++) {
        text = await cdp.evaluate("document.getElementById('root')?.textContent ?? ''", session)
        if (text.includes('截图不存在或已过期')) break
        await delay(100)
      }
      assert(text.includes('截图不存在或已过期'), '过期快照未被拒绝：' + text.slice(0, 200))
      await cdp.send('Target.closeTarget', { targetId: stale.targetId })
      return { rejected: true }
    })
  if (!skipEditor)
    await record('第二张截图快照独立', async () => {
      await cdp.send('Target.activateTarget', { targetId: tabId })
      await cdp.send('Extensions.triggerAction', { id: shotExt.id, targetId: tabId })
      const attached = await attachEditor(
        `${shotUrl}editor.html?captureId=`,
        editorSessions.map((s) => s.targetId)
      )
      editorSessions.push(attached)
      assert(
        editorSessions[0].url.split('captureId=')[1] !==
          editorSessions[1].url.split('captureId=')[1],
        '两次快照captureId相同'
      )
      assert(editorSessions[0].targetId !== editorSessions[1].targetId, '编辑器未独立成页')
      return { second: editorSessions[1].url }
    })

  // ===== 录屏插件 =====
  async function attachWorker(extId) {
    for (let i = 0; i < 40; i++) {
      const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{}] })
      const worker = targetInfos.find(
        (v) => v.type === 'service_worker' && v.url.startsWith(`chrome-extension://${extId}/`)
      )
      if (worker) return await cdp.attach(worker.targetId)
      await delay(100)
    }
    throw new Error('扩展service worker未启动: ' + extId)
  }

  const recControl = await attachWorker(recExt.id)

  await record('录屏原生提示不改变popup布局', async () => {
    const { targetId } = await cdp.send('Target.createTarget', { url: recUrl + 'popup.html' })
    const session = await cdp.attach(targetId)
    await cdp.send('Page.enable', {}, session)
    for (let i = 0; i < 50; i++) {
      if (await cdp.evaluate("!!document.getElementById('audio')", session)) break
      await delay(100)
    }
    const dimensions = () =>
      cdp.evaluate(
        `(() => {
      const main = document.querySelector('main').getBoundingClientRect()
      return { width: main.width, height: main.height,
        scrollWidth: document.body.scrollWidth, scrollHeight: document.body.scrollHeight }
    })()`,
        session
      )
    const evidence = []
    for (const width of [296, 360]) {
      await cdp.send(
        'Emulation.setDeviceMetricsOverride',
        {
          width,
          height: 120,
          deviceScaleFactor: 2,
          mobile: false
        },
        session
      )
      const before = await dimensions()
      const buttons = await cdp.evaluate(
        `Array.from(document.querySelectorAll('button')).map(b => ({
        title: b.title, after: getComputedStyle(b, '::after').content,
        rect: b.getBoundingClientRect().toJSON() }))`,
        session
      )
      for (const b of buttons) {
        assert(b.title, '每个图标须有原生提示')
        assert(['none', 'normal'].includes(b.after), '不得用 DOM 伪元素承载跨窗提示')
        await cdp.send(
          'Input.dispatchMouseEvent',
          {
            type: 'mouseMoved',
            x: b.rect.x + b.rect.width / 2,
            y: b.rect.y + b.rect.height / 2
          },
          session
        )
        assert.deepEqual(await dimensions(), before, 'hover 不应扩大 popup')
      }
      assert(before.scrollWidth <= width, '面板存在横向溢出')
      for (const theme of ['light', 'dark']) {
        await cdp.send(
          'Emulation.setEmulatedMedia',
          {
            features: [{ name: 'prefers-color-scheme', value: theme }]
          },
          session
        )
        const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }, session)
        await writeFile(
          join(output, `recorder-${width}-${theme}.png`),
          Buffer.from(shot.data, 'base64')
        )
      }
      evidence.push({ width, dimensions: before })
    }
    await cdp.send('Target.closeTarget', { targetId })
    return evidence
  })
  const rec = () =>
    cdp.evaluate('chrome.storage.local.get("rec")', recControl).then((v) => v?.rec ?? null)
  async function waitForState(pred, reason, timeout = 15000) {
    for (let i = 0; i < timeout / 100; i++) {
      const value = await rec()
      if (value && pred(value)) return value
      await delay(100)
    }
    throw new Error(reason + '：' + JSON.stringify(await rec()))
  }
  /** 按 downloadId 查真实落盘路径（Chrome 对 blob 下载可能忽略 filename 参数） */
  async function downloadPathById(downloadId) {
    const rows = await cdp.evaluate('chrome.downloads.search({limit:200})', recControl)
    const row = rows.find((v) => v.id === downloadId)
    assert(row && row.state === 'complete', '下载未完成：' + JSON.stringify(row?.state))
    return row.filename
  }
  /** 打开录屏popup并点击其中按钮（popup 即插件入口下方的操作面板） */
  const popupClick = async (id, action) => {
    await cdp.send('Target.activateTarget', { targetId: tabId })
    await cdp.send('Extensions.triggerAction', { id: recExt.id, targetId: tabId })
    let popupId
    for (let i = 0; i < 40; i++) {
      const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{}] })
      const popup = targetInfos.find(
        (v) => v.type === 'page' && v.url.startsWith(`${recUrl}popup.html`)
      )
      if (popup) {
        popupId = popup.targetId
        break
      }
      await delay(100)
    }
    assert(popupId, '录屏popup未打开')
    const session = await cdp.attach(popupId)
    await cdp.send('Page.bringToFront', {}, session)
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }, session)
    // DOM 挂载早于 popup.js 监听器注册；load 完成且按钮可用后再点，避免空点击。
    for (let i = 0; i < 50; i++) {
      if (
        await cdp.evaluate(
          `(() => { const el = document.getElementById('${id}'); return document.readyState === 'complete' && !!el && !el.disabled })()`,
          session
        )
      )
        break
      await delay(100)
    }
    await cdp.evaluate(`document.getElementById('${id}')${action}`, session)
    await delay(150)
  }
  /** audio 开关点击：popup 监听器挂载与 DOM 就绪存在竞态，点击后校验状态翻转，未翻转重试 */
  const clickAudioUntil = async (pred, reason) => {
    for (let attempt = 0; attempt < 6; attempt++) {
      await popupClick('audio', '.click()')
      for (let j = 0; j < 20; j++) {
        const value = await rec()
        if (value && pred(value)) return
        await delay(100)
      }
    }
    throw new Error(reason + '：' + JSON.stringify(await rec()))
  }

  /** 测试音启动（指标重载竞态下 testSite 可能瞬时丢失，失败即重探重试） */
  async function startTabAudio(session, freq) {
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        return await cdp.evaluate(`window.testSite.startAudio(${freq})`, session)
      } catch {
        await delay(500)
      }
    }
    const probe = await cdp.evaluate('({href:location.href.slice(0,80)})', session)
    throw new Error('测试音启动失败：' + JSON.stringify(probe))
  }

  const timeline = {}
  await record('录屏启动与状态机（协议v1模型）', async () => {
    await startTabAudio(target, 440)
    const other = await cdp.send('Target.createTarget', { url: `${site.url}/?session=B` })
    const otherSession = await cdp.attach(other.targetId)
    await startTabAudio(otherSession, 733)
    timeline.startedAt = Date.now()
    await popupClick('start', '.click()')
    const started = await waitForState((v) => v.state === 'recording', '录制未进入recording')
    assert(started.generation >= 1, 'generation未递增')
    // 忙碌语义：录制中再点图标只重开popup（start钮被禁用），不并发新录制
    await cdp.send('Target.activateTarget', { targetId: tabId })
    await cdp.send('Extensions.triggerAction', { id: recExt.id, targetId: tabId })
    await delay(400)
    const busy = await rec()
    assert(busy.state === 'recording', '忙碌时并发了新录制')
    return { state: started.state, generation: started.generation, seq: started.seq }
  })

  await record('暂停排除与恢复（3秒暂停段不进入时长）', async () => {
    await delay(2000)
    await popupClick('pause', '.click()')
    timeline.pausedAt = Date.now()
    const paused = await waitForState((v) => v.state === 'paused', '未进入paused')
    await delay(3000)
    await popupClick('resume', '.click()')
    timeline.resumedAt = Date.now()
    const resumed = await waitForState((v) => v.state === 'recording', '未恢复recording')
    return { paused: paused.seq, resumed: resumed.seq }
  })

  await record('录制中静音开关即时生效并恢复', async () => {
    await clickAudioUntil((v) => v.audioMutedLive === true, '静音开关未生效')
    await clickAudioUntil((v) => v.audioMutedLive === false, '取消静音未生效')
    return { toggled: true }
  })

  await record('停止落盘与MP4规格（H264/AAC、暂停排除）', async () => {
    await delay(1500)
    timeline.stoppedAt = Date.now()
    await popupClick('stop', '.click()')
    const done = await waitForState(
      (v) => v.state === 'idle' && v.info?.downloadId,
      '停止后未落盘完成',
      20000
    )
    await delay(800)
    const file = await downloadPathById(done.info.downloadId)
    assert(existsSync(file), '下载文件不存在：' + file)
    const meta = JSON.parse(
      execFileSync(
        'ffprobe',
        [
          '-v',
          'error',
          '-show_entries',
          'stream=codec_name,codec_type:format=duration',
          '-of',
          'json',
          file
        ],
        { encoding: 'utf8' }
      )
    )
    const codecs = meta.streams.map((s) => `${s.codec_type}:${s.codec_name}`).sort()
    assert.deepEqual(codecs, ['audio:aac', 'video:h264'], '编码不符：' + codecs.join(','))
    const duration = Number(meta.format.duration)
    // 期望有效时长 = 总经过 - 暂停段；±1.8s 容差
    const expected =
      (timeline.stoppedAt - timeline.startedAt - (timeline.resumedAt - timeline.pausedAt)) / 1000
    assert(
      Math.abs(duration - expected) < 1.8,
      `时长未对齐时间线：实际${duration}s 期望≈${expected.toFixed(1)}s`
    )
    await copyFile(file, join(output, 'recorder-audio-on.mp4'))
    return { duration, codecs }
  })

  await record('音频内容440Hz主导且排除733Hz', async () => {
    const file = join(output, 'recorder-audio-on.mp4')
    const pcm = execFileSync(
      'ffmpeg',
      ['-v', 'error', '-i', file, '-vn', '-ar', '48000', '-ac', '1', '-f', 'f32le', 'pipe:1'],
      { maxBuffer: 64 * 1024 * 1024 }
    )
    function tone(freq) {
      const start = 4800
      const count = Math.min(65536, pcm.length / 4 - start)
      let real = 0,
        imag = 0
      for (let i = 0; i < count; i++) {
        const v = pcm.readFloatLE((start + i) * 4)
        const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / count)
        const phase = (2 * Math.PI * freq * i) / 48000
        real += v * w * Math.cos(phase)
        imag += v * w * Math.sin(phase)
      }
      return Math.hypot(real, imag) / Math.max(1, count)
    }
    const t440 = tone(440),
      t733 = tone(733)
    assert(t440 > t733 * 20, `440Hz应主导（440=${t440}, 733=${t733}）`)
    return { t440, t733, separationDb: 20 * Math.log10(t440 / t733) }
  })

  await record('独立audio开关：关音频录制无音轨', async () => {
    await delay(1200)
    await clickAudioUntil((v) => v.audioEnabled === false, 'audio开关未保存')
    await popupClick('start', '.click()')
    await waitForState((v) => v.state === 'recording', '第二次录制未启动')
    await delay(3000)
    await popupClick('stop', '.click()')
    const done = await waitForState(
      (v) => v.state === 'idle' && v.info?.downloadId,
      '第二次未落盘',
      20000
    )
    const file = await downloadPathById(done.info.downloadId)
    const meta = JSON.parse(
      execFileSync(
        'ffprobe',
        ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'json', file],
        {
          encoding: 'utf8'
        }
      )
    )
    assert(!meta.streams.some((s) => s.codec_type === 'audio'), '关闭音频仍有音轨')
    assert.equal(done.info.audioIncluded, false, 'info.audioIncluded应false')
    await copyFile(file, join(output, 'recorder-audio-off.mp4'))
    return { filename: done.info.filename, streams: meta.streams.map((s) => s.codec_type) }
  })

  await record('目标关闭即时收尾（TARGET_GONE语义）', async () => {
    // 上一次录制刚释放采集源，给Chrome一拍恢复时间；失败重试一次启动
    await delay(1500)
    await popupClick('start', '.click()')
    try {
      await waitForState((v) => v.state === 'recording', '第三次录制未启动(popup点开始)', 8000)
    } catch {
      await delay(1000)
      await popupClick('start', '.click()')
      await waitForState((v) => v.state === 'recording', '第三次重试仍未启动')
    }
    await delay(2000)
    await cdp.send('Target.closeTarget', { targetId: pageTargetId })
    const done = await waitForState(
      (v) => v.state === 'idle' && v.info?.reason === 'target-gone',
      '目标关闭未即时收尾',
      15000
    )
    return { reason: done.info.reason, filename: done.info.filename }
  })

  assert.equal(pageErrors.length, 0, '测试页有运行时异常：' + pageErrors.join(';'))
} catch (error) {
  results.fatal = String(error).slice(0, 2000)
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
  if (site) await site.close()
  await writeFile(join(output, 'process.log'), log)
  await writeFile(join(output, 'results.json'), JSON.stringify(results, null, 2))
  console.log(`插件检查证据目录：${output}`)
  const failed = results.checks.filter((v) => v.status === 'fail').length
  if (failed || results.fatal) {
    console.error(`失败 ${failed} 项`)
    process.exitCode = 1
  } else {
    console.log(`全部通过：${results.checks.length} 项`)
  }
}
