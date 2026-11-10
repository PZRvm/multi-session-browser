/* eslint @typescript-eslint/explicit-function-return-type: off -- 独立前置契约断言 */
import assert from 'node:assert/strict'
import { createEndpoint, errorReply } from './protocol-v1.mjs'
const target = { alive: true, token: 'target-A' },
  context = () => ({ trusted: true, topFrame: true, sameSession: true, target })
const make = (requestId = 'req-1', method = 'capture') => ({
  protocol: 1,
  requestId,
  method,
  target: target.token
})
let calls = 0,
  late
const endpoint = createEndpoint(
  context,
  {
    handshake: () => ({
      protocol: 1,
      capabilities: { capture: true, tabAudio: true, mp4: ['avc1,mp4a.40.2'], subscription: false },
      limits: { requestBytes: 4096, entries: 128 }
    }),
    capture: () => {
      calls++
      return { snapshotId: 'snapshot-A', version: 2, width: 100, height: 80, mimeType: 'image/png' }
    },
    'image.copy': () => {
      throw Object.assign(new Error('secret/path'), { code: 'SNAPSHOT_STALE' })
    },
    'recording.start': () =>
      new Promise((resolve) => {
        late = resolve
      })
  },
  { timeoutMs: 20, maxEntries: 8 }
)
const first = endpoint.request(make()),
  duplicate = endpoint.request(make())
assert.strictEqual(first, duplicate)
assert((await first).ok)
assert.equal(calls, 1)
assert.equal(
  (await endpoint.request({ ...make(), method: 'image.copy' })).error.code,
  'INVALID_REQUEST'
)
assert.equal((await endpoint.request(make('copy', 'image.copy'))).error.code, 'SNAPSHOT_STALE')
assert.equal(JSON.stringify(errorReply(make(), new Error('secret/path'))).includes('secret'), false)
const timed = await endpoint.request(make('timeout', 'recording.start'))
assert.equal(timed.error.code, 'TIMEOUT')
late('late')
assert.strictEqual(await endpoint.request(make('timeout', 'recording.start')), timed)
const cancelling = endpoint.request(make('cancel', 'recording.start'))
endpoint.cancel('cancel')
assert.equal((await cancelling).error.code, 'CANCELLED')
assert((await endpoint.request(make('handshake', 'handshake'))).value.capabilities.capture)
target.alive = false
assert.equal((await endpoint.request(make())).error.code, 'TARGET_GONE')
target.alive = true
endpoint.close()
assert.equal((await endpoint.request(make('closed'))).error.code, 'TARGET_GONE')
console.log(
  '协议信封、错误脱敏、请求幂等/冲突、有界超时、取消、晚到结果、握手与关闭撤销通过；不代表生产操作已接线'
)
let committed = 0
const cancelled = createEndpoint(
  context,
  {
    capture: () => {
      committed++
    }
  },
  { maxEntries: 1 }
)
const pending = cancelled.request(make('cancel-before-start'))
cancelled.cancel('cancel-before-start')
assert.equal((await pending).error.code, 'CANCELLED')
assert.equal(committed, 0)
assert.equal((await cancelled.request(make('ledger-full'))).error.code, 'BUSY')
cancelled.close()
const bounded = createEndpoint(context, { capture: () => true })
assert.equal(
  (await bounded.request({ ...make('large'), extra: 'x'.repeat(4097) })).error.code,
  'INVALID_REQUEST'
)
bounded.close()
let complete
const revoked = createEndpoint(context, {
  capture: () =>
    new Promise((resolve) => {
      complete = resolve
    })
})
const revoking = revoked.request(make('revoked'))
await Promise.resolve()
target.alive = false
complete(true)
assert.equal((await revoking).error.code, 'TARGET_GONE')
target.alive = true
revoked.close()
console.log('额外边界：取消前不执行、容量上限、载荷上限、异步返回前目标撤销通过')
