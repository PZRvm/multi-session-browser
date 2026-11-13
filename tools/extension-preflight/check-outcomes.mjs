/* eslint @typescript-eslint/explicit-function-return-type: off -- 独立验证脚本使用原生 JavaScript */
import assert from 'node:assert/strict'
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { runtimeFailures, isInside, storeExitCode } from './outcomes.mjs'
assert.equal(runtimeFailures({ checks: [], fatal: 'cleanup failed' }).length, 1)
assert.equal(runtimeFailures({ checks: [], timeout: true }).length, 1)
assert.equal(
  runtimeFailures({ checks: [{ status: 'fail' }], fatal: 'failed', timeout: true }).length,
  3
)
for (const paths of [path.posix, path.win32]) {
  const root = paths === path.win32 ? 'C:\\run' : '/run'
  assert(isInside(root, paths.join(root, 'video.mp4'), paths))
  for (const file of [paths.resolve(root, '../run-other/x'), paths.resolve(root, '../x'), root])
    assert(!isInside(root, file, paths))
}
assert.equal(storeExitCode({ status: 'fail', loaded: {}, pageConfirmed: true }), 1)
assert.equal(storeExitCode({ loaded: {} }), 2)
assert.equal(storeExitCode({}), 2)
assert.equal(storeExitCode({ loaded: {}, pageConfirmed: true }), 0)
assert.equal(storeExitCode({ loaded: {}, pageConfirmed: true, requireUninstall: true }), 2)
assert.equal(
  storeExitCode({ loaded: {}, pageConfirmed: true, requireUninstall: true, uninstalled: true }),
  0
)
const source = await readFile(new URL('./media.js', import.meta.url), 'utf8')
const window = {}
let stopped = 0,
  trackStopped = 0
class BrokenRecorder {
  static isTypeSupported() {
    return true
  }
  state = 'inactive'
  start() {
    this.state = 'recording'
    queueMicrotask(() => this.onerror({ error: { message: 'encoder failed' } }))
  }
  stop() {
    this.state = 'inactive'
    stopped++
    this.onstop?.()
  }
}
runInNewContext(source, { window, MediaRecorder: BrokenRecorder, setTimeout, clearTimeout, Blob })
const track = {
  kind: 'video',
  getSettings: () => ({}),
  stop: () => {
    trackStopped++
  }
}
const start = Date.now()
await assert.rejects(
  window.preflightRecord({ getTracks: () => [track], getAudioTracks: () => [] }, 60000),
  /encoder failed/
)
assert(Date.now() - start < 1000)
assert.equal(trackStopped, 1)
assert.equal(stopped, 1)
console.log('R1-R4: 运行异常/超时、POSIX/Windows目录边界、商店三态、早期媒体错误即时释放均通过')
if (process.argv[2]) {
  const { mkdtemp, cp, writeFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { verifyArtifacts } = await import('./verify.mjs')
  const root = await mkdtemp(path.join(tmpdir(), 'msb-outcome-'))
  try {
    for (const name of ['target-A.png', 'tab-audio.mp4', 'electron-results.json'])
      await cp(path.join(process.argv[2], name), path.join(root, name))
    const original = JSON.parse(await readFile(path.join(root, 'electron-results.json'), 'utf8'))
    for (const change of [{ fatal: '模拟收尾失败' }, { timeout: true }]) {
      await writeFile(
        path.join(root, 'electron-results.json'),
        JSON.stringify({ ...original, ...change })
      )
      const result = await verifyArtifacts(root)
      assert(result.checks.every((c) => c.status === 'pass'))
      assert.equal(result.componentStatus, 'fail')
      assert.equal(process.exitCode, 1)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
  process.exitCode = 0
  console.log('真实媒体验证器：有效媒体之后fatal/timeout均判失败，退出1，通过')
}
