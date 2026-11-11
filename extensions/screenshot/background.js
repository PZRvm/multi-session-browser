/* eslint @typescript-eslint/explicit-function-return-type: off -- 插件后台/采集器为纯 JS 扩展代码 */
/* global chrome */
// 截图插件后台：action 点击 → captureVisibleTab → 快照入库 → 打开编辑器页。
// 每次截图独立 captureId，编辑窗只绑定自己的快照（对应协议v1 快照语义）。

const MAX_KEPT = 10

/** 读取目标快照；captureId 缺失时回退最新一张 */
async function loadCapture(captureId) {
  if (captureId) {
    const key = 'capture:' + captureId
    const stored = await chrome.storage.local.get(key)
    if (stored[key]) return stored[key]
    throw new Error('截图不存在或已过期')
  }
  const { latestCaptureId } = await chrome.storage.local.get('latestCaptureId')
  if (!latestCaptureId) throw new Error('还没有截图')
  const stored = await chrome.storage.local.get('capture:' + latestCaptureId)
  const payload = stored['capture:' + latestCaptureId]
  if (!payload) throw new Error('截图不存在或已过期')
  return payload
}

/** 保存/续编后的成品入库，并清理超量旧快照 */
async function saveCapture(payload) {
  await chrome.storage.local.set({
    ['capture:' + payload.captureId]: payload,
    latestCaptureId: payload.captureId
  })
  const all = await chrome.storage.local.get(null)
  const ids = Object.keys(all)
    .filter((k) => k.startsWith('capture:'))
    .map((k) => ({ id: k.slice(8), createdAt: all[k].createdAt ?? 0 }))
    .sort((a, b) => b.createdAt - a.createdAt)
  for (const stale of ids.slice(MAX_KEPT)) await chrome.storage.local.remove('capture:' + stale.id)
}

chrome.action.onClicked.addListener(async (tab) => {
  try {
    if (!tab.id || !tab.windowId) throw new Error('目标标签页无效')
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' })
    const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob())
    const payload = {
      captureId: crypto.randomUUID(),
      dataUrl,
      width: bitmap.width,
      height: bitmap.height,
      createdAt: Date.now(),
      tabId: tab.id
    }
    bitmap.close()
    await saveCapture(payload)
    // 与生产编辑窗同形态：chrome=hidden-titlebar 让 EditorWindow 呈现 84px 左让
    // 红绿灯位 + 工具条拖动区（内容形态单源=生产组件）；scale 只按宽适配（只缩不放），
    // 窗宽高按图幅现算并收口。原生标题栏为 Chrome 扩展窗口约束，无法隐藏
    const scale = Math.min(1, 840 / payload.width)
    const width = Math.min(1100, Math.round(payload.width * scale) + 24)
    const height = Math.min(900, Math.round(payload.height * scale) + 64)
    await chrome.windows.create({
      url:
        'editor.html?captureId=' +
        payload.captureId +
        '&scale=' +
        scale +
        '&chrome=hidden-titlebar',
      type: 'popup',
      width,
      height
    })
  } catch (error) {
    await chrome.storage.local.set({ lastError: String(error) })
    console.error('截图失败:', error)
  }
})

// 编辑器页直接经 chrome.storage 读取（editor-entry 适配器自行处理），后台仅提供续编入库。
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'screenshot.save' && message?.type !== 'screenshot.load') return
  void (async () => {
    try {
      if (message.type === 'screenshot.save') {
        await saveCapture(message.payload)
        sendResponse({ ok: true })
      } else {
        sendResponse({ ok: true, payload: await loadCapture(message.captureId) })
      }
    } catch (error) {
      sendResponse({ ok: false, error: String(error) })
    }
  })()
  return true
})
