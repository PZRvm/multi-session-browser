/* eslint @typescript-eslint/explicit-function-return-type: off -- 独立验证脚本使用原生 JavaScript，sandbox preload 使用 CommonJS */
// 仅工具内草案：不暴露生产IPC，也不宣称真实采集已通过。
const METHODS = new Set([
  'handshake',
  'capture',
  'image.copy',
  'image.save',
  'recording.start',
  'recording.pause',
  'recording.resume',
  'recording.stop',
  'recording.status',
  'install.status'
])
function fail(code) {
  throw Object.assign(new Error(code), { code })
}
export function checkRequest(request, context) {
  if (!context.trusted || !context.topFrame || !context.sameSession) fail('UNAUTHORIZED')
  if (!request || typeof request !== 'object' || request.protocol !== 1)
    fail('PROTOCOL_UNSUPPORTED')
  if (typeof request.requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(request.requestId))
    fail('INVALID_REQUEST')
  if (!METHODS.has(request.method)) fail('CAPABILITY_UNSUPPORTED')
  if (!context.target?.alive || request.target !== context.target.token) fail('TARGET_GONE')
  return request
}
export function checkSnapshot(expected, actual) {
  if (!actual || actual.id !== expected.id || actual.version !== expected.version)
    fail('SNAPSHOT_STALE')
}
export function classifyInstall(results) {
  if (!Array.isArray(results) || results.length === 0) return 'not-loaded'
  const n = results.filter((v) => v.ok === true).length
  return n === results.length ? 'ready' : n === 0 ? 'failed' : 'partial'
}
export function createRecordingModel() {
  let state = 'idle',
    generation = 0,
    seq = 0,
    closed = false,
    subscriptionId = 0,
    observerFailures = 0
  const listeners = new Map()
  const status = () => Object.freeze({ state, generation, seq, closed })
  const notify = () => {
    seq++
    const event = status()
    for (const [id, listener] of listeners) {
      try {
        listener(event)
      } catch {
        listeners.delete(id)
        observerFailures++
      }
    }
  }
  const api = {
    state: () => state,
    status,
    observerFailures: () => observerFailures,
    subscribe(listener) {
      if (closed) fail('TARGET_GONE')
      if (typeof listener !== 'function') fail('INVALID_REQUEST')
      if (listeners.size >= 32) fail('BUSY')
      const id = ++subscriptionId
      listeners.set(id, listener)
      try {
        listener(status())
      } catch {
        listeners.delete(id)
        observerFailures++
      }
      return () => listeners.delete(id)
    },
    start() {
      if (closed) fail('TARGET_GONE')
      if (state !== 'idle') fail('BUSY')
      state = 'starting'
      generation++
      notify()
      return generation
    },
    ready(value) {
      if (closed || value !== generation || state !== 'starting') return false
      state = 'recording'
      notify()
      return true
    },
    pause() {
      if (state !== 'recording') fail('INVALID_STATE')
      state = 'paused'
      notify()
    },
    resume() {
      if (state !== 'paused') fail('INVALID_STATE')
      state = 'recording'
      notify()
    },
    stop() {
      if (state === 'idle' || state === 'finalizing') return false
      generation++
      state = state === 'starting' ? 'idle' : 'finalizing'
      notify()
      return true
    },
    finish(value) {
      if (closed || state !== 'finalizing' || value !== generation) return false
      state = 'idle'
      notify()
      return true
    },
    close() {
      if (closed) return
      closed = true
      generation++
      state = 'idle'
      notify()
      listeners.clear()
    }
  }
  return api
}
