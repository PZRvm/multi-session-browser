/* eslint @typescript-eslint/explicit-function-return-type: off -- 插件后台/采集器为纯 JS 扩展代码 */
/* global chrome */
// 录屏控制面板：订阅 storage 快照（协议v1 状态订阅的 Chrome 承载），状态驱动按钮可用态。
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
  $('pause').disabled = rec.state !== 'recording'
  $('resume').disabled = rec.state !== 'paused'
  $('stop').disabled = rec.state === 'idle' || rec.state === 'finalizing'
  $('audio').checked = rec.audioEnabled !== false
  $('audio').disabled = false
}

// 协议v1 订阅语义的 Chrome 承载：storage.onChanged 每次给完整快照，seq 单调
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
