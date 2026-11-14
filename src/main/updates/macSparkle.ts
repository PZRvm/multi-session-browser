import { app } from 'electron'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import type { UpdateEngine } from '../updateController'
import { normalizeUpdateNotes, normalizeUpdateDate } from '../updateReleaseNotes'

type Failure = 'check' | 'download' | 'install' | 'signature' | 'installTimeout' | 'cancelled'
interface NativeBridge {
  initialize(callback: (json: string) => void): void
  command(action: 'check' | 'download' | 'install' | 'cancel', version?: string): void
}
interface Pending {
  resolve(): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}
function failure(code: Failure): Error & { updateError: Failure } {
  return Object.assign(new Error(`Sparkle 更新操作失败：${code}`), { updateError: code })
}
export function createMacSparkle(deps: {
  available(version: string, notes: string, date: string | null): void
  latest(): void
  downloaded(version: string): void
  progress(transferred: number, total: number, percent: number): void
  installFailure(code: 'install' | 'signature' | 'installTimeout'): void
  cancelFailure(): void
  lateCancellation(): void
}): UpdateEngine & {
  cancel(): Promise<void>
  isActive(): boolean
  isCancelling(): boolean
  canQuitForInstall(): boolean
} {
  let native: NativeBridge | undefined
  let phase = 'idle'
  let generation = 0
  let version = ''
  let check: Pending | undefined
  let download: Pending | undefined
  let cancellation: Pending | undefined
  let cancelling: Promise<void> | undefined
  let cancelReason: Failure = 'cancelled'
  const settle = (pending: Pending | undefined, error?: Error): void => {
    if (!pending) return
    clearTimeout(pending.timer)
    if (error) pending.reject(error)
    else pending.resolve()
  }
  const cancel = (reason: Failure = 'cancelled'): Promise<void> => {
    if (cancelling) return cancelling
    if (!native) return Promise.resolve()
    cancelReason = reason
    phase = 'cancelling'
    cancelling = new Promise<void>((resolve, reject) => {
      cancellation = {
        resolve,
        reject,
        timer: setTimeout(() => reject(failure('installTimeout')), 20000)
      }
      try {
        native!.command('cancel')
      } catch (error) {
        settle(cancellation, error instanceof Error ? error : failure('install'))
      }
    })
      .catch((error: unknown) => {
        settle(check, failure(cancelReason))
        settle(download, failure(cancelReason))
        check = undefined
        download = undefined
        deps.cancelFailure()
        throw error
      })
      .finally(() => {
        if (cancellation) clearTimeout(cancellation.timer)
        cancellation = undefined
        cancelling = undefined
      })
    return cancelling
  }
  const renewDownload = (): void => {
    if (!download) return
    clearTimeout(download.timer)
    download.timer = setTimeout(() => {
      void cancel('download').catch((error: unknown) => console.warn('取消停滞下载失败:', error))
    }, 30000)
  }
  const receive = (json: string): void => {
    if (json.length > 100000) return
    let event: Record<string, unknown>
    try {
      event = JSON.parse(json) as Record<string, unknown>
    } catch {
      console.warn('Sparkle 返回无效事件')
      return
    }
    if (typeof event.generation !== 'number' || event.generation < generation) return
    generation = event.generation
    if (event.type === 'cancelled') {
      const late = !cancellation && phase === 'cancelling'
      phase = 'idle'
      settle(check, failure(cancelReason))
      settle(download, failure(cancelReason))
      check = undefined
      download = undefined
      settle(cancellation)
      if (late) deps.lateCancellation()
      return
    }
    if (cancelling || phase === 'cancelling') return
    const current = typeof event.version === 'string' ? event.version : ''
    if (event.type === 'available' && phase === 'checking' && /^\d+\.\d+\.\d+$/.test(current)) {
      version = current
      phase = 'available'
      const date = normalizeUpdateDate(
        typeof event.date === 'number' && event.date > 0 ? new Date(event.date).toString() : null
      )
      deps.available(version, normalizeUpdateNotes(event.notes, version), date)
      settle(check)
      check = undefined
    } else if (event.type === 'latest' && phase === 'checking') {
      deps.latest()
      settle(check)
      check = undefined
    } else if (event.type === 'progress' && phase === 'downloading') {
      renewDownload()
      if (
        [event.transferred, event.total, event.percent].every(
          (value) => typeof value === 'number' && Number.isFinite(value)
        )
      ) {
        deps.progress(event.transferred as number, event.total as number, event.percent as number)
      }
    } else if (event.type === 'heartbeat') {
      renewDownload()
    } else if (event.type === 'ready' && current === version && phase === 'downloading') {
      phase = 'ready'
      deps.downloaded(version)
      settle(download)
      download = undefined
    } else if (event.type === 'cycle-finished') {
      phase = 'idle'
    } else if (event.type === 'error') {
      console.warn('Sparkle 更新失败:', event.message)
      const code =
        event.signature === true
          ? 'signature'
          : phase === 'checking'
            ? 'check'
            : phase === 'installing'
              ? 'install'
              : 'download'
      const needsCancellation = phase === 'installing' || phase === 'ready'
      settle(check, failure(code))
      settle(download, failure(code))
      check = undefined
      download = undefined
      if (needsCancellation) {
        void cancel()
          .then(() => deps.installFailure(code === 'signature' ? 'signature' : 'install'))
          .catch((error: unknown) => console.warn('取消失败的安装交接未完成，保持安装门禁:', error))
      }
    }
  }
  const ensure = (): NativeBridge => {
    if (!native) {
      const requireNative = createRequire(join(app.getAppPath(), 'package.json'))
      const loaded = requireNative(
        join(process.resourcesPath, 'sparkle', 'bridge.node')
      ) as NativeBridge
      if (typeof loaded.initialize !== 'function' || typeof loaded.command !== 'function')
        throw new Error('Sparkle 原生模块接口不完整')
      loaded.initialize(receive)
      native = loaded
    }
    return native
  }
  const checkForUpdates = async (): Promise<void> => {
    if (phase !== 'idle') await cancel()
    const bridge = ensure()
    phase = 'checking'
    return new Promise<void>((resolve, reject) => {
      check = {
        resolve,
        reject,
        timer: setTimeout(() => {
          void cancel('check').catch((error: unknown) => console.warn('取消更新检查失败:', error))
        }, 30000)
      }
      try {
        bridge.command('check')
      } catch (error) {
        settle(check, error as Error)
        check = undefined
      }
    })
  }
  return {
    check: checkForUpdates,
    async download() {
      if (phase !== 'available') {
        const expected = version
        await checkForUpdates()
        if (version !== expected) throw failure('download')
      }
      const bridge = ensure()
      if (phase !== 'available' || !version) return Promise.reject(failure('download'))
      phase = 'downloading'
      return new Promise<void>((resolve, reject) => {
        download = { resolve, reject, timer: setTimeout(() => {}, 0) }
        renewDownload()
        try {
          bridge.command('download', version)
        } catch (error) {
          settle(download, error as Error)
          download = undefined
        }
      })
    },
    install() {
      if (!native || phase !== 'ready') throw failure('install')
      phase = 'installing'
      try {
        native.command('install', version)
      } catch (error) {
        phase = 'ready'
        throw error
      }
    },
    cancel: () => cancel(),
    isActive: () => phase !== 'idle',
    isCancelling: () => phase === 'cancelling',
    canQuitForInstall: () => phase === 'installing' && !cancelling
  }
}
