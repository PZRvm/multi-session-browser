// 地址栏搜索引擎仅作为 renderer 配置：生成结果页后仍走当前会话的既有导航链。
export const SEARCH_ENGINES = [
  {
    id: 'baidu',
    hosts: ['baidu.com', 'www.baidu.com'],
    aliases: ['百度', 'baidu'],
    base: 'https://www.baidu.com/s?ie=utf-8',
    param: 'wd'
  },
  {
    id: 'bing',
    hosts: ['bing.com', 'www.bing.com', 'cn.bing.com'],
    aliases: ['必应', '必應', 'bing'],
    base: 'https://www.bing.com/search',
    param: 'q'
  },
  {
    id: 'google',
    hosts: ['google.com', 'www.google.com'],
    aliases: ['谷歌', 'google'],
    base: 'https://www.google.com/search',
    param: 'q'
  },
  {
    id: 'duckduckgo',
    hosts: ['duckduckgo.com', 'www.duckduckgo.com'],
    aliases: ['duckduckgo'],
    base: 'https://duckduckgo.com/',
    param: 'q'
  },
  {
    id: 'brave',
    hosts: ['search.brave.com'],
    aliases: ['brave'],
    base: 'https://search.brave.com/search',
    param: 'q'
  },
  {
    id: 'ecosia',
    hosts: ['ecosia.org', 'www.ecosia.org'],
    aliases: ['ecosia'],
    base: 'https://www.ecosia.org/search',
    param: 'q'
  },
  {
    id: 'yahoo',
    hosts: ['yahoo.com', 'www.yahoo.com', 'search.yahoo.com'],
    aliases: ['yahoo'],
    base: 'https://search.yahoo.com/search',
    param: 'p'
  },
  {
    id: 'sogou',
    hosts: ['sogou.com', 'www.sogou.com'],
    aliases: ['搜狗', 'sogou'],
    base: 'https://www.sogou.com/web?ie=utf8',
    param: 'query'
  },
  {
    id: 'so360',
    hosts: ['so.com', 'www.so.com'],
    aliases: ['360'],
    base: 'https://www.so.com/s?ie=utf-8',
    param: 'q'
  }
] as const

export type SearchEngine = (typeof SEARCH_ENGINES)[number]

export const DEFAULT_SEARCH_ENGINE = SEARCH_ENGINES.find((engine) => engine.id === 'google')!

/** 仅匹配完整别名或根 URL，不猜测前缀，不把参数/伪装域名认作引擎。 */
export function matchSearchEngine(raw: string): SearchEngine | null {
  const input = raw.trim().toLowerCase()
  if (!input || /\s/.test(input)) return null
  const alias = SEARCH_ENGINES.find((engine) => engine.aliases.some((name) => name === input))
  if (alias) return alias
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `https://${input}`)
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.port ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      /[?#]/.test(input)
    )
      return null
    return (
      SEARCH_ENGINES.find((engine) => engine.hosts.some((host) => host === url.hostname)) ?? null
    )
  } catch {
    return null
  }
}

export function buildSearchUrl(engine: SearchEngine, query: string): string {
  const url = new URL(engine.base)
  url.searchParams.set(engine.param, query)
  return url.href
}
