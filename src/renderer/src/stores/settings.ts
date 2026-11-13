import { create } from 'zustand'
import type { SettingsSnapshot } from '../../../shared/settings'
import { createT, DICTIONARIES, type DictKey, type TParams } from '../../../shared/i18n'
import { useI18nStore } from './i18n'

// 设置值域镜像 store（阶段四，主页 URL 为首个真实键）：先订阅后拉取（订阅先于
// 拉取防初始化窗口漏掉主进程推送）、模块级 in-flight Promise 让 StrictMode/HMR
// 重入共享同一次初始化、HMR dispose 精确移除当前有效 listener——模式逐条对齐
// stores/appearance.ts。本 store 为纯镜像 + 命令转发：homepageUrl 恒以主进程快照
// 为准，setHomepage 成功应用返回快照、失败保持旧值不造半态（工具栏按钮显隐两键
// 同口径：showCaptureButton / showRecorderButton 默认显示，显隐纯 renderer 消费面）。
// 原 screenshotShortcut 镜像与 setScreenshotShortcut 命令转发已随 2026-10-29 截图
// 快捷键退役删除

/** 取词（非组件文件，appearance.ts appearanceText 同款形态）：按 i18n 镜像当前语言
 * 构造 t——store 自产的用户可见报错在产生时刻取词（构造期语言口径，计划 §10 如实
 * 接受在途报错不随语言重译） */
function t(key: DictKey, params?: TParams): string {
  return createT(DICTIONARIES[useI18nStore.getState().language])(key, params)
}

/** Electron invoke 拒绝会包装「Error invoking remote method '<channel>': Error: …」
 * 前缀（channel 名含冒号，用非贪婪通配跨过），剥出主进程侧中文错误文案供行内红显 */
export function readableIpcError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : String(error)
  const match = /Error invoking remote method .*?: (?:Error: )?(.+)$/.exec(message)
  return match ? match[1] : fallback
}

export type SetHomepageResult =
  { snapshot: SettingsSnapshot; error?: undefined } | { snapshot?: undefined; error: string }

interface SettingsState {
  homepageUrl: string
  /** 工具栏截图按钮显隐镜像（插件专项收尾）：默认显示，init/changed 广播收敛 */
  showCaptureButton: boolean
  /** 工具栏录屏按钮显隐镜像（同上） */
  showRecorderButton: boolean
  setting: boolean
  init: () => Promise<void>
  setHomepage: (raw: string) => Promise<SetHomepageResult>
  setShowCapture: (value: boolean) => Promise<SetHomepageResult>
  setShowRecorder: (value: boolean) => Promise<SetHomepageResult>
  /** 恢复出厂（阶段七）：成功返回 null，失败返回可呈现的中文错误；镜像不改——
   * 成功后各镜像（settings/appearance/i18n）经主进程 changed 广播自动回默认 */
  factoryReset: () => Promise<string | null>
}

let initialized = false
let initializing: Promise<void> | null = null
let unsubscribe: (() => void) | null = null

const applySnapshot = (
  set: (partial: Partial<SettingsState>) => void,
  snapshot: SettingsSnapshot
): void => {
  set({
    homepageUrl: snapshot.homepageUrl,
    showCaptureButton: snapshot.showCaptureButton,
    showRecorderButton: snapshot.showRecorderButton
  })
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  homepageUrl: '',
  showCaptureButton: true,
  showRecorderButton: true,

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
    if (get().setting) return { error: t('settings.homepageRow.savingInFlight') }
    set({ setting: true })
    try {
      const snapshot = await window.api.settings.setHomepage({ homepageUrl: raw })
      applySnapshot(set, snapshot)
      return { snapshot }
    } catch (error) {
      return { error: readableIpcError(error, t('settings.homepageRow.saveFailed')) }
    } finally {
      set({ setting: false })
    }
  },

  // 工具栏按钮显隐（插件专项收尾，两命令同构）：失败保持旧值（开关随镜像回弹），
  // 错误文案返回给调用方行内呈现；无 in-flight 互斥——开关幂等且主进程写队列保序，
  // 快速连点按序收敛后写胜出
  setShowCapture: async (value) => {
    try {
      const snapshot = await window.api.settings.setShowCapture({ showCaptureButton: value })
      applySnapshot(set, snapshot)
      return { snapshot }
    } catch (error) {
      return { error: readableIpcError(error, t('settings.captureButtonRow.saveFailed')) }
    }
  },

  setShowRecorder: async (value) => {
    try {
      const snapshot = await window.api.settings.setShowRecorder({ showRecorderButton: value })
      applySnapshot(set, snapshot)
      return { snapshot }
    } catch (error) {
      return { error: readableIpcError(error, t('settings.recorderButtonRow.saveFailed')) }
    }
  },

  // 恢复出厂（阶段七，两步确认弹层确认钮的唯一消费动作）：主进程编排全量清理并
  // 中止制失败。兜底文案把原始错误串填入 {message}（readableIpcError 剥不出主进程
  // 中文前缀时的如实降级，不静默）
  factoryReset: async () => {
    try {
      await window.api.settings.factoryReset()
      return null
    } catch (error) {
      console.error('恢复出厂设置失败', error)
      const raw = error instanceof Error ? error.message : String(error)
      return readableIpcError(error, t('settings.confirmReset.resetFailed', { message: raw }))
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
