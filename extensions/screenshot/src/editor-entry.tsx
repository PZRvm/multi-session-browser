// 截图插件编辑器页入口：复用生产 EditorWindow，浏览器/扩展 API 承担取图、复制与下载。
// 适配器语义对齐生产 window.api.capture：快照绑定本窗 captureId，产出成功后续编，
// 过期/未知 captureId 拒绝（对应协议v1 SNAPSHOT_STALE 语义）。
import { createRoot } from 'react-dom/client'
import EditorWindow from '../../../src/renderer/src/components/browser/captureEditor/EditorWindow'
import '../../../src/renderer/src/assets/app.css'
import type { CaptureEditImagePayload } from '../../../../src/shared/capture'

/** 本窗当前快照（内存权威，续编后更新；页面重载后按 storage 快照重新起步） */
let payload: CaptureEditImagePayload | null = null
let generation = 0

/** 产出入库（新 captureId 递增代次），续编读取本窗现值 */
async function apply(input: { captureId: string; dataUrl: string }): Promise<void> {
  if (!payload || input.captureId !== payload.captureId) throw new Error('截图已过期')
  const image = await createImageBitmap(await (await fetch(input.dataUrl)).blob())
  const next: CaptureEditImagePayload = {
    captureId: `${input.captureId}-g${++generation}`,
    dataUrl: input.dataUrl,
    width: image.width,
    height: image.height
  }
  image.close()
  payload = next
  await chrome.runtime.sendMessage({
    type: 'screenshot.save',
    payload: { ...next, createdAt: Date.now() }
  })
}

function reject(message: string): never {
  throw new Error(message)
}

async function start(): Promise<void> {
  const captureId = new URLSearchParams(window.location.search).get('captureId') ?? ''
  const response = await chrome.runtime.sendMessage({ type: 'screenshot.load', captureId })
  if (!response?.ok) reject(response?.error ?? '截图不存在或已过期')
  payload = response.payload

  window.api = {
    capture: {
      getEditImage: async () => {
        if (!payload) reject('截图不存在或已过期')
        return { ...payload }
      },
      editCopy: async (input) => {
        if (!payload || input.captureId !== payload.captureId) reject('截图已过期')
        const blob = await (await fetch(input.dataUrl)).blob()
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        await apply(input)
      },
      editDownload: async (input) => {
        if (!payload || input.captureId !== payload.captureId) reject('截图已过期')
        const filename = `screenshot-${payload.captureId}.png`
        await chrome.downloads.download({ url: input.dataUrl, filename, saveAs: false })
        await apply(input)
        return { path: filename }
      }
    }
  } as typeof window.api

  document.body.classList.add('plugin-editor')
  setupWheelZoom()
  createRoot(document.getElementById('root')!).render(<EditorWindow />)
}

/** 滚轮缩放：Ctrl/⌘+滚轮在画布区缩放（0.25–4），普通滚轮保持滚动；
 *  zoom 施加于 Konva 容器（CSS zoom），续编重挂后由 MutationObserver 重新应用 */
function setupWheelZoom(): void {
  let zoom = 1
  const apply = (): void => {
    const host = document.querySelector('.chrome-capture-editor-canvas')
    const konva = host?.firstElementChild as HTMLElement | null
    if (konva) konva.style.zoom = String(zoom)
  }
  document.addEventListener(
    'wheel',
    (event) => {
      const host = document.querySelector('.chrome-capture-editor-canvas')
      if (!host || !host.contains(event.target as Node)) return
      if (!(event.ctrlKey || event.metaKey)) return
      event.preventDefault()
      zoom = Math.min(4, Math.max(0.25, zoom * (event.deltaY < 0 ? 1.1 : 0.9)))
      apply()
    },
    { passive: false }
  )
  new MutationObserver(apply).observe(document.getElementById('root')!, {
    childList: true,
    subtree: true
  })
}

void start().catch((error) => {
  // EditorWindow 挂载前失败没有取图链错误条，直接呈现原始错误，不伪造内容
  document.getElementById('root')!.textContent = String(error)
})
