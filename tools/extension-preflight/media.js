// 两端共用的验证录制器，纯 Web API，无 Node 或宿主特权。
window.preflightRecord = async function (
  stream,
  duration = 12000,
  pauseAt = 4000,
  pauseFor = 3000
) {
  let recorder
  const timers = []
  try {
    const candidates = [
      'video/mp4;codecs=avc1,mp4a.40.2',
      'video/mp4;codecs=avc1,opus',
      'video/mp4'
    ]
    const supported = Object.fromEntries(
      candidates.map((x) => [x, MediaRecorder.isTypeSupported(x)])
    )
    const mimeType = candidates.find((x) => supported[x])
    if (!mimeType) throw new Error('无可用MP4编码')
    const tracks = stream
      .getTracks()
      .map((t) => ({ kind: t.kind, label: t.label, settings: t.getSettings() }))
    const chunks = []
    recorder = new MediaRecorder(stream, { mimeType })
    // 开始前挂载结束与错误处理，早期编码错误立即进入finally，不等录制时长。
    await new Promise((resolve, reject) => {
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data)
      }
      recorder.onstop = resolve
      recorder.onerror = (event) => reject(new Error(event.error?.message || 'MediaRecorder错误'))
      recorder.start(500)
      timers.push(
        setTimeout(() => {
          if (recorder.state === 'recording') recorder.pause()
        }, pauseAt)
      )
      timers.push(
        setTimeout(() => {
          if (recorder.state === 'paused') recorder.resume()
        }, pauseAt + pauseFor)
      )
      timers.push(
        setTimeout(() => {
          if (recorder.state !== 'inactive') recorder.stop()
        }, duration)
      )
    })
    if (chunks.length === 0) throw new Error('录制没有生成媒体分块')
    return {
      blob: new Blob(chunks, { type: mimeType }),
      info: { mimeType, supported, tracks, duration, pauseFor }
    }
  } finally {
    timers.forEach(clearTimeout)
    stream.getTracks().forEach((t) => t.stop())
    if (recorder && recorder.state !== 'inactive') recorder.stop()
  }
}
