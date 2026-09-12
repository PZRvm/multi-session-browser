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

export function isAppearanceMode(value: unknown): value is AppearanceMode {
  return value === 'system' || value === 'light' || value === 'dark'
}
