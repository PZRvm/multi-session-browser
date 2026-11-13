/* global chrome */
/* eslint @typescript-eslint/explicit-function-return-type: off -- 插件弹窗为纯 JS 扩展代码 */
// 录屏工具栏弹窗（icon 化）：状态订阅 + 启动意图 + 暂停/恢复/取消/结束录制 + 音频开关。
// 弹窗关闭录制继续，重开查看状态；产物信息仅在结束后短暂呈现。
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
  if (!rec) {
    // 状态被清除（如解楔）时重置全部控件，避免残留上一轮的陈旧状态显示
    rec = { state: 'idle', audioEnabled: true }
  }
  $('state').textContent = STATE_TEXT[rec.state] ?? rec.state
  $('dot').className = 'dot' + (rec.state === 'idle' ? '' : ' ' + rec.state)
  const result = $('result')
  if (rec.info?.filename) {
    result.textContent =
      rec.info.reason === 'cancelled'
        ? ''
        : `已保存 ${rec.info.filename}${rec.info.reason === 'target-gone' ? '（标签页已关闭）' : ''}`
  } else if (rec.info?.reason === 'cancelled') {
    result.textContent = '已取消，本次录像未保存'
  } else {
    result.textContent = ''
  }
  $('error').textContent = rec.error ?? ''
  const busy = rec.state !== 'idle'
  $('start').disabled = busy
  $('pause').disabled = rec.state !== 'recording'
  $('resume').disabled = rec.state !== 'paused'
  $('cancel').disabled = !['starting', 'recording', 'paused'].includes(rec.state)
  $('stop').disabled = rec.state === 'idle' || rec.state === 'finalizing'
  $('audio').classList.toggle('off', rec.audioEnabled === false)
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

$('start').addEventListener('click', () => {
  $('error').textContent = ''
  // popup 点击即调用事件：同步发起取流（缺省捕获当前激活标签页），
  // 拿到 streamId 再移交 SW，避免调用态窗口在异步链路中过期
  chrome.tabCapture
    .getMediaStreamId()
    .then((streamId) => chrome.runtime.sendMessage({ target: 'sw', type: 'start', streamId }))
    .catch((error) => {
      $('error').textContent = String(error)
      render()
    })
})
$('pause').addEventListener('click', () => void send({ target: 'sw', type: 'pause' }))
$('resume').addEventListener('click', () => void send({ target: 'sw', type: 'resume' }))
$('stop').addEventListener('click', () => void send({ target: 'sw', type: 'stop' }))
// 取消：停止采集并丢弃本次产物（区别于结束录制=收尾落盘）
$('cancel').addEventListener('click', () => void send({ target: 'sw', type: 'cancel' }))
$('audio').addEventListener('click', () => {
  const next = rec?.audioEnabled === false
  void send({ target: 'sw', type: 'setAudio', value: next })
})

chrome.storage.local.get('rec', ({ rec: stored }) => {
  rec = stored ?? null
  render()
})
