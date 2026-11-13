/* global chrome */
chrome.action.onClicked.addListener(async (tab) => {
  try {
    const capturePNG = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' })
    await chrome.storage.local.set({ capturePNG, recording: 'starting', targetTabId: tab.id })
    await chrome.downloads.download({
      url: capturePNG,
      filename: 'msb-preflight-target.png',
      saveAs: false
    })
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })
    if (!contexts.length)
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['USER_MEDIA', 'BLOBS'],
        justification: '隔离环境验证当前Tab画面和音频'
      })
    const id = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id })
    await chrome.runtime.sendMessage({ target: 'collector', streamId: id })
  } catch (error) {
    await chrome.storage.local.set({ recording: 'failed', error: String(error) })
  }
})
chrome.runtime.onMessage.addListener((message) => {
  if (message.target !== 'result') return
  void (async () => {
    if (message.error) {
      await chrome.storage.local.set({ recording: 'failed', error: message.error })
      return
    }
    const downloadId = await chrome.downloads.download({
      url: message.url,
      filename: 'msb-preflight-tab-audio.mp4',
      saveAs: false
    })
    await chrome.storage.local.set({ recording: 'done', info: message.info, downloadId })
  })().catch(async (error) => {
    await chrome.storage.local.set({ recording: 'failed', error: String(error) })
  })
})
