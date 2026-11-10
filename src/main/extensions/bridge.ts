/**
 * 协议v1 生产桥（E线，M3）。
 * 分层：IPC handler 校验 sender 身份（event.sender/frame/session 对照目标绑定）；
 * endpoint 层只管 target 生命周期（alive/导航撤销），异步返回前重校验。
 * 二进制：PNG 独立 ArrayBuffer 参数，单图≤32MiB、暂存≤64MiB、摘要参与校验、解码后才复制。
 */
import { createHash, randomUUID } from 'node:crypto'
import { ipcMain, type Session, type WebContents } from 'electron'
import {
  checkRequest,
  createEndpoint,
  errorReply,
  MAX_IMAGE_BYTES,
  MAX_STAGED_BYTES,
  type BridgeOperation,
  type BridgeRequest,
  type BridgeResponse,
  type RequestContext
} from '../../shared/extensions/protocol'

/** PNG 载荷校验（协议v1 checkImagePayload 同源：魔数/IHDR/尺寸/像素上限/摘要一致） */
function checkImagePayload(
  meta: { width: number; height: number; mimeType: string; sha256: string } | undefined,
  bytes: Buffer
): { width: number; height: number } {
  const pngMagic = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const valid =
    !!meta &&
    meta.mimeType === 'image/png' &&
    bytes.length >= 24 &&
    bytes.length <= MAX_IMAGE_BYTES &&
    bytes.subarray(0, 8).equals(pngMagic) &&
    bytes.toString('latin1', 12, 16) === 'IHDR' &&
    meta.width === bytes.readUInt32BE(16) &&
    meta.height === bytes.readUInt32BE(20) &&
    /^[a-f0-9]{64}$/.test(meta.sha256) &&
    createHash('sha256').update(bytes).digest('hex') === meta.sha256
  if (!valid) throw Object.assign(new Error('INVALID_REQUEST'), { code: 'INVALID_REQUEST' })
  return { width: meta.width, height: meta.height }
}

interface TargetEntry {
  token: string
  alive: boolean
  wc: WebContents
  session: Session
  endpoint: ReturnType<typeof createEndpoint>
  staged: Map<string, Buffer>
  stagedBytes: number
  onNavigated: () => void
}

const targets = new Map<string, TargetEntry>()
let handlerAttached = false

function contextForEvent(
  event: Electron.IpcMainInvokeEvent,
  entry: TargetEntry | undefined
): RequestContext {
  const sender = event.sender
  const frame = event.senderFrame
  return {
    trusted: !!(entry && !sender.isDestroyed() && sender === entry.wc),
    topFrame: !!(frame && frame === frame.top),
    sameSession: !!(entry && sender.session === entry.session),
    target: entry ? { token: entry.token, alive: entry.alive } : undefined
  }
}

function attachHandler(): void {
  if (handlerAttached) return
  handlerAttached = true
  ipcMain.handle(
    'msb:extension-bridge',
    (event, payload: unknown, binary: unknown): Promise<BridgeResponse> => {
      const token = (payload as { target?: string } | null)?.target
      const entry = token ? targets.get(token) : undefined
      try {
        checkRequest(payload, contextForEvent(event, entry))
      } catch (error) {
        return Promise.resolve(errorReply(payload, error))
      }
      if (!entry) return Promise.resolve(errorReply(payload, { code: 'UNAUTHORIZED' }))
      const request = payload as BridgeRequest
      let staged = false
      if (binary !== undefined) {
        if (!(binary instanceof ArrayBuffer) || request.method !== 'image.copy') {
          return Promise.resolve(errorReply(payload, { code: 'INVALID_REQUEST' }))
        }
        try {
          const bytes = Buffer.from(binary)
          checkImagePayload(request.image, bytes)
          if (
            !entry.staged.has(request.requestId) &&
            entry.stagedBytes + bytes.length > MAX_STAGED_BYTES
          ) {
            return Promise.resolve(errorReply(payload, { code: 'BUSY' }))
          }
          entry.staged.set(request.requestId, bytes)
          entry.stagedBytes += bytes.length
          staged = true
        } catch (error) {
          return Promise.resolve(errorReply(payload, error))
        }
      }
      return entry.endpoint.request(payload).finally(() => {
        if (staged) {
          const bytes = entry.staged.get(request.requestId)
          if (bytes) {
            entry.stagedBytes -= bytes.length
            entry.staged.delete(request.requestId)
          }
        }
      })
    }
  )
}

export interface BridgeTarget {
  token: string
  /** 手动失效（宿主关闭目标等）；导航撤销已自动挂钩 */
  setAlive(alive: boolean): void
  release(): void
}

/**
 * 注册目标：宿主生成不可预测 token，绑定 wc/会话；did-navigate 自动撤销（协议v1
 * 来源导航撤销语义）。operations 由接线方提供（capture/image.copy 等）。
 */
export function registerBridgeTarget(
  wc: WebContents,
  session: Session,
  operations: Record<string, BridgeOperation>
): BridgeTarget {
  const token = randomUUID()
  const entry: TargetEntry = {
    token,
    alive: true,
    wc,
    session,
    endpoint: createEndpoint(
      () => ({
        trusted: true,
        topFrame: true,
        sameSession: true,
        target: { token, alive: entry.alive }
      }),
      operations
    ),
    staged: new Map(),
    stagedBytes: 0,
    onNavigated: () => {
      entry.alive = false
    }
  }
  wc.on('did-navigate', entry.onNavigated)
  targets.set(token, entry)
  attachHandler()
  return {
    token,
    setAlive: (alive: boolean) => {
      entry.alive = alive
    },
    release: () => {
      entry.alive = false
      wc.off('did-navigate', entry.onNavigated)
      targets.delete(token)
    }
  }
}
