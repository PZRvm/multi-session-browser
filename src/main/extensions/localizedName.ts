import { constants } from 'node:fs'
import { open, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import type { SupportedLanguage } from '../../shared/i18n'

const MAX_MESSAGE_BYTES = 1024 * 1024
const MAX_NAME_LENGTH = 4096
const reference = /__MSG_([a-z0-9_@]+)__/gi

export function isUsableExtensionName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= MAX_NAME_LENGTH &&
    !/__MSG_/i.test(value)
  )
}

/** 包提供的 locale 只能是目录名，不能成为路径。 */
function normalizeLocale(value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-z]{2,3}(?:[-_][a-z0-9]{2,8})?$/i.test(value)
    ? value.replaceAll('-', '_')
    : undefined
}

async function readMessages(root: string, locale: string): Promise<Record<string, unknown>> {
  const target = join(root, '_locales', locale, 'messages.json')
  const actual = await realpath(target)
  const rel = relative(root, actual)
  if (isAbsolute(rel) || rel === '..' || rel.startsWith('../') || rel.startsWith('..\\')) {
    throw new Error('扩展语言文件越界')
  }
  const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    if (!(await file.stat()).isFile()) throw new Error('扩展语言文件不是普通文件')
    const bytes = Buffer.alloc(MAX_MESSAGE_BYTES + 1)
    let length = 0
    while (length < bytes.length) {
      const { bytesRead } = await file.read(bytes, length, bytes.length - length, null)
      if (!bytesRead) break
      length += bytesRead
    }
    if (length > MAX_MESSAGE_BYTES) throw new Error('扩展语言文件过大')
    const data: unknown = JSON.parse(bytes.subarray(0, length).toString('utf8'))
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('扩展语言文件格式无效')
    }
    return data as Record<string, unknown>
  } finally {
    await file.close()
  }
}

function messageText(entry: unknown): string | undefined {
  if (!entry || typeof entry !== 'object') return undefined
  const { message, placeholders } = entry as { message?: unknown; placeholders?: unknown }
  if (typeof message !== 'string' || message.length > MAX_NAME_LENGTH) return undefined
  const staticValues = new Map<string, string>()
  if (placeholders && typeof placeholders === 'object' && !Array.isArray(placeholders)) {
    for (const [key, value] of Object.entries(placeholders)) {
      if (value && typeof value === 'object' && typeof value.content === 'string') {
        staticValues.set(key.toLowerCase(), value.content)
      }
    }
  }
  let valid = true
  const text = message.replace(/\$\$|\$([a-z0-9_@]+)\$|\$[1-9]/gi, (token, key) => {
    if (token === '$$') return '$'
    const content = key ? staticValues.get(key.toLowerCase()) : undefined
    // manifest 名称没有调用参数，不推测 $1 等动态替换，也不递归展开消息。
    if (content === undefined) {
      valid = false
      return ''
    }
    return content.replace(/\$\$|\$[1-9]|\$[a-z0-9_@]+\$/gi, (part) => {
      if (part === '$$') return '$'
      valid = false
      return ''
    })
  })
  return valid && isUsableExtensionName(text) ? text : undefined
}

/** 只解析宿主显示名称，不修改扩展原包，也不改变插件运行时语言。 */
export async function resolveLocalizedName(
  directory: string,
  rawName: unknown,
  defaultLocale: unknown,
  language: SupportedLanguage
): Promise<string | undefined> {
  if (isUsableExtensionName(rawName)) return rawName
  if (typeof rawName !== 'string' || rawName.length > MAX_NAME_LENGTH) return undefined
  const keys = [...rawName.matchAll(reference)].map((match) => match[1].toLowerCase())
  if (!keys.length) return undefined
  const preferred = normalizeLocale(language)!
  const candidates = [
    ...new Set([preferred, preferred.split('_')[0], normalizeLocale(defaultLocale)])
  ]
  try {
    const root = await realpath(directory)
    const resolved = new Map<string, string>()
    for (const locale of candidates) {
      if (!locale) continue
      try {
        const messages = new Map(
          Object.entries(await readMessages(root, locale)).map(([key, entry]) => [
            key.toLowerCase(),
            entry
          ])
        )
        for (const key of keys) {
          if (resolved.has(key)) continue
          const text = messageText(messages.get(key))
          if (text !== undefined) resolved.set(key, text)
        }
      } catch {
        // 缺失、损坏或不可信的候选文件不阻塞后续语言和其他插件。
      }
      if (keys.every((key) => resolved.has(key))) break
    }
    const name = rawName.replace(
      reference,
      (_, key: string) => resolved.get(key.toLowerCase()) ?? ''
    )
    return keys.every((key) => resolved.has(key)) && isUsableExtensionName(name) ? name : undefined
  } catch {
    return undefined
  }
}
