// 维护 SVG 源后重建插件 PNG：需本机安装 librsvg（rsvg-convert），运行时/插件构建无此依赖。
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
for (const plugin of ['screenshot', 'recorder']) {
  for (const [name, sizes] of [
    ['icon', [16, 32, 48, 128]],
    ['action', [16, 32]]
  ]) {
    for (const size of sizes) {
      const folder = join(here, plugin, 'icons')
      execFileSync('rsvg-convert', [
        '-w',
        String(size),
        '-h',
        String(size),
        '-o',
        join(folder, `${name}-${size}.png`),
        join(folder, `${name}.svg`)
      ])
    }
  }
}
console.log('截图与录屏插件图标已生成')
