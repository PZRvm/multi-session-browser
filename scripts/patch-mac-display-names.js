// macOS 本地网络权限按主程序 LC_UUID 反查应用，Electron 预编译启动器的 UUID
// 被同版本应用共用，可能导致权限串用、内网报 -109；按 appId + CPU 派生稳定 UUID。
// 依据：https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy
/* eslint-disable @typescript-eslint/explicit-function-return-type -- Mach-O 处理为原生 JS，无 TS 返回类型语法 */
function patchMacAppUuid(binary, appId, createHash) {
  if (typeof appId !== 'string' || !appId.trim()) throw new Error('应用 appId 不能为空')
  const patches = []

  function inspectSlice(start, size) {
    if (start < 0 || size < 32 || start + size > binary.length) {
      throw new Error('Mach-O 切片越界或头部不完整')
    }
    const magic = binary.readUInt32LE(start)
    if (magic !== 0xfeedfacf && magic !== 0xcffaedfe) {
      throw new Error('不支持的 Mach-O 头部，预期 64 位启动器')
    }
    const read = (offset) =>
      magic === 0xfeedfacf ? binary.readUInt32LE(offset) : binary.readUInt32BE(offset)
    const commandsEnd = start + 32 + read(start + 20)
    const count = read(start + 16)
    if (commandsEnd > start + size || count > (commandsEnd - start - 32) / 8) {
      throw new Error('Mach-O 加载命令越界')
    }
    let cursor = start + 32
    let uuidOffset
    for (let i = 0; i < count; i++) {
      if (cursor + 8 > commandsEnd) throw new Error('Mach-O 加载命令头部不完整')
      const command = read(cursor)
      const commandSize = read(cursor + 4)
      if (commandSize < 8 || cursor + commandSize > commandsEnd) {
        throw new Error('Mach-O 加载命令长度非法')
      }
      if (command === 0x1b) {
        if (commandSize !== 24 || uuidOffset !== undefined) {
          throw new Error('Mach-O LC_UUID 长度非法或重复')
        }
        uuidOffset = cursor + 8
      }
      cursor += commandSize
    }
    if (uuidOffset === undefined || cursor !== commandsEnd) {
      throw new Error('Mach-O 缺少 LC_UUID 或加载命令长度不一致')
    }
    // UUID v5（DNS 命名空间）：同应用同架构跨构建保持稳定，异应用不共用。
    const uuid = createHash('sha1')
      .update(Buffer.from('6ba7b8109dad11d180b400c04fd430c8', 'hex'))
      .update(`${appId}:${read(start + 4)}:${read(start + 8)}`)
      .digest()
      .subarray(0, 16)
    uuid[6] = (uuid[6] & 0x0f) | 0x50
    uuid[8] = (uuid[8] & 0x3f) | 0x80
    patches.push({ offset: uuidOffset, uuid })
  }

  if (binary.length < 4) throw new Error('Mach-O 文件不完整')
  const magic = binary.readUInt32BE(0)
  if ([0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca].includes(magic)) {
    const littleEndian = magic === 0xbebafeca || magic === 0xbfbafeca
    const fat64 = magic === 0xcafebabf || magic === 0xbfbafeca
    const read = (offset) =>
      littleEndian ? binary.readUInt32LE(offset) : binary.readUInt32BE(offset)
    if (binary.length < 8) throw new Error('Universal Mach-O 头部不完整')
    const count = read(4)
    const entrySize = fat64 ? 32 : 20
    const tableEnd = 8 + count * entrySize
    if (count === 0 || tableEnd > binary.length) throw new Error('Universal Mach-O 架构表非法')
    const ranges = []
    for (let i = 0; i < count; i++) {
      const entry = 8 + i * entrySize
      const readSize = (offset) => {
        if (!fat64) return read(offset)
        const value = littleEndian ? binary.readBigUInt64LE(offset) : binary.readBigUInt64BE(offset)
        if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Mach-O 切片长度超限')
        return Number(value)
      }
      const start = readSize(entry + 8)
      const size = readSize(entry + (fat64 ? 16 : 12))
      if (start < tableEnd || ranges.some(([a, b]) => start < b && start + size > a)) {
        throw new Error('Mach-O 切片与架构表或其他切片重叠')
      }
      inspectSlice(start, size)
      ranges.push([start, start + size])
    }
  } else {
    inspectSlice(0, binary.length)
  }
  // 全部校验通过才改写，避免非法 Universal 文件被部分修改。
  for (const { offset, uuid } of patches) uuid.copy(binary, offset)
  return patches.length
}

/* eslint-enable @typescript-eslint/explicit-function-return-type */

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
  const { execFileSync } = await import('node:child_process')
  const { createHash } = await import('node:crypto')
  const appName = `${context.packager.appInfo.productFilename}.app`
  const contentsDir = path.join(context.appOutDir, appName, 'Contents')
  const executable = path.join(contentsDir, 'MacOS', context.packager.appInfo.productFilename)
  const binary = fs.readFileSync(executable)
  const slices = patchMacAppUuid(binary, context.packager.appInfo.id, createHash)
  fs.writeFileSync(executable, binary)
  console.log(`[patch-mac-app-uuid] 已为 ${appName} 的 ${slices} 个架构写入独立稳定 UUID`)
  const resourcesDir = path.join(contentsDir, 'Resources')
  for (const [lproj, name] of Object.entries(LOCALIZED_DISPLAY_NAMES)) {
    const lprojDir = path.join(resourcesDir, `${lproj}.lproj`)
    fs.mkdirSync(lprojDir, { recursive: true })
    // InfoPlist.strings 传统格式键对：modern macOS 接受 UTF-8 编码的 .strings 文件
    const content = `"CFBundleDisplayName" = "${name}";\n`
    fs.writeFileSync(path.join(lprojDir, 'InfoPlist.strings'), content)
  }
  // 修改 LC_UUID/本地化资源后刷新临时签名（含 Helper），保证无证书、本地打包
  // 跳过后续签名时仍为完整有效的应用；正式证书签名仍由 builder 后续覆盖。
  execFileSync('/usr/bin/codesign', [
    '--force',
    '--deep',
    '--sign',
    '-',
    path.join(context.appOutDir, appName)
  ])
  const count = Object.keys(LOCALIZED_DISPLAY_NAMES).length
  console.log(`[patch-mac-display-names] 已注入 ${count} 组本地化展示名 -> ${appName}`)
}
