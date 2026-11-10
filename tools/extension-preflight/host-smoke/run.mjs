import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '../../..')
const electron = join(root, 'node_modules/.bin/electron')
const samples = process.argv[2] || join(root, '../feature-chrome-extension-preflight/tools/extension-preflight/out/.artifacts/samples')
const build = (await import('esbuild')).build
await build({
  stdin: { contents: "import {injectBrowserAction} from 'electron-chrome-extensions/browser-action';injectBrowserAction()", resolveDir: root },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
  outfile: join(here, 'action-preload.cjs')
})
await build({
  entryPoints: [join(root, 'src/main/extensions/dev-entry.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron', 'electron-chrome-extensions', 'adm-zip'],
  outfile: join(here, 'host-smoke-bundle.cjs')
})
await build({
  entryPoints: [join(root, 'src/preload/extensions-bridge.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
  outfile: join(here, 'bridge-preload.cjs')
})
await rm('/tmp/host-smoke-userdata', { recursive: true, force: true })
const child = spawn(electron, [here], { env: { ...process.env, HOST_SMOKE_SAMPLES: samples }, stdio: ['ignore', 'pipe', 'pipe'] })
let out = ''
child.stdout.on('data', (d) => { out += d; process.stdout.write(d) })
child.stderr.on('data', (d) => { out += d; process.stderr.write(d) })
child.on('exit', async (code) => {
  console.log('ELECTRON_EXIT=' + code)
  try {
    const r = JSON.parse(await readFile(join(here, 'host-smoke-results.json'), 'utf8'))
    const allOk = r.checks.every((c) => c.ok)
    console.log('CHECKS=' + r.checks.length + ' ALL_OK=' + allOk)
    for (const c of r.checks) console.log((c.ok ? 'PASS ' : 'FAIL ') + c.name + ' | ' + c.detail)
    process.exitCode = code === 0 && allOk ? 0 : 1
  } catch {
    console.log('RESULTS_MISSING')
    process.exitCode = 1
  }
})
