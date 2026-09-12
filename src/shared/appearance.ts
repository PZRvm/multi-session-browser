export type AppearanceMode = 'system' | 'light' | 'dark'

export type ResolvedTheme = 'light' | 'dark'

export interface AppearanceSnapshot {
  mode: AppearanceMode
  resolvedTheme: ResolvedTheme
}

export interface SetAppearanceModePayload {
  mode: AppearanceMode
}

export const APPEARANCE_CHANNELS = {
  getState: 'appearance:get-state',
  setMode: 'appearance:set-mode',
  changed: 'appearance:changed'
} as const

// 外观模式闭集单一事实源：守卫与 UI（菜单/分段控件）均由此派生，防增删模式时漏改
export const APPEARANCE_MODES: AppearanceMode[] = ['system', 'light', 'dark']

export function isAppearanceMode(value: unknown): value is AppearanceMode {
  return (APPEARANCE_MODES as string[]).includes(value as AppearanceMode)
}
