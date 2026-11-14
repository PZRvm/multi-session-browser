import { spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import {
  createReadStream,
  statSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync
} from 'node:fs'
import { basename, join, resolve } from 'node:path'

import { generateKeyPairSync } from 'node:crypto'
import { generateAppcast } from './sparkle-appcast.mjs'

const [command, version = '90.0.2'] = process.argv.slice(2)
if (command === 'build') {
  const targetArch = ['arm64', 'x64'].includes(version) ? version : process.arch
  const env = { ...process.env, MAIN_VITE_UPDATE_TEST: 'true' }
  if (process.platform === 'darwin') {
    const keyFile = 'dist/update-test/test-keys.json'
    mkdirSync('dist/update-test', { recursive: true })
    if (!existsSync(keyFile)) {
      const pair = generateKeyPairSync('ed25519')
      writeFileSync(
        keyFile,
        JSON.stringify({
          SPARKLE_PRIVATE_KEY: pair.privateKey
            .export({ type: 'pkcs8', format: 'der' })
            .subarray(-32)
            .toString('base64'),
          SPARKLE_PUBLIC_ED_KEY: pair.publicKey
            .export({ type: 'spki', format: 'der' })
            .subarray(-32)
            .toString('base64')
        }),
        { mode: 0o600 }
      )
    }
    Object.assign(env, JSON.parse(readFileSync(keyFile, 'utf8')))
  }
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  console.log('[update-test] 1/3 编译应用，两个测试版本复用同一份产物')
  const result = spawnSync(npm, ['run', 'build'], {
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  })
  if (result.status !== 0) process.exit(result.status || 1)
  // 版本只覆盖包元数据；编译产物不含硬编码的测试版本号。
  for (const [index, candidate] of ['90.0.1', '90.0.2'].entries()) {
    console.log(`[update-test] ${index + 2}/3 打包 ${candidate}`)
    const packageEnv = {
      ...env,
      MSB_UPDATE_TEST_VERSION: candidate,
      MSB_UPDATE_TEST_ARCH: targetArch
    }
    const builder = spawnSync(
      npm,
      [
        'exec',
        'electron-builder',
        '--',
        '--config',
        'scripts/electron-builder-update-test.cjs',
        `--${process.platform === 'win32' ? 'win' : 'mac'}`,
        `--${targetArch}`,
        '--publish',
        'never'
      ],
      { env: packageEnv, stdio: 'inherit', shell: process.platform === 'win32' }
    )
    if (builder.status !== 0) process.exit(builder.status || 1)
    if (process.platform === 'darwin') {
      Object.assign(process.env, {
        SPARKLE_PUBLIC_ED_KEY: env.SPARKLE_PUBLIC_ED_KEY,
        SPARKLE_PRIVATE_KEY: env.SPARKLE_PRIVATE_KEY
      })
      generateAppcast(
        `dist/update-test/${candidate}`,
        'multi-session-browser-update-test',
        candidate,
        targetArch,
        {
          base: 'http://127.0.0.1:6185',
          notes: readFileSync(
            `tools/update-test/fixtures/release-notes-${candidate}.md`,
            'utf8'
          ).trim()
        }
      )
      rmSync(`dist/update-test/${candidate}/latest-mac.yml`, { force: true })
      rmSync(
        `dist/update-test/${candidate}/multi-session-browser-update-test-${candidate}-mac-${targetArch}.zip.blockmap`,
        { force: true }
      )
    }
  }
  console.log('[update-test] 两个测试版本已生成，可以运行 serve 90.0.2')
} else if (command === 'serve') {
  if (!['90.0.1', '90.0.2'].includes(version)) throw new Error('仅允许提供测试版本')
  const root = resolve('dist/update-test', version)
  const allowed = new Set([
    'appcast-arm64.xml',
    'appcast-x64.xml',
    `release-notes-v${version}.md`,
    `multi-session-browser-update-test-${version}-mac-arm64.zip`,
    `multi-session-browser-update-test-${version}-mac-x64.zip`,
    'latest.yml',
    `multi-session-browser-update-test-${version}-win-x64-setup.exe`,
    `multi-session-browser-update-test-${version}-win-x64-setup.exe.blockmap`
  ])
  const server = createServer((req, res) => {
    let file
    try {
      file = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname).slice(1)
    } catch {
      res.writeHead(400).end()
      return
    }
    if (
      !file ||
      basename(file) !== file ||
      !allowed.has(file) ||
      !['GET', 'HEAD'].includes(req.method)
    ) {
      res.writeHead(404).end()
      return
    }
    try {
      const path = join(root, file),
        stat = statSync(path)
      if (!stat.isFile()) {
        res.writeHead(404).end()
        return
      }
      res.writeHead(200, { 'Content-Length': stat.size, 'Cache-Control': 'no-store' })
      if (req.method === 'HEAD') {
        res.end()
        return
      }
      const stream = createReadStream(path)
      stream.on('error', () => res.destroy())
      stream.pipe(res)
      console.log(`测试源 ${req.method} ${file}`)
    } catch {
      res.writeHead(404).end()
    }
  })
  server.on('error', (error) => {
    console.error(
      error.code === 'EADDRINUSE'
        ? '端口 6185 已占用，请先关闭原测试源；本工具不会接管已有服务'
        : error.message
    )
    process.exitCode = 1
  })
  server.listen(6185, '127.0.0.1', () =>
    console.log(`本地更新源：http://127.0.0.1:6185/ → ${root}`)
  )
} else throw new Error('用法：node scripts/update-test.mjs build | serve [90.0.1|90.0.2]')
