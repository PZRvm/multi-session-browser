// 插件构建：esbuild 把截图插件编辑器页打包为静态 assets（录屏插件纯静态文件无需构建）。
// 产物不入库：extensions/screenshot/out/ 在仓库 .gitignore 中。
import { readFile, mkdir, cp } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const assets = join(here, 'screenshot/out')
await mkdir(assets, { recursive: true })
const esbuild = createRequire(join(root, 'package.json'))('esbuild')
await esbuild.build({
  entryPoints: [join(here, 'screenshot/src/editor-entry.tsx')],
  bundle: true,
  platform: 'browser',
  format: 'esm',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"development"' },
  outfile: join(assets, 'editor.js')
})
await cp(join(root, 'src/renderer/src/assets/app.css'), join(assets, 'editor.css'))
// 入口自检：产物存在且非空
const js = await readFile(join(assets, 'editor.js'), 'utf8')
if (js.length < 1000) throw new Error('编辑器bundle异常过小')
console.log('截图插件编辑器bundle已构建：extensions/screenshot/out/')
