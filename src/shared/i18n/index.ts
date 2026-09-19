// 语言注册表与字典基建（设置专项阶段六 i18n，需求 docs/PRD.md 3.8.2 / 验收 24；
// 计划 notes/plans/20260917172635-设置阶段六语言切换i18n开发计划.md 契约核对第 2 条）。
// 与 themeSystems.ts 同哲学：配置单源、不写死——新增一种语言零组件/零主进程业务改动。
//
// 入字典范围线（范围裁决单源）：用户可见文案入字典 = renderer 全部 UI 文案（含
// aria-label / title / placeholder / 空态 / 反馈条）、原生应用菜单、主进程原生对话框、
// 跨 IPC 上浮到界面显示的报错、空白 Tab 标题、窗口标题；开发注释与 console 告警/
// 日志保持中文不入字典。
//
// 新增语言扩展入口（2026-09-17 用户裁决，操作说明同载 docs/项目骨架.md）：
//  1. 新建 src/shared/i18n/locales/<code>/ 目录：七个命名空间文件逐个
//     `: Dictionary['<ns>']` 类型约束（缺键/多键均编译失败），并建 index.ts 合并导出；
//  2. 本文件 SUPPORTED_LANGUAGES 注册表加一条 { code, label }（label 用该语言自名）；
//  3. src/renderer/src/i18n.ts 的 ANTD_LOCALES 映射加一条（antd 语言包；若 antd 无
//     对应语言包，可暂映射 antd/locale/zh_CN 或 en_US 作兜底，注册表与字典不受影响）。
//  消费方（守卫/语言选择框选项/主进程菜单与对话框/renderer useT）全部由注册表与
//  DICTIONARIES 派生，无需改任何组件或 handler。
//
// 类型约束：zh-CN 是源语言，Dictionary 类型由它派生；其余语言逐命名空间挂
// Dictionary['<ns>']——en-US 文件删键/加键/改嵌套形状都会让 typecheck 失败，
// 「无缺译」由编译期硬性保证（PRD 24 的门禁实现）。

import { zhCN } from './locales/zh-CN'
import { enUS } from './locales/en-US'
import { zhTW } from './locales/zh-TW'

/** 语言代码闭集（BCP-47）：settings.json 落盘值、建窗 query lang 值、字典目录名三处同源 */
export type SupportedLanguage = 'zh-CN' | 'en-US' | 'zh-TW'

/** 注册表条目：label 用该语言自名（中文（简体）/ English），语言选择框显示单源 */
export interface LanguageEntry {
  code: SupportedLanguage
  label: string
}

/** 语言注册表单一事实源：新增语言在此加一条（扩展方法见头注），消费方全部由此派生 */
export const SUPPORTED_LANGUAGES: LanguageEntry[] = [
  { code: 'zh-CN', label: '中文（简体）' },
  { code: 'zh-TW', label: '繁體中文' },
  { code: 'en-US', label: 'English' }
]

/** 默认语言（PRD 3.8.2：默认中文；settings.json 缺键/坏值的回退值） */
export const DEFAULT_LANGUAGE: SupportedLanguage = 'zh-CN'

export function isSupportedLanguage(value: unknown): value is SupportedLanguage {
  return SUPPORTED_LANGUAGES.some((entry) => entry.code === value)
}

/** 字典形状单源：由 zh-CN 源语言派生 */
export type Dictionary = typeof zhCN

/** 全部语言字典（主进程 t() 与 renderer useT 共用；键受 SupportedLanguage 闭集约束） */
export const DICTIONARIES: Record<SupportedLanguage, Dictionary> = {
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  'en-US': enUS
}

/** 字典点路径联合（编译期生成）：t() 的 key 只接受真实存在的键，路径拼错即编译失败 */
type DictPath<T> = T extends string
  ? never
  : { [K in keyof T & string]: T[K] extends string ? K : `${K}.${DictPath<T[K]>}` }[keyof T &
      string]

export type DictKey = DictPath<Dictionary>

export type TParams = Record<string, string | number>

export type TFunc = (key: DictKey, params?: TParams) => string

/**
 * 取词纯函数工厂：点路径查字典 + `{name}` 插值。缺键或值非字符串如实回显键名
 * （类型约束下不应发生，运行期兜底可巡检发现）；插值缺参如实保留原文占位符——
 * 两种兜底都只为可观察，不静默伪造（计划 2.3 数据原则）。
 */
export function createT(dictionary: Dictionary): TFunc {
  return (key, params) => {
    let value: unknown = dictionary
    for (const part of key.split('.')) {
      if (!value || typeof value !== 'object' || !(part in value)) return key
      value = (value as Record<string, unknown>)[part]
    }
    if (typeof value !== 'string') return key
    if (!params) return value
    return value.replace(/\{(\w+)\}/g, (match, name: string) =>
      name in params ? String(params[name]) : match
    )
  }
}
