// 独立 Electron 夹具只创建隐藏工具窗；数据写入临时目录，不启动真实用户应用。
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { build } from 'esbuild'

const root = await mkdtemp(join(tmpdir(), 'msb-icon-electron-'))
try {
  await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
        import assert from 'node:assert/strict'
        import { createServer } from 'node:http'
        import { join } from 'node:path'
        import { readdir } from 'node:fs/promises'
        import { app, nativeImage, session, BrowserWindow } from 'electron'
        import { createHistoryIcons } from './src/main/browser/historyIcons'
        import { createHistoryIconTools } from './src/main/browser/historyIconTools'
        ;(async () => {
        app.setPath('userData', join(process.env.MSB_ICON_TEST_ROOT, 'profile'))
        await app.whenReady()
        app.dock?.hide()
        const tools = createHistoryIconTools()
        const png = nativeImage.createFromBitmap(Buffer.alloc(32 * 32 * 4, 255), { width: 32, height: 32 }).toPNG()
        const padded = Buffer.concat([png, Buffer.alloc(96024 - png.length)])
        const valid = 'data:image/png;base64,' + png.toString('base64')
        const broken = 'data:image/png;base64,' + png.subarray(0, 8).toString('base64')
        const svg = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16"/></svg>').toString('base64')
        const requests = []
        const server = createServer((req, res) => {
          requests.push({ url: req.url, cookie: req.headers.cookie })
          if (req.url === '/icons/good.png') { res.writeHead(200, { 'content-type': 'image/png' }); res.end(padded); return }
          if (req.url === '/broken.png') { res.writeHead(200, { 'content-type': 'image/png' }); res.end(png.subarray(0, 8)); return }
          res.writeHead(200, { 'content-type': 'text/html' })
          res.end('<base href="/icons/"><link rel="shortcut icon" href="good.png"><img src="/forbidden">')
        })
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
        const base = 'http://127.0.0.1:' + server.address().port
        const net = session.fromPartition('history-icon-net-test')
        await net.cookies.set({ url: base, name: 'owner', value: 'a' })
        const deps = {
          cacheDir: id => join(process.env.MSB_ICON_TEST_ROOT, 'cache', id),
          fetch: (_id, url, signal) => net.fetch(url, { signal, credentials: 'include' }),
          validate: tools.validate,
          findIcons: tools.findIcons
        }
        let icons = createHistoryIcons(deps)
        try {
          assert.equal(await tools.validate(valid, new AbortController().signal), true)
          assert.equal(await tools.validate(svg, new AbortController().signal), true)
          assert.equal(await tools.validate(broken, new AbortController().signal), false)
          const aborted = new AbortController(); aborted.abort()
          assert.equal(await tools.validate(valid, aborted.signal), false)
          assert.deepEqual(await tools.findIcons('<base href="/icons/"><link rel="ICON" href="good.png"><link rel="icon" href="file:///blocked"><link rel="icon" href="javascript:alert(1)">', base + '/legacy'), [base + '/icons/good.png'])
          const entry = { url: base + '/legacy', faviconUrl: base + '/broken.png' }
          const first = await icons.resolve('a', entry)
          assert.ok(first)
          assert.equal(Buffer.from(first.split(',')[1], 'base64').length, 96024)
          const count = requests.length
          assert.equal(await icons.resolve('a', entry), first)
          assert.equal(requests.length, count)
          assert.ok(requests.every(req => req.cookie === 'owner=a' && req.url !== '/forbidden'))
          await icons.shutdown()
          assert.equal((await readdir(deps.cacheDir('a'))).length, 2)
          icons = createHistoryIcons(deps)
          await new Promise(resolve => server.close(resolve))
          const offline = await icons.resolve('a', { url: entry.url, faviconUrl: null })
          assert.equal(offline, first)
          await icons.shutdown()
          if (process.env.MSB_ICON_REAL_PAGE) {
            let online = true
            let calls = 0
            const realDeps = { ...deps,
              cacheDir: id => join(process.env.MSB_ICON_TEST_ROOT, 'real-cache', id),
              fetch: (_id, url, signal) => { calls++; if (!online) throw new Error('离线'); return net.fetch(url, { signal, credentials: 'include' }) }
            }
            const realEntry = { url: process.env.MSB_ICON_REAL_PAGE, faviconUrl: null }
            const real = createHistoryIcons(realDeps)
            const data = await real.resolve('real', realEntry)
            assert.ok(data)
            const downloaded = calls
            assert.equal(await real.resolve('real', realEntry), data)
            assert.equal(calls, downloaded)
            await real.shutdown()
            online = false
            const realRestart = createHistoryIcons(realDeps)
            assert.equal(await realRestart.resolve('real', realEntry), data)
            assert.equal(calls, downloaded)
            await realRestart.shutdown()
            console.log('PASS real-page: bytes=' + Buffer.from(data.split(',')[1], 'base64').length + ' network=' + downloaded + ' repeat/offline-restart=cache')
          }
          tools.dispose()
          assert.equal(BrowserWindow.getAllWindows().length, 0)
          console.log('PASS Electron: PNG/SVG/损坏图片/取消/HTML解析/禁止外部资源/会话Cookie/真实下载/缓存/离线重建')
          app.exit(0)
        } catch (error) {
          console.error(error)
          tools.dispose()
          server.close()
          app.exit(1)
        }
        })().catch(error => { console.error(error); app.exit(1) })
      `
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
    outfile: join(root, 'test.cjs')
  })
  const electron = createRequire(import.meta.url)('electron')
  const env = { ...process.env, MSB_ICON_TEST_ROOT: root }
  delete env.ELECTRON_RUN_AS_NODE
  const status = await new Promise((resolve, reject) => {
    const child = spawn(electron, [join(root, 'test.cjs')], { env, stdio: 'inherit' })
    const timer = setTimeout(() => child.kill(), 30000)
    child.on('error', reject)
    child.on('exit', (code) => {
      clearTimeout(timer)
      resolve(code ?? 1)
    })
  })
  process.exitCode = status
} finally {
  await rm(root, { recursive: true, force: true })
}
