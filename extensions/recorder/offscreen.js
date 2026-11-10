/* eslint @typescript-eslint/explicit-function-return-type: off -- 插件后台/采集器为纯 JS 扩展代码 */
/* global chrome */
// 录屏采集器（offscreen 文档）：getUserMedia 拿 Tab 流 → MediaRecorder MP4。
// 手动控制（start/pause/resume/stop/cancel/setAudio），目标关闭经 track ended 上报。

let stream = null
let recorder = null
let chunks = []
let audioCtx = null
let generation = 0
let audioTrack = null
let cancelRequested = false
let stopReason = 'user'
let startedAt = 0

function report(message) {
  return chrome.runtime.sendMessage({ target: 'sw-result', ...message }).catch(() => {})
}

/** MP4 编码候选，与前置验证一致的探测顺序 */
function pickMime() {
  const candidates = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1,opus', 'video/mp4']
  for (const mime of candidates) if (MediaRecorder.isTypeSupported(mime)) return mime
  throw new Error('无可用MP4编码')
}

async function cleanup() {
  try {
    if (recorder && recorder.state !== 'inactive') recorder.stop()
  } catch {
    /* 已停 */
  }
  stream?.getTracks().forEach((t) => t.stop())
  if (audioCtx) {
    await audioCtx.close().catch(() => {})
    audioCtx = null
  }
}

async function start(message) {
  if (recorder && recorder.state !== 'inactive') {
    await report({ type: 'error', generation, message: '采集器忙碌' })
    return
  }
  generation = message.generation
  cancelRequested = false
  stopReason = 'user'
  chunks = []
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: message.audio
        ? { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: message.streamId } }
        : false,
      video: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: message.streamId,
          maxWidth: 1280,
          maxHeight: 720,
          maxFrameRate: 15
        }
      }
    })
    // 音频轨在才回放保活（与前置验证一致）；纯视频录制不建音频上下文
    if (message.audio) {
      audioCtx = new AudioContext()
      audioCtx.createMediaStreamSource(stream).connect(audioCtx.destination)
      await audioCtx.resume()
    }
    audioTrack = stream.getAudioTracks()[0] ?? null
    const mimeType = pickMime()
    recorder = new MediaRecorder(stream, { mimeType })
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data)
    }
    recorder.onstop = async () => {
      const blob = chunks.length ? new Blob(chunks, { type: mimeType }) : null
      const info = {
        mimeType,
        duration: (Date.now() - startedAt) / 1000,
        audioIncluded: Boolean(audioTrack),
        audioMutedLive: audioTrack ? !audioTrack.enabled : false,
        chunkCount: chunks.length
      }
      const reason = cancelRequested ? 'cancelled' : stopReason
      // 取消：不生成下载产物，blob 随之丢弃
      const url = blob && reason !== 'cancelled' ? URL.createObjectURL(blob) : null
      await cleanup()
      await report({ type: 'stopped', generation, reason, url, info })
    }
    startedAt = Date.now()
    recorder.onerror = (event) => {
      stopReason = 'recorder-error'
      void report({
        type: 'error',
        generation,
        message: event.error?.message ?? 'MediaRecorder错误'
      })
    }
    // 目标关闭：track ended / 流内轨道移除 → 保已录内容收尾
    const onTargetGone = () => {
      if (stopReason === 'user') stopReason = 'target-gone'
      if (recorder && recorder.state !== 'inactive') recorder.stop()
    }
    stream.getVideoTracks()[0]?.addEventListener('ended', onTargetGone)
    stream.addEventListener('removetrack', onTargetGone)
    recorder.start(500)
    await report({ type: 'ready', generation })
  } catch (error) {
    await cleanup()
    await report({ type: 'error', generation, message: String(error) })
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.target !== 'offscreen') return
  void (async () => {
    switch (message.type) {
      case 'start':
        await start(message)
        return
      case 'pause':
        if (recorder?.state === 'recording') {
          recorder.pause()
          audioTrack && (audioTrack.enabled = false)
          await report({ type: 'paused' })
        }
        return
      case 'resume':
        if (recorder?.state === 'paused') {
          recorder.resume()
          audioTrack && (audioTrack.enabled = true)
          await report({ type: 'resumed' })
        }
        return
      case 'stop':
        stopReason = 'user'
        if (recorder?.state !== 'inactive') recorder.stop()
        return
      case 'cancel':
        cancelRequested = true
        stopReason = 'cancelled-start'
        if (recorder?.state !== 'inactive') recorder.stop()
        else if (!recorder) await cleanup()
        return
      case 'setAudio':
        if (audioTrack) audioTrack.enabled = message.value
        return
    }
  })()
})
