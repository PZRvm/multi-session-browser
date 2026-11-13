/* eslint @typescript-eslint/explicit-function-return-type: off -- 独立验证脚本使用原生 JavaScript，sandbox preload 使用 CommonJS */
import { createServer } from 'node:http'
import { mkdir, readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const requireRoot = createRequire(`${root}/package.json`)
export async function startSite() {
  const syncFile = resolve(root, 'tools/extension-preflight/out/.artifacts/avsync-reference.mp4')
  await mkdir(dirname(syncFile), { recursive: true })
  try {
    await readFile(syncFile)
  } catch {
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=black:s=800x400:r=30:d=20',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=48000:duration=20',
      '-vf',
      "drawbox=x=600:y=100:w=150:h=150:color=white:t=fill:enable='lt(mod(t,1),0.2)'",
      '-af',
      "volume=volume='if(lt(mod(t,1),0.2),0.2,0)':eval=frame",
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-shortest',
      syncFile
    ])
  }
  const syncBytes = await readFile(syncFile)
  const { build } = requireRoot('esbuild')
  const compiled = await build({
    stdin: {
      contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
      function Fixture(){const [count,setCount]=React.useState(0);React.useEffect(()=>{const id=setInterval(()=>setCount(v=>v+1),1000);return()=>clearInterval(id)},[]);return React.createElement('p',{'data-testid':'react-counter'},'React测试计数：'+count)}
      createRoot(document.getElementById('react-root')).render(React.createElement(Fixture,{session:new URLSearchParams(location.search).get('session')||'A'}));`,
      resolveDir: root
    },
    bundle: true,
    write: false,
    format: 'iife',
    define: { 'process.env.NODE_ENV': '"development"' }
  })
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>插件前置验证</title></head>
  <body><h1 id="session">插件前置验证</h1><p>虚构数据，同源分区对照；图案用于判断截图目标。</p>
  <label>临时输入 <input id="draft" value=""></label><button id="audio">播放本Tab测试音</button>
  <p id="audio-state">声音未开始</p><div id="react-root"></div><canvas id="pattern" width="800" height="400" aria-label="截图与录屏测试图案"></canvas>
  <script src="/app.js"></script><script>
  const params=new URLSearchParams(location.search),label=params.get('session')||'A';document.getElementById('session').textContent='验证会话 '+label;
  let audio=null,osc=null;const syncProbe=params.get('avsync')==='1';const syncVideo=document.createElement('video');syncVideo.src='/avsync.mp4';syncVideo.loop=true;syncVideo.playsInline=true; const canvas=document.getElementById('pattern'),ctx=canvas.getContext('2d'),started=performance.now();
  function draw(){ctx.fillStyle=label==='B'?'#0044cc':'#cc2200';ctx.fillRect(0,0,800,400);ctx.fillStyle='#ffffff';ctx.font='32px sans-serif';ctx.fillText('目标 '+label+' / '+((performance.now()-started)/1000).toFixed(1)+'s',30,60);ctx.fillStyle='#00cc44';ctx.fillRect(40,100,150,150);ctx.fillStyle='#ffff00';ctx.fillRect(220,100,150,150);if(syncProbe && syncVideo.readyState>=2)ctx.drawImage(syncVideo,0,0,800,400);requestAnimationFrame(draw)}draw();
  window.testSite={label,startAudio:async(freq=440)=>{if(syncProbe){await syncVideo.play();document.getElementById('audio-state').textContent='正在播放同步测试素材';return 'playing'}if(audio)return;audio=new AudioContext();await audio.resume();osc=audio.createOscillator();const gain=audio.createGain();gain.gain.value=.025;osc.frequency.value=freq;osc.connect(gain);gain.connect(audio.destination);osc.start();document.getElementById('audio-state').textContent='正在播放 '+freq+'Hz';return audio.state},stopAudio:async()=>{if(syncProbe){syncVideo.pause();syncVideo.currentTime=0}if(osc)osc.stop();if(audio)await audio.close();audio=null;osc=null},cookie:()=>document.cookie,syncGeometry:()=>({rect:canvas.getBoundingClientRect().toJSON(),viewport:{width:innerWidth,height:innerHeight},marker:{x:600,y:100,width:150,height:150}})};
  document.getElementById('audio').onclick=()=>window.testSite.startAudio(label==='B'?733:440);
  </script></body></html>`
  const server = createServer((req, res) => {
    if (req.url === '/avsync.mp4') {
      res.setHeader('Content-Type', 'video/mp4')
      res.end(syncBytes)
    } else if (req.url?.startsWith('/app.js')) {
      res.setHeader('Content-Type', 'application/javascript')
      res.end(compiled.outputFiles[0].text)
    } else {
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end(html)
    }
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return {
    url: `http://localhost:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve))
  }
}
