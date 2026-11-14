/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-require-imports -- electron-builder 钩子 */
const { cpSync, copyFileSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')
const { execFileSync } = require('node:child_process')

exports.default = async function prepareMacSparkle(context) {
  if (context.electronPlatformName !== 'darwin') return
  const arch = { 1: 'x64', 3: 'arm64' }[context.arch]
  if (!arch) throw new Error('Sparkle 只支持 arm64 / x64')
  const test = context.packager.appInfo.name === 'multi-session-browser-update-test'
  const key = process.env.SPARKLE_PUBLIC_ED_KEY
  if (!key || !/^[A-Za-z0-9+/]{43}=$/.test(key)) throw new Error('缺少有效的 SPARKLE_PUBLIC_ED_KEY')
  const { buildSparkle, sdkRoot } = await import('./build-sparkle.mjs')
  const bridge = buildSparkle(arch)
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  const contents = join(app, 'Contents')
  const resources = join(contents, 'Resources', 'sparkle')
  mkdirSync(resources, { recursive: true })
  cpSync(join(sdkRoot, 'Sparkle.framework'), join(contents, 'Frameworks/Sparkle.framework'), {
    recursive: true,
    verbatimSymlinks: true
  })
  copyFileSync(bridge, join(resources, 'bridge.node'))
  copyFileSync(join(sdkRoot, 'LICENSE'), join(resources, 'LICENSE'))
  const info = join(contents, 'Info.plist')
  const set = (name, type, value) => {
    try {
      execFileSync('/usr/libexec/PlistBuddy', ['-c', `Delete :${name}`, info], { stdio: 'pipe' })
    } catch (error) {
      if (!String(error.stderr).includes('Does Not Exist')) throw error
    }
    execFileSync('/usr/libexec/PlistBuddy', ['-c', `Add :${name} ${type} ${value}`, info])
  }
  set('SUPublicEDKey', 'string', key)
  set(
    'SUFeedURL',
    'string',
    test
      ? `http://127.0.0.1:6185/appcast-${arch}.xml`
      : `https://github.com/PZRvm/multi-session-browser/releases/latest/download/appcast-${arch}.xml`
  )
  set('SUEnableAutomaticChecks', 'bool', 'false')
  set('SUAutomaticallyUpdate', 'bool', 'false')
  set('SUAllowsAutomaticUpdates', 'bool', 'false')
  if (test) {
    set('MSBSparkleTestBuild', 'bool', 'true')
    try {
      execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :NSAppTransportSecurity', info], {
        stdio: 'pipe'
      })
    } catch {
      execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Add :NSAppTransportSecurity dict', info])
    }
    set('NSAppTransportSecurity:NSAllowsLocalNetworking', 'bool', 'true')
  }
  // 所有原生文件已嵌入，再保留既有 UUID、本地化和最终临时签名。
  await require('./patch-mac-display-names.js').default(context)
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app])
}
