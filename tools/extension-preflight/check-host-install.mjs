import { readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
const P = process.argv[2] ?? join('tools/extension-preflight/out/.artifacts/samples')
const M = '/Users/pangzerui/foreunit/multi-session-browser-wt/feature-extension-host/src/main/extensions/install'
const { inspectCrx, extractCrx } = await import(`${M}/crx.ts`)
const { createManifestStore, validateManifest, classifyInstall } = await import(`${M}/manifest-store.ts`)
const samples = JSON.parse(await readFile(join(P, 'samples.json'), 'utf8')).samples
const meta = Object.fromEntries(samples.map((v) => [v.name, v]))
const results = []
const check = (name, ok, detail) => { results.push({ name, ok, detail }); if (!ok) process.exitCode = 1 }
const dark = await readFile(join(P, 'dark.crx'))
const i1 = inspectCrx(dark, meta.dark.id)
check('CRX3验签+ID/版本/哈希对账', i1.id === meta.dark.id && i1.manifest.version === meta.dark.version && i1.sha256 === meta.dark.sha256, i1.id)
const root = '/tmp/ext-final/packages'
await rm('/tmp/ext-final', { recursive: true, force: true })
const ex1 = await extractCrx(dark, root, meta.dark.id)
const ex2 = await extractCrx(dark, root, meta.dark.id)
check('解包落盘+重复幂等', !ex1.duplicate && ex2.duplicate && ex1.path === ex2.path, '幂等')
const archiveStart = 12 + dark.readUInt32LE(8)
const bad = Buffer.from(dark)
bad[archiveStart + 10] ^= 1
let t = false
try { inspectCrx(bad, meta.dark.id) } catch { t = true }
check('归档篡改拒绝', t, '签名无效')
const own2 = await readFile(join(P, 'own-positive-crx2.crx'))
const i2 = inspectCrx(own2, meta['own-positive-crx2'].id)
const ex3 = await extractCrx(own2, root, meta['own-positive-crx2'].id)
check('CRX2正向验签解包', i2.version === 2 && i2.manifest.version === '1.0.0' && !ex3.duplicate, i2.id)
let neg = false
try { inspectCrx(await readFile(join(P, 'legacy-crx2.crx'))) } catch { neg = true }
check('历史CRX2负向拒绝', neg, '拒绝')
const store = createManifestStore('/tmp/ext-final/installed.json')
const rec = await store.upsertInstall({ id: 'a'.repeat(32), version: '4.9.135', sha256: 'b'.repeat(64), source: { kind: 'crx', origin: 'smoke' }, partitions: [{ partition: 'persist:sess-test', ok: true }] })
const back = await store.read()
const cls = classifyInstall(back.installs[0].partitions)
check('清单闭环+ready分类', back.installs.length === 1 && cls === 'ready' && back.installs[0].partitions[0].generation === back.installs[0].generation, `gen=${back.installs[0].generation}`)
await writeFile('/tmp/ext-final/installed.json', '{"version":1,"generation":1,"installs":[{"id":"zz"}]}')
let cr = false
try { await store.read() } catch { cr = true }
check('损坏清单拒绝加载', cr, 'INVALID_MANIFEST')
const badRec = { ...rec, partitions: [{ ...rec.partitions[0], generation: rec.generation - 1 }] }
let gr = false
try { validateManifest({ version: 1, generation: rec.generation, installs: [badRec] }) } catch { gr = true }
check('分区代次不一致拒绝', gr, '协议v1')
const dup = { ...rec }
let dr = false
try { validateManifest({ version: 1, generation: rec.generation, installs: [rec, dup] }) } catch { dr = true }
check('安装记录重复拒绝', dr, '协议v1')
console.log(JSON.stringify(results))
