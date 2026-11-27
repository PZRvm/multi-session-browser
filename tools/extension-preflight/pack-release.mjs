/* eslint @typescript-eslint/explicit-function-return-type: off -- 发布打包脚本直接由 Node 执行 */
/**
 * 自研插件发布打包（2026-11-13，Release 附件配置化调研定稿：CI 现场打包 + 独立工作流
 * 发布——CRX 与应用版本解耦，不是每次应用发版都带 CRX）。
 *
 * 用法：node tools/extension-preflight/pack-release.mjs <插件源目录> <pem 路径> <输出 .crx> [Chrome 解包 .zip]
 * 流程：源目录 zip（保留页面引用的 bundle，剔除 dotfiles）→ CRX2 签名（复用 crx.mjs 单源，
 * sha1 头 + pem 公钥——ID 由 pem 派生，与 Chrome --pack-extension 的 CRX3 同 ID，
 * 升级路径兼容）→ inspectCrx 自验（验签 + ID 对账）→ 打印 JSON（id/version/sha256）。
 * PEM 绝不入库、绝不出现在产物目录；CI 侧经 Secrets 注入临时文件，步末清理。
 */
import { createHash } from 'node:crypto'
import { createPublicKey, createPrivateKey } from 'node:crypto'
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import AdmZip from 'adm-zip'
import { makeCrx2, inspectCrx, extensionId } from './crx.mjs'

const [srcDir, pemPath, outPath, chromeZipPath] = process.argv.slice(2)
if (!srcDir || !pemPath || !outPath) {
  throw new Error('用法：node tools/extension-preflight/pack-release.mjs <源目录> <pem> <输出.crx> [解包.zip]')
}

/** 递归收集相对路径（跳过 dotfiles，保留页面引用的 bundle） */
function walk(dir, base = dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'out' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    const rel = relative(base, full).split('\\').join('/')
    if (statSync(full).isDirectory()) walk(full, base, acc)
    else acc.push(rel)
  }
  return acc
}

const files = walk(srcDir)
const manifest = JSON.parse(readFileSync(join(srcDir, 'manifest.json'), 'utf8'))
const assets = new Set(files)
for (const page of ['editor.html', 'result.html'].filter((name) => assets.has(name))) {
  const html = readFileSync(join(srcDir, page), 'utf8')
  for (const [, asset] of html.matchAll(/(?:src|href)="(out\/[a-zA-Z0-9._-]+)"/g)) {
    if (!statSync(join(srcDir, asset), { throwIfNoEntry: false })?.isFile())
      throw new Error(page + ' 缺少构建文件 ' + asset)
    assets.add(asset)
  }
}

// 目录 zip：路径用 posix 分隔（CRX 解包跨平台一致）
const zip = new AdmZip()
for (const rel of assets) zip.addFile(rel, readFileSync(join(srcDir, rel)))
const zipBuffer = zip.toBuffer()

const pemText = readFileSync(pemPath, 'utf8')
const publicKey = createPublicKey(pemText)
const privateKey = createPrivateKey(pemText)
// extensionId 收 DER SPKI（与 makeCrx2 头内公钥同形态）
const publicDer = publicKey.export({ type: 'spki', format: 'der' })
const expectedId = extensionId(publicDer)

const crx = makeCrx2(zipBuffer, publicKey, privateKey)

// 自验：验签 + ID 对账 + manifest 版本一致（防 pem 拿错/源目录拿错）
const inspected = inspectCrx(crx)
if (inspected.id !== expectedId) {
  throw new Error(`CRX 自验失败：ID ${inspected.id} 与 pem 派生 ID ${expectedId} 不一致`)
}
if (inspected.manifest.version !== manifest.version) {
  throw new Error(
    `CRX 自验失败：manifest 版本 ${inspected.manifest.version} ≠ 源 ${manifest.version}`
  )
}

mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, crx)

if (chromeZipPath) {
  // 解压后在普通 Chrome 加载，使用正式签名公钥保持扩展 ID。
  manifest.key = publicDer.toString('base64')
  zip.updateFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n'))
  mkdirSync(dirname(chromeZipPath), { recursive: true })
  writeFileSync(chromeZipPath, zip.toBuffer())
}

const digest = createHash('sha256').update(crx).digest('hex')
console.log(
  JSON.stringify(
    {
      name: `${manifest.name}`,
      id: inspected.id,
      version: manifest.version,
      file: outPath,
      bytes: crx.length,
      sha256: digest
    },
    null,
    2
  )
)
