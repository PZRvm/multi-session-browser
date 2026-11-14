/* eslint-disable @typescript-eslint/explicit-function-return-type -- Node 发布工具 */
import { createHash } from 'node:crypto'
import { copyFileSync, lstatSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { validateAppcast } from './sparkle-appcast.mjs'
const { load } = createRequire(import.meta.url)('js-yaml')

function metadata(directory, file, version) {
  const data = load(readFileSync(join(directory, file), 'utf8'))
  if (data?.version !== version || !Array.isArray(data.files) || !data.files.length) {
    throw new Error(`更新清单版本或 files 错误：${file}`)
  }
  for (const entry of data.files) {
    if (
      typeof entry.url !== 'string' ||
      basename(entry.url) !== entry.url ||
      /[?#%\\]/.test(entry.url)
    ) {
      throw new Error(`更新清单 URL 非法：${file}`)
    }
    const path = join(directory, entry.url)
    const stat = lstatSync(path)
    const hash = createHash('sha512').update(readFileSync(path)).digest('base64')
    if (!stat.isFile() || stat.size === 0 || stat.size !== entry.size || hash !== entry.sha512) {
      throw new Error(`更新附件大小或 SHA-512 不符：${entry.url}`)
    }
  }
  if (
    data.path &&
    !data.files.some((entry) => entry.url === data.path && entry.sha512 === data.sha512)
  ) {
    throw new Error(`兼容字段与 files 不一致：${file}`)
  }
  return data
}

export function validateUpdateAssets(directory, name, version, expectedNotes) {
  const win = metadata(directory, 'latest.yml', version)
  const notes = readFileSync(join(directory, `release-notes-v${version}.md`), 'utf8')
  if (!notes.trim() || notes.length > 12000 || notes !== win.releaseNotes)
    throw new Error('各平台更新日志缺失、超长或不一致')
  if (expectedNotes !== undefined && notes !== expectedNotes)
    throw new Error('更新清单与版本Markdown日志不一致')
  for (const arch of ['arm64', 'x64']) validateAppcast(directory, name, version, arch)
  if (win.files.length !== 1 || win.files[0].url !== `${name}-${version}-win-x64-setup.exe`)
    throw new Error('缺少或多余 Windows 更新 EXE')
  const required = [
    `${name}-${version}-mac-arm64.dmg`,
    `${name}-${version}-mac-x64.dmg`,
    `${name}-${version}-mac-arm64.zip`,
    `${name}-${version}-mac-x64.zip`,
    `${name}-${version}-win-x64-setup.exe`,
    'latest.yml',
    'appcast-arm64.xml',
    'appcast-x64.xml',
    `release-notes-v${version}.md`
  ]
  const optional = required.filter((file) => /\.exe$/.test(file)).map((file) => `${file}.blockmap`)
  for (const file of required) {
    const stat = lstatSync(join(directory, file))
    if (!stat.isFile() || stat.size === 0) throw new Error(`附件为空：${file}`)
  }
  const all = readdirSync(directory)
  const extra = all.filter(
    (file) => !required.includes(file) && !optional.includes(file) && file !== 'SHA256SUMS.txt'
  )
  if (extra.length) throw new Error(`发布目录包含意外文件：${extra.join('、')}`)
  return [...required, ...optional.filter((file) => all.includes(file))]
}

/** artifact 按架构分目录；每份 feed 先验签，重复日志必须正文完全一致。 */
export function prepareUpdateAssets(input, output, name, version) {
  mkdirSync(output, { recursive: true })
  for (const folder of ['installer-mac-arm64', 'installer-mac-x64', 'installer-win-x64']) {
    const directory = join(input, folder)
    const arch = folder.endsWith('arm64') ? 'arm64' : 'x64'
    const isMac = folder.includes('-mac-')
    const notes = `release-notes-v${version}.md`
    const allowed = isMac
      ? [
          `${name}-${version}-mac-${arch}.zip`,
          `${name}-${version}-mac-${arch}.dmg`,
          `appcast-${arch}.xml`,
          notes
        ]
      : [
          `${name}-${version}-win-x64-setup.exe`,
          `${name}-${version}-win-x64-setup.exe.blockmap`,
          'latest.yml'
        ]
    for (const asset of allowed.filter((file) => !file.endsWith('.blockmap'))) {
      if (!lstatSync(join(directory, asset)).isFile()) throw new Error(`缺少普通附件：${asset}`)
    }
    if (isMac) validateAppcast(directory, name, version, arch)
    else metadata(directory, 'latest.yml', version)
    for (const asset of readdirSync(directory)) {
      if (!allowed.includes(asset)) throw new Error(`意外 artifact：${asset}`)
      const target = join(output, asset)
      if (readdirSync(output).includes(asset)) {
        if (asset === notes && readFileSync(target).equals(readFileSync(join(directory, asset))))
          continue
        throw new Error(`重复 artifact 或日志不一致：${asset}`)
      }
      if (!lstatSync(join(directory, asset)).isFile()) throw new Error(`附件不是普通文件：${asset}`)
      copyFileSync(join(directory, asset), target)
    }
  }
  return validateUpdateAssets(output, name, version)
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [input, output] = process.argv.slice(2)
  const { name, version } = JSON.parse(readFileSync('package.json', 'utf8'))
  if (!input || !output)
    throw new Error('用法：node scripts/update-assets.mjs <artifact目录> <输出目录>')
  prepareUpdateAssets(input, output, name, version)
}
