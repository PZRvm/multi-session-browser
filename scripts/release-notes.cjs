/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type -- Node发布工具 */
// 每个正式版本的产品说明唯一来源；同名跨月重复时拒绝猜测。
const { readFileSync, readdirSync } = require('node:fs')
const { join } = require('node:path')
const MAX_NOTES = 12000
function readVersionReleaseNotes(version, root = process.cwd()) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error('更新日志需要稳定版本号')
  }
  const base = join(root, 'book/changelogs')
  const file = `release-notes-v${version}.md`
  const matches = readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}$/.test(entry.name))
    .map((entry) => join(base, entry.name, file))
    .filter((path) => {
      try {
        readFileSync(path)
        return true
      } catch (error) {
        if (error.code === 'ENOENT') return false
        throw error
      }
    })
  if (matches.length !== 1)
    throw new Error(`版本 ${version} 需要唯一的 ${file}，当前找到 ${matches.length} 份`)
  const text = readFileSync(matches[0], 'utf8')
    .replace(/^\uFEFF/, '')
    .replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '')
    .replace(/\r\n?/g, '\n')
    .trim()
  if (!text || text.length > MAX_NOTES)
    throw new Error(`版本 ${version} 的更新日志必须为1—${MAX_NOTES}字符`)
  return text
}
module.exports = { readVersionReleaseNotes }
