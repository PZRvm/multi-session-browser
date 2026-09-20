// 浏览器 URL 工具：地址栏输入规范化（scheme 白名单 + 缺省补 https://）、
// window.open 目标可导航性判断（同一白名单，不做改写）、loadURL 失败统一日志。
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

/**
 * loadURL reject 的统一日志：ERR_ABORTED（停止加载 / 被新导航替换）属正常静默；
 * 其余失败页面侧由 Chromium 内建错误页呈现，主进程侧只留单行——Error.message 已含
 * 错误码与目标地址，整包打印与 Electron C++ 固定警告重复且刷屏（后者已由
 * main/warnings.ts 的通道接管吞掉，本行是失败加载的唯一日志面）。
 */
export function logLoadFailure(url: string, error: unknown): void {
  if (error instanceof Error && error.message.includes('ERR_ABORTED')) return
  console.warn(`[browser] 加载失败 ${url}:`, error instanceof Error ? error.message : error)
}
