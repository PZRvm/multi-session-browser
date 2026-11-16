// 历史建议专用图标缓存。请求由 registry 注入对应 Session，子窗只接收图片数据。
// 缓存是分区内可丢弃的派生数据，不修改历史 schema，也不使用第三方图标服务。
import { createHash } from 'crypto'
import { readFile, readdir, rm, stat } from 'fs/promises'
import { basename, join } from 'path'
import { atomicWriteJson } from '../fs-utils'

const MAX_BYTES = 256 * 1024
const MAX_DATA_LENGTH = Math.ceil(MAX_BYTES / 3) * 4 + 128
const MAX_ICONS = 128
const CACHE_AGE = 7 * 24 * 60 * 60 * 1000
const FAILURE_AGE = 60 * 1000
const IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/svg+xml',
  'image/x-icon',
  'image/vnd.microsoft.icon'
])

interface IconEntry {
  data: string | null
  updatedAt: number
  retryAt?: number
}

interface IconSession {
  closed: boolean
  entries: Map<string, IconEntry>
  pending: Map<string, Promise<string | null>>
  pagePending: Map<string, Promise<string[]>>
  pages: Map<string, { urls: string[]; updatedAt: number }>
  controllers: Set<AbortController>
  writes: Promise<void>
}

interface HistoryIcons {
  resolve(id: string, entry: { url: string; faviconUrl: string | null }): Promise<string | null>
  cancel(id: string, permanent?: boolean): Promise<void>
  cancelAll(): Promise<void>
  shutdown(): Promise<void>
}

/** 按文件签名识别，兼容内网站点的缺失/错误 MIME，同时拒绝伪装为图片的登录 HTML。 */
function imageType(bytes: Buffer): string | null {
  const hex = bytes.subarray(0, 12).toString('hex')
  if (hex.startsWith('89504e470d0a1a0a')) return 'image/png'
  if (hex.startsWith('ffd8ff')) return 'image/jpeg'
  if (hex.startsWith('474946383761') || hex.startsWith('474946383961')) return 'image/gif'
  if (hex.startsWith('00000100') || hex.startsWith('00000200')) return 'image/x-icon'
  const header = bytes.subarray(0, 32).toString('ascii')
  if (header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP') return 'image/webp'
  if (header.slice(4, 8) === 'ftyp' && /avif|avis/.test(header.slice(8))) return 'image/avif'
  const xml = bytes
    .toString('utf8')
    .trimStart()
    .replace(/^(?:<\?xml[^>]*\?>\s*|<!--[\s\S]*?-->\s*)*/, '')
  if (/^<svg(?:\s|>)/i.test(xml)) return 'image/svg+xml'
  return null
}

function inlineImage(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_DATA_LENGTH) return null
  const match = /^data:([^;,]+)(;base64)?,([\s\S]+)$/i.exec(value)
  if (!match || !IMAGE_TYPES.has(match[1].toLowerCase())) return null
  try {
    const bytes = match[2]
      ? Buffer.from(match[3], 'base64')
      : Buffer.from(decodeURIComponent(match[3]))
    const type = bytes.length <= MAX_BYTES ? imageType(bytes) : null
    return type ? `data:${type};base64,${bytes.toString('base64')}` : null
  } catch {
    return null
  }
}

function httpUrl(value: string): string | null {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null
    url.hash = ''
    return url.href
  } catch {
    return null
  }
}

export function createHistoryIcons(deps: {
  cacheDir: (sessionId: string) => string
  fetch: (sessionId: string, url: string, signal: AbortSignal) => Promise<Response>
  validate: (data: string, signal: AbortSignal) => Promise<boolean>
  findIcons: (html: string, baseUrl: string) => Promise<string[]>
}): HistoryIcons {
  const sessions = new Map<string, IconSession>()
  const retired = new Set<string>()
  let sealed = false
  let active = 0
  const waiting: Array<{ state: IconSession; resolve: (acquired: boolean) => void }> = []

  async function acquire(state: IconSession): Promise<boolean> {
    if (state.closed) return false
    if (active < 4) {
      active++
      return true
    }
    return new Promise((resolve) => waiting.push({ state, resolve }))
  }

  function release(): void {
    while (waiting.length) {
      const next = waiting.shift()!
      if (next.state.closed) next.resolve(false)
      else {
        next.resolve(true)
        return
      }
    }
    active--
  }

  async function download(
    id: string,
    state: IconSession,
    url: string,
    html = false
  ): Promise<{ data: string; url: string } | null> {
    if (!(await acquire(state))) return null
    const controller = new AbortController()
    state.controllers.add(controller)
    const timeout = setTimeout(() => controller.abort(), 4000)
    try {
      if (state.closed) return null
      const response = await deps.fetch(id, url, controller.signal)
      if (
        !response.ok ||
        Number(response.headers.get('content-length')) > MAX_BYTES ||
        !response.body
      ) {
        await response.body?.cancel()
        return null
      }
      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > MAX_BYTES) {
            await reader.cancel()
            return null
          }
          chunks.push(value)
        }
      } finally {
        reader.releaseLock()
      }
      if (size === 0 || state.closed) return null
      const bytes = Buffer.concat(chunks)
      if (html) return { data: bytes.toString('utf8'), url: response.url || url }
      const type = imageType(bytes)
      if (!type) return null
      const data = `data:${type};base64,${bytes.toString('base64')}`
      return (await deps.validate(data, controller.signal)) && !state.closed ? { data, url } : null
    } catch {
      return null
    } finally {
      clearTimeout(timeout)
      state.controllers.delete(controller)
      release()
    }
  }

  async function readCache(file: string, state: IconSession): Promise<IconEntry | null> {
    try {
      if ((await stat(file)).size > MAX_DATA_LENGTH + 256) return null
      const entry = JSON.parse(await readFile(file, 'utf8')) as IconEntry
      const data = inlineImage(entry?.data)
      if (!data || !Number.isFinite(entry.updatedAt) || entry.updatedAt > Date.now()) {
        return null
      }
      if (!(await validateInline(data, state))) return null
      return { data, updatedAt: entry.updatedAt }
    } catch {
      return null
    }
  }

  async function validateInline(data: string, state: IconSession): Promise<boolean> {
    if (state.closed) return false
    const controller = new AbortController()
    state.controllers.add(controller)
    const timer = setTimeout(() => controller.abort(), 2000)
    try {
      return (await deps.validate(data, controller.signal)) && !state.closed
    } catch {
      return false
    } finally {
      clearTimeout(timer)
      state.controllers.delete(controller)
    }
  }

  function saveCache(
    id: string,
    state: IconSession,
    file: string,
    entry: IconEntry | { urls: string[]; updatedAt: number }
  ): void {
    state.writes = state.writes
      .then(async () => {
        await atomicWriteJson(file, entry)
        const dir = deps.cacheDir(id)
        const pattern = basename(file).startsWith('page-')
          ? /^page-[a-f0-9]{64}\.json$/
          : /^[a-f0-9]{64}\.json$/
        const files = (await readdir(dir)).filter((name) => pattern.test(name))
        if (files.length <= MAX_ICONS) return
        const dated = await Promise.all(
          files.map(async (name) => ({ name, time: (await stat(join(dir, name))).mtimeMs }))
        )
        dated.sort((a, b) => b.time - a.time)
        await Promise.all(
          dated.slice(MAX_ICONS).map(({ name }) => rm(join(dir, name), { force: true }))
        )
      })
      .catch(() => console.warn('[history-icons] 图标缓存写入失败，本次仍使用内存图标'))
  }

  function pageFile(id: string, page: string): string {
    return join(deps.cacheDir(id), `page-${createHash('sha256').update(page).digest('hex')}.json`)
  }

  async function cachedPage(id: string, state: IconSession, page: string): Promise<string[]> {
    if (!state.pages.has(page)) {
      try {
        const file = pageFile(id, page)
        if ((await stat(file)).size > 8192) return []
        const parsed = JSON.parse(await readFile(file, 'utf8'))
        if (
          !parsed ||
          !Array.isArray(parsed.urls) ||
          parsed.urls.length > 3 ||
          !Number.isFinite(parsed.updatedAt) ||
          parsed.updatedAt > Date.now()
        )
          return []
        const urls = parsed.urls.filter(
          (url: unknown): url is string =>
            typeof url === 'string' && url.length <= 2048 && httpUrl(url) === url
        )
        if (!state.closed && !state.pages.has(page))
          state.pages.set(page, { urls, updatedAt: parsed.updatedAt })
      } catch {
        // 首次补取尚无页面索引，继续正常候选路径。
      }
    }
    return state.pages.get(page)?.urls ?? []
  }

  function candidate(id: string, state: IconSession, url: string): Promise<string | null> {
    const cached = state.entries.get(url)
    const age = cached?.data ? CACHE_AGE : FAILURE_AGE
    if (
      cached &&
      (cached.retryAt ? Date.now() < cached.retryAt : Date.now() - cached.updatedAt < age)
    )
      return Promise.resolve(cached.data)
    const pending = state.pending.get(url)
    if (pending) return pending
    const file = join(deps.cacheDir(id), `${createHash('sha256').update(url).digest('hex')}.json`)
    const request = (async () => {
      const disk = cached ?? (await readCache(file, state))
      if (state.closed) return null
      let result = disk
      if (!disk?.data || Date.now() - disk.updatedAt >= CACHE_AGE) {
        const fetched = await download(id, state, url)
        const data = fetched?.data ?? null
        // 离线可继续使用旧缓存；失败冷却只在内存，重启后允许重新补取。
        result = data
          ? { data, updatedAt: Date.now() }
          : disk?.data
            ? { ...disk, retryAt: Date.now() + FAILURE_AGE }
            : { data: null, updatedAt: Date.now() }
        if (data && !state.closed) saveCache(id, state, file, result)
      }
      if (state.closed) return null
      state.entries.delete(url)
      state.entries.set(url, result!)
      if (state.entries.size > MAX_ICONS) state.entries.delete(state.entries.keys().next().value!)
      return result!.data
    })().finally(() => state.pending.delete(url))
    state.pending.set(url, request)
    return request
  }

  function discover(id: string, state: IconSession, page: string): Promise<string[]> {
    const cached = state.pages.get(page)
    if (cached && Date.now() - cached.updatedAt < FAILURE_AGE) return Promise.resolve(cached.urls)
    const pending = state.pagePending.get(page)
    if (pending) return pending
    const work = (async () => {
      const response = await download(id, state, page, true)
      const urls =
        response && !state.closed
          ? (await deps.findIcons(response.data, response.url))
              .map(httpUrl)
              .filter((url): url is string => !!url)
              .filter((url) => url.length <= 2048)
              .slice(0, 3)
          : []
      if (state.closed) return []
      state.pages.delete(page)
      const entry = { urls, updatedAt: Date.now() }
      state.pages.set(page, entry)
      if (urls.length) saveCache(id, state, pageFile(id, page), entry)
      if (state.pages.size > MAX_ICONS) state.pages.delete(state.pages.keys().next().value!)
      return urls
    })()
      .catch(() => [])
      .finally(() => state.pagePending.delete(page))
    state.pagePending.set(page, work)
    return work
  }

  const icons: HistoryIcons = {
    async resolve(
      id: string,
      entry: { url: string; faviconUrl: string | null }
    ): Promise<string | null> {
      if (sealed || retired.has(id)) return null
      let state = sessions.get(id)
      if (!state) {
        state = {
          closed: false,
          entries: new Map(),
          pending: new Map(),
          pagePending: new Map(),
          pages: new Map(),
          controllers: new Set(),
          writes: Promise.resolve()
        }
        sessions.set(id, state)
      }
      if (state.closed) return null
      const inline = inlineImage(entry.faviconUrl)
      if (inline && (await validateInline(inline, state))) return inline
      const page = httpUrl(entry.url)
      if (!page) return null
      const candidates = new Set<string>()
      for (const url of await cachedPage(id, state, page)) {
        candidates.add(url)
        const data = await candidate(id, state, url)
        if (state.closed) return null
        if (data) return data
      }
      const icon = entry.faviconUrl && httpUrl(entry.faviconUrl)
      if (icon) candidates.add(icon)
      candidates.add(new URL('/favicon.ico', page).href)
      for (const url of candidates) {
        const data = await candidate(id, state, url)
        if (state.closed) return null
        if (data) return data
      }
      for (const url of state.pages.get(page)?.urls ?? []) {
        if (candidates.has(url)) continue
        candidates.add(url)
        const data = await candidate(id, state, url)
        if (state.closed) return null
        if (data) return data
      }
      for (const url of await discover(id, state, page)) {
        if (state.closed) return null
        if (candidates.has(url)) continue
        const data = await candidate(id, state, url)
        if (data) return data
      }
      return null
    },

    async cancel(id: string, permanent = false): Promise<void> {
      if (permanent) retired.add(id)
      const state = sessions.get(id)
      if (!state) return
      state.closed = true
      for (let i = waiting.length - 1; i >= 0; i--) {
        if (waiting[i].state !== state) continue
        waiting.splice(i, 1)[0].resolve(false)
      }
      for (const controller of state.controllers) controller.abort()
      await Promise.allSettled([...state.pending.values(), ...state.pagePending.values()])
      await state.writes
      if (sessions.get(id) === state) sessions.delete(id)
    },

    async cancelAll(): Promise<void> {
      await Promise.all([...sessions.keys()].map((id) => icons.cancel(id)))
    },

    async shutdown(): Promise<void> {
      sealed = true
      await icons.cancelAll()
    }
  }
  return icons
}
