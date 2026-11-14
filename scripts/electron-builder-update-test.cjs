/* eslint-disable @typescript-eslint/no-require-imports -- electron-builder CJS 配置入口 */
const { readFileSync } = require('node:fs')
const { load } = require('js-yaml')
const config = load(readFileSync('electron-builder.yml', 'utf8'))
const version = process.env.MSB_UPDATE_TEST_VERSION
if (!/^90\.0\.[12]$/.test(version || '')) throw new Error('测试包版本仅允许 90.0.1 / 90.0.2')
config.directories.output = `dist/update-test/${version}`
config.extraMetadata = { version, name: 'multi-session-browser-update-test' }
config.releaseInfo = {
  releaseNotes: readFileSync(
    `tools/update-test/fixtures/release-notes-${version}.md`,
    'utf8'
  ).trim()
}
// 测试包复用 npm 已安装的同版本 Electron，避免重复下载造成非业务失败。
config.electronDist = 'node_modules/electron/dist'
config.publish = { provider: 'generic', url: 'http://127.0.0.1:6185/' }
// 本地验收不自动选开发证书逐文件联网签名；afterPack 已刷新临时签名。
config.mac.identity = null
// 更新下载使用 ZIP，低版本直接从解包 .app 启动，无需额外生成 DMG。
config.mac.target = ['zip']
module.exports = config
