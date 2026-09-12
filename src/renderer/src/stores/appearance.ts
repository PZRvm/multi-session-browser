import { create } from 'zustand'
import type { AppearanceMode, AppearanceSnapshot, ResolvedTheme } from '../../../shared/appearance'

interface AppearanceState extends AppearanceSnapshot {
  setting: boolean
  init: () => Promise<void>
  setMode: (mode: AppearanceMode) => Promise<void>
}

const initialResolvedTheme: ResolvedTheme = window.matchMedia('(prefers-color-scheme: dark)')
  .matches
  ? 'dark'
  : 'light'

let initialized = false
let initializing: Promise<void> | null = null
let unsubscribe: (() => void) | null = null

const applySnapshot = (
  set: (partial: Partial<AppearanceState>) => void,
  snapshot: AppearanceSnapshot
): void => {
  set({ mode: snapshot.mode, resolvedTheme: snapshot.resolvedTheme })
}

export const useAppearanceStore = create<AppearanceState>((set, get) => ({
  mode: 'system',
  resolvedTheme: initialResolvedTheme,
  setting: false,

  // 订阅先于拉取，避免初始化窗口内漏掉主进程变更；模块级 Promise 让 StrictMode
  // 重入共享同一次初始化，HMR dispose 则精确移除当前有效 listener。
  init: () => {
    if (initialized) return Promise.resolve()
    if (initializing) return initializing

    initializing = (async () => {
      let currentUnsubscribe: (() => void) | null = null
      try {
        currentUnsubscribe = window.api.appearance.onChanged((snapshot) => {
          applySnapshot(set, snapshot)
        })
        unsubscribe = currentUnsubscribe
        applySnapshot(set, await window.api.appearance.getState())
        initialized = true
      } catch (error) {
        currentUnsubscribe?.()
        if (unsubscribe === currentUnsubscribe) unsubscribe = null
        initialized = false
        console.error('初始化外观模式失败', error)
      } finally {
        initializing = null
      }
    })()

    return initializing
  },

  // 不做乐观主题切换：成功后以主进程返回快照为准；失败恢复提交前快照。
  setMode: async (mode) => {
    const state = get()
    if (state.setting || state.mode === mode) return

    const previous: AppearanceSnapshot = {
      mode: state.mode,
      resolvedTheme: state.resolvedTheme
    }
    set({ setting: true })

    try {
      applySnapshot(set, await window.api.appearance.setMode({ mode }))
    } catch (error) {
      applySnapshot(set, previous)
      console.error('切换外观模式失败', error)
    } finally {
      set({ setting: false })
    }
  }
}))

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    unsubscribe?.()
    unsubscribe = null
    initialized = false
    initializing = null
  })
}
