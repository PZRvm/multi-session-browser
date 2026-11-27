/* eslint @typescript-eslint/explicit-function-return-type: off -- 插件 Worker 使用原生 JS */
/* global chrome */
import { saveCapture, trimCaptures } from './capture-store.js'

let results = Promise.resolve()

async function captureVisibleTab(tab) {
  let changed = false
  const onActivated = ({ windowId, tabId }) => {
    if (windowId === tab.windowId && tabId !== tab.id) changed = true
  }
  const onRemoved = (tabId) => {
    if (tabId === tab.id) changed = true
  }
  chrome.tabs.onActivated.addListener(onActivated)
  chrome.tabs.onRemoved.addListener(onRemoved)
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' })
    const [active] = await chrome.tabs.query({ windowId: tab.windowId, active: true })
    if (changed || active?.id !== tab.id) throw new Error('NO_ACTIVE_TAB')
    return { dataUrl }
  } finally {
    chrome.tabs.onActivated.removeListener(onActivated)
    chrome.tabs.onRemoved.removeListener(onRemoved)
  }
}

async function takeScreenshot(tab) {
  if (!Number.isInteger(tab?.id) || !Number.isInteger(tab?.windowId))
    throw new Error('NO_ACTIVE_TAB')
  const bridge = globalThis.__msbShimBridge
  if (bridge?.captureAndCopy)
    return bridge.captureAndCopy(tab.msbScreenshotAction, tab.windowId, tab.id)
  if (bridge) throw new Error('HOST_UPDATE_REQUIRED')
  return captureVisibleTab(tab)
}

async function showResult(params, tab) {
  const bridge = globalThis.__msbShimBridge
  if (bridge) return bridge.showScreenshotResult(tab.msbScreenshotAction, params)
  const [active] = await chrome.tabs.query({ windowId: tab.windowId, active: true })
  if (active?.id !== tab.id) return
  const popup = 'result.html?' + new URLSearchParams(params)
  await chrome.action.setPopup({ tabId: tab.id, popup })
  const open = () => chrome.action.openPopup({ windowId: tab.windowId })
  try {
    await open()
  } catch (error) {
    // 可视区采集期间原窗口可能短暂失去原生焦点。仅重试仍是当前目标的窗口。
    const [selected] = await chrome.tabs.query({ windowId: tab.windowId, active: true })
    const focused = await chrome.windows.getLastFocused()
    if (
      !String(error).includes('inactive window') ||
      focused.id !== tab.windowId ||
      selected?.id !== tab.id
    )
      throw error
    await chrome.windows.update(tab.windowId, { focused: true })
    await open()
  } finally {
    await chrome.action.setPopup({ tabId: tab.id, popup: '' }).catch(() => undefined)
  }
}

async function finishCapture(tab, pending) {
  let result
  try {
    const completion = await pending
    if ('error' in completion) throw completion.error
    result = completion.result
    if (!result.dataUrl?.startsWith('data:image/png;base64,')) throw new Error('CAPTURE_FAILED')
  } catch (error) {
    console.warn('截图采集失败', error)
    await showResult({ status: 'capture-failed' }, tab)
    return
  }
  const blob = await (await fetch(result.dataUrl)).blob()
  const captureId = crypto.randomUUID()
  let copied = result.copied ?? false
  let unavailable = false
  if (result.copied === undefined) {
    unavailable = !navigator.clipboard?.write || typeof ClipboardItem !== 'function'
    if (!unavailable) {
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        copied = true
      } catch (error) {
        console.warn('截图复制失败', error)
      }
    }
  }
  let capture
  try {
    const bitmap = await createImageBitmap(blob)
    capture = {
      captureId,
      blob,
      width: bitmap.width,
      height: bitmap.height,
      createdAt: Date.now(),
      handoffUntil: Date.now() + 30_000
    }
    bitmap.close()
    await saveCapture(capture)
  } catch (error) {
    console.warn('截图缓存失败', error)
    await showResult({ status: copied ? 'copied-no-actions' : 'capture-failed' }, tab)
    return
  }
  const status = copied ? 'copied' : unavailable ? 'copy-unavailable' : 'copy-failed'
  await showResult({ captureId, status }, tab)
  await trimCaptures()
}

chrome.action.onClicked.addListener((tab) => {
  // 先发起采集以使用本次点击的当前标签和 activeTab 授权，再顺序提交结果。
  const pending = takeScreenshot(tab).then(
    (result) => ({ result }),
    (error) => ({ error })
  )
  results = results
    .then(() => finishCapture(tab, pending))
    .catch((error) => console.warn('截图结果窗无法打开', error))
})
