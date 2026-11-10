/* eslint @typescript-eslint/explicit-function-return-type: off, @typescript-eslint/no-require-imports: off -- 独立验证脚本 */
const { app, BrowserWindow, session, ipcMain } = require('electron')
const { join } = require('node:path'),
  { pathToFileURL } = require('node:url'),
  { writeFile } = require('node:fs/promises'),
  { execFileSync } = require('node:child_process')
const output = process.argv[2],
  delay = (ms) => new Promise((r) => setTimeout(r, ms)),
  results = { checks: [] }
app.setPath('userData', join(output, 'profile'))
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
app.on('window-all-closed', () => {})
let site
async function run() {
  await app.whenReady()
  site = await (await import('./server.mjs')).startSite()
  const ses = session.fromPartition('persist:lifecycle')
  for (const name of [
    'late-audio',
    'muted',
    'target-switch',
    'navigation',
    'target-close',
    'collector-close'
  ]) {
    let a, b, c
    const events = [],
      timers = []
    let saved
    try {
      a = new BrowserWindow({
        show: true,
        width: 1000,
        height: 700,
        webPreferences: {
          session: ses,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false
        }
      })
      b = new BrowserWindow({
        show: false,
        webPreferences: {
          session: ses,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false
        }
      })
      c = new BrowserWindow({
        show: false,
        webPreferences: {
          session: ses,
          preload: join(__dirname, 'collector-preload.cjs'),
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          backgroundThrottling: false
        }
      })
      const allowed = pathToFileURL(join(__dirname, 'collector.html')).href
      ses.setPermissionCheckHandler(
        (wc, p) => wc === c.webContents && ['media', 'display-capture'].includes(p)
      )
      ses.setPermissionRequestHandler((wc, p, cb) =>
        cb(wc === c.webContents && ['media', 'display-capture'].includes(p))
      )
      ses.setDisplayMediaRequestHandler((r, cb) => {
        if (r.frame === c.webContents.mainFrame && r.frame.url === allowed && !a.isDestroyed())
          cb({
            video: a.webContents.mainFrame,
            audio: a.webContents.mainFrame,
            enableLocalEcho: true
          })
        else cb({})
      })
      c.webContents.on('will-navigate', (e, url) => {
        if (url !== allowed) {
          e.preventDefault()
          events.push('collector-navigation-denied')
        }
      })
      await a.loadURL(site.url + '/?session=A')
      await b.loadURL(site.url + '/?session=B')
      await c.loadFile(join(__dirname, 'collector.html'))
      await b.webContents.executeJavaScript('testSite.startAudio(733)', true)
      if (name !== 'late-audio')
        await a.webContents.executeJavaScript('testSite.startAudio(440)', true)
      if (name === 'muted') a.webContents.setAudioMuted(true)
      ipcMain.handle('preflight:collector', async (e, p) => {
        if (e.sender !== c.webContents || e.senderFrame !== c.webContents.mainFrame)
          throw new Error('来源错误')
        if (p.ok) {
          saved = join(output, name + '.mp4')
          await writeFile(saved, Buffer.from(p.bytes))
        }
        return { ok: p.ok, error: p.error }
      })
      await c.webContents.executeJavaScript(
        `window.lifecyclePromise=window.recordTarget(6000,9000,0);true`,
        true
      )
      if (name === 'late-audio')
        timers.push(
          setTimeout(
            () => a.webContents.executeJavaScript('testSite.startAudio(440)', true).catch(() => {}),
            1800
          )
        )
      if (name === 'target-switch')
        timers.push(
          setTimeout(() => {
            b.once('focus', () => events.push('B-received-focus'))
            app.focus({ steal: true })
            b.show()
            b.focus()
            events.push('requested-B-focus')
          }, 1800)
        )
      if (name === 'navigation')
        timers.push(
          setTimeout(
            () =>
              a
                .loadURL(site.url + '/?session=A2')
                .then(() => a.webContents.executeJavaScript('testSite.startAudio(440)', true))
                .catch((e) => events.push(String(e))),
            1800
          )
        )
      if (name === 'target-close')
        timers.push(
          setTimeout(() => {
            a.destroy()
            events.push('target-destroyed')
          }, 1800)
        )
      if (name === 'collector-close') {
        await delay(1800)
        const before = a.webContents.isBeingCaptured()
        c.destroy()
        await delay(700)
        const after = a.webContents.isBeingCaptured()
        if (!before || after) throw new Error('采集器关闭未释放捕获')
        results.checks.push({
          name,
          status: 'pass',
          events: ['collector-destroyed'],
          captureBefore: before,
          captureAfter: after,
          scope: '渲染进程销毁，媒体轨道随上下文释放；未冒充生产状态订阅'
        })
        continue
      }
      const value = await Promise.race([
        c.webContents.executeJavaScript('window.lifecyclePromise'),
        delay(12000).then(() => {
          throw new Error('生命周期未收尾')
        })
      ])
      if (!value.ok) throw new Error(value.error)
      if (!saved) throw new Error('没有媒体产物')
      if (name === 'navigation' && !a.webContents.getURL().endsWith('/?session=A2'))
        throw new Error('目标未完成实际导航')
      if (name === 'target-close' && !a.isDestroyed()) throw new Error('目标未关闭')
      if (name === 'target-switch' && !events.includes('B-received-focus'))
        throw new Error('第二窗口未实际获得焦点')
      execFileSync('ffmpeg', [
        '-v',
        'error',
        '-xerror',
        '-i',
        saved,
        '-enc_time_base',
        'demux',
        '-fps_mode',
        'passthrough',
        '-f',
        'null',
        '-'
      ])
      const pcm = execFileSync(
        'ffmpeg',
        ['-v', 'error', '-i', saved, '-vn', '-ar', '48000', '-ac', '1', '-f', 'f32le', 'pipe:1'],
        { maxBuffer: 8 * 1024 * 1024 }
      )
      const windows = []
      for (let n = 0; n + 48000 <= pcm.length / 4; n += 48000) {
        let sq = 0,
          r = 0,
          i = 0,
          br = 0,
          bi = 0
        for (let k = 0; k < 48000; k++) {
          const v = pcm.readFloatLE((n + k) * 4)
          sq += v * v
          r += v * Math.cos((2 * Math.PI * 440 * k) / 48000)
          i += v * Math.sin((2 * Math.PI * 440 * k) / 48000)
          br += v * Math.cos((2 * Math.PI * 733 * k) / 48000)
          bi += v * Math.sin((2 * Math.PI * 733 * k) / 48000)
        }
        windows.push({
          second: n / 48000,
          rms: Math.sqrt(sq / 48000),
          separationDb: 20 * Math.log10((Math.hypot(r, i) + 1e-10) / (Math.hypot(br, bi) + 1e-10))
        })
      }
      if (
        name === 'late-audio' &&
        !(
          windows[0].rms < 0.001 &&
          windows.slice(2).some((w) => w.rms > 0.01 && w.separationDb > 20)
        )
      )
        throw new Error('晚启声音未捕获/初段非静音')
      if (
        name === 'muted' &&
        (!a.webContents.isAudioMuted() ||
          !windows.some((w) => w.rms > 0.001 && w.separationDb > 20))
      )
        throw new Error('静音输出/独立采集语义不符')
      if (name === 'target-switch' && windows.some((w) => w.rms > 0.001 && w.separationDb < 20))
        throw new Error('目标漂移到B')
      results.checks.push({ name, status: 'pass', events, value, windows })
    } catch (e) {
      results.checks.push({ name, status: 'fail', error: String(e), events })
    } finally {
      timers.forEach(clearTimeout)
      ipcMain.removeHandler('preflight:collector')
      for (const w of [a, b, c]) if (w && !w.isDestroyed()) w.destroy()
      await writeFile(join(output, 'results.json'), JSON.stringify(results, null, 2))
      console.log(JSON.stringify(results.checks.at(-1)))
    }
  }
  await site.close()
  app.exit(results.checks.some((x) => x.status === 'fail') ? 1 : 0)
}
run().catch(async (e) => {
  results.fatal = String(e)
  await writeFile(join(output, 'results.json'), JSON.stringify(results, null, 2))
  app.exit(1)
})
