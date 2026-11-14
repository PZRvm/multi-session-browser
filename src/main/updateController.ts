import type { UpdatePolicy, UpdateSnapshot, UpdateError } from '../shared/updates'

// 最小适配面可注入受控源；生产下载、版本选择和验签由平台更新引擎承担。
export interface UpdateEngine {
  check(): Promise<void>
  download(): Promise<void>
  install(): void
}
export interface UpdateControllerDeps {
  version: string
  policy: UpdatePolicy
  enabled: boolean
  engine: UpdateEngine
  publish(state: UpdateSnapshot): void
  confirm(): Promise<boolean>
  busy(): boolean | Promise<boolean>
  prepare(): Promise<void>
  resume(): void
  beforeInstall(): void
  prepareTimeout?: number
}
export function createUpdateController(deps: UpdateControllerDeps): {
  getState(): UpdateSnapshot
  check(): Promise<UpdateSnapshot>
  download(): Promise<UpdateSnapshot>
  install(): Promise<UpdateSnapshot>
  available(version: string, notes?: string, releaseDate?: string | null): void
  latest(): void
  downloaded(version: string): void
  progress(transferred: number, total: number, percent: number): void
  engineError(error?: 'install' | 'signature' | 'installTimeout'): void
  cancelled(): void
  handoffBlocked(): void
} {
  let state: UpdateSnapshot = {
    revision: 0,
    currentVersion: deps.version,
    policy: deps.policy,
    status: deps.policy.showHeaderEntry || deps.policy.showSettingsEntry ? 'idle' : 'disabled',
    releaseNotes: '',
    releaseDate: null,
    candidateVersion: null,
    downloadedVersion: null,
    progress: null,
    error: null
  }
  let operation: Promise<UpdateSnapshot> | null = null
  let installHandoff = false
  let lastProgress = 0
  const snapshot = (): UpdateSnapshot => structuredClone(state)
  const set = (patch: Partial<UpdateSnapshot>): void => {
    state = { ...state, ...patch, revision: state.revision + 1 }
    deps.publish(snapshot())
  }
  const fail = (error: UpdateError): void => set({ status: 'error', error })
  const allowed = (): boolean => {
    if (state.status === 'disabled') return false
    if (!deps.enabled) {
      fail('development')
      return false
    }
    return true
  }
  const single = (run: () => Promise<void>): Promise<UpdateSnapshot> => {
    if (operation) return operation
    // 先持锁，再运行任何可能同步发出事件的引擎操作。
    operation = Promise.resolve()
      .then(run)
      .then(snapshot)
      .finally(() => {
        operation = null
      })
    return operation
  }
  return {
    getState: snapshot,
    check() {
      if (!allowed()) return Promise.resolve(snapshot())
      if (operation) return operation
      if (state.downloadedVersion || state.status === 'downloading')
        return Promise.resolve(snapshot())
      return single(async () => {
        set({
          status: 'checking',
          error: null,
          candidateVersion: null,
          releaseNotes: '',
          releaseDate: null,
          progress: null
        })
        try {
          await deps.engine.check()
        } catch (error) {
          if ((error as { updateError?: string })?.updateError === 'cancelled')
            set({ status: 'idle', error: null })
          else fail('check')
        }
      })
    },
    download() {
      if (!allowed()) return Promise.resolve(snapshot())
      if (operation) return operation
      if (!state.candidateVersion || state.downloadedVersion) return Promise.resolve(snapshot())
      return single(async () => {
        set({ status: 'downloading', error: null, progress: null })
        try {
          await deps.engine.download()
        } catch (error) {
          const code = (error as { updateError?: string })?.updateError
          if (code === 'cancelled') set({ status: 'available', error: null })
          else fail(code === 'signature' ? 'signature' : 'download')
        }
      })
    },
    install() {
      if (!allowed()) return Promise.resolve(snapshot())
      if (operation) return operation
      if (!state.downloadedVersion || installHandoff) return Promise.resolve(snapshot())
      return single(async () => {
        const version = state.downloadedVersion
        if (!(await deps.confirm())) return
        if (version !== state.downloadedVersion) return
        if (await deps.busy()) {
          fail('recording')
          return
        }
        set({ status: 'preparing', error: null })
        let expired = false
        let prepared = false
        // 超时只标记失败；仍等待实际写入落定再恢复，绝不并发重试或调用安装。
        const timeout = setTimeout(() => {
          expired = true
          set({ error: 'save' })
        }, deps.prepareTimeout ?? 15000)
        try {
          await deps.prepare()
          if (expired) throw new Error('更新保存超时')
          if (await deps.busy()) throw new Error('更新准备期出现录屏')
          if (expired) throw new Error('更新保存超时')
          if (version !== state.downloadedVersion || state.error) throw new Error('更新候选已失效')
          clearTimeout(timeout)
          prepared = true
          installHandoff = true
          deps.beforeInstall()
          set({ status: 'installing' })
          deps.engine.install()
        } catch {
          clearTimeout(timeout)
          installHandoff = false
          deps.resume()
          fail(prepared ? 'install' : 'save')
        }
      })
    },
    available(version, notes = '', releaseDate = null) {
      set({
        status: 'available',
        candidateVersion: version,
        releaseNotes: notes,
        releaseDate,
        error: null
      })
    },
    latest() {
      set({
        status: 'up-to-date',
        candidateVersion: null,
        releaseNotes: '',
        releaseDate: null,
        error: null
      })
    },
    downloaded(version) {
      set({
        status: 'ready',
        candidateVersion: version,
        downloadedVersion: version,
        error: null,
        progress: null
      })
    },
    progress(transferred, total, percent) {
      if (state.status !== 'downloading' || Date.now() - lastProgress < 150) return
      lastProgress = Date.now()
      set({
        progress: {
          transferred,
          total,
          percent:
            total > 0 && Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : null
        }
      })
    },
    engineError(error = 'install') {
      if (installHandoff) {
        installHandoff = false
        deps.resume()
        fail(error)
      } else if (state.downloadedVersion) {
        set({ status: 'error', error: 'download', downloadedVersion: null })
      }
      // 检查/下载错误在对应 Promise 的 catch 中处理，避免重复恢复或覆盖 preparing。
    },
    cancelled() {
      set({
        ...(state.status === 'ready'
          ? { status: state.candidateVersion ? 'available' : 'idle' }
          : {}),
        downloadedVersion: null,
        progress: null
      })
    },
    handoffBlocked() {
      if (installHandoff) set({ error: 'installTimeout' })
    }
  }
}
