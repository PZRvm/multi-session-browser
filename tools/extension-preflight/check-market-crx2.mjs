/* eslint @typescript-eslint/explicit-function-return-type: off -- 独立验证脚本使用原生 JavaScript */
import { createRequire } from 'node:module'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { extractCrx } from './crx.mjs'
const here = dirname(fileURLToPath(import.meta.url)),
  require = createRequire(join(here, '../../package.json'))
const source =
  'https://github.com/FelisCatus/SwitchyOmega/releases/download/v2.5.20/SwitchyOmega_Chromium.crx'
const expected = '0b7b185ef8bd0dc45287d8bbc487e33a759f8e9a4556bdf072945185c50b0c1b'
const artifacts = join(here, 'out/.artifacts'),
  file = join(artifacts, 'samples/SwitchyOmega_Chromium_2.5.20.crx')
await mkdir(dirname(file), { recursive: true })
let bytes
try {
  bytes = await readFile(file)
} catch {
  const response = await fetch(source)
  if (!response.ok) throw new Error('厂商下载失败：' + response.status)
  bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length > 16 * 1024 * 1024) throw new Error('包过大')
}
if (createHash('sha256').update(bytes).digest('hex') !== expected)
  throw new Error('固定厂商包哈希改变')
await writeFile(file, bytes)
const sample = {
  ...(await extractCrx(
    bytes,
    join(artifacts, 'samples/market-crx2'),
    'padekgcemlokbadohgkifijomclgjgif'
  )),
  source,
  file
}
if (sample.crxVersion !== 2) throw new Error('不是真实CRX2')
const output = join(artifacts, 'market-crx2-' + Date.now())
await mkdir(output, { recursive: true })
await writeFile(join(output, 'sample.json'), JSON.stringify(sample, null, 2))
const main = join(output, 'probe.cjs')
await writeFile(
  main,
  `const {app,session,BrowserWindow}=require('electron');const fs=require('node:fs/promises');const path=require('node:path');const sample=${JSON.stringify(sample)};app.setPath('userData',path.join(__dirname,'profile'));app.whenReady().then(async()=>{const ses=session.fromPartition('persist:market-crx2');const result={sample};try{const ext=await ses.extensions.loadExtension(sample.path);const win=new BrowserWindow({show:false,webPreferences:{session:ses,sandbox:true,contextIsolation:true,nodeIntegration:false}});win.webContents.setWindowOpenHandler(()=>({action:'deny'}));await win.loadURL('chrome-extension://'+ext.id+'/options.html');result.loaded={id:ext.id,version:ext.version};result.page=await win.webContents.executeJavaScript('({text:document.body.innerText,proxyApi:typeof chrome.proxy})');if(!result.page.text.includes('Version 2.5.20'))throw new Error('真实设置页未执行');result.scope='仅CRX2格式验签/安装/设置页执行；不代表代理主功能兼容';win.destroy();result.status='pass'}catch(error){result.status='fail';result.error=String(error)}await fs.writeFile(path.join(__dirname,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));app.exit(result.status==='pass'?0:1)})`
)
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(require('electron'), [main], { env, stdio: 'inherit' })
child.on('exit', (code) => {
  console.log('市售CRX2证据：' + output)
  process.exitCode = code ?? 1
})
