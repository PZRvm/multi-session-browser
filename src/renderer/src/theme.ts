import type { ResolvedTheme } from '../../shared/appearance'
import { isThemeSystemId, themeCssVariables } from '../../shared/themeSystems'
import type { ThemeSystemId } from '../../shared/themeSystems'

// 主题 token 注入模块（设置专项阶段五）：色值单源 shared/themeSystems.ts，经
// themeCssVariables 逐条写入 documentElement 内联样式——内联样式优先级高于 app.css
// 的 :root / 暗色媒体查询声明（那里只剩琥珀系缺省值承担对账与无 JS 期兜底）。
//
// 收敛口径：本模块的 bootstrapThemeTokens 只管两件事——首帧（建窗 query sys 为
// 初始值契约，见 shared/themeSystems.ts 头注）与系统亮暗翻转（matchMedia change
// 重注，与 CSS 媒体查询同拍，防内联样式在翻转瞬间残留旧值）；运行期主题变更经主
// 进程 appearance:changed 推送，由 App / SettingsWindow 的 effect 驱动
// applyThemeTokens 完成其后的第二道收敛（显式白昼/黑夜切换两道收敛同值）。

const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)'

// 模块态当前系统（重注的 sys 来源）；resolved 实时读自 matchMedia 查询本身，
// 不另存副本（applyThemeTokens 每次以实参为准落 DOM）
let currentSystem: ThemeSystemId = 'amber'
let currentResolved: ResolvedTheme = 'light'
let mediaListener: ((event: MediaQueryListEvent) => void) | null = null

/** 注入指定系统 × 亮暗态的全量主题 token，并记录模块态 */
export function applyThemeTokens(sys: ThemeSystemId, resolved: ResolvedTheme): void {
  const variables = themeCssVariables(sys, resolved)
  for (const [name, value] of Object.entries(variables)) {
    document.documentElement.style.setProperty(name, value)
  }
  currentSystem = sys
  currentResolved = resolved
}

/** 求值期首帧注入：query sys（isThemeSystemId 守卫，缺省/非法回退 'amber'）+
 * 系统亮暗取 resolved；并注册 matchMedia change 监听（OS 翻转与 CSS 媒体查询同拍） */
export function bootstrapThemeTokens(): void {
  const querySys = new URLSearchParams(window.location.search).get('sys')
  const sys: ThemeSystemId = isThemeSystemId(querySys) ? querySys : 'amber'
  const media = window.matchMedia(DARK_MEDIA_QUERY)
  applyThemeTokens(sys, media.matches ? 'dark' : 'light')

  // 监听只注册一次（重复调用 bootstrap 不叠加）；同值事件跳过，防冗余 DOM 写入
  if (mediaListener) return
  mediaListener = (event): void => {
    const resolved: ResolvedTheme = event.matches ? 'dark' : 'light'
    if (resolved === currentResolved) return
    applyThemeTokens(currentSystem, resolved)
  }
  media.addEventListener('change', mediaListener)
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (mediaListener) {
      window.matchMedia(DARK_MEDIA_QUERY).removeEventListener('change', mediaListener)
      mediaListener = null
    }
  })
}
