import { createRoot } from 'react-dom/client'
import EditorWindow from '../../../src/renderer/src/components/browser/captureEditor/EditorWindow'
import { bootstrapLanguage } from '../../../src/renderer/src/stores/i18n'
import { DICTIONARIES } from '../../../src/shared/i18n'
import type { CaptureEditImagePayload } from '../../../src/shared/capture'
import { loadCapture, pngDataUrl, saveCapture, trimCaptures } from '../capture-store.js'
import { pluginLanguage } from './language'

const params = new URLSearchParams(location.search)
const captureId = params.get('captureId')
const handoff = params.get('handoff')
const language = pluginLanguage(params)
const messages = DICTIONARIES[language].browser.capturePlugin
const root = document.getElementById('root')!

document.documentElement.lang = language
document.title = messages.editorTitle
bootstrapLanguage(language)

let payload: CaptureEditImagePayload | null = null

function current(): CaptureEditImagePayload {
  if (!payload) throw new Error(messages.expired)
  return payload
}

function notifyResult(loaded: boolean): void {
  if (!handoff) return
  const channel = new BroadcastChannel('screenshot-editor:' + handoff)
  channel.postMessage(loaded ? captureId : null)
  channel.close()
}

async function apply(input: { captureId: string; dataUrl: string }, blob: Blob): Promise<void> {
  if (input.captureId !== current().captureId) throw new Error(messages.expired)
  const image = await createImageBitmap(blob)
  const next = {
    captureId: crypto.randomUUID(),
    dataUrl: input.dataUrl,
    width: image.width,
    height: image.height
  }
  image.close()
  await saveCapture({
    captureId: next.captureId,
    width: next.width,
    height: next.height,
    blob,
    createdAt: Date.now()
  })
  payload = next
  void trimCaptures().catch((error) => console.warn('截图缓存清理失败', error))
}

async function start(): Promise<void> {
  const capture = await loadCapture(captureId)
  if (!capture) throw new Error(messages.expired)
  payload = {
    captureId: capture.captureId,
    width: capture.width,
    height: capture.height,
    dataUrl: await pngDataUrl(capture.blob)
  }
  window.api = {
    capture: {
      getEditImage: async () => ({ ...current() }),
      editCopy: async (input) => {
        if (input.captureId !== current().captureId) throw new Error(messages.expired)
        const blob = await (await fetch(input.dataUrl)).blob()
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        await apply(input, blob)
      },
      editDownload: async (input) => {
        if (input.captureId !== current().captureId) throw new Error(messages.expired)
        const filename = 'screenshot-' + input.captureId + '.png'
        const blob = await (await fetch(input.dataUrl)).blob()
        await chrome.downloads.download({
          url: input.dataUrl,
          filename,
          saveAs: false,
          conflictAction: 'uniquify'
        })
        await apply(input, blob)
        return { path: filename }
      }
    }
  } as typeof window.api

  document.body.classList.add('plugin-editor')
  createRoot(root).render(<EditorWindow wheelZoom fitCanvas onLoad={notifyResult} />)
}

void start().catch((error) => {
  console.warn('截图编辑器无法载入', error)
  root.setAttribute('role', 'alert')
  root.textContent = messages.expired
  notifyResult(false)
})
