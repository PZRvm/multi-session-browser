/* eslint-disable @typescript-eslint/explicit-function-return-type -- Node 发布工具 */
import { createPrivateKey, createPublicKey, verify } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { prepareSparkleSdk, sdkRoot, sparklePin } from './build-sparkle.mjs'
const AdmZip = createRequire(import.meta.url)('adm-zip')
const { readVersionReleaseNotes } = createRequire(import.meta.url)('./release-notes.cjs')
export const releaseBase = 'https://github.com/PZRvm/multi-session-browser/releases/download'
export function publicKey(value = process.env.SPARKLE_PUBLIC_ED_KEY) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value))
    throw new Error('缺少有效的 SPARKLE_PUBLIC_ED_KEY')
  return createPublicKey({
    key: Buffer.concat([
      Buffer.from('302a300506032b6570032100', 'hex'),
      Buffer.from(value, 'base64')
    ]),
    type: 'spki',
    format: 'der'
  })
}
export function validateSigningKeys() {
  const seed = process.env.SPARKLE_PRIVATE_KEY
  if (!seed || !/^[A-Za-z0-9+/]{43}=$/.test(seed))
    throw new Error('SPARKLE_PRIVATE_KEY 必须为 Sparkle 的 32 字节 Ed25519 seed（Base64）')
  const key = createPrivateKey({
    key: Buffer.concat([
      Buffer.from('302e020100300506032b657004220420', 'hex'),
      Buffer.from(seed, 'base64')
    ]),
    type: 'pkcs8',
    format: 'der'
  })
  if (
    !createPublicKey(key)
      .export({ type: 'spki', format: 'der' })
      .equals(publicKey().export({ type: 'spki', format: 'der' }))
  )
    throw new Error('Sparkle 私钥与构建公钥不匹配')
}
function xml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]
  )
}
function names(name, version, arch, base) {
  if (
    !/^[a-z0-9-]+$/.test(name) ||
    !/^\d+\.\d+\.\d+$/.test(version) ||
    !['arm64', 'x64'].includes(arch)
  )
    throw new Error('无效的 appcast 版本、名称或架构')
  return {
    archive: `${name}-${version}-mac-${arch}.zip`,
    notes: `release-notes-v${version}.md`,
    url: base || `${releaseBase}/v${version}`
  }
}
export function renderAppcast({ name, version, arch, length, signature, date, base }) {
  const n = names(name, version, arch, base)
  return `<?xml version="1.0" encoding="utf-8"?>\n<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">\n  <channel>\n    <title>${xml(name)}</title>\n    <item>\n      <title>${xml(version)}</title>\n      <pubDate>${xml(date)}</pubDate>\n      <sparkle:version>${xml(version)}</sparkle:version>\n      <sparkle:shortVersionString>${xml(version)}</sparkle:shortVersionString>\n      <sparkle:minimumSystemVersion>${xml(sparklePin.deploymentTarget)}</sparkle:minimumSystemVersion>\n      <sparkle:releaseNotesLink>${xml(n.url + '/' + n.notes)}</sparkle:releaseNotesLink>\n      <enclosure url="${xml(n.url + '/' + n.archive)}" length="${length}" type="application/octet-stream" sparkle:edSignature="${signature}" />\n    </item>\n  </channel>\n</rss>\n`
}
// 仅接受本项目生成的单版本规范格式；逐字重建比较拒绝实体、额外条目、重复字段与任意 URL。
export function validateAppcast(directory, name, version, arch, { base, key } = {}) {
  const text = readFileSync(join(directory, `appcast-${arch}.xml`), 'utf8')
  if (text.length > 8192) throw new Error('appcast 过大')
  const signature = text.match(/sparkle:edSignature="([A-Za-z0-9+/]{86}==)"/)?.[1]
  const length = text.match(/length="([1-9]\d*)"/)?.[1]
  const date = text.match(/<pubDate>([^<]+)<\/pubDate>/)?.[1]
  if (
    !signature ||
    !length ||
    !date ||
    !Number.isFinite(Date.parse(date)) ||
    text !== renderAppcast({ name, version, arch, length, signature, date, base })
  )
    throw new Error(`appcast 格式、版本或 URL 不符：${arch}`)
  const bytes = readFileSync(join(directory, names(name, version, arch, base).archive))
  if (
    bytes.length !== Number(length) ||
    !verify(null, bytes, publicKey(key), Buffer.from(signature, 'base64'))
  )
    throw new Error(`Sparkle 归档大小或 EdDSA 签名不符：${arch}`)
}
export function validateArchive(file, version, arch, base) {
  const zip = new AdmZip(file)
  const infos = zip
    .getEntries()
    .filter((entry) => /^[^/]+\.app\/Contents\/Info\.plist$/.test(entry.entryName))
  if (infos.length !== 1) throw new Error('更新 ZIP 必须包含唯一的顶层应用包')
  const plist = infos[0].getData()
  const get = (key) =>
    execFileSync('plutil', ['-extract', key, 'raw', '-o', '-', '-'], {
      input: plist,
      encoding: 'utf8'
    }).trim()
  const feed = base
    ? `${base}/appcast-${arch}.xml`
    : `https://github.com/PZRvm/multi-session-browser/releases/latest/download/appcast-${arch}.xml`
  if (
    get('CFBundleVersion') !== version ||
    get('CFBundleShortVersionString') !== version ||
    get('LSMinimumSystemVersion') !== sparklePin.deploymentTarget ||
    get('SUPublicEDKey') !== process.env.SPARKLE_PUBLIC_ED_KEY ||
    get('SUFeedURL') !== feed
  )
    throw new Error('归档应用版本、公钥或 feed 与签名目标不一致')
  for (const flag of [
    'SUEnableAutomaticChecks',
    'SUAutomaticallyUpdate',
    'SUAllowsAutomaticUpdates'
  ]) {
    if (get(flag) !== 'false') throw new Error('归档含未授权的自动更新策略')
  }
  const executable = get('CFBundleExecutable')
  if (!executable || /[/\\]/.test(executable)) throw new Error('无效的主程序路径')
  const binaryEntry = zip.getEntry(infos[0].entryName.replace('Info.plist', `MacOS/${executable}`))
  if (!binaryEntry) throw new Error('归档缺少主程序')
  const binary = binaryEntry.getData()
  if (
    binary.length < 8 ||
    binary.readUInt32LE(0) !== 0xfeedfacf ||
    binary.readUInt32LE(4) !== (arch === 'arm64' ? 0x100000c : 0x1000007)
  )
    throw new Error('归档主程序架构不匹配')
}
export function generateAppcast(directory, name, version, arch, { base, notes } = {}) {
  validateSigningKeys()
  prepareSparkleSdk()
  const n = names(name, version, arch, base)
  const file = join(directory, n.archive)
  validateArchive(file, version, arch, base)
  // 私钥只走 stdin；不读写 Keychain，不出现在参数、产物或日志中。
  const signature = execFileSync(
    join(sdkRoot, 'bin/sign_update'),
    ['--ed-key-file', '-', '-p', file],
    {
      input: process.env.SPARKLE_PRIVATE_KEY + '\n',
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    }
  ).trim()
  const body = notes ?? readVersionReleaseNotes(version)
  if (!body.trim() || body.length > 12000) throw new Error('版本更新日志为空或过长')
  writeFileSync(join(directory, n.notes), body)
  writeFileSync(
    join(directory, `appcast-${arch}.xml`),
    renderAppcast({
      name,
      version,
      arch,
      length: readFileSync(file).length,
      signature,
      date: new Date().toUTCString(),
      base
    })
  )
  validateAppcast(directory, name, version, arch, { base })
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [directory = 'dist', arch = process.arch] = process.argv.slice(2)
  const { name, version } = JSON.parse(readFileSync('package.json', 'utf8'))
  generateAppcast(directory, name, version, arch)
}
