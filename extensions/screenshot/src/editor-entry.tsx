// 截图插件编辑器页入口：复用生产 EditorWindow，浏览器/扩展 API 承担取图、复制与下载。
// 适配器语义对齐生产 window.api.capture：快照绑定本窗 captureId，产出成功后续编，
// 过期/未知 captureId 拒绝（对应协议v1 SNAPSHOT_STALE 语义）。
// 窗口形态：加载后自动迁移到 Document PiP 无框窗口（对齐主应用无标题条编辑窗，
// 工具行与红绿灯同源单行；PiP 无系统灯，工具行最左放关闭钮），迁移失败保留常规弹窗。
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

/** 滚轮缩放：Ctrl/⌘+滚轮在画布区缩放（0.25–4），普通滚轮保持滚动；
 *  zoom 施加于 Konva 容器（CSS zoom），续编重挂后由 MutationObserver 重新应用 */
function setupWheelZoom(doc: Document): void {
  let zoom = 1
  const apply = (): void => {
    const host = doc.querySelector('.chrome-capture-editor-canvas')
    const konva = host?.firstElementChild as HTMLElement | null
    if (konva) konva.style.zoom = String(zoom)
  }
  doc.addEventListener(
    'wheel',
    (event) => {
      const host = doc.querySelector('.chrome-capture-editor-canvas')
      if (!host || !host.contains(event.target as Node)) return
      if (!(event.ctrlKey || event.metaKey)) return
      event.preventDefault()
      zoom = Math.min(4, Math.max(0.25, zoom * (event.deltaY < 0 ? 1.1 : 0.9)))
      apply()
    },
    { passive: false }
  )
  const root = doc.getElementById('root')
  if (root) new MutationObserver(apply).observe(root, { childList: true, subtree: true })
}

/** PiP 文档需要自备样式：克隆原页 head 里的 link/style 到 PiP head */
function copyStyles(target: Document): void {
  for (const node of Array.from(document.head.children)) {
    const tag = node.tagName
    if (tag === 'LINK' || tag === 'STYLE') target.head.append(node.cloneNode(true))
  }
}

/** PiP 无系统红绿灯：工具行最左插入关闭钮（功能等价红绿灯的关闭灯） */
function insertCloseButton(doc: Document): void {
  const toolbar = doc.querySelector('.chrome-capture-editor-toolbar')
  if (!toolbar || doc.getElementById('pip-close')) return
  const close = doc.createElement('button')
  close.id = 'pip-close'
  close.className = 'chrome-capture-editor-iconbtn pip-close-btn'
  close.setAttribute('aria-label', '关闭编辑器')
  close.title = '关闭编辑器'
  close.textContent = '✕'
  close.addEventListener('click', () => window.close())
  toolbar.insertBefore(close, toolbar.firstChild)
}

/** 迁移到 Document PiP 无框窗口；无调用态/不支持时静默保留常规弹窗并给出浮动入口 */
async function migrateToPip(): Promise<void> {
  if (!('documentPictureInPicture' in window)) return
  try {
    const pipWin = await documentPictureInPicture.requestWindow({
      width: 880,
      height: 640,
      disallowReturnToOpener: true
    })
    copyStyles(pipWin.document)
    const root = document.getElementById('root')
    if (root) pipWin.document.body.append(root)
    pipWin.document.body.className = 'plugin-editor pip'
    insertCloseButton(pipWin.document)
    setupWheelZoom(pipWin.document)
    // 开窗后延迟 300ms 再拆原弹窗：给 PiP 与 opener 的关联解绑留出结算时间，
    // 避免拆窗竞态把刚落地的 PiP 一并带走
    setTimeout(() => {
      chrome.runtime.sendMessage({ type: 'screenshot.pip-migrated' }).catch(() => {})
      window.close()
    }, 300)
  } catch {
    // 无调用态等场景：常规弹窗内提供浮动入口
    const chip = document.createElement('button')
    chip.id = 'pip-fallback'
    chip.textContent = '浮动'
    chip.addEventListener('click', () => {
      chip.remove()
      void migrateToPip()
    })
    document.body.append(chip)
  }
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
  setupWheelZoom(document)
  createRoot(document.getElementById('root')!).render(<EditorWindow />)
  // 等 React 挂上工具行后自动迁移；迁移失败时 fallback chip 已在 migrateToPip 内补上
  setTimeout(() => void migrateToPip(), 250)
}

void start().catch((error) => {
  // EditorWindow 挂载前失败没有取图链错误条，直接呈现原始错误，不伪造内容
  document.getElementById('root')!.textContent = String(error)
})
