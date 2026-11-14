// 独立生命周期探针。输出和随机测试密钥只写 dist；不接入生产应用。
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { spawn, execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import assert from 'node:assert/strict'

if (process.platform !== 'darwin') throw new Error('G0 原生生命周期验证仅支持 macOS')
const root = resolve('dist/sparkle-g0')
const electronArch = process.argv[2]
const resultFile = join(root, `${electronArch || 'cocoa'}-results.json`)
if (electronArch && !['arm64', 'x64'].includes(electronArch)) throw new Error('只接受 arm64 / x64')
const sdk = JSON.parse(readFileSync('build/sparkle/sdk.json'))
const archive = join(root, 'sdk.tar.xz')
assert.equal(createHash('sha256').update(readFileSync(archive)).digest('hex'), sdk.sha256)
const sdkDir = join(root, 'sdk')
mkdirSync(sdkDir, { recursive: true })
execFileSync('tar', ['-xf', archive, '-C', sdkDir])
const framework = join(sdkDir, 'Sparkle.framework')
assert.ok(existsSync(framework))
const fixture = join(root, `fixture-${randomBytes(5).toString('hex')}`)
mkdirSync(fixture, { recursive: true })
const identifier = `local.msb.sparkle-g0.${randomBytes(5).toString('hex')}`
const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const publicRaw = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32)
const seed = privateKey.export({ type: 'pkcs8', format: 'der' }).subarray(-32)
const keyFile = join(fixture, 'test-key')
writeFileSync(keyFile, seed.toString('base64'), { mode: 0o600 })
const requests = []
let feed = ''
let zip = Buffer.alloc(0)
const server = createServer((req, res) => {
  requests.push({ path: req.url, at: Date.now() })
  const body =
    req.url === '/appcast.xml'
      ? Buffer.from(feed)
      : req.url === '/notes.md'
        ? Buffer.from('## G0\n- Sparkle\n')
        : req.url === '/update.zip'
          ? zip
          : null
  if (!body) return res.writeHead(404).end()
  res.writeHead(200, {
    'Content-Length': body.length,
    'Content-Type': req.url.endsWith('xml') ? 'application/xml' : 'application/octet-stream'
  })
  res.end(body)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
try {
  const url = `http://127.0.0.1:${server.address().port}`
  const binary = join(fixture, 'probe')
  const nativeFlags = electronArch
    ? [
        '-DELECTRON_G0',
        '-shared',
        '-undefined',
        'dynamic_lookup',
        '-I',
        join(root, 'headers/node_headers/include/node')
      ]
    : []
  execFileSync(
    'clang',
    [
      '-fobjc-arc',
      ...nativeFlags,
      '-arch',
      'arm64',
      '-arch',
      'x86_64',
      '-fblocks',
      '-Wno-protocol',
      '-framework',
      'Cocoa',
      '-F',
      sdkDir,
      '-framework',
      'Sparkle',
      '-Wl,-rpath,@executable_path/../Frameworks',
      'tools/sparkle-g0/driver.m',
      '-o',
      binary
    ],
    { stdio: 'inherit' }
  )
  const apps = []
  for (const version of ['90.0.1', '90.0.2']) {
    const app = join(fixture, version, 'SparkleProbe.app')
    const contents = join(app, 'Contents')
    if (electronArch) {
      const base =
        electronArch === 'arm64'
          ? 'node_modules/electron/dist/Electron.app'
          : join(root, 'electron-x64/Electron.app')
      cpSync(base, app, { recursive: true, verbatimSymlinks: true })
      const appDir = join(contents, 'Resources/app')
      mkdirSync(appDir, { recursive: true })
      cpSync(binary, join(appDir, 'probe.node'))
      writeFileSync(
        join(appDir, 'package.json'),
        JSON.stringify({ name: 'sparkle-g0', version, main: 'main.cjs' })
      )
      writeFileSync(
        join(appDir, 'main.cjs'),
        `const {app}=require('electron'); const path=require('node:path'); app.setPath('userData',path.resolve(__dirname,'../../../../profile'));app.disableHardwareAcceleration();if(process.env.SPARKLE_G0_MODE==='install-cancel')app.once('before-quit',e=>e.preventDefault());app.whenReady().then(()=>require('./probe.node').start());`
      )
    }
    mkdirSync(join(contents, 'MacOS'), { recursive: true })
    mkdirSync(join(contents, 'Frameworks'), { recursive: true })
    cpSync(binary, join(contents, 'MacOS', 'probe'))
    cpSync(framework, join(contents, 'Frameworks', 'Sparkle.framework'), {
      recursive: true,
      verbatimSymlinks: true
    })
    writeFileSync(
      join(contents, 'Info.plist'),
      `<?xml version="1.0"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${identifier}</string><key>CFBundleName</key><string>SparkleProbe</string><key>CFBundleExecutable</key><string>${electronArch ? 'Electron' : 'probe'}</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>${version}</string><key>CFBundleShortVersionString</key><string>${version}</string>
<key>SUPublicEDKey</key><string>${publicRaw.toString('base64')}</string><key>SUFeedURL</key><string>${url}/appcast.xml</string><key>SUEnableAutomaticChecks</key><false/><key>SUAutomaticallyUpdate</key><false/><key>SUAllowsAutomaticUpdates</key><false/><key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>`
    )
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'pipe' })
    execFileSync('codesign', ['--verify', '--deep', '--strict', app])
    apps.push(app)
  }
  const zipPath = join(fixture, 'update.zip')
  execFileSync('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', apps[1], zipPath])
  zip = readFileSync(zipPath)
  const signed = execFileSync(
    join(sdkDir, 'bin/sign_update'),
    ['--ed-key-file', keyFile, zipPath],
    { encoding: 'utf8' }
  )
  assert.match(signed, /sparkle:edSignature="[^"]+"/)
  feed = `<?xml version="1.0"?><rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"><channel><title>G0</title><item><title>90.0.2</title><sparkle:version>90.0.2</sparkle:version><sparkle:releaseNotesLink>${url}/notes.md</sparkle:releaseNotesLink><enclosure url="${url}/update.zip" ${signed.trim()} type="application/octet-stream"/></item></channel></rss>`
  const runs = []
  const validFeed = feed
  for (let index = 0; index < 7; index++) {
    const mode =
      index === 6
        ? 'install'
        : index === 5
          ? 'install-cancel'
          : index === 3
            ? 'save-failure'
            : 'skip'
    feed = index === 4 ? validFeed.replace(/(edSignature=")[A-Za-z0-9+/]/, '$1!') : validFeed
    const before = requests.length
    const result = await new Promise((resolve, reject) => {
      const executable = join(apps[0], 'Contents/MacOS', electronArch ? 'Electron' : 'probe')
      const command = index === 2 && !electronArch ? '/usr/bin/arch' : executable
      const args = index === 2 && !electronArch ? ['-x86_64', executable] : []
      const child = spawn(command, args, {
        env: { ...process.env, SPARKLE_G0_MODE: mode },
        stdio: ['ignore', 'pipe', 'pipe']
      })
      let stdout = '',
        stderr = ''
      child.stdout.on('data', (data) => {
        stdout += data
        process.stdout.write(data)
      })
      child.stderr.on('data', (data) => {
        stderr += data
      })
      child.once('error', reject)
      const timeout = setTimeout(() => child.kill('SIGTERM'), 45000)
      child.once('close', (code, signal) => {
        clearTimeout(timeout)
        resolve({ code, signal, stdout, stderr, requests: requests.slice(before) })
      })
    })
    runs.push(result)
    writeFileSync(
      resultFile,
      JSON.stringify({ sdk: sdk.version, identifier, fixture, runs }, null, 2)
    )
    if (index === 4) {
      assert.equal(result.code, 6, result.stderr)
      assert.doesNotMatch(result.stdout, /"event":"ready"/)
      continue
    }
    assert.equal(result.code, 0, result.stderr)
    assert.match(result.stdout, /"event":"ready"/)
    assert.match(result.stdout, /"event":"notes"/)
    const permission = result.stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
      .find((event) => event.event === 'download-permission')
    assert.ok(permission)
    assert.ok(
      result.requests
        .filter((request) => request.path === '/update.zip')
        .every((request) => request.at >= permission.at),
      '检查阶段不能请求更新归档'
    )
  }
  const downloads = runs.map(
    (run) => run.requests.filter((request) => request.path === '/update.zip').length
  )
  const marker = join(apps[0], '..', 'installed-marker')
  for (let attempt = 0; attempt < 60 && !existsSync(marker); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  const unchanged = execFileSync(
    '/usr/libexec/PlistBuddy',
    ['-c', 'Print :CFBundleVersion', join(apps[0], 'Contents/Info.plist')],
    { encoding: 'utf8' }
  ).trim()
  const installed = existsSync(marker) ? readFileSync(marker, 'utf8') : null
  const result = {
    sdk: sdk.version,
    electronArch: electronArch || null,
    identifier,
    fixture,
    runs,
    downloads,
    unchanged,
    installed,
    passed:
      downloads.filter((_, index) => index !== 4).every((count) => count === 1) &&
      unchanged === '90.0.2' &&
      installed === '90.0.2'
  }
  writeFileSync(resultFile, JSON.stringify(result, null, 2))
  console.log(JSON.stringify({ downloads, unchanged, passed: result.passed }))
  if (!result.passed) process.exitCode = 1
} finally {
  await new Promise((resolve) => server.close(resolve))
}
