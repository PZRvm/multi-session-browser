import { create } from 'zustand'
import { DEFAULT_LANGUAGE, isSupportedLanguage, type SupportedLanguage } from '../../../shared/i18n'
import type { SettingsSnapshot } from '../../../shared/settings'

// 语言镜像 store（设置专项阶段六 i18n，计划步骤 3）：先订阅后拉取（订阅先于拉取防
// 初始化窗口漏掉主进程 changed 推送）、模块级 in-flight Promise 让 StrictMode/HMR
// 重入共享同一次初始化、HMR dispose 精确移除当前有效 listener——模式逐条对齐
// stores/settings.ts（settings:changed 推送 SettingsSnapshot，快照含 language 键）。
// 本 store 为纯镜像 + 命令转发：language 恒以主进程快照为权威，setLanguage 成功应用
// 返回快照、失败保持旧值不造半态（appearance.setMode 同语义，不自行乐观改）

interface I18nState {
  /** 当前界面语言：初值 = 注册表默认（中文），bootstrapLanguage 按建窗 query lang
   * 在求值期改写（首帧防闪变），init 后恒随主进程快照收敛 */
  language: SupportedLanguage
  /** init 是否已用主进程真值回填（appearance.initialized 同语义门控位） */
  ready: boolean
  init: () => Promise<void>
  setLanguage: (language: SupportedLanguage) => Promise<void>
}

let initialized = false
let initializing: Promise<void> | null = null
let unsubscribe: (() => void) | null = null

const applySnapshot = (
  set: (partial: Partial<I18nState>) => void,
  snapshot: SettingsSnapshot
): void => {
  set({ language: snapshot.language })
}

export const useI18nStore = create<I18nState>((set, get) => ({
  language: DEFAULT_LANGUAGE,

  ready: false,

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
        set({ ready: true })
      } catch (error) {
        currentUnsubscribe?.()
        if (unsubscribe === currentUnsubscribe) unsubscribe = null
        initialized = false
        console.error('初始化语言镜像失败', error)
      } finally {
        initializing = null
      }
    })()

    return initializing
  },

  // 同值短路零 IPC；不乐观改语言——成功以主进程返回快照权威回填（含设置窗标题/
  // 菜单重建后的 changed 全窗推送会随后到达，快照幂等），失败保持旧语言不回滚半态。
  // 值域校验单源在主进程守卫，renderer 不自建第二套规则；主进程 handler 未就绪时
  // invoke 拒绝走失败路径，中文日志可巡检
  setLanguage: async (language) => {
    if (get().language === language) return
    try {
      applySnapshot(set, await window.api.settings.setLanguage({ language }))
    } catch (error) {
      console.error('切换界面语言失败', error)
    }
  }
}))

/** 求值期首帧定值（main.tsx 在 bootstrapThemeTokens() 旁、四角色分流前调用）：建窗
 * query 的 lang 参数是主进程建窗注入契约（sys 同点），合法值设为 store 初值——语言
 * 先于一切渲染定值，英文窗不闪中文首帧；非法/缺省忽略，维持注册表默认语言。只改
 * 内存初值，不订阅不拉取（那是 init 的职责） */
export function bootstrapLanguage(raw: string | null): void {
  if (isSupportedLanguage(raw)) {
    useI18nStore.setState({ language: raw })
  }
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    unsubscribe?.()
    unsubscribe = null
    initialized = false
    initializing = null
  })
}
