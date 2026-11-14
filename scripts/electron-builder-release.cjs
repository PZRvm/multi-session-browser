/* eslint-disable @typescript-eslint/no-require-imports -- electron-builder CJS 配置入口 */
// 正式 CI 唯一打包入口：缺材料直接失败，本地默认配置仍可临时签名验证界面。
const { readFileSync } = require('node:fs')
const { load } = require('js-yaml')
const config = load(readFileSync('electron-builder.yml', 'utf8'))
const { readVersionReleaseNotes } = require('./release-notes.cjs')
const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
config.releaseInfo = { releaseNotes: readVersionReleaseNotes(version) }
if (process.platform === 'darwin') {
  for (const key of ['SPARKLE_PUBLIC_ED_KEY', 'SPARKLE_PRIVATE_KEY']) {
    if (!process.env[key]) throw new Error(`正式 macOS 构建缺少 ${key}`)
  }
  config.mac.identity = null
  config.mac.notarize = false
}
module.exports = config
