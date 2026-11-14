/* eslint-disable @typescript-eslint/explicit-function-return-type -- 隔离的打包升级探针 */
import assert from 'node:assert/strict'
import {
  cpSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  rmSync,
  existsSync,
  statSync
} from 'node:fs'
import { createServer } from 'node:http'
import { spawn, execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { join, resolve } from 'node:path'
import { generateAppcast, validateArchive } from '../../scripts/sparkle-appcast.mjs'
if (process.platform !== 'darwin') throw new Error('仅支持 macOS')
const arch = process.argv[2] || process.arch
const fixture = resolve('dist/sparkle-product', randomBytes(5).toString('hex'))
mkdirSync(fixture, { recursive: true })
const profile = join(fixture, 'profile'),
  requests = []
Object.assign(process.env, JSON.parse(readFileSync('dist/update-test/test-keys.json', 'utf8')))
let badSignature = false
let testMode = ''
const server = createServer((req, res) => {
  const file = req.url?.slice(1)
  if (
    ![
      `appcast-${arch}.xml`,
      'release-notes-v90.0.2.md',
      `multi-session-browser-update-test-90.0.2-mac-${arch}.zip`
    ].includes(file)
  )
    return res.writeHead(404).end()
  requests.push({ file, at: Date.now() })
  if (testMode === 'network' && file.endsWith('.xml')) return res.writeHead(503).end()
  if (testMode === 'notes' && file.endsWith('.md')) return res.writeHead(404).end()
  let data = readFileSync(join(fixture, file))
  if (badSignature && file.endsWith('.xml'))
    data = Buffer.from(
      data
        .toString()
        .replace(
          /sparkle:edSignature="[^"]+"/,
          `sparkle:edSignature="${Buffer.alloc(64).toString('base64')}"`
        )
    )
  res.writeHead(200, { 'Content-Length': data.length, Connection: 'close' })
  res.end(
    testMode === 'truncated' && file.endsWith('.zip')
      ? data.subarray(0, Math.floor(data.length / 2))
      : data
  )
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`
const appId = `local.msb.sparkle-product.${randomBytes(5).toString('hex')}`
const apps = []
for (const version of ['90.0.1', '90.0.2']) {
  const app = join(fixture, version, '多会话浏览器.app')
  cpSync(
    `dist/update-test/${version}/mac${arch === 'arm64' ? '-arm64' : ''}/多会话浏览器.app`,
    app,
    { recursive: true, verbatimSymlinks: true }
  )
  const info = join(app, 'Contents/Info.plist')
  execFileSync('/usr/libexec/PlistBuddy', [
    '-c',
    `Set :SUFeedURL ${base}/appcast-${arch}.xml`,
    info
  ])
  execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :CFBundleIdentifier ${appId}`, info])
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'pipe' })
  execFileSync('codesign', ['--verify', '--deep', '--strict', app])
  apps.push(app)
}
execFileSync('ditto', [
  '-c',
  '-k',
  '--sequesterRsrc',
  '--keepParent',
  apps[1],
  join(fixture, `multi-session-browser-update-test-90.0.2-mac-${arch}.zip`)
])
const archive = join(fixture, `multi-session-browser-update-test-90.0.2-mac-${arch}.zip`)
assert.throws(() => validateArchive(archive, '90.0.3', arch, base))
assert.throws(() => validateArchive(archive, '90.0.2', arch === 'arm64' ? 'x64' : 'arm64', base))
assert.throws(() => validateArchive(archive, '90.0.2', arch, 'https://example.invalid'))
generateAppcast(fixture, 'multi-session-browser-update-test', '90.0.2', arch, {
  base,
  notes: '## Sparkle 产品打包验证\n- 本次测试日志'
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function connect(url) {
  const ws = new WebSocket(url)
  await new Promise((r, j) => {
    ws.onopen = r
    ws.onerror = j
  })
  let id = 0
  const pending = new Map()
  ws.onmessage = ({ data }) => {
    const m = JSON.parse(data)
    const p = pending.get(m.id)
    if (!p) return
    pending.delete(m.id)
    clearTimeout(p.timer)
    if (m.error || m.result?.exceptionDetails) p.reject(Error(JSON.stringify(m)))
    else p.resolve(m.result?.result?.value)
  }
  return {
    close: () => ws.close(),
    evaluate(expression) {
      return new Promise((resolve, reject) => {
        const key = ++id
        const timer = setTimeout(() => {
          pending.delete(key)
          reject(Error('主进程求值超时'))
        }, 90000)
        pending.set(key, { resolve, reject, timer })
        ws.send(
          JSON.stringify({
            id: key,
            method: 'Runtime.evaluate',
            params: { expression, awaitPromise: true, returnByValue: true }
          })
        )
      })
    }
  }
}
function runningAppPids() {
  const executable = join(apps[0], 'Contents/MacOS/多会话浏览器')
  return execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' })
    .split('\n')
    .flatMap((line) => {
      const match = line.trim().match(/^(\d+) (.+)$/)
      return match && (match[2] === executable || match[2].startsWith(executable + ' --'))
        ? [Number(match[1])]
        : []
    })
}
const automaticMarker = `SPARKLE_AUTO_${randomBytes(5).toString('hex')}`
const results = []
let child, client
try {
  const modes = process.argv.includes('--relaunch-only')
    ? ['cancel', 'install', 'verify']
    : ['network', 'notes', 'truncated', 'signature', 'save-failure', 'cancel', 'install', 'verify']
  for (const mode of modes) {
    testMode = mode
    badSignature = mode === 'signature'
    let stderr = ''
    child = spawn(
      join(apps[0], 'Contents/MacOS/多会话浏览器'),
      ['--inspect=127.0.0.1:0', '--agent-debug'],
      {
        env: {
          ...process.env,
          MSB_USER_DATA: profile,
          MSB_AGENT_DEBUG_PORT: '0',
          SPARKLE_PRIVATE_KEY: ''
        },
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )
    child.stderr.on('data', (d) => {
      stderr += d
    })
    child.stdout.on('data', (d) => writeFileSync(join(fixture, `${mode}.log`), d, { flag: 'a' }))
    child.on('error', (e) => {
      stderr += e.message
    })
    let url
    for (let i = 0; i < 450 && !url; i++) {
      await sleep(100)
      url = stderr.match(/ws:\/\/127\.0\.0\.1:\d+\/[a-z0-9-]+/)?.[0]
      if (child.exitCode !== null) throw Error(stderr)
    }
    assert.ok(url, stderr)
    client = await connect(url)
    for (let i = 0; i < 450; i++) {
      if (await client.evaluate('Boolean(process.mainModule)')) break
      await sleep(100)
    }
    await client.evaluate(`globalThis.et=process.mainModule.require('electron');et.app.whenReady()`)
    await client.evaluate(
      `et.dialog.showMessageBox=async(_owner,opts)=>({response:opts.type==='question'&&globalThis.acceptInstall?1:0});undefined`
    )
    const invoke = (name) =>
      client.evaluate(
        `et.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('index.html')).webContents.executeJavaScript('window.api.updates.${name}()')`
      )
    if (mode === 'verify') {
      assert.equal(await client.evaluate('et.app.getVersion()'), '90.0.2')
      const cookies = await client.evaluate(
        `et.session.fromPartition('persist:sess-sparkle-probe').cookies.get({url:'https://sparkle-probe.test'})`
      )
      assert.equal(cookies.find((c) => c.name === 'isolation')?.value, 'kept')
      await client.evaluate('setTimeout(()=>et.app.quit(),20);true')
      client.close()
      client = undefined
      for (let i = 0; i < 200 && child.exitCode === null; i++) await sleep(100)
      assert.equal(child.exitCode, 0, stderr)
      results.push({ mode, version: '90.0.2', cookiePreserved: true, passed: true })
      continue
    }
    let state
    for (let i = 0; i < 200; i++) {
      try {
        state = await invoke('getState')
      } catch {
        /* 主窗可能仍在创建，继续等待 */
      }
      if (state?.status === 'available' || state?.error) break
      await sleep(100)
    }
    if (mode === 'network') {
      assert.equal(state.error, 'check')
      assert.equal(state.downloadedVersion, null)
      testMode = 'retry'
      state = await invoke('check')
      assert.equal(state.status, 'available')
    }
    assert.equal(state?.status, 'available', JSON.stringify({ state, stderr }))
    if (mode === 'notes') assert.equal(state.releaseNotes, '')
    else assert.match(state.releaseNotes, /产品打包验证/)
    if (['network', 'notes'].includes(mode)) {
      await client.evaluate('setTimeout(()=>et.app.quit(),20);true')
      client.close()
      client = undefined
      for (let i = 0; i < 200 && child.exitCode === null; i++) await sleep(100)
      assert.equal(child.exitCode, 0, stderr)
      results.push({ mode, state, passed: true })
      continue
    }
    if (mode === 'cancel')
      await client.evaluate(
        `et.session.fromPartition('persist:sess-sparkle-probe').cookies.set({url:'https://sparkle-probe.test',name:'isolation',value:'kept',expirationDate:Date.now()/1000+86400})`
      )
    let beforeRestart = 0
    const beforeDownload = requests.filter((r) => r.file.endsWith('.zip')).length
    const permission = Date.now()
    state = await invoke('download')
    if (['signature', 'truncated'].includes(mode)) {
      assert.equal(state.status, 'error', JSON.stringify({ state, stderr }))
      assert.equal(state.error, mode === 'signature' ? 'signature' : 'download')
      assert.equal(state.downloadedVersion, null)
      await client.evaluate('setTimeout(()=>et.app.quit(),20);true')
      client.close()
      client = undefined
      for (let i = 0; i < 200 && child.exitCode === null; i++) await sleep(100)
      assert.equal(child.exitCode, 0, stderr)
      assert.equal(
        execFileSync(
          '/usr/libexec/PlistBuddy',
          ['-c', 'Print :CFBundleVersion', join(apps[0], 'Contents/Info.plist')],
          { encoding: 'utf8' }
        ).trim(),
        '90.0.1'
      )
      results.push({ mode, state, passed: true })
      writeFileSync(join(fixture, `${mode}.stderr.log`), stderr)
      continue
    }
    assert.equal(state.status, 'ready', JSON.stringify({ state, stderr }))
    assert.equal(state.downloadedVersion, '90.0.2')
    assert.ok(
      requests
        .filter((r) => r.file.endsWith('.zip'))
        .slice(beforeDownload)
        .every((r) => r.at >= permission)
    )
    assert.equal(requests.filter((r) => r.file.endsWith('.zip')).length, beforeDownload + 1)
    if (mode === 'save-failure') {
      await client.evaluate(
        `et.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('index.html')).webContents.executeJavaScript('(async()=>{const s=await window.api.sessions.create({name:"Sparkle save probe"});await window.api.sessions.setActive({id:s.id});return s.id})()')`
      )
      let browser
      for (let i = 0; i < 200; i++) {
        browser = await client.evaluate(
          `et.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('index.html')).webContents.executeJavaScript('window.api.browser.getState()')`
        )
        if (browser.sessionId) break
        await sleep(100)
      }
      assert.ok(browser.sessionId, '保存故障注入前必须已有实际会话管理器')
      const file = join(profile, 'sessions.json'),
        backup = join(profile, 'sessions.json.probe-backup')
      const hadFile = existsSync(file)
      if (hadFile) renameSync(file, backup)
      mkdirSync(file)
      try {
        await client.evaluate('globalThis.acceptInstall=true')
        const rejected = await invoke('install')
        assert.equal(rejected.error, 'save', JSON.stringify(rejected))
        assert.equal(rejected.status, 'error')
        assert.equal(
          execFileSync(
            '/usr/libexec/PlistBuddy',
            ['-c', 'Print :CFBundleVersion', join(apps[0], 'Contents/Info.plist')],
            { encoding: 'utf8' }
          ).trim(),
          '90.0.1'
        )
      } finally {
        rmSync(file, { recursive: true })
        if (hadFile) renameSync(backup, file)
      }
      await client.evaluate('setTimeout(()=>et.app.quit(),20);true')
      client.close()
      client = undefined
      for (let i = 0; i < 200 && child.exitCode === null; i++) await sleep(100)
      assert.equal(child.exitCode, 0, stderr)
      results.push({ mode, saveRejected: true, passed: true })
      continue
    }
    if (mode === 'cancel') {
      await client.evaluate('setTimeout(()=>et.app.quit(),20);true')
      client.close()
      client = undefined
      for (let i = 0; i < 200 && child.exitCode === null; i++) await sleep(100)
      assert.equal(child.exitCode, 0, stderr)
      assert.equal(
        execFileSync(
          '/usr/libexec/PlistBuddy',
          ['-c', 'Print :CFBundleVersion', join(apps[0], 'Contents/Info.plist')],
          { encoding: 'utf8' }
        ).trim(),
        '90.0.1'
      )
    } else {
      const statesFile = join(fixture, 'install-states.jsonl')
      const markerScript = `window.api.sessions.create(${JSON.stringify({ name: automaticMarker })})`
      await client.evaluate(
        `et.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('index.html')).webContents.executeJavaScript(${JSON.stringify(markerScript)})`
      )
      const debugFile = join(profile, 'DevToolsActivePort')
      beforeRestart = statSync(debugFile).mtimeMs
      // 安装会销毁 renderer，不能用旧 frame 的 IPC 返回作为完成证据。
      // 观察真正发布的快照，仍调用原 send；不替代保存、许可或引擎。
      await client.evaluate(
        `globalThis.acceptInstall=true;const wc=et.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('index.html')).webContents;const send=wc.send.bind(wc);wc.send=(channel,...args)=>{if(channel==='updates:changed')process.mainModule.require('node:fs').appendFileSync(${JSON.stringify(statesFile)},JSON.stringify(args[0])+'\\n');return send(channel,...args)};wc.executeJavaScript('void window.api.updates.install().catch(()=>{})');'requested'`
      )
      client.close()
      client = undefined
      // 观察磁盘替换和新进程，随后以隔离参数重开校验实际版本与 Cookie。
      for (let i = 0; i < 300; i++) {
        const version = execFileSync(
          '/usr/libexec/PlistBuddy',
          ['-c', 'Print :CFBundleVersion', join(apps[0], 'Contents/Info.plist')],
          { encoding: 'utf8' }
        ).trim()
        if (version === '90.0.2') break
        await sleep(100)
      }
      assert.equal(
        execFileSync(
          '/usr/libexec/PlistBuddy',
          ['-c', 'Print :CFBundleVersion', join(apps[0], 'Contents/Info.plist')],
          { encoding: 'utf8' }
        ).trim(),
        '90.0.2',
        stderr
      )
    }
    if (mode === 'install') {
      const states = readFileSync(join(fixture, 'install-states.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
      assert.ok(states.some((s) => s.status === 'preparing'))
      state = states.at(-1)
      assert.equal(state.status, 'installing', JSON.stringify(states))
      let relaunched = []
      for (let i = 0; i < 100; i++) {
        relaunched = runningAppPids().filter((pid) => pid !== child.pid)
        if (relaunched.length) break
        await sleep(100)
      }
      assert.ok(relaunched.length, '未观察到新应用重启')
      let automaticHealth = null
      for (let i = 0; i < 450; i++) {
        try {
          if (statSync(join(profile, 'DevToolsActivePort')).mtimeMs <= beforeRestart) {
            await sleep(100)
            continue
          }
          const port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]
          const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
          const target = pages.find(
            (page) => page.type === 'page' && page.url.includes('index.html')
          )
          if (target) {
            const page = await connect(target.webSocketDebuggerUrl)
            try {
              const result = await page.evaluate(
                'Promise.all([window.api.settings.getAppInfo(),window.api.sessions.list()])'
              )
              if (
                result[0].appVersion === '90.0.2' &&
                result[1].sessions.some((s) => s.name === automaticMarker)
              )
                automaticHealth = {
                  version: result[0].appVersion,
                  originalProfile: true,
                  markerPresent: true
                }
            } finally {
              page.close()
            }
            if (automaticHealth) break
          }
        } catch {
          /* 自动启动期间端口或 preload 尚未就绪，继续等 */
        }
        await sleep(100)
      }
      assert.ok(automaticHealth, '自动重启未直接恢复原隔离目录并打开 90.0.2；不能用手动重开代替')
      results.push({ mode: 'automatic-relaunch', ...automaticHealth, passed: true })
      for (const pid of relaunched) process.kill(pid, 'SIGTERM')
      for (let i = 0; i < 100 && runningAppPids().length; i++) await sleep(100)
    }
    results.push({ mode, beforeDownload, state, passed: true })
    writeFileSync(join(fixture, `${mode}.stderr.log`), stderr)
  }
  writeFileSync(
    join(fixture, 'results.json'),
    JSON.stringify({ fixture, arch, appId, profile, requests, results, passed: true }, null, 2)
  )
  console.log(JSON.stringify({ fixture, arch, passed: true }))
} catch (error) {
  writeFileSync(
    join(fixture, 'results.json'),
    JSON.stringify(
      { fixture, arch, requests, results, passed: false, error: String(error) },
      null,
      2
    )
  )
  throw error
} finally {
  client?.close()
  if (child?.exitCode === null) child.kill('SIGTERM')
  for (const pid of runningAppPids()) {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      /* 已退出 */
    }
  }
  await new Promise((r) => server.close(r))
}
