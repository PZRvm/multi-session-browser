// 主进程语言态模块（设置专项阶段六 i18n）：主进程全部用户可见文案（应用菜单、原生
// 对话框、跨 IPC 上浮的用户可见报错、窗口标题、建窗 query lang）经本模块的同步 t()
// 取词，字典单源在 shared/i18n（DICTIONARIES + createT）。
//
// 与 settings.ts 语言缓存的关系（职责边界）：
// - getBootLanguage()（settings.ts 的语言同步缓存）是 boot 唯一初始值来源——index.ts
//   whenReady 在 initHomepageCache（填充缓存）之后、装菜单与建窗之前调用
//   initMainProcessLanguage(getBootLanguage()) 完成引导，菜单语言即启动语言。
//   本模块不反向 import settings.ts（settings.ts 的 handler 报错经本模块 t 取词，
//   反向依赖会成环），初值经装配点注入，方向恒为 settings 缓存 → 本模块。
// - setMainProcessLanguage 在 settings:set-language 落盘成功后被 settings.ts 调用
//   （其内已先行 updateCachedLanguage 更新缓存）——此后两者同步：settings.ts 缓存
//   是落盘面/重启恢复面，本模块 currentLanguage 是主进程运行期取词面；拒绝路径零变更。
// - 语言变更回调（onMainLanguageChanged）：菜单重建（index.ts）、设置窗标题刷新
//   （settingsWindow.ts）等消费方在装配期注册，setMainProcessLanguage 内按注册序
//   同步触发；注册返回解绑函数（现消费方均随应用生命周期存续，解绑留作扩展）。

import {
  createT,
  DEFAULT_LANGUAGE,
  DICTIONARIES,
  type DictKey,
  type SupportedLanguage,
  type TFunc,
  type TParams
} from '../shared/i18n'

/** 当前语言（boot 前为默认中文，boot 后 = settings 缓存值；此后仅 setMainProcessLanguage 写） */
let currentLanguage: SupportedLanguage = DEFAULT_LANGUAGE
/** 取词函数随语言重建（避免每次 t() 现建闭包） */
let translate: TFunc = createT(DICTIONARIES[currentLanguage])

type LanguageChangedListener = (language: SupportedLanguage) => void
const changeListeners = new Set<LanguageChangedListener>()

/** boot 引导（唯一调用点 index.ts whenReady）：初值 = settings 语言缓存（getBootLanguage） */
export function initMainProcessLanguage(bootLanguage: SupportedLanguage): void {
  currentLanguage = bootLanguage
  translate = createT(DICTIONARIES[bootLanguage])
}

/** 主进程当前语言（建窗 query lang 等同步消费） */
export function getCurrentLanguage(): SupportedLanguage {
  return currentLanguage
}

/** 主进程同步取词：点路径查字典 + {name} 插值（语义单源见 shared/i18n createT） */
export function t(key: DictKey, params?: TParams): string {
  return translate(key, params)
}

/** 语言态更新并同步触发全部变更回调（settings:set-language 落盘成功后的唯一入口） */
export function setMainProcessLanguage(language: SupportedLanguage): void {
  currentLanguage = language
  translate = createT(DICTIONARIES[language])
  for (const listener of [...changeListeners]) listener(language)
}

/** 注册语言变更回调（菜单重建/设置窗标题刷新等装配期消费），返回解绑函数 */
export function onMainLanguageChanged(listener: LanguageChangedListener): () => void {
  changeListeners.add(listener)
  return () => {
    changeListeners.delete(listener)
  }
}
