import type { ThemeModeTokens } from '../themeSystems'

/** 商店页面桥闭集；详情ID只从官方HTTPS URL提取。 */
export const STORE_PAGE_CHANNELS = {
  status: 'store-page:status',
  install: 'store-page:install'
} as const

export function storeDetailId(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.origin !== 'https://chromewebstore.google.com' || url.username || url.password)
      return null
    return /^\/detail\/(?:[^/]+\/)?([a-p]{32})\/?$/.exec(url.pathname)?.[1] ?? null
  } catch {
    return null
  }
}

export type StorePageTheme = Pick<
  ThemeModeTokens,
  'accent' | 'accentStrong' | 'accentPress' | 'accentInk' | 'raised' | 'inkDim'
>

export interface StorePageStatus {
  theme: StorePageTheme
  installed: boolean
  installing: boolean
  installLabel: string
  installedLabel: string
  installingLabel: string
}
