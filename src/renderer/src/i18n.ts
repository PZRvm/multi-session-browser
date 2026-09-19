import { useMemo } from 'react'
import type { Locale } from 'antd/es/locale'
import enUS from 'antd/locale/en_US'
import zhCN from 'antd/locale/zh_CN'
import zhTW from 'antd/locale/zh_TW'
import { createT, DICTIONARIES, type SupportedLanguage, type TFunc } from '../../shared/i18n'
import { useI18nStore } from './stores/i18n'

// renderer 侧 i18n 装配（设置专项阶段六 i18n，计划步骤 3）：antd 语言包映射与取词
// hook。antd 依赖不得进 shared（shared 文件同时进 node/web 双工程编译），故映射独立
// 于语言注册表留在这里——新增语言时按 shared/i18n/index.ts 头注扩展入口第 3 步
// 加一条映射（注册表与字典本身零组件改动）

/** antd 组件语言包映射：语言注册表 code → antd Locale（静态导入，无运行期加载） */
export const ANTD_LOCALES: Record<SupportedLanguage, Locale> = {
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  'en-US': enUS
}

/** 取词 hook：经 i18n 镜像 selector 订阅 language，返回当前语言字典的 t 函数——
 * 组件里 t('settings.languageRow.label') 这样用；语言变化经 store 订阅触发本组件
 * 重渲染，t 函数随语言重建（useMemo 按语言缓存，语言无关的 store 更新不重渲染） */
export function useT(): TFunc {
  const language = useI18nStore((s) => s.language)
  return useMemo(() => createT(DICTIONARIES[language]), [language])
}
