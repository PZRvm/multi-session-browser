/**
 * 协议v1 生产实现（E线，移植自前置 protocol-v1.mjs/contracts.mjs，行为同源）：
 * 信封、错误码、请求校验、有界幂等账本端点、录屏状态机。
 */
export const PROTOCOL_VERSION = 1
export const MAX_REQUEST_BYTES = 4096
export const MAX_ENTRIES_PER_TARGET = 128
export const DEFAULT_TIMEOUT_MS = 5000
export const MAX_IMAGE_BYTES = 32 * 1024 * 1024
export const MAX_PIXELS = 64 * 1024 * 1024
export const MAX_STAGED_BYTES = 64 * 1024 * 1024

export type ErrorCode =
  | 'UNAUTHORIZED'
  | 'PROTOCOL_UNSUPPORTED'
  | 'INVALID_REQUEST'
  | 'CAPABILITY_UNSUPPORTED'
  | 'TARGET_GONE'
  | 'SNAPSHOT_STALE'
  | 'BUSY'
  | 'INVALID_STATE'
  | 'TIMEOUT'
  | 'CANCELLED'

export interface BridgeRequest {
  protocol: number
  requestId: string
  method: string
  target: string
  snapshot?: { id: string; version: number }
  image?: { width: number; height: number; mimeType: string; sha256: string }
}

export interface BridgeError {
  code: string
}

export type BridgeResponse =
  | { protocol: number; requestId: string | null; ok: true; value: unknown }
  | { protocol: number; requestId: string | null; ok: false; error: BridgeError }

export interface RequestContext {
  trusted: boolean
  topFrame: boolean
  sameSession: boolean
  target?: { token: string; alive: boolean }
}

const METHODS = new Set<string>([
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

function fail(code: string): never {
  throw Object.assign(new Error(code), { code })
}

/** 请求校验（协议v1 checkRequest 同源） */
export function checkRequest(request: unknown, context: RequestContext): void {
  const r = request as BridgeRequest
  if (!context.trusted || !context.topFrame || !context.sameSession) fail('UNAUTHORIZED')
  if (!r || typeof r !== 'object' || r.protocol !== PROTOCOL_VERSION) fail('PROTOCOL_UNSUPPORTED')
  if (typeof r.requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(r.requestId))
    fail('INVALID_REQUEST')
  if (!METHODS.has(r.method)) fail('CAPABILITY_UNSUPPORTED')
  if (!context.target?.alive || r.target !== context.target.token) fail('TARGET_GONE')
}

export const ERROR_CODES: readonly ErrorCode[] = [
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
]

/** 非法 requestId 回传 null 的错误信封（协议v1 errorReply 同源） */
export function errorReply(request: unknown, error: unknown): BridgeResponse {
  const r = request as { requestId?: unknown } | null
  const valid = typeof r?.requestId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(r.requestId)
  const code = ERROR_CODES.includes(error as never)
    ? (error as ErrorCode)
    : (error as { code?: unknown })?.code &&
        ERROR_CODES.includes((error as { code: string }).code as ErrorCode)
      ? (error as { code: ErrorCode }).code
      : 'INTERNAL'
  return {
    protocol: PROTOCOL_VERSION,
    requestId: valid ? (r as { requestId: string }).requestId : null,
    ok: false,
    error: { code }
  }
}

/**
 * 有界幂等账本端点（协议v1 createEndpoint 同源）：
 * 同ID同JSON复用原Promise、同ID异JSON拒绝、账本满BUSY、超时/取消/关闭撤销。
 */
export type BridgeOperation = (
  request: BridgeRequest,
  signal: AbortSignal
) => Promise<unknown> | unknown

export interface EndpointHandle {
  request(payload: unknown): Promise<BridgeResponse>
  cancel(id: string): void
  close(): void
}

export function createEndpoint(
  context: () => RequestContext,
  operations: Record<string, BridgeOperation>,
  options?: { timeoutMs?: number; maxEntries?: number }
): EndpointHandle {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxEntries = options?.maxEntries ?? MAX_ENTRIES_PER_TARGET
  const requests = new Map<
    string,
    { fingerprint: string; promise: Promise<BridgeResponse>; reject: (code: string) => void }
  >()
  let closed = false
  function request(payload: unknown): Promise<BridgeResponse> {
    try {
      if (closed) throw Object.assign(new Error('TARGET_GONE'), { code: 'TARGET_GONE' })
      checkRequest(payload, context())
      const fingerprint = JSON.stringify(payload)
      if (Buffer.byteLength(fingerprint) > MAX_REQUEST_BYTES) fail('INVALID_REQUEST')
      const prior = requests.get((payload as BridgeRequest).requestId)
      if (prior) {
        if (prior.fingerprint !== fingerprint) fail('INVALID_REQUEST')
        return prior.promise
      }
      if (requests.size >= maxEntries) fail('BUSY')
      const operation = operations[(payload as BridgeRequest).method]
      if (!operation) fail('CAPABILITY_UNSUPPORTED')
      const controller = new AbortController()
      let settled = false
      let timer: NodeJS.Timeout | undefined
      let finish: (value: BridgeResponse) => void = () => undefined
      const reject = (code: string): void => {
        if (settled) return
        controller.abort()
        finish(errorReply(payload, { code }))
      }
      const promise = new Promise<BridgeResponse>((resolve) => {
        finish = (value: BridgeResponse): void => {
          if (settled) return
          settled = true
          if (timer) clearTimeout(timer)
          resolve(value)
        }
        timer = setTimeout(() => reject('TIMEOUT'), timeoutMs)
        void Promise.resolve()
          .then(() =>
            controller.signal.aborted
              ? undefined
              : operation(payload as BridgeRequest, controller.signal)
          )
          .then(
            (value) => {
              if (settled) return
              try {
                checkRequest(payload, context())
                finish({
                  protocol: 1,
                  requestId: (payload as BridgeRequest).requestId,
                  ok: true,
                  value
                })
              } catch (error) {
                finish(errorReply(payload, error))
              }
            },
            (error) => finish(errorReply(payload, error))
          )
      })
      requests.set((payload as BridgeRequest).requestId, { fingerprint, promise, reject })
      return promise
    } catch (error) {
      return Promise.resolve(errorReply(payload, error))
    }
  }
  return {
    request,
    cancel: (id) => requests.get(id)?.reject('CANCELLED'),
    close: () => {
      closed = true
      for (const entry of requests.values()) entry.reject('TARGET_GONE')
      requests.clear()
    }
  }
}
