import { isSupportedLanguage, type SupportedLanguage } from '../../../src/shared/i18n'

export function pluginLanguage(params: URLSearchParams): SupportedLanguage {
  const requested = params.get('lang')
  if (isSupportedLanguage(requested)) return requested
  const language = (chrome.i18n?.getUILanguage() ?? navigator.language).toLowerCase()
  if (/^zh-(tw|hk|mo|hant)(-|$)/.test(language)) return 'zh-TW'
  return language.startsWith('zh') ? 'zh-CN' : 'en-US'
}
