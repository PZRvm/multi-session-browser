import type { ProxyConfig } from 'electron'
import { readFile, stat } from 'node:fs/promises'
import { isIP } from 'node:net'
import { atomicWriteJson } from '../fs-utils'
import { SESSION_ID_RE } from '../../shared/sessions'

export interface ExtensionProxyConfig {
  mode: 'direct' | 'system' | 'auto_detect' | 'fixed_servers' | 'pac_script'
  rules?: { [key: string]: ProxyServer | string[] }
  pacScript?: { url?: string; data?: string; mandatory?: boolean }
}
interface ProxyServer {
  scheme: string
  host: string
  port: number
}
export interface ExtensionProxyRecord {
  config: ExtensionProxyConfig
  priority: number
}
export type ExtensionProxyRecords = Record<string, Record<string, ExtensionProxyRecord>>
export interface ExtensionProxyDetails {
  value: ExtensionProxyConfig
  levelOfControl:
    | 'not_controllable'
    | 'controlled_by_other_extensions'
    | 'controlled_by_this_extension'
    | 'controllable_by_this_extension'
  incognitoSpecific: false
}
function demand(value: unknown): asserts value {
  if (!value) throw new Error('INVALID_PROXY_CONFIG')
}
function object(value: unknown): asserts value is Record<string, unknown> {
  demand(value && typeof value === 'object' && !Array.isArray(value))
}
function keys(value: Record<string, unknown>, allowed: string[]): void {
  demand(Object.keys(value).every((key) => allowed.includes(key)))
}
export function normalizeExtensionProxy(raw: unknown): ExtensionProxyConfig {
  object(raw)
  keys(raw, ['mode', 'rules', 'pacScript'])
  demand(
    ['direct', 'system', 'auto_detect', 'fixed_servers', 'pac_script'].includes(String(raw.mode))
  )
  const mode = raw.mode as ExtensionProxyConfig['mode']
  if (mode === 'pac_script') {
    demand(raw.rules === undefined)
    object(raw.pacScript)
    const p = raw.pacScript
    keys(p, ['url', 'data', 'mandatory'])
    demand(p.mandatory === undefined || typeof p.mandatory === 'boolean')
    demand((typeof p.url === 'string') !== (typeof p.data === 'string'))
    if (typeof p.url === 'string') {
      demand(p.url.length <= 4096)
      const url = new URL(p.url)
      demand(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password)
      return {
        mode,
        pacScript: {
          url: url.href,
          ...(p.mandatory !== undefined ? { mandatory: p.mandatory } : {})
        }
      }
    }
    demand(
      typeof p.data === 'string' &&
        p.data.length > 0 &&
        Buffer.byteLength(p.data, 'utf8') <= 1024 * 1024
    )
    return {
      mode,
      pacScript: { data: p.data, ...(p.mandatory !== undefined ? { mandatory: p.mandatory } : {}) }
    }
  }
  demand(raw.pacScript === undefined)
  if (mode !== 'fixed_servers') {
    demand(raw.rules === undefined)
    return { mode }
  }
  object(raw.rules)
  const rules = raw.rules
  keys(rules, [
    'singleProxy',
    'proxyForHttp',
    'proxyForHttps',
    'proxyForFtp',
    'fallbackProxy',
    'bypassList'
  ])
  const names = ['singleProxy', 'proxyForHttp', 'proxyForHttps', 'proxyForFtp', 'fallbackProxy']
  demand(names.some((key) => rules[key] !== undefined))
  demand(rules.singleProxy === undefined || names.slice(1).every((key) => rules[key] === undefined))
  const normalized: NonNullable<ExtensionProxyConfig['rules']> = {}
  for (const name of names) {
    if (rules[name] === undefined) continue
    const server = rules[name]
    object(server)
    keys(server, ['scheme', 'host', 'port'])
    const scheme = server.scheme ?? 'http'
    demand(['http', 'https', 'socks4', 'socks5'].includes(String(scheme)))
    demand(
      typeof server.host === 'string' &&
        server.host.length > 0 &&
        server.host.length <= 253 &&
        !/[\s/@?#]/.test(server.host)
    )
    const host =
      server.host.includes(':') && !server.host.startsWith('[') ? `[${server.host}]` : server.host
    const url = new URL(`http://${host}`)
    demand(!url.port && url.pathname === '/' && url.hostname)
    demand(/^[a-z0-9.-]+$/i.test(url.hostname) || isIP(url.hostname.replace(/^\[|\]$/g, '')) === 6)
    const port =
      server.port ?? { http: 80, https: 443, socks4: 1080, socks5: 1080 }[String(scheme)] ?? 80
    demand(typeof port === 'number' && Number.isInteger(port) && port >= 1 && port <= 65535)
    normalized[name] = { scheme: String(scheme), host: url.hostname, port }
  }
  if (rules.bypassList !== undefined) {
    demand(
      Array.isArray(rules.bypassList) &&
        rules.bypassList.length <= 1024 &&
        rules.bypassList.every(
          (v) => typeof v === 'string' && v.length <= 1024 && !/[;\r\n\0]/.test(v)
        )
    )
    normalized.bypassList = rules.bypassList as string[]
  }
  return { mode, rules: normalized }
}
export function toElectronProxy(config: ExtensionProxyConfig): ProxyConfig {
  if (config.mode === 'pac_script') {
    const pac = config.pacScript!
    return {
      mode: 'pac_script',
      pacScript:
        pac.url ??
        `data:application/x-ns-proxy-autoconfig;base64,${Buffer.from(pac.data!, 'utf8').toString('base64')}`
    }
  }
  if (config.mode !== 'fixed_servers') return { mode: config.mode }
  const rules = config.rules!
  const server = (value: ProxyServer): string => `${value.scheme}://${value.host}:${value.port}`
  const proxyRules = rules.singleProxy
    ? server(rules.singleProxy as ProxyServer)
    : [
        ['proxyForHttp', 'http'],
        ['proxyForHttps', 'https'],
        ['proxyForFtp', 'ftp'],
        ['fallbackProxy', 'socks']
      ]
        .filter(([key]) => rules[key])
        .map(([key, protocol]) => `${protocol}=${server(rules[key] as ProxyServer)}`)
        .join(';')
  return {
    mode: 'fixed_servers',
    proxyRules,
    ...(rules.bypassList ? { proxyBypassRules: (rules.bypassList as string[]).join(',') } : {})
  }
}
export async function readExtensionProxyRecords(file?: string): Promise<ExtensionProxyRecords> {
  if (!file) return {}
  let text: string
  try {
    demand((await stat(file)).size <= 8 * 1024 * 1024)
    text = await readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }
  demand(Buffer.byteLength(text) <= 8 * 1024 * 1024)
  const raw = JSON.parse(text)
  object(raw)
  keys(raw, ['version', 'sessions'])
  demand(raw.version === 1)
  object(raw.sessions)
  demand(Object.keys(raw.sessions).length <= 4096)
  const result: ExtensionProxyRecords = {}
  for (const [id, value] of Object.entries(raw.sessions)) {
    demand(SESSION_ID_RE.test(id))
    object(value)
    demand(Object.keys(value).length <= 128)
    result[id] = {}
    for (const [extension, entry] of Object.entries(value)) {
      demand(/^[a-p]{32}$/.test(extension))
      object(entry)
      keys(entry, ['config', 'priority'])
      demand(Number.isSafeInteger(entry.priority) && Number(entry.priority) >= 0)
      result[id][extension] = {
        config: normalizeExtensionProxy(entry.config),
        priority: Number(entry.priority)
      }
    }
  }
  return result
}
export async function saveExtensionProxyRecords(
  file: string | undefined,
  records: ExtensionProxyRecords
): Promise<void> {
  demand(
    Object.keys(records).length <= 4096 &&
      Object.values(records).every((value) => Object.keys(value).length <= 128)
  )
  demand(
    Buffer.byteLength(JSON.stringify({ version: 1, sessions: records }, null, 2)) <= 8 * 1024 * 1024
  )
  if (file) await atomicWriteJson(file, { version: 1, sessions: records }, 0o600)
}
