import { DICTIONARIES } from '../../../src/shared/i18n'
import { loadCapture, pngDataUrl, saveCapture } from '../capture-store.js'
import { pluginLanguage } from './language'

const params = new URLSearchParams(location.search)
const language = pluginLanguage(params)
const {
  capture: messages,
  capturePlugin: resultMessages,
  captureEditor
} = DICTIONARIES[language].browser
const statusEl = document.querySelector<HTMLParagraphElement>('#status')!
const actions = document.querySelector<HTMLDivElement>('#actions')!
const download = document.querySelector<HTMLButtonElement>('#download')!
const edit = document.querySelector<HTMLButtonElement>('#edit')!

document.documentElement.lang = language
document.title = resultMessages.title
download.textContent = messages.download
edit.textContent = messages.edit
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !event.isComposing) window.close()
})

async function downloadOriginal(url: string, captureId: string): Promise<void> {
  const id = await chrome.downloads.download({
    url,
    filename: 'screenshot-' + captureId + '.png',
    saveAs: false,
    conflictAction: 'uniquify'
  })
  // 宿主兼容层的回执在落盘后返回，Chrome 的任务 ID 只确认受理。
  if (globalThis.__msbShimBridge) return
  await new Promise<void>((resolve, reject) => {
    const finish = (state: string | undefined): void => {
      if (!state || state === 'in_progress') return
      chrome.downloads.onChanged.removeListener(onChanged)
      if (state === 'complete') resolve()
      else reject(new Error('DOWNLOAD_FAILED'))
    }
    const onChanged = (delta: { id: number; state?: { current?: string } }): void => {
      if (delta.id === id) finish(delta.state?.current)
    }
    chrome.downloads.onChanged.addListener(onChanged)
    void chrome.downloads.search({ id }).then(
      ([item]) => {
        if (item) finish(item.state)
      },
      () => finish('interrupted')
    )
  })
}

async function openEditor(captureId: string): Promise<void> {
  const handoff = crypto.randomUUID()
  const channel = new BroadcastChannel('screenshot-editor:' + handoff)
  let timeout: number | undefined
  const ready = new Promise<boolean>((resolve) => {
    channel.onmessage = ({ data }) => resolve(data === captureId)
    timeout = window.setTimeout(() => resolve(false), 12_000)
  })
  try {
    const query = new URLSearchParams({ captureId, handoff, lang: language })
    const editor = await chrome.windows.create({
      url: 'editor.html?' + query,
      type: 'popup',
      width: Math.min(1440, Math.max(200, screen.availWidth - 24)),
      height: Math.min(960, Math.max(150, screen.availHeight - 24))
    })
    if (!(await ready)) {
      if (typeof editor?.id === 'number')
        await chrome.windows.remove(editor.id).catch(() => undefined)
      throw new Error('EDITOR_NOT_READY')
    }
    window.close()
  } finally {
    window.clearTimeout(timeout)
    channel.close()
  }
}

async function start(): Promise<void> {
  const captureId = params.get('captureId')
  const status = params.get('status')
  if (!captureId) {
    statusEl.textContent =
      status === 'copied-no-actions' ? resultMessages.copiedNoActions : messages.failed
    return
  }
  const capture = await loadCapture(captureId)
  if (!capture) throw new Error('CAPTURE_EXPIRED')
  statusEl.textContent =
    status === 'copied'
      ? messages.copied
      : status === 'copy-unavailable'
        ? resultMessages.copyUnavailable
        : resultMessages.copyFailed
  actions.hidden = false
  download.onclick = async () => {
    if (download.disabled) return
    download.disabled = true
    statusEl.textContent = resultMessages.downloading
    try {
      await downloadOriginal(await pngDataUrl(capture.blob), captureId)
      statusEl.textContent = resultMessages.downloaded
    } catch (error) {
      console.warn('截图下载失败', error)
      statusEl.textContent = resultMessages.downloadFailed
    } finally {
      download.disabled = false
    }
  }
  edit.onclick = async () => {
    if (edit.disabled) return
    edit.disabled = true
    statusEl.textContent = resultMessages.openingEditor
    try {
      await saveCapture({ ...capture, handoffUntil: Date.now() + 30_000 })
      await openEditor(captureId)
    } catch (error) {
      console.warn('截图编辑器无法打开', error)
      statusEl.textContent = captureEditor.loadFailed
      edit.disabled = false
    }
  }
}

void start().catch((error) => {
  console.warn('截图无法载入', error)
  statusEl.textContent = resultMessages.expired
})
