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
  entryPoints: {
    editor: join(here, 'screenshot/src/editor-entry.tsx'),
    result: join(here, 'screenshot/src/result-entry.ts')
  },
  bundle: true,
  platform: 'browser',
  format: 'esm',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"development"' },
  outdir: assets
})
await cp(join(root, 'src/renderer/src/assets/app.css'), join(assets, 'editor.css'))
// 入口自检：产物存在且非空
for (const file of ['editor.js', 'result.js']) {
  const js = await readFile(join(assets, file), 'utf8')
  if (js.length < 1000) throw new Error('截图插件构建文件异常过小: ' + file)
}
console.log('截图插件编辑器bundle已构建：extensions/screenshot/out/')
