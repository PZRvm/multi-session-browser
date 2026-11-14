/* eslint @typescript-eslint/explicit-function-return-type: off -- 固定版本依赖补丁 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// 上游 MIT 许可保持不变；仅适配 4.10.0 的构造注册行为，升级必须重新核验。
const marker = 'MSB_FILTERED_PRELOAD_REQUIRED'
const anchor = '    checkVersion();'
const call = '    this.prependPreload(opts.modulePath);'
const preflight = `${anchor}
    // MSB：宿主先受限注册，再构造引擎；不允许库短暂注册无过滤 preload。
    const msbPreloads = session2.getPreloadScripts();
    if (![['crx-mv2-preload', 'frame'], ['crx-mv3-preload', 'service-worker']].every(([id, type]) =>
      msbPreloads.some(s => s.id === id && s.type === type &&
        s.includeGlobs?.length === 1 && s.includeGlobs[0] === 'chrome-extension://*/*')
    )) throw new Error('${marker}');`
const disabled = '    // MSB：preload 已由宿主注册，禁止重复或无过滤注册。'

export function patchSource(source) {
  if (source.includes(marker)) {
    if (!source.includes(preflight) || !source.includes(disabled) || source.includes(call)) {
      throw new Error('扩展注册补丁不完整，请重新安装依赖并核验')
    }
    return source
  }
  if (source.split(anchor).length !== 2 || source.split(call).length !== 2) {
    throw new Error('扩展库注册锚点已变化，请重新核验补丁')
  }
  return source.replace(anchor, preflight).replace(call, disabled)
}

export function patchExtensionPreloads() {
  const require = createRequire(import.meta.url)
  const entry = require.resolve('electron-chrome-extensions')
  const root = dirname(dirname(dirname(entry)))
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  if (pkg.version !== '4.10.0') throw new Error('扩展注册补丁仅适配 4.10.0，请先核验新版本')
  // 两个入口先全部校验，避免第二个失败时已写入半套补丁。
  const files = ['dist/cjs/index.js', 'dist/esm/index.mjs'].map((file) => {
    const path = join(root, file)
    const original = readFileSync(path, 'utf8')
    return { path, original, patched: patchSource(original) }
  })
  for (const file of files) {
    if (file.original !== file.patched) writeFileSync(file.path, file.patched)
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  patchExtensionPreloads()
  console.log('扩展 preload 注册补丁已核验（4.10.0，CJS/ESM）')
}
