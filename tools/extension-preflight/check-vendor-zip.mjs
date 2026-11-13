/* eslint @typescript-eslint/explicit-function-return-type: off -- ZIP边界拒绝断言 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import AdmZip from 'adm-zip'
import { readBoundedResponse, inspectVendorZip, MAX_VENDOR_DOWNLOAD } from './vendor-zip.mjs'
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const make = (names) => {
  const z = new AdmZip()
  for (const name of names) z.addFile(name, Buffer.from('body'))
  return z.toBuffer()
}
const valid = make(['manifest.json', 'dir/page.html'])
assert.equal(inspectVendorZip(valid, hash(valid)).getEntries().length, 2)
assert.throws(() => inspectVendorZip(valid, '0'.repeat(64)), /哈希/)
assert.throws(() => inspectVendorZip(Buffer.alloc(MAX_VENDOR_DOWNLOAD + 1), 'x'), /下载过大/)
for (const [names, options, pattern] of [
  [['A', 'a'], {}, /重复路径/],
  [['C:/evil'], {}, /路径拒绝/],
  [['one', 'two'], { maxEntries: 1 }, /条目数/],
  [['one'], { maxExpanded: 1 }, /展开过大/]
]) {
  const bytes = make(names)
  assert.throws(() => inspectVendorZip(bytes, hash(bytes), options), pattern)
}
assert.deepEqual(await readBoundedResponse(new Response('abc'), 3), Buffer.from('abc'))
await assert.rejects(
  readBoundedResponse(new Response('too-large', { headers: { 'content-length': '100' } }), 3),
  /下载过大/
)
let cancelled = false
const stream = new ReadableStream({
  start(controller) {
    controller.enqueue(new Uint8Array(4))
  },
  cancel() {
    cancelled = true
  }
})
await assert.rejects(readBoundedResponse(new Response(stream), 3), /下载过大/)
assert(cancelled)
console.log('厂商ZIP有效样本及哈希、下载/条目/展开上限、流式取消、重复路径和Windows盘符拒绝通过')
