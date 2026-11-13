// 仅验证普通Chrome适配：复用完整生产编辑器，浏览器API承担图像输入/复制/下载。
import { createRoot } from 'react-dom/client'
import EditorWindow from '../../src/renderer/src/components/browser/captureEditor/EditorWindow'
import '../../src/renderer/src/assets/app.css'
import type { CaptureEditImagePayload } from '../../src/shared/capture'

async function start(): Promise<void> {
  const blob = await (await fetch('/source.png')).blob()
  const bitmap = await createImageBitmap(blob)
  const dataUrl: string = await new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(blob)
  })
  let payload: CaptureEditImagePayload = {
    captureId: 'chrome-fixture-1',
    dataUrl,
    width: bitmap.width,
    height: bitmap.height
  }
  bitmap.close()
  let generation = 1
  async function apply(input: { captureId: string; dataUrl: string }): Promise<void> {
    if (input.captureId !== payload.captureId) throw new Error('截图已过期')
    const image = await createImageBitmap(await (await fetch(input.dataUrl)).blob())
    payload = {
      captureId: 'chrome-fixture-' + ++generation,
      dataUrl: input.dataUrl,
      width: image.width,
      height: image.height
    }
    image.close()
  }
  window.api = {
    capture: {
      getEditImage: async () => ({ ...payload }),
      editCopy: async (input) => {
        if (input.captureId !== payload.captureId) throw new Error('截图已过期')
        const blob = await (await fetch(input.dataUrl)).blob()
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        await apply(input)
      },
      editDownload: async (input) => {
        if (input.captureId !== payload.captureId) throw new Error('截图已过期')
        const link = document.createElement('a')
        link.href = input.dataUrl
        link.download = 'editor-chrome.png'
        document.body.append(link)
        link.click()
        link.remove()
        await apply(input)
        return { path: 'editor-chrome.png' }
      }
    }
  } as typeof window.api
  createRoot(document.getElementById('root')!).render(<EditorWindow />)
}
void start().catch(console.error)
