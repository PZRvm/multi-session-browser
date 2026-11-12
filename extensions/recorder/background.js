/* eslint @typescript-eslint/explicit-function-return-type: off -- 插件后台/采集器为纯 JS 扩展代码 */
/* global chrome */
// 录屏插件后台：popup 内取 tabCapture streamId 后经消息启动；状态机对齐协议v1
// （idle→starting→recording↔paused→finalizing→idle，generation/seq 单调，晚到 ready 拒绝，
// 启动期取消落盘不回滚）。Chrome 侧用 storage + runtime 消息承载协议语义。

const IDLE = { state: 'idle', generation: 0, seq: 0, audioEnabled: true, error: null, info: null }

// SW 启动扫尾：上次会话若卡在 finalizing（收尾链异常中断且看门狗随 SW 一起消亡），
// 启动即自愈回 idle，避免永久楔死（start/cancel 都要求非 finalizing）
void (async () => {
  const rec = await readRec()
  if (rec.state === 'finalizing') {
    await patchRec({ state: 'idle', error: '上次收尾异常中断，已恢复' })
  }
})()

async function readRec() {
  const stored = await chrome.storage.local.get('rec')
  return stored.rec ?? { ...IDLE }
}

/** 每次状态变化 seq 单调递增，快照整体写入（订阅方经 storage.onChanged 收完整快照） */
async function patchRec(patch, { bumpSeq = true } = {}) {
  const rec = await readRec()
  const next = {
    ...rec,
    ...patch,
    seq: bumpSeq ? rec.seq + 1 : rec.seq,
    state: patch.state ?? rec.state,
    generation: patch.generation ?? rec.generation
  }
  await chrome.storage.local.set({ rec: next })
  return next
}

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })
  if (!contexts.length)
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA', 'BLOBS'],
      justification: '录制当前Tab画面与音频'
    })
}

// popup 启动指令：popup 点击即调用事件，streamId 已在 popup 同步取好移交 SW 分发
async function startRecording(message) {
  const rec = await readRec()
  if (rec.state !== 'idle') return
  if (!message.streamId) throw new Error('缺少采集流ID')
  await ensureOffscreen()
  const next = await patchRec({
    state: 'starting',
    generation: rec.generation + 1,
    error: null,
    info: null
  })
  await chrome.runtime.sendMessage({
    target: 'offscreen',
    type: 'start',
    streamId: message.streamId,
    audio: rec.audioEnabled,
    generation: next.generation
  })
}

// popup 指令中继到 offscreen（start/pause/resume/stop/setAudio）
chrome.runtime.onMessage.addListener((message) => {
  if (message?.target !== 'sw') return
  void (async () => {
    const rec = await readRec()
    if (message.type === 'start') {
      try {
        await startRecording(message)
      } catch (error) {
        await patchRec({ state: 'idle', error: String(error) })
      }
      return
    }
    if (message.type === 'stop') {
      if (rec.state === 'idle' || rec.state === 'finalizing') return
      await patchRec({ state: 'finalizing' })
      await chrome.runtime.sendMessage({ target: 'offscreen', type: 'stop' }).catch(() => {})
      // 收尾看门狗：下载链异常挂起时状态机永久收尾中、start/cancel 全部被忽略——
      // 15s 后仍未离开 finalizing 则解楔报错，用户可重试而非永久卡死
      setTimeout(() => {
        void (async () => {
          const cur = await readRec()
          if (cur.state === 'finalizing') {
            await patchRec({ state: 'idle', error: '录制收尾超时，请重试' })
          }
        })()
      }, 15000)
      return
    }
    if (message.type === 'cancel' && ['starting', 'recording', 'paused'].includes(rec.state)) {
      // 取消：丢弃本次产物（区别于停止=收尾落盘）
      await patchRec({ state: 'finalizing' })
      await chrome.runtime.sendMessage({ target: 'offscreen', type: 'cancel' }).catch(() => {})
      return
    }
    if (message.type === 'setAudio') {
      const patch = { audioEnabled: message.value }
      if (rec.state === 'recording' || rec.state === 'paused') patch.audioMutedLive = !message.value
      await patchRec(patch, { bumpSeq: false })
      await chrome.runtime
        .sendMessage({ target: 'offscreen', type: 'setAudio', value: message.value })
        .catch(() => {})
      return
    }
    if (rec.state !== 'recording' && rec.state !== 'paused') return
    if (message.type === 'pause') await patchRec({ state: 'paused' })
    if (message.type === 'resume') await patchRec({ state: 'recording' })
    await chrome.runtime.sendMessage({ target: 'offscreen', type: message.type }).catch(() => {})
  })()
})

// offscreen 结果回传：ready/paused/resumed/stopped/error
chrome.runtime.onMessage.addListener((message) => {
  if (message?.target !== 'sw-result') return
  void (async () => {
    const rec = await readRec()
    if (message.type === 'ready') {
      // 晚到 ready：generation 不匹配或状态已非 starting 时直接让采集器停止
      if (rec.state !== 'starting' || message.generation !== rec.generation) {
        await chrome.runtime.sendMessage({ target: 'offscreen', type: 'stop' }).catch(() => {})
        return
      }
      await patchRec({ state: 'recording' })
      return
    }
    if (message.type === 'paused' && rec.state === 'recording') {
      await patchRec({ state: 'paused' })
      return
    }
    if (message.type === 'resumed' && rec.state === 'paused') {
      await patchRec({ state: 'recording' })
      return
    }
    if (message.type === 'stopped') {
      // 收尾（finalizing）：产物已产生就落盘，不回滚已提交副作用；完成后 finish → idle
      await patchRec({ state: 'finalizing' })
      try {
        if (message.url) {
          const filename = `recording-${rec.generation}.mp4`
          const downloadId = await chrome.downloads.download({
            url: message.url,
            filename,
            saveAs: false
          })
          await patchRec({
            state: 'idle',
            info: { ...message.info, filename, downloadId, reason: message.reason ?? 'user' }
          })
        } else if (message.reason === 'cancelled') {
          // 取消：不落盘、不算失败
          await patchRec({ state: 'idle', info: { reason: 'cancelled' }, error: null })
        } else {
          await patchRec({ state: 'idle', error: message.reason ?? '无产物' })
        }
      } catch (error) {
        await patchRec({ state: 'idle', error: String(error) })
      }
      return
    }
    if (message.type === 'error') {
      // 启动期失败回滚到 idle；录制期失败保已录内容走收尾
      if (rec.state === 'starting') {
        await patchRec({ state: 'idle', error: message.message })
      } else {
        await patchRec({ state: 'idle', error: message.message })
      }
    }
  })()
})
