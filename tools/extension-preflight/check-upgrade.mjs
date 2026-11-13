/* eslint @typescript-eslint/explicit-function-return-type: off -- 独立验证脚本 */
import { createRequire } from 'node:module'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { readBoundedResponse, inspectVendorZip } from './vendor-zip.mjs'
const here = dirname(fileURLToPath(import.meta.url)),
  root = createRequire(join(here, '../../package.json'))
const output = join(here, 'out/.artifacts/upgrade-' + Date.now())
await mkdir(output, { recursive: true })
const source =
  'https://github.com/darkreader/darkreader/releases/download/v4.9.134/darkreader-chrome-mv3.zip'
const response = await fetch(source, { signal: AbortSignal.timeout(30000) })
const bytes = await readBoundedResponse(response)
const zip = inspectVendorZip(
  bytes,
  '40402188ad23154a1b8fa094171f2b6908209ed6673ccf58276b75ce661acfaf'
)
await writeFile(join(output, 'vendor-4.9.134.zip'), bytes)
const samples = JSON.parse(
  await readFile(join(here, 'out/.artifacts/samples/samples.json'), 'utf8')
).samples
const current = samples.find((s) => s.name === 'dark'),
  manifest = JSON.parse(await readFile(join(current.path, 'manifest.json'), 'utf8'))
const old = join(output, 'vendor-old')
await mkdir(old)
for (const e of zip.getEntries()) {
  const target = join(old, e.entryName)
  if (e.isDirectory) await mkdir(target, { recursive: true })
  else {
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, e.getData())
  }
}
const oldManifest = JSON.parse(await readFile(join(old, 'manifest.json'), 'utf8'))
if (oldManifest.version !== '4.9.134') throw new Error('实际旧版本不符')
await writeFile(join(old, 'manifest.json'), JSON.stringify({ ...oldManifest, key: manifest.key }))
const info = {
  source,
  oldFormat: '厂商原版ZIP；未声称CRX签名认证，仅解包副本补key保持ID',
  sha256: createHash('sha256').update(bytes).digest('hex'),
  current
}
await writeFile(join(output, 'source.json'), JSON.stringify(info, null, 2))
await writeFile(
  join(output, 'main.cjs'),
  `const{app,session}=require('electron');const fs=require('node:fs/promises'),path=require('node:path');app.setPath('userData',path.join(__dirname,'profile'));app.whenReady().then(async()=>{const r={};try{const s=session.fromPartition('persist:upgrade');const old=await s.extensions.loadExtension(${JSON.stringify(old)});if(old.id!==${JSON.stringify(current.id)}||old.version!=='4.9.134')throw new Error('旧版本ID不符');r.before={id:old.id,version:old.version};s.extensions.removeExtension(old.id);const next=await s.extensions.loadExtension(${JSON.stringify(current.path)});if(next.id!==old.id||next.version!=='4.9.135')throw new Error('升级失败');r.after={id:next.id,version:next.version};const again=await s.extensions.loadExtension(${JSON.stringify(current.path)});r.duplicate={id:again.id,version:again.version,count:s.extensions.getAllExtensions().length};if(r.duplicate.count!==1)throw new Error('重复安装留下多份');r.status='pass'}catch(e){r.status='fail';r.error=String(e)}await fs.writeFile(path.join(__dirname,'results.json'),JSON.stringify(r,null,2));console.log(JSON.stringify(r));app.exit(r.status==='pass'?0:1)})`
)
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(root('electron'), [join(output, 'main.cjs')], { env, stdio: 'inherit' })
child.on('exit', (code) => {
  console.log('升级证据：' + output)
  process.exitCode = code ?? 1
})
