import { spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { createReadStream, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

const [command, version = '90.0.2'] = process.argv.slice(2)
if (command === 'build') {
  const env = { ...process.env, MAIN_VITE_UPDATE_TEST: 'true' }
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
    const packageEnv = { ...env, MSB_UPDATE_TEST_VERSION: candidate }
    const builder = spawnSync(
      npm,
      [
        'exec',
        'electron-builder',
        '--',
        '--config',
        'scripts/electron-builder-update-test.cjs',
        `--${process.platform === 'win32' ? 'win' : 'mac'}`,
        `--${process.arch}`,
        '--publish',
        'never'
      ],
      { env: packageEnv, stdio: 'inherit', shell: process.platform === 'win32' }
    )
    if (builder.status !== 0) process.exit(builder.status || 1)
  }
  console.log('[update-test] 两个测试版本已生成，可以运行 serve 90.0.2')
} else if (command === 'serve') {
  if (!['90.0.1', '90.0.2'].includes(version)) throw new Error('仅允许提供测试版本')
  const root = resolve('dist/update-test', version)
  createServer((req, res) => {
    let file
    try {
      file = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname).slice(1)
    } catch {
      res.writeHead(400).end()
      return
    }
    if (!file || basename(file) !== file || !/\.(yml|zip|exe|blockmap)$/.test(file)) {
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
      const stream = createReadStream(path)
      stream.on('error', () => res.destroy())
      stream.pipe(res)
      console.log(`测试源 ${req.method} ${file}`)
    } catch {
      res.writeHead(404).end()
    }
  }).listen(6185, '127.0.0.1', () => console.log(`本地更新源：http://127.0.0.1:6185/ → ${root}`))
} else throw new Error('用法：node scripts/update-test.mjs build | serve [90.0.1|90.0.2]')
