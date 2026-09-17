import { create } from 'zustand'
import type { AppearanceMode, AppearanceSnapshot, ResolvedTheme } from '../../../shared/appearance'
import type { ThemeSystemId } from '../../../shared/themeSystems'
import { DICTIONARIES } from '../../../shared/i18n'
import { useI18nStore } from './i18n'

// 外观三态文案取词（板头 AppearanceEntry 与设置窗外观行同词消费）：阶段六 i18n 字典
// 接管后三态名归 sessions 命名空间跨簇共享键 sessions.appearanceGroup.modes（簇 A
// 定义），本函数按 i18n 镜像当前语言取词——组件在语言订阅的重渲染期调用即得新词；
// 本模块为非组件文件，非组件导出不触发 react-refresh 限制
export function appearanceText(mode: AppearanceMode): string {
  return DICTIONARIES[useI18nStore.getState().language].sessions.appearanceGroup.modes[mode]
}

interface AppearanceState extends AppearanceSnapshot {
  setting: boolean
  /** init 是否已用主进程真值回填（审查修复轮中 1：App/SettingsWindow 的 token 重注
   * effect 以此门控——初值 'amber' 只允许存在到 init 真值到达，防止晚到的镜像回填
   * 把 bootstrap 按建窗 sys 注入的非琥珀首帧打回琥珀） */
  initialized: boolean
  init: () => Promise<void>
  setMode: (mode: AppearanceMode) => Promise<void>
  setThemeColor: (themeColor: ThemeSystemId) => Promise<void>
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
  set({
    mode: snapshot.mode,
    resolvedTheme: snapshot.resolvedTheme,
    themeColor: snapshot.themeColor
  })
}

export const useAppearanceStore = create<AppearanceState>((set, get) => ({
  mode: 'system',
  resolvedTheme: initialResolvedTheme,
  // 初值 'amber' 仅为 init 真值到达前的占位：首帧 token 由 theme.ts bootstrap 按建窗
  // query sys 注入（不受本初值影响），init 回填后 initialized 翻真、重注 effect 才接管
  themeColor: 'amber',
  setting: false,
  initialized: false,

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
        set({ initialized: true })
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
      resolvedTheme: state.resolvedTheme,
      themeColor: state.themeColor
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
  },

  // 主题色切换逐条对齐 setMode：共用 setting 防重位与同值短路；不做乐观切换——
  // 成功以主进程返回快照为准，失败回退提交前快照。token DOM 注入不在此处，由
  // App / SettingsWindow 的 effect 驱动 theme.ts applyThemeTokens（注入链单源）
  setThemeColor: async (themeColor) => {
    const state = get()
    if (state.setting || state.themeColor === themeColor) return

    const previous: AppearanceSnapshot = {
      mode: state.mode,
      resolvedTheme: state.resolvedTheme,
      themeColor: state.themeColor
    }
    set({ setting: true })

    try {
      applySnapshot(set, await window.api.appearance.setThemeColor({ themeColor }))
    } catch (error) {
      applySnapshot(set, previous)
      console.error('切换主题色失败', error)
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
