export type AddressInput =
  | { kind: 'empty' }
  | { kind: 'navigate'; url: string }
  | { kind: 'search'; query: string }
  | { kind: 'invalid' }

const SEARCH_OPERATOR = /^(?:site|inurl|intitle|intext|filetype|ext|related|cache):/i
const EXPLICIT_SCHEME = /^([a-z][a-z\d+.-]*):/i
const BLOCKED_SCHEME =
  /^(?:javascript|data|vbscript|ftp|mailto|blob|view-source|magnet|tel|sms|urn|geo):/i

/** 本地判断网址意图，不探测 DNS；明确但无效的网址不能转成外部搜索。 */
export function classifyAddressInput(raw: string): AddressInput {
  const input = raw.trim()
  if (!input) return { kind: 'empty' }
  if (BLOCKED_SCHEME.test(input)) return { kind: 'invalid' }

  const scheme = EXPLICIT_SCHEME.exec(input)?.[1].toLowerCase()
  const explicit =
    scheme === 'http' || scheme === 'https' || scheme === 'file' || scheme === 'about'
  if (explicit) {
    if (hasControlCharacter(input)) return { kind: 'invalid' }
    if (scheme === 'about')
      return input.toLowerCase() === 'about:blank'
        ? { kind: 'navigate', url: input }
        : { kind: 'invalid' }
    if (!/^(?:https?|file):\/\//i.test(input)) return { kind: 'invalid' }
    return checkedNavigation(input, true)
  }
  if (SEARCH_OPERATOR.test(input)) return { kind: 'search', query: input }
  // 单标签内网主机的明确端口是例外；其他已识别的 scheme 不隐式发给搜索引擎。
  const hostPort = /^[^\s/:?#]+:\d+(?=[/?#]|$)/.test(input)
  if (scheme && !hostPort) return { kind: 'invalid' }

  // 查询可含域名和空白；实际网址中的控制字符则必须拒绝，不能由 URL 静默删除。
  const authority = input.split(/[/?#\\]/, 1)[0]
  const hostIntent =
    authority.includes('.') ||
    /^localhost(?::|$)/i.test(authority) ||
    authority.startsWith('[') ||
    /^[^\s:]+:\d/.test(authority)
  if (!hostIntent || hasQuerySpace(authority)) return { kind: 'search', query: input }
  if (hasControlCharacter(input) || hasQuerySpace(input)) return { kind: 'invalid' }
  return checkedNavigation(input, false)
}

function hasQuerySpace(input: string): boolean {
  return Array.from(input).some(
    (character) => character.charCodeAt(0) >= 32 && /\s/u.test(character)
  )
}

function hasControlCharacter(input: string): boolean {
  return Array.from(input).some(
    (character) => character.charCodeAt(0) < 32 || character === '\u007f'
  )
}

function checkedNavigation(input: string, explicit: boolean): AddressInput {
  try {
    const url = new URL(explicit ? input : `https://${input}`)
    if (url.protocol !== 'file:') {
      const host = url.hostname.replace(/\.$/, '')
      // Chromium 会接受并转义主机空格；HTTP(S) 序列化主机不应保留百分号。
      if (!host || /[%\s]/u.test(host)) return { kind: 'invalid' }
      // IPv6 的括号、压缩与范围由 URL 校验；IPv4 不接受解析器的缩写/进制改写。
      if (!host.startsWith('[')) {
        const authority = input.replace(/^https?:\/\//i, '').split(/[/?#\\]/, 1)[0]
        const originalHost = authority.slice(authority.lastIndexOf('@') + 1).split(':', 1)[0]
        if (/^[\d.]+$/.test(host)) {
          const parts = originalHost.split('.')
          if (
            parts.length !== 4 ||
            parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255) ||
            parts.map(Number).join('.') !== host
          )
            return { kind: 'invalid' }
        } else if (
          !explicit &&
          (host.length > 253 ||
            host.split('.').some((label) => !/^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(label)))
        ) {
          return { kind: 'invalid' }
        }
      }
    }
    return { kind: 'navigate', url: input }
  } catch {
    return { kind: 'invalid' }
  }
}
