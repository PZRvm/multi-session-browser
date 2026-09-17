import { create } from 'zustand'
import type { SettingsSnapshot } from '../../../shared/settings'

// 设置值域镜像 store（阶段四，主页 URL 为首个真实键）：先订阅后拉取（订阅先于
// 拉取防初始化窗口漏掉主进程推送）、模块级 in-flight Promise 让 StrictMode/HMR
// 重入共享同一次初始化、HMR dispose 精确移除当前有效 listener——模式逐条对齐
// stores/appearance.ts。本 store 为纯镜像 + 命令转发：homepageUrl 恒以主进程快照
// 为准，setHomepage 成功应用返回快照、失败保持旧值不造半态

/** Electron invoke 拒绝会包装「Error invoking remote method '<channel>': Error: …」
 * 前缀（channel 名含冒号，用非贪婪通配跨过），剥出主进程侧中文错误文案供行内红显 */
function readableIpcError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : String(error)
  const match = /Error invoking remote method .*?: (?:Error: )?(.+)$/.exec(message)
  return match ? match[1] : fallback
}

export type SetHomepageResult =
  { snapshot: SettingsSnapshot; error?: undefined } | { snapshot?: undefined; error: string }

interface SettingsState {
  homepageUrl: string
  setting: boolean
  init: () => Promise<void>
  setHomepage: (raw: string) => Promise<SetHomepageResult>
}

let initialized = false
let initializing: Promise<void> | null = null
let unsubscribe: (() => void) | null = null

const applySnapshot = (
  set: (partial: Partial<SettingsState>) => void,
  snapshot: SettingsSnapshot
): void => {
  set({ homepageUrl: snapshot.homepageUrl })
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  homepageUrl: '',

  setting: false,

  init: () => {
    if (initialized) return Promise.resolve()
    if (initializing) return initializing

    initializing = (async () => {
      let currentUnsubscribe: (() => void) | null = null
      try {
        currentUnsubscribe = window.api.settings.onChanged((snapshot) => {
          applySnapshot(set, snapshot)
        })
        unsubscribe = currentUnsubscribe
        applySnapshot(set, await window.api.settings.getHomepage())
        initialized = true
      } catch (error) {
        currentUnsubscribe?.()
        if (unsubscribe === currentUnsubscribe) unsubscribe = null
        initialized = false
        console.error('初始化设置镜像失败', error)
      } finally {
        initializing = null
      }
    })()

    return initializing
  },

  // 成功以主进程返回快照为准（受控值随回填规范化结果）；失败保持旧值，错误文案
  // 返回给调用方行内呈现——值域校验单源在主进程守卫，renderer 不自建第二套规则
  setHomepage: async (raw) => {
    if (get().setting) return { error: '正在保存主页设置' }
    set({ setting: true })
    try {
      const snapshot = await window.api.settings.setHomepage({ homepageUrl: raw })
      applySnapshot(set, snapshot)
      return { snapshot }
    } catch (error) {
      return { error: readableIpcError(error, '保存主页设置失败') }
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
