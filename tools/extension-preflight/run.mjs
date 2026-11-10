/* eslint @typescript-eslint/explicit-function-return-type: off -- 独立验证脚本使用原生 JavaScript，sandbox preload 使用 CommonJS */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { execFileSync, spawn } from 'node:child_process'
import { prepareSamples } from './samples.mjs'
const here = dirname(fileURLToPath(import.meta.url))
const requireRoot = createRequire(join(here, '../../package.json'))
const electron = requireRoot('electron')
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const mode = process.argv[2] ?? 'check'
const artifacts = join(here, 'out/.artifacts')
await mkdir(artifacts, { recursive: true })
const versions = JSON.parse(
  execFileSync(electron, ['-p', 'JSON.stringify(process.versions)'], {
    env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8'
  })
)
const runId = new Date().toISOString().replace(/[:.]/g, '-')
const output = join(artifacts, runId)
if (mode === 'fork') {
  const { buildReactFork } = await import('./react-fork.mjs')
  const samples = JSON.parse(
    await readFile(join(artifacts, 'samples/samples.json'), 'utf8')
  ).samples
  console.log(JSON.stringify(await buildReactFork(samples), null, 2))
} else if (mode === 'samples') {
  console.log(
    JSON.stringify(await prepareSamples(join(artifacts, 'samples'), versions.chrome), null, 2)
  )
} else if (mode === 'check') {
  const child = spawn(process.execPath, [join(here, 'check.mjs')], { stdio: 'inherit' })
  child.on('exit', (code) => {
    process.exitCode = code ?? 1
  })
} else if (mode === 'electron' || mode === 'store') {
  const samples = JSON.parse(await readFile(join(artifacts, 'samples/samples.json'), 'utf8'))
  await mkdir(output, { recursive: true })
  await writeFile(
    join(output, 'environment.json'),
    JSON.stringify(
      {
        runId,
        versions,
        platform: process.platform,
        arch: process.arch,
        git: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        samples
      },
      null,
      2
    )
  )
  const child = spawn(
    electron,
    [
      join(here, mode === 'store' ? 'store-main.cjs' : 'electron-main.cjs'),
      output,
      process.argv[3] ?? 'auto'
    ],
    { env, stdio: ['ignore', 'pipe', 'pipe'] }
  )
  let log = ''
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (data) => {
      log += data
      process.stdout.write(data)
    })
  child.on('exit', async (code) => {
    await writeFile(join(output, 'process.log'), log)
    await writeFile(join(artifacts, `latest-${mode}.txt`), output)
    console.log(`证据目录：${output}`)
    process.exitCode = code ?? 1
  })
} else if (mode === 'chrome') {
  const { runChrome } = await import('./chrome-probe.mjs')
  await mkdir(output, { recursive: true })
  await writeFile(
    join(output, 'environment.json'),
    JSON.stringify(
      {
        runId,
        versions,
        platform: process.platform,
        arch: process.arch,
        git: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
      },
      null,
      2
    )
  )
  await runChrome(
    output,
    artifacts,
    process.argv[3] === 'long' ? 64000 : 12000,
    process.argv[3] === 'extensions-fixed',
    process.argv[3] === 'sync'
  )
} else if (mode === 'verify') {
  const { verifyArtifacts } = await import('./verify.mjs')
  await verifyArtifacts(
    process.argv[3] ?? (await readFile(join(artifacts, 'latest-electron.txt'), 'utf8')).trim()
  )
} else throw new Error(`未知命令：${mode}`)
