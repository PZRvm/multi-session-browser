/* eslint @typescript-eslint/explicit-function-return-type: off, @typescript-eslint/no-require-imports: off -- 独立验证脚本使用原生 JavaScript，sandbox preload 使用 CommonJS */
const { app, BrowserWindow, session, ipcMain, dialog } = require('electron')
const { readFile, mkdir, writeFile } = require('node:fs/promises')
const { join } = require('node:path')
const { pathToFileURL } = require('node:url')
const { installChromeWebStore } = require('electron-chrome-web-store')
const output = process.argv[2]
const mode = process.argv[3] || 'manual'
if (!output?.includes('.artifacts')) throw new Error('必须指定工具证据目录')
app.setPath('userData', join(output, 'profile-store'))
app.disableHardwareAcceleration()
let win
const result = {
  platform: process.platform,
  status: 'pending',
  events: [],
  requireUninstall: mode === 'cycle'
}
let saveQueue = Promise.resolve()
async function save() {
  const snapshot = JSON.stringify(result, null, 2)
  saveQueue = saveQueue.then(() => writeFile(join(output, 'store-results.json'), snapshot))
  await saveQueue
}
async function start() {
  await mkdir(app.getPath('userData'), { recursive: true })
  await app.whenReady()
  if (mode === 'simulate-startup-failure') throw new Error('模拟商店启动失败')
  const samples = JSON.parse(
    await readFile(join(__dirname, 'out/.artifacts/samples/samples.json'), 'utf8')
  ).samples
  const target = samples.find((v) => v.name === 'dark')
  const ses = session.fromPartition('persist:store-verification')
  const { ElectronChromeExtensions } = require('electron-chrome-extensions')
  new ElectronChromeExtensions({
    session: ses,
    createTab: async () => {
      throw new Error('商店夹具不打开附加页面')
    },
    selectTab: () => {},
    removeTab: (wc) => wc.close()
  })
  win = new BrowserWindow({
    width: 1200,
    height: 850,
    title: 'Chrome商店安装前置验证',
    webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false }
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  const originalHandle = ipcMain.handle
  // 小型宿主适配：上游的 startsWith 校验不足以充当精确来源边界。
  ipcMain.handle = function (channel, handler) {
    return originalHandle.call(ipcMain, channel, (event, ...args) => {
      if (
        event.sender !== win.webContents ||
        event.senderFrame?.origin !== 'https://chromewebstore.google.com' ||
        event.senderFrame !== event.senderFrame?.top
      )
        throw new Error('非商店顶层页面请求被拒绝')
      return handler(event, ...args)
    })
  }
  try {
    await installChromeWebStore({
      session: ses,
      extensionsPath: join(output, 'store-extensions'),
      loadExtensions: false,
      autoUpdate: false,
      allowlist: [target.id],
      beforeInstall: async (details) => {
        if (
          details.frame.origin !== 'https://chromewebstore.google.com' ||
          details.frame !== win.webContents.mainFrame ||
          details.id !== target.id
        )
          return { action: 'deny' }
        result.events.push({
          type: 'before-install',
          id: details.id,
          version: details.manifest.version
        })
        await save()
        const response = await dialog.showMessageBox(win, {
          type: 'question',
          title: '插件安装验证',
          message: `安装 ${details.localizedName}`,
          detail: '仅写入前置验证的隔离分区。请核对这是 Dark Reader 测试安装。',
          buttons: ['取消', '安装'],
          defaultId: 0,
          cancelId: 0
        })
        if (response.response !== 1) {
          result.status = 'cancelled'
          await save()
          return { action: 'deny' }
        }
        const { extractCrx } = await import(pathToFileURL(join(__dirname, 'crx.mjs')).href)
        const verified = await extractCrx(
          await readFile(target.file),
          join(output, 'verified'),
          target.id
        )
        if (verified.version !== details.manifest.version)
          throw new Error('商店展示版本与固定原版包不符，拒绝换包')
        // 安全验包/加载先完成；上游安装器看到已加载ID后直接返回，不走未验签下载路径。
        const ext = await ses.extensions.loadExtension(verified.path)
        result.events.push({
          type: 'verified-loaded',
          id: ext.id,
          version: ext.version,
          sha256: verified.sha256
        })
        await save()
        return { action: 'allow' }
      }
    })
  } finally {
    ipcMain.handle = originalHandle
  }
  ses.extensions.on('extension-unloaded', async (_event, ext) => {
    result.events.push({ type: 'unloaded', id: ext.id })
    await save()
  })
  ses.extensions.on('extension-loaded', async (_event, ext) => {
    result.loaded = { id: ext.id, version: ext.version }
    await save()
  })
  win.webContents.on('did-finish-load', () => {
    void (async () => {
      result.url = win.webContents.getURL()
      result.pageText = await win.webContents.executeJavaScript(
        'document.body.innerText.slice(0,10000)'
      )
      await writeFile(join(output, 'store-page.png'), (await win.webContents.capturePage()).toPNG())
      await save()
    })().catch(async (error) => {
      result.events.push({ type: 'page-observation-error', error: String(error) })
      await save()
    })
  })
  const probeFile = join(output, 'store-origin-probe.html'),
    probePreload = join(output, 'store-origin-probe.cjs')
  await writeFile(probeFile, '<!doctype html><title>商店来源负向测试</title>')
  await writeFile(
    probePreload,
    `if(location.href===${JSON.stringify(pathToFileURL(probeFile).href)}){const{contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('storeOriginProbe',()=>ipcRenderer.invoke('chromeWebstore.completeInstall',${JSON.stringify(target.id)}).then(()=>({accepted:true})).catch(error=>({accepted:false,error:String(error)})))}`
  )
  const probeId = ses.registerPreloadScript({ type: 'frame', filePath: probePreload })
  const unknown = new BrowserWindow({
    show: false,
    webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false }
  })
  try {
    await win.loadFile(probeFile)
    const fakeOrigin = await win.webContents.executeJavaScript('window.storeOriginProbe()')
    await unknown.loadFile(probeFile)
    const unknownSender = await unknown.webContents.executeJavaScript('window.storeOriginProbe()')
    if (fakeOrigin.accepted || unknownSender.accepted) throw new Error('商店IPC来源守卫失效')
    result.originChecks = { fakeOrigin, unknownSender }
    await save()
  } finally {
    ses.unregisterPreloadScript(probeId)
    unknown.destroy()
  }
  await win.loadURL(`https://chromewebstore.google.com/detail/dark-reader/${target.id}`)
  console.log(`商店验证窗口已打开，证据目录：${output}`)
  const confirmation = setInterval(async () => {
    if (!result.loaded || win.isDestroyed()) return
    try {
      const page = new URL(win.webContents.getURL())
      if (
        page.origin !== 'https://chromewebstore.google.com' ||
        !page.pathname.endsWith('/' + target.id)
      )
        return
      const text = await win.webContents.executeJavaScript('document.body.innerText')
      if (
        !result.pageConfirmed &&
        /Remove from (?:Chrome|Electron)|从\s*(?:Chrome|Electron)\s*(?:中)?移除/i.test(text)
      ) {
        result.pageConfirmed = true
        result.status = 'complete'
        result.pageText = text.slice(0, 10000)
        await writeFile(
          join(output, 'store-installed.png'),
          (await win.webContents.capturePage()).toPNG()
        )
        await save()
        if (mode === 'install-only') {
          clearInterval(confirmation)
          win.destroy()
        }
        if (mode !== 'cycle') clearInterval(confirmation)
      }
      if (
        mode === 'cycle' &&
        result.pageConfirmed &&
        !ses.extensions.getExtension(target.id) &&
        /添加至\s*Electron|Add to Electron|Add to Chrome/.test(text)
      ) {
        result.uninstalled = true
        result.events.push({ type: 'page-confirmed-uninstall' })
        await writeFile(
          join(output, 'store-uninstalled.png'),
          (await win.webContents.capturePage()).toPNG()
        )
        await save()
        clearInterval(confirmation)
        win.destroy()
      }
    } catch (error) {
      result.events.push({ type: 'page-confirmation-error', error: String(error) })
    }
  }, 500)
  win.on('closed', () => {
    clearInterval(confirmation)
    void finish()
  })
}
let closed = false
async function finish() {
  if (closed) return
  closed = true
  await save()
  const { storeExitCode } = await import(pathToFileURL(join(__dirname, 'outcomes.mjs')).href)
  app.exit(storeExitCode(result))
}
start().catch(async (error) => {
  result.status = 'fail'
  result.error = String(error)
  console.error(error)
  await finish()
})
setTimeout(() => {
  if (result.status !== 'fail' && !result.pageConfirmed)
    result.status = result.loaded ? 'loaded-awaiting-page-confirmation' : 'not-completed'
  if (win && !win.isDestroyed()) win.destroy()
  void finish()
}, 180000).unref()
