/* eslint @typescript-eslint/explicit-function-return-type: off -- 独立验证脚本使用原生 JavaScript */
import { createServer } from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
const here = dirname(fileURLToPath(import.meta.url)),
  root = join(here, '../..')
export async function startEditorSite(imageFile) {
  const output = join(here, 'out/.artifacts/editor-build')
  await mkdir(output, { recursive: true })
  const { build } = createRequire(join(root, 'package.json'))('esbuild')
  await build({
    entryPoints: [join(here, 'editor-fixture.tsx')],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' },
    outfile: join(output, 'editor.js'),
    alias: { '@renderer': join(root, 'src/renderer/src') }
  })
  const routes = new Map([
    ['/editor.js', [await readFile(join(output, 'editor.js')), 'text/javascript']],
    ['/editor.css', [await readFile(join(output, 'editor.css')), 'text/css']],
    ['/source.png', [await readFile(imageFile), 'image/png']]
  ])
  const html =
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Chrome编辑适配验证</title><link rel="stylesheet" href="/editor.css"></head><body><div id="root"></div><script type="module" src="/editor.js"></script></body></html>'
  const server = createServer((req, res) => {
    const value = routes.get(req.url)
    res.setHeader('Content-Type', value?.[1] ?? 'text/html; charset=utf-8')
    res.end(value?.[0] ?? html)
  })
  await new Promise((ok, no) => {
    server.once('error', no)
    server.listen(0, '127.0.0.1', ok)
  })
  return {
    url: 'http://localhost:' + server.address().port,
    close: () => new Promise((ok) => server.close(ok))
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  console.log((await startEditorSite(process.argv[2])).url)
