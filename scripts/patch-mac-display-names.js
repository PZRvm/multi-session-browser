// macOS 本地化展示名注入（electron-builder afterPack 钩子，2026-09-18 用户裁决）：
// 在 <app>.app/Contents/Resources 下写 <lang>.lproj/InfoPlist.strings，系统按用户
// 语言偏好自动挑选 Dock/菜单栏显示名——运行期零介入。名称契约单源
// src/shared/appDisplay.ts（本表与其对账，改名两处同步；electron-builder.yml 的
// productName 为无匹配语言时的兜底名）。仅 darwin 生效；动态 import 而非 require
//（本包为 CJS，钩子 async 内动态导入与 lint 规则两全）
const LOCALIZED_DISPLAY_NAMES = {
  zh_CN: '多会话浏览器',
  zh_TW: '多會話瀏覽器',
  en: 'Multi-session Browser'
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const { default: fs } = await import('node:fs')
  const { default: path } = await import('node:path')
  const appName = `${context.packager.appInfo.productFilename}.app`
  const resourcesDir = path.join(context.appOutDir, appName, 'Contents', 'Resources')
  for (const [lproj, name] of Object.entries(LOCALIZED_DISPLAY_NAMES)) {
    const lprojDir = path.join(resourcesDir, `${lproj}.lproj`)
    fs.mkdirSync(lprojDir, { recursive: true })
    // InfoPlist.strings 传统格式键对：modern macOS 接受 UTF-8 编码的 .strings 文件
    const content = `"CFBundleDisplayName" = "${name}";\n`
    fs.writeFileSync(path.join(lprojDir, 'InfoPlist.strings'), content)
  }
  const count = Object.keys(LOCALIZED_DISPLAY_NAMES).length
  console.log(`[patch-mac-display-names] 已注入 ${count} 组本地化展示名 -> ${appName}`)
}
