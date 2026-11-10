/* global chrome */
/* eslint @typescript-eslint/explicit-function-return-type: off -- 插件弹窗为纯 JS 扩展代码 */
// 录屏工具栏弹窗：状态订阅 + 启动意图（SW 在调用态内取 tabCapture 流）+
// 暂停/恢复/停止/音频开关经消息中继到 SW。弹窗关闭录制继续，重开查看状态。
const $ = (id) => document.getElementById(id)
const STATE_TEXT = {
  idle: '空闲',
  starting: '启动中',
  recording: '录制中',
  paused: '已暂停',
  finalizing: '收尾中'
}
let rec = null

function render() {
  if (!rec) return
  $('state').textContent = STATE_TEXT[rec.state] ?? rec.state
  const bits = [`generation=${rec.generation}`, `seq=${rec.seq}`]
  if (rec.info?.filename) bits.push(`产物 ${rec.info.filename}（${rec.info.reason}）`)
  $('meta').textContent = bits.join(' · ')
  $('error').textContent = rec.error ?? ''
  const busy = rec.state !== 'idle'
  $('start').disabled = busy || rec.state === 'starting'
  $('pause').disabled = rec.state !== 'recording'
  $('resume').disabled = rec.state !== 'paused'
  $('stop').disabled = rec.state === 'idle' || rec.state === 'finalizing'
  $('audio').checked = rec.audioEnabled !== false
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.rec) {
    rec = changes.rec.newValue
    render()
  }
})

async function send(message) {
  try {
    await chrome.runtime.sendMessage(message)
  } catch {
    /* offscreen 未起时静默 */
  }
}

$('start').addEventListener('click', async () => {
  $('start').disabled = true
  $('error').textContent = ''
  try {
    // popup 打开本身即扩展调用态；对当前激活标签页发启动意图，SW 在该窗口内取流
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) throw new Error('未找到当前标签页')
    await chrome.runtime.sendMessage({ target: 'sw', type: 'start', targetTabId: tab.id })
  } catch (error) {
    $('error').textContent = String(error)
    render()
  }
})
$('pause').addEventListener('click', () => void send({ target: 'sw', type: 'pause' }))
$('resume').addEventListener('click', () => void send({ target: 'sw', type: 'resume' }))
$('stop').addEventListener('click', () => void send({ target: 'sw', type: 'stop' }))
$('audio').addEventListener('change', (event) => {
  void send({ target: 'sw', type: 'setAudio', value: event.target.checked })
})

chrome.storage.local.get('rec', ({ rec: stored }) => {
  rec = stored ?? null
  render()
})
