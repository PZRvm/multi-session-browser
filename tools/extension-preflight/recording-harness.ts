// 生产采集页/preload/落盘器的Electron集成夹具，不进应用构建。
import { app, BrowserWindow, WebContentsView, session } from 'electron'
import { createCollector } from '../../src/main/browser/recording/captureView'
import { createRecordingFileWriter } from '../../src/main/browser/recording/fileWriter'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mkdir, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
const output = process.argv[2]
const root = process.cwd()
app.setPath('userData', join(output, 'profile'))
app.commandLine.appendSwitch('force-device-scale-factor', '1')
app.on('window-all-closed', () => {})
const results: { name: string; status: string; detail?: unknown; error?: string }[] = []
app
  .whenReady()
  .then(async () => {
    const site = await import(
      pathToFileURL(join(root, 'tools/extension-preflight/server.mjs')).href
    ).then((m) => m.startSite())
    await mkdir(output, { recursive: true })
    for (const mode of ['odd', 'even', 'resize', 'closed', 'early-stop', 'denied']) {
      const dir = join(output, mode)
      await mkdir(dir, { recursive: true })
      const partition = 'persist:recording-' + mode
      const ses = session.fromPartition(partition)
      ses.setPermissionRequestHandler((wc, _p, callback) =>
        callback(mode !== 'denied' && wc.getURL().startsWith('file:'))
      )
      const win = new BrowserWindow({ width: 1300, height: 850, show: true })
      const view = new WebContentsView({ webPreferences: { session: ses, sandbox: true } })
      win.contentView.addChildView(view)
      view.setBounds({ x: 300, y: 70, width: mode === 'even' ? 1000 : 999, height: 741 })
      await view.webContents.loadURL(site.url + '/?session=' + mode)
      const writer = createRecordingFileWriter({
        tmpDir: dir,
        downloadsDir: dir,
        sessionName: mode,
        now: () => Date.now(),
        exists: async () => false
      })
      let collector: ReturnType<typeof createCollector> | undefined
      const timers: NodeJS.Timeout[] = []
      const pauseTimes: number[] = []
      let file: string | undefined
      const started = Date.now()
      try {
        const outcome = await new Promise<string>((resolve, reject) => {
          timers.push(setTimeout(() => reject(new Error('采集器超时')), 12000))
          collector = createCollector({
            partition,
            preloadPath: join(output, 'capture-preload.cjs'),
            pagePath: join(root, 'src/main/browser/recording/capturePage.html'),
            getTargetFrame: () =>
              view.webContents.isDestroyed() ? undefined : view.webContents.mainFrame,
            callbacks: {
              onReady: () => {
                if (mode === 'denied') {
                  reject(new Error('拒绝权限后仍ready'))
                  return
                }
                if (mode === 'early-stop') return
                timers.push(
                  setTimeout(() => {
                    pauseTimes.push(Date.now())
                    collector?.sendCommand('pause')
                  }, 1000)
                )
                timers.push(
                  setTimeout(() => {
                    pauseTimes.push(Date.now())
                    collector?.sendCommand('resume')
                  }, 2000)
                )
                if (mode === 'resize')
                  timers.push(
                    setTimeout(
                      () => view.setBounds({ x: 300, y: 70, width: 1003, height: 743 }),
                      2500
                    )
                  )
                if (mode === 'closed') timers.push(setTimeout(() => view.webContents.close(), 2700))
                else timers.push(setTimeout(() => collector?.sendCommand('stop'), 4500))
              },
              onChunk: (buffer) => {
                void writer.append(new Uint8Array(buffer)).catch(reject)
              },
              onError: (message) =>
                mode === 'denied' ? resolve('denied') : reject(new Error(message)),
              onStopped: () => resolve(mode === 'early-stop' ? 'cancelled' : 'stopped')
            }
          })
          if (mode === 'early-stop') collector.sendCommand('stop')
        })
        await writer.drain()
        if (mode === 'early-stop' || mode === 'denied') {
          await writer.abort()
          if (outcome !== (mode === 'denied' ? 'denied' : 'cancelled')) throw new Error('终态不符')
        } else {
          file = (await writer.finalize()).path
          execFileSync(
            'ffmpeg',
            [
              '-v',
              'error',
              '-xerror',
              '-i',
              file,
              '-enc_time_base',
              'demux',
              '-fps_mode',
              'passthrough',
              '-f',
              'null',
              '-'
            ],
            { stdio: ['ignore', 'pipe', 'pipe'] }
          )
          const metadata = JSON.parse(
            execFileSync(
              'ffprobe',
              [
                '-v',
                'error',
                '-show_entries',
                'format=duration:stream=width,height',
                '-of',
                'json',
                file
              ],
              { encoding: 'utf8' }
            )
          )
          if (
            metadata.streams.some(
              (s: { width: number; height: number }) => s.width % 2 || s.height % 2
            )
          )
            throw new Error('编码尺寸仍为奇数')
          const expected = (Date.now() - started - (pauseTimes[1] - pauseTimes[0])) / 1000
          if (mode !== 'closed' && Math.abs(Number(metadata.format.duration) - expected) > 1)
            throw new Error('暂停时长不符')
        }
        results.push({ name: mode, status: 'pass', detail: { file, outcome } })
      } catch (error) {
        results.push({ name: mode, status: 'fail', error: String(error) })
      } finally {
        timers.forEach(clearTimeout)
        collector?.destroy()
        if (!win.isDestroyed()) win.destroy()
      }
      await writeFile(join(output, 'results.json'), JSON.stringify(results, null, 2))
    }
    await site.close()
    console.log(JSON.stringify(results, null, 2))
    app.exit(results.some((r) => r.status === 'fail') ? 1 : 0)
  })
  .catch(async (error) => {
    console.error(error)
    app.exit(1)
  })
