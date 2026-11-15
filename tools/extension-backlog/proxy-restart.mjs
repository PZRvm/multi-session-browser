/* eslint @typescript-eslint/explicit-function-return-type: off -- 真实开发应用重启与卸载回归 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
const require = createRequire(join(process.cwd(), 'package.json'))
const { app, BrowserWindow, dialog } = require('electron')
const delay = (ms) => new Promise((r) => setTimeout(r, ms))
async function wait(fn, label) {
  const end = Date.now() + 20000
  while (Date.now() < end) {
    const v = await fn()
    if (v) return v
    await delay(100)
  }
  throw Error(label)
}
export async function run({ registry, mainWindow, getExtensionsHandle }) {
  const dir = app.getPath('userData')
  assert(dir.startsWith('/tmp/msb-backlog-'))
  const previous = JSON.parse(await readFile(join(dir, 'probe.json'), 'utf8')),
    data = previous.restart
  assert(data, '必须先运行完整代理矩阵并保留profile')
  const origin = createServer((_q, res) => res.end(JSON.stringify({ via: 'origin' }))),
    proxy = createServer((_q, res) => res.end(JSON.stringify({ via: 'proxy' })))
  await new Promise((r) => origin.listen(data.originPort, '127.0.0.1', r))
  await new Promise((r) => proxy.listen(data.proxyPort, '127.0.0.1', r))
  const shell = mainWindow.webContents,
    api = (x) => shell.executeJavaScript(x)
  await wait(() => api('!!window.api?.sessions'), 'shell')
  await api(`window.api.sessions.setActive({id:${JSON.stringify(data.id)}})`)
  await wait(
    () => registry.getActiveSessionId() === data.id && registry.getActiveWebContents(),
    'activation'
  )
  let wc = registry.getActiveWebContents()
  await wait(
    async () => String(await wc.session.resolveProxy(data.target)).includes(String(data.proxyPort)),
    'proxy restoration'
  )
  const route = await (await wc.session.fetch(data.target + '?restart')).json()
  assert.equal(route.via, 'proxy')
  const handle = getExtensionsHandle(),
    extId = previous.sample.id
  assert(wc.session.extensions.getExtension(data.extension), '重启后实际扩展ID稳定')
  // 非永久重载期间请求必须阻断，重载成功后恢复原控制记录。
  const originalExtension = wc.session.extensions.getExtension(data.extension)
  await wc.session.extensions.removeExtension(data.extension)
  await assert.rejects(wc.session.fetch(data.target + '?reload-gap'))
  await wc.session.extensions.loadExtension(originalExtension.path)
  await wait(
    async () => String(await wc.session.resolveProxy(data.target)).includes(String(data.proxyPort)),
    'reload proxy restoration'
  )
  assert.equal((await (await wc.session.fetch(data.target + '?reloaded')).json()).via, 'proxy')
  // 从插件原 options 入口打开原生页面，来源Session保持一致。
  const page = new BrowserWindow({
    show: false,
    webPreferences: { session: wc.session, contextIsolation: true }
  })
  await page.loadURL(`chrome-extension://${data.extension}/options.html`)
  const windowsBefore = new Set(BrowserWindow.getAllWindows().map((w) => w.id))
  await page.webContents.executeJavaScript('chrome.runtime.openOptionsPage()')
  const opened = await wait(
    () => BrowserWindow.getAllWindows().find((w) => !windowsBefore.has(w.id)),
    '原版选项页打开'
  )
  assert.equal(opened.webContents.session, wc.session)
  assert(opened.webContents.getURL().startsWith(`chrome-extension://${data.extension}/`))
  opened.destroy()
  page.destroy()
  await registry.closeSession(data.id)
  const native = dialog.showMessageBox
  dialog.showMessageBox = async () => ({ response: 1 })
  let uninstall
  try {
    uninstall = await api(`window.api.extensions.uninstall(${JSON.stringify(extId)})`)
  } finally {
    dialog.showMessageBox = native
  }
  assert(uninstall.ok, JSON.stringify(uninstall))
  await api(`window.api.sessions.setActive({id:${JSON.stringify(data.id)}})`)
  await wait(
    () => registry.getActiveSessionId() === data.id && registry.getActiveWebContents(),
    '卸载后重开'
  )
  wc = registry.getActiveWebContents()
  assert(!wc.session.extensions.getExtension(data.extension), '卸载真的移除原生实例')
  const state = JSON.parse(await readFile(join(dir, 'extensions/proxy-settings.json'), 'utf8'))
  assert(!state.sessions[data.id]?.[data.extension], '卸载删除持久代理控制记录')
  assert.equal(await wc.session.resolveProxy(data.target), 'DIRECT')
  assert.equal((await (await wc.session.fetch(data.target + '?uninstalled')).json()).via, 'origin')
  const result = {
    restartRoute: route.via,
    reloadBlockedThenRestored: true,
    optionsSessionBound: true,
    uninstalled: uninstall.ok,
    uninstallWhileSuspended: true,
    uninstallRoute: 'origin',
    focusedWindows: BrowserWindow.getAllWindows().filter((w) => w.isFocused()).length
  }
  await writeFile(join(dir, 'restart-proxy.json'), JSON.stringify(result, null, 2))
  console.log('PROXY_RESTART_PASS', JSON.stringify(result))
  assert(handle.runtime.getEngine(data.partition))
  origin.close()
  proxy.close()
  app.exit(0)
}
