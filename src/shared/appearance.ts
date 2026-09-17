import type { ThemeSystemId } from './themeSystems'

export type AppearanceMode = 'system' | 'light' | 'dark'

export type ResolvedTheme = 'light' | 'dark'

export interface AppearanceSnapshot {
  mode: AppearanceMode
  resolvedTheme: ResolvedTheme
  /** 主题色（设置专项阶段五）：琥珀/雾蓝/苔绿三套设计系统，闭集见 shared/themeSystems.ts */
  themeColor: ThemeSystemId
}

export interface SetAppearanceModePayload {
  mode: AppearanceMode
}

export interface SetThemeColorPayload {
  themeColor: ThemeSystemId
}

export const APPEARANCE_CHANNELS = {
  getState: 'appearance:get-state',
  setMode: 'appearance:set-mode',
  /** 设置窗（与板头未来的入口）切换主题色：与 set-mode 同规，无 sender 白名单（入参值守卫承担） */
  setThemeColor: 'appearance:set-theme-color',
  changed: 'appearance:changed'
} as const

// 外观模式闭集单一事实源：守卫与 UI（菜单/分段控件）均由此派生，防增删模式时漏改
export const APPEARANCE_MODES: AppearanceMode[] = ['system', 'light', 'dark']

export function isAppearanceMode(value: unknown): value is AppearanceMode {
  return (APPEARANCE_MODES as string[]).includes(value as AppearanceMode)
}
