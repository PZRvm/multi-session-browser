/* eslint @typescript-eslint/explicit-function-return-type: off -- 独立验证脚本 */
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
const here = dirname(fileURLToPath(import.meta.url)),
  require = createRequire(join(here, '../../package.json')),
  output = join(here, 'out/.artifacts/lifecycle-' + Date.now())
await mkdir(output, { recursive: true })
await writeFile(
  join(output, 'location.json'),
  JSON.stringify({ scope: '真实Electron指定frame带声音采集的生命周期；不等于完整产品扩展接线' })
)
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(require('electron'), [join(here, 'lifecycle-main.cjs'), output], {
  env,
  stdio: 'inherit'
})
child.on('exit', (code) => {
  console.log('生命周期证据：' + output)
  process.exitCode = code ?? 1
})
