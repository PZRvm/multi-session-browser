/* eslint @typescript-eslint/explicit-function-return-type: off -- 独立验证脚本使用原生 JavaScript */
import { parse } from '@babel/parser'
import generator from '@babel/generator'
import { createHash, createPublicKey } from 'node:crypto'
import { readFile, writeFile, mkdir, mkdtemp, cp, rm, rename, readdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import AdmZip from 'adm-zip'
import { inspectCrx, extractCrx, extensionId } from './crx.mjs'

const here = dirname(fileURLToPath(import.meta.url))
export const UPSTREAM_CRX_SHA256 =
  'd92e1122a16362cc5510927068a5b1a8d50b43e1f3be25c3117f7c005807b302'
const hash = (value) => createHash('sha256').update(value).digest('hex')
async function treeHash(root, prefix = '', digest = createHash('sha256')) {
  const entries = (await readdir(root, { withFileTypes: true })).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  )
  for (const entry of entries) {
    demand(!entry.isSymbolicLink(), '修复版目录含符号链接')
    const name = prefix + entry.name
    if (entry.isDirectory()) await treeHash(join(root, entry.name), name + '/', digest)
    else {
      demand(entry.isFile(), '修复版目录含未知条目')
      digest.update(name + '\0').update(hash(await readFile(join(root, entry.name))))
    }
  }
  return prefix === '' ? digest.digest('hex') : digest
}
function demand(ok, message) {
  if (!ok) throw new Error(message)
}
function walk(node, visit) {
  if (!node || typeof node !== 'object') return
  if (typeof node.type === 'string') visit(node)
  for (const [key, value] of Object.entries(node)) {
    if (
      [
        'loc',
        'comments',
        'tokens',
        'leadingComments',
        'trailingComments',
        'innerComments'
      ].includes(key)
    )
      continue
    if (Array.isArray(value)) value.forEach((child) => walk(child, visit))
    else if (value && typeof value === 'object') walk(value, visit)
  }
}

// 只修 ButtonIcon 的 React 元素分支，其他字符串图标保持原有渲染。
export function fixButtonIcon(source) {
  const ast = parse(source, { sourceType: 'script' })
  const functions = []
  walk(ast, (node) => {
    if (node.type === 'FunctionDeclaration' && node.id?.name === 'ButtonIcon_ButtonIcon')
      functions.push(node)
  })
  demand(functions.length === 1, 'ButtonIcon结构改变，拒绝盲目打补丁')
  const targets = []
  walk(functions[0].body, (node) => {
    if (
      node.type !== 'CallExpression' ||
      node.callee.type !== 'MemberExpression' ||
      node.callee.object.type !== 'Identifier' ||
      node.callee.property.name !== 'createElement' ||
      node.arguments[0]?.value !== 'svg'
    )
      return
    node.arguments.forEach((child, index) => {
      if (
        child.type !== 'CallExpression' ||
        child.arguments[0]?.value !== 'path' ||
        child.arguments[1]?.type !== 'ObjectExpression'
      )
        return
      const properties = child.arguments[1].properties
      const d = properties.find((p) => p.key?.name === 'd')
      const fill = properties.find((p) => p.key?.name === 'fill')
      if (d?.value.type === 'Identifier' && fill?.value.value === 'currentColor')
        targets.push({ node, child, index, variable: d.value.name, react: node.callee.object.name })
    })
  })
  demand(targets.length === 1, 'ButtonIcon目标数不符，拒绝应用')
  const { node, child, index, variable, react } = targets[0]
  node.arguments[index] = {
    type: 'ConditionalExpression',
    test: {
      type: 'CallExpression',
      callee: {
        type: 'MemberExpression',
        object: { type: 'Identifier', name: react },
        property: { type: 'Identifier', name: 'isValidElement' },
        computed: false
      },
      arguments: [{ type: 'Identifier', name: variable }]
    },
    consequent: { type: 'Identifier', name: variable },
    alternate: child
  }
  const generate = generator.default ?? generator
  return generate(ast, {
    compact: true,
    comments: true,
    shouldPrintComment: (comment) => !comment.includes('sourceMappingURL')
  }).code
}

export async function buildReactFork(samples, root = join(here, 'out/.artifacts/forks')) {
  const upstream = samples.find((s) => s.name === 'react')
  demand(upstream, '缺少固定原版React样本')
  const bytes = await readFile(upstream.file)
  demand(hash(bytes) === UPSTREAM_CRX_SHA256, '原版包哈希改变，必须重新审阅补丁')
  const inspected = inspectCrx(bytes, upstream.id)
  demand(inspected.manifest.version === '8.0.0', '只支持原版8.0.0')
  const source = inspected.zip.getEntry('build/main.js').getData().toString('utf8')
  const patched = fixButtonIcon(source)
  const key = createPublicKey(
    await readFile(join(here, 'vendor/react-devtools-fork-public.pem'))
  ).export({ type: 'spki', format: 'der' })
  const id = extensionId(key)
  const destination = join(root, `${id}-8.0.0.1-${hash(patched).slice(0, 12)}`)
  await mkdir(root, { recursive: true })
  const stage = await mkdtemp(join(root, '.building-'))
  try {
    const extracted = await extractCrx(bytes, join(stage, 'source'), upstream.id)
    const fork = join(stage, 'fork')
    await cp(extracted.path, fork, { recursive: true })
    await rm(join(fork, '_metadata'), { recursive: true, force: true })
    await rm(join(fork, '.preflight-package.json'), { force: true })
    await rm(join(fork, 'build/main.js.map'), { force: true })
    await writeFile(join(fork, 'build/main.js'), patched)
    const manifest = {
      ...inspected.manifest,
      name: 'React Developer Tools (MSB SVG Fix)',
      short_name: 'React DevTools MSB',
      version: '8.0.0.1',
      version_name: '8.0.0 + MSB SVG fix 1',
      key: key.toString('base64')
    }
    delete manifest.update_url
    await writeFile(join(fork, 'manifest.json'), JSON.stringify(manifest, null, 2))
    const metadata = {
      name: 'react',
      variant: 'msb-svg-fix',
      id,
      version: manifest.version,
      path: destination,
      upstream: {
        id: upstream.id,
        version: '8.0.0',
        sha256: hash(bytes),
        source: upstream.source,
        revision: '1d34f91dfd',
        mainSha256: hash(source)
      },
      patchedMainSha256: hash(patched),
      manifestSha256: hash(JSON.stringify(manifest, null, 2))
    }
    await writeFile(join(fork, 'MSB-FORK.json'), JSON.stringify(metadata, null, 2))
    await writeFile(
      join(fork, 'LICENSE-MSB-REACT'),
      await readFile(join(here, 'vendor/REACT-LICENSE'))
    )
    await writeFile(
      join(fork, 'MSB-FORK.md'),
      '# Independently maintained SVG fix\n\nBased on React Developer Tools 8.0.0, revision 1d34f91dfd, MIT. This is not the official Chrome Web Store package. Original publisher is Meta Platforms, Inc. and affiliates. The sole code change renders an existing React SVG node directly instead of using it as a path string. Original download and checksums are retained in MSB-FORK.json. Automatic upstream updates are disabled. Reproduce with tools/extension-preflight/react-fork.mjs in the MSB repository.\n'
    )
    try {
      await rename(fork, destination)
    } catch (error) {
      if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error
      demand((await treeHash(destination)) === (await treeHash(fork)), '现有修复版被修改，拒绝复用')
    }
    const zip = new AdmZip()
    zip.addLocalFolder(destination)
    for (const entry of zip.getEntries()) entry.header.time = new Date(2026, 0, 1)
    await writeFile(`${destination}.zip`, zip.toBuffer())
    await writeFile(
      join(root, 'latest.json'),
      JSON.stringify({ ...metadata, zip: `${destination}.zip` }, null, 2)
    )
    return { ...metadata, zip: `${destination}.zip` }
  } finally {
    await rm(stage, { recursive: true, force: true })
  }
}
