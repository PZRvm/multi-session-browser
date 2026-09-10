// 浏览器地址栏输入规范化：scheme 白名单仅放行 http/https/file/about，
// 其余（无 scheme 或白名单外的伪 scheme，如 localhost:3000）一律补 https://；
// 解析失败返回 null，由调用方统一抛「无效的网址」。

const SCHEME_RE = /^([a-zA-Z][a-zA-Z0-9+.-]*):/
const ALLOWED_SCHEMES = new Set(['http:', 'https:', 'file:', 'about:'])

/**
 * 规范化地址栏输入：空串返回 null；合法 web scheme 直通；其余补 https://；
 * new URL() 解析失败返回 null。
 */
export function normalizeInput(raw: string): string | null {
  const input = raw.trim()
  if (!input) return null
  const match = SCHEME_RE.exec(input)
  const scheme = match ? `${match[1].toLowerCase()}:` : null
  const candidate = scheme !== null && ALLOWED_SCHEMES.has(scheme) ? input : `https://${input}`
  try {
    new URL(candidate)
    return candidate
  } catch {
    return null
  }
}
