/* eslint @typescript-eslint/explicit-function-return-type: off -- 独立前置契约夹具，不接入生产桥 */
import { checkRequest } from './contracts.mjs'
const CODES = new Set([
  'UNAUTHORIZED',
  'PROTOCOL_UNSUPPORTED',
  'INVALID_REQUEST',
  'CAPABILITY_UNSUPPORTED',
  'TARGET_GONE',
  'SNAPSHOT_STALE',
  'BUSY',
  'INVALID_STATE',
  'TIMEOUT',
  'CANCELLED'
])
export function errorReply(request, error) {
  return {
    protocol: 1,
    requestId:
      typeof request?.requestId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(request.requestId)
        ? request.requestId
        : null,
    ok: false,
    error: { code: CODES.has(error?.code) ? error.code : 'INTERNAL' }
  }
}
// 有界请求账本仅属于本工具；生产操作仍需实现自己的事务及AbortSignal检查。
export function createEndpoint(context, operations, { timeoutMs = 5000, maxEntries = 128 } = {}) {
  const requests = new Map()
  let closed = false
  function request(payload) {
    try {
      if (closed) throw Object.assign(new Error(), { code: 'TARGET_GONE' })
      checkRequest(payload, context())
      const fingerprint = JSON.stringify(payload)
      if (Buffer.byteLength(fingerprint) > 4096)
        throw Object.assign(new Error(), { code: 'INVALID_REQUEST' })
      const prior = requests.get(payload.requestId)
      if (prior) {
        if (prior.fingerprint !== fingerprint)
          throw Object.assign(new Error(), { code: 'INVALID_REQUEST' })
        return prior.promise
      }
      if (requests.size >= maxEntries) throw Object.assign(new Error(), { code: 'BUSY' })
      const operation = operations[payload.method]
      if (!operation) throw Object.assign(new Error(), { code: 'CAPABILITY_UNSUPPORTED' })
      const controller = new AbortController()
      let finish,
        timer,
        settled = false
      const promise = new Promise((resolve) => {
        finish = (value) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve(value)
        }
      })
      const reject = (code) => {
        if (settled) return
        controller.abort()
        finish(errorReply(payload, { code }))
      }
      const entry = { fingerprint, promise, reject }
      requests.set(payload.requestId, entry)
      timer = setTimeout(() => reject('TIMEOUT'), timeoutMs)
      Promise.resolve()
        .then(() => {
          if (!controller.signal.aborted) return operation(payload, controller.signal)
        })
        .then(
          (value) => {
            if (settled) return
            try {
              checkRequest(payload, context())
              finish({ protocol: 1, requestId: payload.requestId, ok: true, value })
            } catch (error) {
              finish(errorReply(payload, error))
            }
          },
          (error) => finish(errorReply(payload, error))
        )
      return promise
    } catch (error) {
      return Promise.resolve(errorReply(payload, error))
    }
  }
  return {
    request,
    cancel(id) {
      requests.get(id)?.reject('CANCELLED')
    },
    close() {
      closed = true
      for (const entry of requests.values()) entry.reject('TARGET_GONE')
      requests.clear()
    }
  }
}
