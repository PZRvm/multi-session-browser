// 截图插件编辑器页入口：复用生产 EditorWindow，浏览器/扩展 API 承担取图、复制与下载。
// 适配器语义对齐生产 window.api.capture：快照绑定本窗 captureId，产出成功后续编，
// 过期/未知 captureId 拒绝（对应协议v1 SNAPSHOT_STALE 语义）。
// 窗口形态：无框化 = Document PiP（三条平台约束见 migrateToPip 头注）：加载后自动
// 尝试迁移（需页内手势，无手势时浮动钮承接），迁移成功后编辑器在 PiP 文档自身上下文
// 全新起跑（React/Konva/rAF 全在 PiP），工具行最左为仿 macOS 三灯组（pip-lifecycle.js，
// 红=关窗），承载窗最小化承载 PiP 生命周期，PiP 关闭后由后台收回承载窗。
// 配色 = 雾蓝系（plugin-theme.css 对账 themeSystems.ts mist）。
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

/** PiP 上下文脚本注入：editor-entry 自身的 JS 上下文随 opener 关窗销毁，灯组
 *  插入与滚轮缩放必须活在 PiP 文档自身的上下文里——经 <script src> 注入独立文件
 *  （MV3 CSP 仅放行扩展自身文件，内联脚本不可用），详见 pip-lifecycle.js 头注 */
function injectPipLifecycle(pipWin: Window): void {
  const script = pipWin.document.createElement('script')
  script.src = 'pip-lifecycle.js'
  pipWin.document.head.append(script)
}

/** 迁移到 Document PiP 无框窗口。三条平台约束（真机验证）：
 *  ① requestWindow 需页内瞬态激活——icon 点击的激活在 SW，编辑页没有，自动迁移
 *  必拒，故失败时给出浮动钮（页内点击供激活，无框迁移必经页内手势）；
 *  ② PiP 不能活过 opener——承载窗只能最小化不能关闭，PiP 关闭（leave）后由
 *  后台收回承载窗；
 *  ③ 承载窗最小化后其 rAF 节流，跨窗搬运节点会让 React/Konva 绘制卡死——编辑器
 *  必须在 PiP 文档自身上下文全新起跑（自举同 editor.html：克隆样式 → root →
 *  module 入口 → 生命周期脚本），捕获快照经 storage 按 captureId 重新加载 */
async function migrateToPip(): Promise<void> {
  if (!('documentPictureInPicture' in window)) return
  try {
    const pipWin = await documentPictureInPicture.requestWindow({
      width: 880,
      height: 640,
      disallowReturnToOpener: true
    })
    copyStyles(pipWin.document)
    const pipRoot = pipWin.document.createElement('div')
    pipRoot.id = 'root'
    pipWin.document.body.append(pipRoot)
    pipWin.document.body.className = 'plugin-editor pip'
    // 顺序即依赖：chrome 桥（PiP 非扩展上下文，借 opener 命名空间）→ module 入口
    // （自举编辑器）→ 生命周期脚本（灯组 + 滚轮缩放，PiP 上下文常驻）
    const bridge = pipWin.document.createElement('script')
    bridge.src = 'editor-bridge.js'
    pipWin.document.head.append(bridge)
    const entry = pipWin.document.createElement('script')
    entry.type = 'module'
    entry.src = 'out/editor.js'
    pipWin.document.head.append(entry)
    injectPipLifecycle(pipWin)
    // PiP 关闭时（含灯组红点）通知后台收回承载窗；leave 在 opener 上下文触发
    documentPictureInPicture.addEventListener('leave', () => {
      void chrome.runtime.sendMessage({ type: 'screenshot.pip-closed' }).catch(() => {})
    })
    // 延迟 300ms 通知后台最小化承载窗：PiP 不能活过 opener，承载窗只缩不关
    setTimeout(() => {
      chrome.runtime.sendMessage({ type: 'screenshot.pip-migrated' }).catch(() => {})
    }, 300)
  } catch {
    // 无调用态等场景：常规弹窗内提供浮动入口（页内点击供瞬态激活，无框迁移必经页内手势）
    const chip = document.createElement('button')
    chip.id = 'pip-fallback'
    chip.textContent = '浮动'
    chip.title = '移入无框浮窗'
    chip.setAttribute('aria-label', '移入无框浮窗')
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
  // PiP 上下文（迁移时自举）：滚轮缩放由 pip-lifecycle.js 承担，且不再发起二次
  // 迁移（requestWindow 于 PiP 文档内再入会再开窗）；渲染照常进行
  const inPip = document.body.classList.contains('pip')
  if (!inPip) setupWheelZoom(document)
  createRoot(document.getElementById('root')!).render(<EditorWindow />)
  if (!inPip) setTimeout(() => void migrateToPip(), 250)
}

void start().catch((error) => {
  // EditorWindow 挂载前失败没有取图链错误条，直接呈现原始错误，不伪造内容
  document.getElementById('root')!.textContent = String(error)
})
