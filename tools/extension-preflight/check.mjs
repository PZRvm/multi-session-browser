/* eslint @typescript-eslint/explicit-function-return-type: off -- 独立验证脚本使用原生 JavaScript，sandbox preload 使用 CommonJS */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { generateKeyPairSync } from 'node:crypto'
import AdmZip from 'adm-zip'
import { inspectCrx, extractCrx, makeCrx2 } from './crx.mjs'
import { checkRequest, createRecordingModel, classifyInstall, checkSnapshot } from './contracts.mjs'
import { mkdtemp, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { createRequire } from 'node:module'
import { fixButtonIcon } from './react-fork.mjs'
const requireRoot = createRequire(new URL('../../package.json', import.meta.url))
const React = requireRoot('react')
const { renderToStaticMarkup } = requireRoot('react-dom/server')

const results = []
async function check(name, fn) {
  await fn()
  results.push({ name, status: 'pass' })
}
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
function archive(manifest = { manifest_version: 3, name: '自有验证夹具', version: '1.0.0' }) {
  const zip = new AdmZip()
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest)))
  zip.addFile('page.html', Buffer.from('<!doctype html><title>自有验证夹具</title>'))
  return zip.toBuffer()
}
const valid = makeCrx2(archive(), publicKey, privateKey)
const scratch = await mkdtemp(join(tmpdir(), 'msb-preflight-check-'))
try {
  await check('合法自有 CRX2 验签与 manifest', () =>
    assert.equal(inspectCrx(valid).manifest.manifest_version, 3)
  )
  await check('截断包拒绝', () => assert.throws(() => inspectCrx(valid.subarray(0, 12))))
  await check('篡改签名拒绝', () => {
    const b = Buffer.from(valid)
    b[320] ^= 1
    assert.throws(() => inspectCrx(b))
  })
  await check('篡改包体拒绝', () => {
    const b = Buffer.from(valid)
    b[b.length - 8] ^= 1
    assert.throws(() => inspectCrx(b))
  })
  await check('扩展 ID 不符拒绝', () => assert.throws(() => inspectCrx(valid, 'a'.repeat(32))))
  await check('过旧 manifest 拒绝', () =>
    assert.throws(() =>
      inspectCrx(makeCrx2(archive({ name: '旧包', version: '1' }), publicKey, privateKey))
    )
  )
  await check('有界解包与重复安装', async () => {
    const first = await extractCrx(valid, scratch)
    assert.equal(JSON.parse(readFileSync(join(first.path, 'manifest.json'))).name, '自有验证夹具')
    const second = await extractCrx(valid, scratch)
    assert.equal(second.duplicate, true)
    assert.equal((await readdir(scratch)).length, 1)
  })
  await check('失败升级不覆盖原包', async () => {
    const changed = new AdmZip(archive())
    changed.addFile('extra.txt', Buffer.from('changed'))
    await assert.rejects(extractCrx(makeCrx2(changed.toBuffer(), publicKey, privateKey), scratch))
    assert.equal((await readdir(scratch)).length, 1)
    assert.equal((await extractCrx(valid, scratch)).duplicate, true)
  })
  await check('ZIP大小写冲突拒绝', () => {
    const conflicting = new AdmZip(archive())
    conflicting.addFile('PAGE.html', Buffer.from('conflict'))
    assert.throws(() => inspectCrx(makeCrx2(conflicting.toBuffer(), publicKey, privateKey)))
  })
  const target = { token: 'target-a', alive: true }
  const context = { trusted: true, topFrame: true, sameSession: true, target }
  const req = { protocol: 1, requestId: 'req-1', method: 'capture', target: 'target-a' }
  await check('合法请求', () => assert.equal(checkRequest(req, context).method, 'capture'))
  for (const [name, changes] of [
    ['未知来源', { trusted: false }],
    ['子 frame', { topFrame: false }],
    ['其他分区', { sameSession: false }],
    ['目标关闭', { target: { ...target, alive: false } }]
  ]) {
    await check(`${name}拒绝`, () =>
      assert.throws(() => checkRequest(req, { ...context, ...changes }))
    )
  }
  await check('伪造目标拒绝', () =>
    assert.throws(() => checkRequest({ ...req, target: 'target-b' }, context))
  )
  await check('协议版本拒绝', () =>
    assert.throws(() => checkRequest({ ...req, protocol: 2 }, context))
  )
  await check('未知方法拒绝', () =>
    assert.throws(() => checkRequest({ ...req, method: 'fs.readFile' }, context))
  )
  await check('无效请求编号拒绝', () =>
    assert.throws(() => checkRequest({ ...req, requestId: '' }, context))
  )
  await check('旧图与交错快照拒绝', () => {
    checkSnapshot({ id: 'a', version: 2 }, { id: 'a', version: 2 })
    assert.throws(() => checkSnapshot({ id: 'a', version: 2 }, { id: 'b', version: 2 }))
    assert.throws(() => checkSnapshot({ id: 'a', version: 2 }, { id: 'a', version: 1 }))
  })
  await check('部分安装失败不能算全部成功', () =>
    assert.equal(classifyInstall([{ ok: true }, { ok: false }]), 'partial')
  )
  await check('启动取消与晚到就绪、忙碌和重复停止', () => {
    const m = createRecordingModel()
    const generation = m.start()
    assert.throws(() => m.start())
    m.stop()
    assert.equal(m.ready(generation), false)
    assert.equal(m.stop(), false)
    const next = m.start()
    assert.equal(m.ready(next), true)
    m.pause()
    assert.equal(m.state(), 'paused')
    m.resume()
    m.stop()
  })
  const iconFixture = `function ButtonIcon_ButtonIcon(v) { const path = v; return React.createElement('svg', null, React.createElement('path', {fill:'currentColor', d:path})) }`
  const renderIcon = (code) => runInNewContext(code + ';ButtonIcon_ButtonIcon', { React })
  const group = React.createElement(
    'g',
    null,
    React.createElement('polygon', { points: '0,0 1,1 0,1' })
  )
  await check('SVG原错误重现、React图形分支修复', () => {
    assert(renderToStaticMarkup(renderIcon(iconFixture)(group)).includes('[object Object]'))
    const fixed = renderToStaticMarkup(renderIcon(fixButtonIcon(iconFixture))(group))
    assert(!fixed.includes('[object Object]'))
    assert(fixed.includes('<g><polygon'))
  })
  await check('SVG字符串路径不变', () =>
    assert.equal(
      renderToStaticMarkup(renderIcon(iconFixture)('M0 0h1v1z')),
      renderToStaticMarkup(renderIcon(fixButtonIcon(iconFixture))('M0 0h1v1z'))
    )
  )
  await check('未知或已修复结构拒绝盲目补丁', () => {
    assert.throws(() => fixButtonIcon('function unknown() {}'))
    assert.throws(() => fixButtonIcon(fixButtonIcon(iconFixture)))
  })
  console.log(JSON.stringify({ status: 'pass', checks: results }, null, 2))
} finally {
  await rm(scratch, { recursive: true, force: true })
}
