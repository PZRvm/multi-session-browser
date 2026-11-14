/* eslint-disable @typescript-eslint/explicit-function-return-type -- 原生构建工具 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const sparklePin = JSON.parse(readFileSync('build/sparkle/sdk.json', 'utf8'))
export const sdkRoot = resolve('dist/sparkle-sdk', sparklePin.version)
function checksum(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}
function obtain(file, url, expected, cache) {
  if (existsSync(file) && checksum(file) === expected) return
  console.log(`[sparkle] 准备并校验构建输入：${url.split('/').at(-1)}`)
  mkdirSync(sdkRoot, { recursive: true })
  const pending = `${file}.download`
  if (cache && existsSync(cache) && checksum(cache) === expected) copyFileSync(cache, pending)
  else
    execFileSync(
      'curl',
      [
        '-fLsS',
        '--connect-timeout',
        '20',
        '--max-time',
        '180',
        '--speed-limit',
        '1024',
        '--speed-time',
        '30',
        '--retry',
        '2',
        '-o',
        pending,
        url
      ],
      { stdio: 'inherit' }
    )
  if (checksum(pending) !== expected) {
    rmSync(pending)
    throw new Error('原生构建输入 SHA-256 不匹配')
  }
  renameSync(pending, file)
}
export function prepareSparkleSdk() {
  if (process.platform !== 'darwin') throw new Error('Sparkle 仅在 macOS 构建')
  const archive = join(sdkRoot, 'sdk.tar.xz')
  obtain(archive, sparklePin.url, sparklePin.sha256, 'dist/sparkle-g0/sdk.tar.xz')
  execFileSync('tar', ['-xf', archive, '-C', sdkRoot])
  return sdkRoot
}
export function buildSparkle(arch) {
  if (!['arm64', 'x64'].includes(arch)) throw new Error('不支持的 Sparkle 架构')
  const installed = JSON.parse(readFileSync('node_modules/electron/package.json', 'utf8')).version
  if (installed !== sparklePin.electron)
    throw new Error('Electron 版本变化，需要更新并验证原生构建输入')
  prepareSparkleSdk()
  const headers = join(sdkRoot, 'headers.tar.gz')
  obtain(
    headers,
    `https://artifacts.electronjs.org/headers/dist/v${sparklePin.electron}/node-v${sparklePin.electron}-headers.tar.gz`,
    sparklePin.headersSha256,
    'dist/sparkle-g0/electron-headers.tgz'
  )
  execFileSync('tar', ['-xzf', headers, '-C', sdkRoot])
  const output = resolve('dist/sparkle-native', arch, 'bridge.node')
  mkdirSync(join(output, '..'), { recursive: true })
  execFileSync(
    'clang',
    [
      '-fobjc-arc',
      '-fblocks',
      `-mmacosx-version-min=${sparklePin.deploymentTarget}`,
      '-arch',
      arch === 'x64' ? 'x86_64' : arch,
      '-shared',
      '-undefined',
      'dynamic_lookup',
      '-I',
      join(sdkRoot, 'node_headers/include/node'),
      '-F',
      sdkRoot,
      '-framework',
      'Cocoa',
      '-framework',
      'Sparkle',
      '-Wl,-rpath,@executable_path/../Frameworks',
      'native/sparkle/bridge.m',
      '-o',
      output
    ],
    { stdio: 'inherit' }
  )
  return output
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(buildSparkle(process.argv[2] || process.arch))
}
