import { UPDATE_NOTES_MAX } from '../shared/updates'

/** 远端说明只作为文本；版本数组只选择当前候选，不拼入其他版本。 */
export function normalizeUpdateNotes(value: unknown, version: string): string {
  let note: unknown = value
  if (Array.isArray(value)) {
    note = value.find((item) => item && typeof item === 'object' && item.version === version)?.note
  }
  if (typeof note !== 'string') return ''
  return (
    note
      .slice(0, UPDATE_NOTES_MAX * 2)
      .replace(/<\s*(script|style)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
      .replace(/<\s*br\s*\/?\s*>/gi, '\n')
      .replace(/<\s*\/(p|div|li|h[1-6])\s*>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\r\n?/g, '\n')
      // eslint-disable-next-line no-control-regex -- 删除远端日志中的不可见控制字符
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
      .trim()
      .slice(0, UPDATE_NOTES_MAX)
  )
}
export function normalizeUpdateDate(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 50) return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}
