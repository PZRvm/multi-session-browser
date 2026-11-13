/* eslint @typescript-eslint/explicit-function-return-type: off -- 独立验证脚本使用原生 JavaScript */
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function checkChromeReact(cdp, output, siteUrl, id, strictSvg = true) {
  async function wait(read, reason) {
    for (let i = 0; i < 100; i++) {
      const value = await read()
      if (value) return value
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error(reason)
  }
  const target = await wait(async () => {
    const inventory = await cdp.send('Target.getTargets', { filter: [{}] })
    return inventory.targetInfos.find(
      (t) => t.url.startsWith('devtools://') && t.title.includes(new URL(siteUrl).host)
    )
  }, 'Chrome未打开目标DevTools')
  const session = await cdp.attach(target.targetId)
  const logs = []
  const observedFrames = []
  const panelSessions = new Map()
  const onMessage = (raw) => {
    const event = JSON.parse(raw)
    if (
      (event.sessionId === session || [...panelSessions.values()].includes(event.sessionId)) &&
      event.method === 'Log.entryAdded'
    )
      logs.push(event.params.entry)
  }
  cdp.socket.on('message', onMessage)
  try {
    await cdp.send('Log.enable', {}, session)
    await cdp.send('Page.enable', {}, session)
    await cdp.send('Page.bringToFront', {}, session)
    const registry = `const UI=await import('devtools://devtools/bundled/ui/legacy/legacy.js');const view=UI.InspectorView.InspectorView.instance();`
    const ids = await wait(async () => {
      const values = await cdp.evaluate(
        `(async()=>{${registry}return view.tabbedPane.tabIds()})()`,
        session
      )
      return values.some((v) => v.includes(id + 'Profiler')) ? values : false
    }, 'Chrome未注册修复版面板')
    async function show(suffix) {
      const panelId = ids.find((v) => v.includes(id + suffix))
      if (!panelId) throw new Error('缺少' + suffix)
      await cdp.evaluate(
        `(async()=>{${registry}await view.showPanel(${JSON.stringify(panelId)})})()`,
        session
      )
    }
    function flatten(tree) {
      return [tree.frame, ...(tree.childFrames ?? []).flatMap(flatten)]
    }
    async function evaluate(context, expression) {
      const { contextId, sessionId = session } =
        typeof context === 'object' ? context : { contextId: context }
      const result = await cdp.send(
        'Runtime.evaluate',
        {
          ...(contextId ? { contextId } : {}),
          expression,
          awaitPromise: true,
          returnByValue: true,
          userGesture: true
        },
        sessionId
      )
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
      return result.result.value
    }
    async function findPanel(condition) {
      return wait(async () => {
        const inventory = await cdp.send('Target.getTargets', { filter: [{}] })
        for (const candidate of inventory.targetInfos.filter(
          (t) => t.type === 'iframe' && t.url === `chrome-extension://${id}/panel.html`
        )) {
          if (!panelSessions.has(candidate.targetId)) {
            const sid = await cdp.attach(candidate.targetId)
            panelSessions.set(candidate.targetId, sid)
            await cdp.send('Log.enable', {}, sid)
          }
          const context = { sessionId: panelSessions.get(candidate.targetId) }
          const body = await evaluate(context, 'document.body.innerText')
          observedFrames.push({ panelBody: body.slice(0, 5000), target: candidate.targetId })
          if (await evaluate(context, condition)) return context
        }
        const { frameTree } = await cdp.send('Page.getFrameTree', {}, session)
        observedFrames.push({
          frames: flatten(frameTree),
          targets: inventory.targetInfos.map((t) => ({ id: t.targetId, type: t.type, url: t.url })),
          body: await cdp.evaluate('document.body.innerText', session)
        })
        for (const frame of flatten(frameTree).filter(
          (f) => f.url === `chrome-extension://${id}/panel.html`
        )) {
          const { executionContextId } = await cdp.send(
            'Page.createIsolatedWorld',
            { frameId: frame.id, worldName: 'msb-preflight-test' },
            session
          )
          if (await evaluate(executionContextId, condition)) return executionContextId
        }
        return false
      }, 'Chrome插件面板内容未就绪')
    }
    await show('Components')
    const components = await findPanel(
      `!!document.querySelector('[data-testname="ComponentTreeListItem"]')`
    )
    await evaluate(
      components,
      `{const row=[...document.querySelectorAll('[data-testname="ComponentTreeListItem"]')].find(e=>e.textContent.includes('Fixture'));if(!row)throw new Error('Fixture缺失');row.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));row.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));row.click()}`
    )
    const props = await wait(async () => {
      const value = await evaluate(
        components,
        `({text:document.body.innerText,inputs:[...document.querySelectorAll('input')].map(e=>e.value),invalidPaths:[...document.querySelectorAll('path')].filter(p=>p.getAttribute('d')==='[object Object]').length,polygons:document.querySelectorAll('svg g polygon').length})`
      )
      return value.inputs.some((v, i) => v === 'session' && value.inputs[i + 1] === '"A"')
        ? value
        : false
    }, 'Chrome未读取到session=A')
    if (strictSvg && (props.invalidPaths || props.polygons < 3))
      throw new Error('修复版图形不完整或仍有无效path')
    await show('Profiler')
    const profiler = await findPanel(
      `[...document.querySelectorAll('button')].some(b=>b.textContent==='Start recording')`
    )
    await evaluate(
      profiler,
      `[...document.querySelectorAll('button')].find(b=>b.textContent==='Start recording').click()`
    )
    await wait(
      () => evaluate(profiler, `document.body.innerText.includes('Profiling is in progress')`),
      'Chrome Profiler未开始'
    )
    await new Promise((resolve) => setTimeout(resolve, 2500))
    await evaluate(
      profiler,
      `[...document.querySelectorAll('button')].find(b=>b.textContent==='Stop recording').click()`
    )
    const profile = await wait(async () => {
      const text = await evaluate(profiler, 'document.body.innerText')
      return text.includes('Commit information') &&
        text.includes('Fixture') &&
        text.includes('Committed at:')
        ? text
        : false
    }, 'Chrome Profiler没有提交数据')
    const shot = await cdp.send('Page.captureScreenshot', {}, session)
    await writeFile(join(output, 'chrome-react-profiler.png'), Buffer.from(shot.data, 'base64'))
    const targetErrors = logs.filter((l) =>
      /<path> attribute d:|sandbox_bundle/.test(l.text + ' ' + l.url)
    )
    if (strictSvg && targetErrors.length) throw new Error(JSON.stringify(targetErrors))
    return { id, props, profile, targetErrors, strictSvg }
  } finally {
    await writeFile(
      join(output, 'chrome-devtools-frames.json'),
      JSON.stringify(observedFrames.slice(-6), null, 2)
    )
    await writeFile(join(output, 'chrome-devtools-log.json'), JSON.stringify(logs, null, 2))
    cdp.socket.off('message', onMessage)
  }
}
