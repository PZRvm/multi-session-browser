/* eslint @typescript-eslint/explicit-function-return-type: off -- 独立验证脚本 */
import { rm, writeFile } from 'node:fs/promises'
const M = 'src/main/extensions'
const { createManifestStore, classifyInstall } = await import(`../../${M}/install/manifest-store.ts`)
const { loadInstallsIntoSession } = await import(`../../${M}/runtime/loader.ts`)
await rm('/tmp/ext-runtime', { recursive: true, force: true })
const store = createManifestStore('/tmp/ext-runtime/installed.json')
let loadCalls = 0
let loaded = []
const mkSession = () => ({
  getAllExtensions: () => loaded.map((id) => ({ id })),
  loadExtension: async (path) => {
    loadCalls++
    if (path.endsWith('.bad')) throw new Error('EACCES: bad path')
    const id = path.split('/').pop() === 'a' ? 'a'.repeat(32) : 'b'.repeat(32)
    loaded.push(id)
    return { id }
  }
})
await store.upsertInstall({ id: 'a'.repeat(32), version: '1.0.0', sha256: 'c'.repeat(64), source: { kind: 'unpacked', origin: '/tmp/ext-runtime/a' }, partitions: [] })
await store.upsertInstall({ id: 'b'.repeat(32), version: '1.0.0', sha256: 'c'.repeat(64), source: { kind: 'unpacked', origin: '/tmp/ext-runtime/b' }, partitions: [] })
const opts = () => ({
  resolvePath: (r) => r.source.origin ?? '',
  recordPartition: (id, p, ok) => store.recordPartition(id, p, ok)
})
const results1 = await loadInstallsIntoSession(mkSession(), (await store.read()).installs, 'persist:sess-1', opts('x'))
const part1 = (await store.read()).installs.map((r) => r.partitions.find((p) => p.partition === 'persist:sess-1')).filter(Boolean)
const cls1 = classifyInstall(part1)
const t1 = results1.length === 2 && results1.every((r) => r.ok) && cls1 === 'ready' && part1.length === 2
console.log(JSON.stringify({ t1_ready: t1, calls: loadCalls }))
loadCalls = 0
const results2 = await loadInstallsIntoSession(mkSession(), (await store.read()).installs, 'persist:sess-1', opts('x'))
const t2 = results2.every((r) => r.detail === 'already-loaded') && loadCalls === 0
console.log(JSON.stringify({ t2_dedupe: t2, calls: loadCalls }))
loaded = []
const installs3 = (await store.read()).installs.map((r) =>
  r.id === 'b'.repeat(32) ? { ...r, source: { ...r.source, origin: r.source.origin + '.bad' } } : r
)
const results3 = await loadInstallsIntoSession(mkSession(), installs3, 'persist:sess-2', opts('x'))
const part2 = (await store.read()).installs.map((r) => r.partitions.find((p) => p.partition === 'persist:sess-2')).filter(Boolean)
const cls3 = classifyInstall(part2)
const ok3 = results3.filter((r) => r.ok).length === 1
const t3 = ok3 && cls3 === 'partial' && part2.some((p) => p.ok === false) && part2.length === 2
console.log(JSON.stringify({ t3_partial: t3, ok: results3.map((r) => r.ok) }))
loadCalls = 0
await loadInstallsIntoSession(mkSession(), installs3, 'persist:sess-2', opts('x'))
const m4 = await store.read()
const t4 = m4.installs.every((r) => r.partitions.filter((p) => p.partition === 'persist:sess-2').length === 1)
console.log(JSON.stringify({ t4_partition_idempotent: t4, calls: loadCalls }))
await writeFile('/tmp/ext-runtime/installed.json', '{"version":1,"generation":1,"installs":[{"id":"zz"}]}')
let corrupt = false
try { await store.read() } catch { corrupt = true }
console.log(JSON.stringify({ t5_corrupt_reject: corrupt }))
