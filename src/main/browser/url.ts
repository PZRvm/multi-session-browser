// 浏览器 URL 工具：地址栏输入规范化（scheme 白名单 + 缺省补 https://）、
// window.open 目标可导航性判断（同一白名单，不做改写）。
// 解析失败返回 null / false，由调用方统一抛「无效的网址」或拒绝。

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

/** window.open 目标可否转为新 Tab：页面可控 URL 不做补全改写，仅按同一白名单放行 */
export function isOpenableUrl(raw: string): boolean {
  try {
    return ALLOWED_SCHEMES.has(new URL(raw).protocol)
  } catch {
    return false
  }
}
