/* global chrome */
chrome.runtime.onMessage.addListener((message) => {
  if (message.target !== 'collector') return
  void (async () => {
    let audio
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: message.streamId } },
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
      audio = new AudioContext()
      audio.createMediaStreamSource(stream).connect(audio.destination)
      await audio.resume()
      const { blob, info } = await window.preflightRecord(
        stream,
        window.preflightDuration,
        4000,
        3000
      )
      await chrome.runtime.sendMessage({ target: 'result', url: URL.createObjectURL(blob), info })
    } catch (error) {
      await chrome.runtime.sendMessage({ target: 'result', error: String(error) })
    } finally {
      if (audio) await audio.close()
    }
  })()
})
