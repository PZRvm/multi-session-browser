/* eslint @typescript-eslint/explicit-function-return-type: off -- 独立验证脚本使用原生 JavaScript */
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { CDP } from './cdp.mjs'
import { startEditorSite } from './editor-server.mjs'
const here = dirname(fileURLToPath(import.meta.url)),
  output = join(here, 'out/.artifacts/editor-' + Date.now())
await mkdir(output, { recursive: true })
const site = await startEditorSite(
  process.argv[2] ?? join(here, 'out/.artifacts/2026-11-10T04-45-00-471Z/target-A.png')
)
let cdp, child
const checks = [],
  errors = []
const hash = (s) => createHash('sha256').update(s).digest('hex')
const delay = (ms) => new Promise((ok) => setTimeout(ok, ms))
async function wait(read, reason) {
  for (let i = 0; i < 100; i++) {
    const value = await read()
    if (value) return value
    await delay(100)
  }
  throw new Error(reason)
}
try {
  child = spawn(
    process.env.PREFLIGHT_CHROME_BINARY ??
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    [
      `--user-data-dir=${join(output, 'profile')}`,
      '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=0',
      '--no-first-run',
      '--no-default-browser-check',
      'about:blank'
    ],
    { stdio: 'ignore' }
  )
  const port = await wait(async () => {
    try {
      return (await readFile(join(output, 'profile/DevToolsActivePort'), 'utf8')).trim().split('\n')
    } catch {
      return false
    }
  }, 'Chrome未启动')
  cdp = await CDP.connect(`ws://127.0.0.1:${port[0]}${port[1]}`)
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: output })
  await cdp.send('Browser.grantPermissions', {
    origin: site.url,
    permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite']
  })
  const target = await cdp.send('Target.createTarget', { url: site.url })
  const session = await cdp.attach(target.targetId)
  await cdp.send(
    'Emulation.setDeviceMetricsOverride',
    { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false },
    session
  )
  const evaluate = (s) => cdp.evaluate(s, session)
  cdp.socket.on('message', (raw) => {
    const m = JSON.parse(raw)
    if (m.sessionId === session && m.method === 'Runtime.exceptionThrown')
      errors.push(m.params.exceptionDetails.text)
  })
  await cdp.send('Runtime.enable', {}, session)
  await wait(() => evaluate("!!document.querySelector('canvas')"), '编辑器未加载')
  await delay(200)
  const click = (label) =>
    evaluate(
      `[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===${JSON.stringify(label)}||b.textContent===${JSON.stringify(label)}).click()`
    )
  const state = () =>
    evaluate(
      "({canUndo:!document.querySelector('button[aria-label=撤销]').disabled,canRedo:!document.querySelector('button[aria-label=重做]').disabled,canvas:[...document.querySelectorAll('canvas')].map(c=>c.toDataURL())})"
    )
  async function draw(x, y, w, h) {
    const r = await evaluate("document.querySelector('canvas').getBoundingClientRect().toJSON()")
    const sx = r.x + x,
      sy = r.y + y
    await cdp.send(
      'Input.dispatchMouseEvent',
      { type: 'mousePressed', x: sx, y: sy, button: 'left', buttons: 1, clickCount: 1 },
      session
    )
    for (let i = 1; i <= 8; i++)
      await cdp.send(
        'Input.dispatchMouseEvent',
        {
          type: 'mouseMoved',
          x: sx + (w * i) / 8,
          y: sy + (h * i) / 8,
          button: 'left',
          buttons: 1
        },
        session
      )
    await cdp.send(
      'Input.dispatchMouseEvent',
      { type: 'mouseReleased', x: sx + w, y: sy + h, button: 'left', buttons: 0, clickCount: 1 },
      session
    )
    await delay(150)
  }
  for (const label of ['矩形', '椭圆', '箭头', '画笔', '马赛克']) {
    const before = await state()
    await click(label)
    await draw(40, 20, 360, 55)
    const after = await state()
    assert(after.canUndo, label + '无撤销记录')
    assert.notEqual(
      hash(after.canvas.join('')),
      hash(before.canvas.join('')),
      label + '没有绘制结果'
    )
    await click('撤销')
    await delay(100)
    assert((await state()).canRedo, label + '无法重做')
    await click('重做')
    await delay(100)
    assert((await state()).canUndo, label + '重做失败')
    await click('撤销')
    await delay(100)
    checks.push({ name: label + '绘制/撤销/重做', status: 'pass' })
  }
  await click('文字')
  await draw(100, 80, 0, 0)
  await wait(() => evaluate("!!document.querySelector('textarea')"), '文字输入框未出现')
  await cdp.send('Input.insertText', { text: 'Chrome Preflight' }, session)
  await cdp.send(
    'Input.dispatchKeyEvent',
    { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 },
    session
  )
  await cdp.send(
    'Input.dispatchKeyEvent',
    { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 },
    session
  )
  await delay(100)
  assert((await state()).canUndo)
  checks.push({ name: '文字输入与落版', status: 'pass' })
  await click('裁剪')
  await draw(20, 20, 500, 300)
  await wait(
    () => evaluate("!!document.querySelector('.chrome-capture-editor-cropbtn.is-primary')"),
    '裁剪确认未出现'
  )
  await evaluate("document.querySelector('.chrome-capture-editor-cropbtn.is-primary').click()")
  await delay(150)
  const shot = await cdp.send('Page.captureScreenshot', {}, session)
  await writeFile(join(output, 'editor.png'), Buffer.from(shot.data, 'base64'))
  await click('复制到剪贴板')
  const copied = await wait(async () => {
    const value = await evaluate(
      "(async()=>{const items=await navigator.clipboard.read();const blob=await items[0].getType('image/png');const image=await createImageBitmap(blob);return {width:image.width,height:image.height,size:blob.size}})()"
    )
    return value.width === 500 && value.height === 300 ? value : false
  }, '复制PNG裁剪尺寸不符')
  checks.push({ name: '裁剪与真实剪贴板PNG', status: 'pass', detail: copied })
  await click('下载')
  await wait(async () => {
    try {
      return (await readFile(join(output, 'editor-chrome.png'))).length > 100
    } catch {
      return false
    }
  }, '下载未完成')
  const png = await readFile(join(output, 'editor-chrome.png'))
  assert.equal(png.readUInt32BE(16), 500)
  assert.equal(png.readUInt32BE(20), 300)
  assert.equal(errors.length, 0, errors.join('\n'))
  checks.push({ name: '下载PNG内容与尺寸', status: 'pass' })
} catch (error) {
  checks.push({ name: '编辑器验证', status: 'fail', error: String(error) })
  process.exitCode = 1
} finally {
  await writeFile(join(output, 'results.json'), JSON.stringify({ checks, errors }, null, 2))
  if (cdp) {
    try {
      await cdp.send('Browser.close')
    } catch {
      /* 浏览器关闭时连接可先断 */
    }
    cdp.close()
  }
  if (child && child.exitCode === null) child.kill('SIGTERM')
  await site.close()
  console.log(JSON.stringify({ output, checks, errors }, null, 2))
}
