/* eslint @typescript-eslint/explicit-function-return-type: off -- 真实样本数据与状态模型的前置对账 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { checkImagePayload, checkInstallRecord, MAX_IMAGE_BYTES } from './schema-v1.mjs'
import { createRecordingModel } from './contracts.mjs'
const here = dirname(fileURLToPath(import.meta.url)),
  artifacts = join(here, 'out/.artifacts')
const dir =
  process.argv[2] ?? (await readFile(join(artifacts, 'latest-electron.txt'), 'utf8')).trim()
const png = await readFile(join(dir, 'target-A.png')),
  meta = {
    mimeType: 'image/png',
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
    sha256: createHash('sha256').update(png).digest('hex')
  }
assert(checkImagePayload(meta, png))
assert.throws(() => checkImagePayload({ ...meta, width: meta.width + 1 }, png))
assert.throws(() => checkImagePayload(meta, Buffer.alloc(MAX_IMAGE_BYTES + 1)))
const broken = Buffer.from(png)
broken[0] ^= 1
assert.throws(() =>
  checkImagePayload({ ...meta, sha256: createHash('sha256').update(broken).digest('hex') }, broken)
)
const sample = JSON.parse(
  await readFile(join(artifacts, 'samples/samples.json'), 'utf8')
).samples.find((s) => s.name === 'dark')
const record = {
  id: sample.id,
  version: sample.version,
  sha256: sample.sha256,
  source: { kind: 'store' },
  generation: 2,
  partitions: [
    { partition: 'persist:A', ok: true, generation: 2 },
    { partition: 'persist:B', ok: true, generation: 2 }
  ]
}
assert.equal(checkInstallRecord(record), 'ready')
assert.equal(
  checkInstallRecord({
    ...record,
    partitions: [record.partitions[0], { ...record.partitions[1], ok: false }]
  }),
  'partial'
)
assert.equal(
  checkInstallRecord({
    ...record,
    partitions: record.partitions.map((v) => ({ ...v, ok: false }))
  }),
  'failed'
)
assert.equal(checkInstallRecord({ ...record, partitions: [] }), 'not-loaded')
assert.throws(() =>
  checkInstallRecord({ ...record, partitions: [record.partitions[0], record.partitions[0]] })
)
assert.throws(() =>
  checkInstallRecord({ ...record, partitions: [{ ...record.partitions[0], generation: 1 }] })
)
const model = createRecordingModel(),
  events = []
const unsubscribe = model.subscribe((event) => events.push(event))
const start = model.start()
assert(model.ready(start))
model.pause()
model.resume()
assert(model.stop())
assert.equal(model.state(), 'finalizing')
assert.throws(() => model.start(), /BUSY/)
assert.equal(model.stop(), false)
const finalizing = model.status().generation
assert(!model.finish(finalizing - 1))
assert(model.finish(finalizing))
assert(!model.finish(finalizing))
assert.deepEqual(
  events.map((e) => e.state),
  ['idle', 'starting', 'recording', 'paused', 'recording', 'finalizing', 'idle']
)
assert(events.every((e, i) => e.seq === i))
unsubscribe()
const count = events.length
const cancelled = model.start()
model.stop()
assert(!model.ready(cancelled))
assert.equal(events.length, count)
model.close()
assert.throws(() => model.start(), /TARGET_GONE/)
const failure = createRecordingModel()
failure.subscribe(() => {
  throw new Error('subscriber gone')
})
assert.equal(failure.observerFailures(), 1)
failure.start()
failure.close()
console.log(
  '真实PNG/摘要/尺寸/上限、真实插件安装记录与分区代次、录屏finalizing/重复收尾/晚到/订阅序号及取消订阅对账通过'
)
