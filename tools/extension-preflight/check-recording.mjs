/* eslint @typescript-eslint/explicit-function-return-type: off -- 独立验证脚本使用原生 JavaScript */
import { createRequire } from 'node:module'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
const here = dirname(fileURLToPath(import.meta.url)),
  root = join(here, '../..')
const require = createRequire(join(root, 'package.json'))
const output = join(here, 'out/.artifacts/recording-' + Date.now())
await mkdir(output, { recursive: true })
const { build } = require('esbuild')
for (const [entry, name] of [
  ['tools/extension-preflight/recording-harness.ts', 'harness.cjs'],
  ['src/main/browser/recording/capturePreload.ts', 'capture-preload.cjs']
])
  await build({
    entryPoints: [join(root, entry)],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
    outfile: join(output, name)
  })
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(require('electron'), [join(output, 'harness.cjs'), output], {
  cwd: root,
  env,
  stdio: 'inherit'
})
child.on('exit', (code) => {
  console.log('生产录屏证据目录：' + output)
  process.exitCode = code ?? 1
})
