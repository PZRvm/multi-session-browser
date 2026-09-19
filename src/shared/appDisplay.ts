// OS 展示名（Dock/任务栏等系统面）单源（2026-09-18 用户裁决）：短名随操作系统语言，
// 与应用内产品名 common.appName（菜单/关于页，随界面语言设置）职责分离——系统面跟
// 随 OS，应用内跟随应用语言。消费方：主进程 app.setName 与主窗标题（index.ts）、
// electron-builder productName（无匹配语言时的兜底名）与打包钩子注入的本地化
// InfoPlist.strings（scripts/patch-mac-display-names.js）——三处与本表对账，改名
// 同步改。macOS dev 态限制：Dock/菜单栏应用名来自未打包的 Electron 二进制包名，
// 运行期不可改（打包后由 bundle 元数据生效），见 PRD 2.1
import type { SupportedLanguage } from './i18n'

/** 三语言 OS 展示短名（语言键与 i18n 注册表闭集同构） */
export const APP_DISPLAY_NAMES: Record<SupportedLanguage, string> = {
  'zh-CN': '多会话浏览器',
  'zh-TW': '多會話瀏覽器',
  'en-US': 'Multi-session Browser'
}

/**
 * OS locale（BCP-47，app.getLocale() 形如 zh-CN/zh-TW/zh-Hant-HK/en-US）→ 展示语言：
 * zh 系按繁简分流（Hant 与港/澳用繁体，CN/SG 与裸 zh 用简体），其余一律英文
 */
export function resolveDisplayLanguage(osLocale: string): SupportedLanguage {
  const locale = osLocale.toLowerCase()
  if (locale.startsWith('zh')) {
    const traditional = locale.includes('hant') || /-(tw|hk|mo)\b/.test(locale)
    return traditional ? 'zh-TW' : 'zh-CN'
  }
  return 'en-US'
}

/** OS 展示名：按操作系统语言解析短名 */
export function getAppDisplayNameForOS(osLocale: string): string {
  return APP_DISPLAY_NAMES[resolveDisplayLanguage(osLocale)]
}
