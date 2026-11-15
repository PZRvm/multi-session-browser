// 会话独立代理引擎（独立代理专项步骤 2，PRD 4.14）：代理应用 / 认证凭据表 / 分区
// 反查 / 出口 IP 探测的单一事实源。分层与不变量：
// - 归浏览器域（src/main/browser/），不 import ipcMain——两通道 handler 装配在
//   sessions.ts，app 级 'login' 认证装配在 index.ts（分层先例同 permissions.ts）
// - 分区串经 deps 注入 registry 的 partitionFor 单源，本模块禁止自拼分区字面量；
//   反查也禁止对未知 id 调 fromPartition（会惰性重建分区目录，见 registry 销毁链
//   注释）——对象身份比对只遍历 apply 时捕获的 Session 实例，storagePath 兜底支线
//   纯路径反解零实例化
// - 凭据只驻内存表（Map<sessionId, {username, password}>），随应用/清除/销毁单源
//   维护；凭据不落 console 日志——告警只打会话 id 与原因，不打用户名密码
// - 探测（probeExitIpForId）经 net.request 定向该分区发起（ClientRequest 自带 'login'
//   事件直供凭据），探测期临时把分区代理设为草稿值、结束恢复原状（净效果不改变该
//   会话当前生效配置）；不落盘、不动引擎登记与凭据表

import { net, session, type ProxyConfig } from 'electron'
import { randomUUID } from 'node:crypto'
import { createLock } from '../extensions/install/mutex'
import {
  normalizeExtensionProxy,
  readExtensionProxyRecords,
  saveExtensionProxyRecords,
  toElectronProxy,
  type ExtensionProxyConfig,
  type ExtensionProxyDetails,
  type ExtensionProxyRecords
} from './extensionProxyConfig'
import type { Session } from 'electron'
import { basename } from 'path'
import {
  PROXY_PROBE_TIMEOUT_MS,
  PROXY_PROBE_URL,
  SESSION_ID_RE,
  toProxyRules,
  type ProxyCheckResult,
  type SessionProxyConfig
} from '../../shared/sessions'

/**
 * 探测响应体收集上限：异常响应（HTML 错误页等）不刷内存，截断后按非 IP 形态收敛
 * 'fetch' 态——探测地址契约是 IP 形态纯文本（shared 常量头注），超限即非契约响应
 */
const PROBE_BODY_MAX_BYTES = 1024

/** 探测响应体的 IPv4 形态校验（每段 0—255，无前导零容忍） */
const PROBE_IP_RE = /^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/

/**
 * 第①跳（本机 → 代理）失败特征码：连接被拒（端口无监听）、显式代理连接失败、网络
 * 不可达 / 断网、代理主机名解析失败、连接超时。落到这些码收敛 'unreachable'；其余
 * 错误（隧道失败、探测地址侧错误等）按「代理已连通但探测请求失败」收敛 'fetch'
 */
const PROXY_FIRST_HOP_CODES = new Set([
  'ERR_PROXY_CONNECTION_FAILED',
  'ERR_CONNECTION_REFUSED',
  'ERR_CONNECTION_TIMED_OUT',
  'ERR_ADDRESS_UNREACHABLE',
  'ERR_NAME_NOT_RESOLVED',
  'ERR_INTERNET_DISCONNECTED',
  'ERR_NETWORK_ACCESS_DENIED'
])

/** 'net::ERR_XXX' → 'ERR_XXX'（Electron 请求 error.message 的固定形态）；无匹配返回 null */
function netErrorCode(error: Error): string | null {
  const match = /ERR_[A-Z0-9_]+/.exec(error.message)
  return match !== null ? match[0] : null
}

export interface SessionProxyEngine {
  forgetUnloadedExtensionProxies(ids: readonly string[]): Promise<void>
  syncExtensionProxy(target: Session, reapply?: boolean): Promise<void>
  extensionProxy(
    target: Session,
    extensionId: string,
    operation: string,
    details: unknown,
    priority: number
  ): Promise<ExtensionProxyDetails | undefined>
  removeExtensionProxy(target: Session, extensionId: string): Promise<void>
  onExtensionProxyError(listener: (target: Session, error: string) => void): () => void
  onExtensionProxyChanged(listener: (target: Session) => void): () => void
  /**
   * 把代理配置应用到该会话分区（config = null = 清除回直连）：setProxy + 配置变化时
   * closeAllConnections 收尾 keep-alive；幂等（落盘值未变不重放）。凭据表与模块登记
   * 随此单源维护。调用方：registry 的激活链/兜底/克隆预应用、set-proxy handler
   */
  applySessionProxy(id: string, config: SessionProxyConfig | null): Promise<void>
  /**
   * Session 对象身份反查会话 id（app 级 'login' 认证路由用）：fromPartition 同分区返回
   * 同一实例，apply 时捕获的实例可直接身份命中；未 apply 过的会话走 storagePath 路径
   * 反解 + 已知 id 集合校验（零分区实例化）。未命中返回 null
   */
  findSessionIdBySession(target: Session): string | null
  /** 该会话的代理凭据现取（login 供给用；无凭据返回 null——不消费，可重复读取） */
  getCredentials(id: string): { username: string; password: string } | null
  /**
   * 按草稿值探测该会话出口 IP（check-proxy 通道）：锚定该会话真实分区（探测必须锚定
   * 真实分区——凭据与连通性都以该分区为准），临时应用草稿值 → 探测 → 恢复原状
   */
  probeExitIpForId(id: string, config: SessionProxyConfig): Promise<ProxyCheckResult>
  /** 销毁清理：凭据表 / 应用登记 / 已知 id 集合一并摘除（destroySession 调用） */
  dropSession(id: string): Promise<void>
  /** 已知会话 id 全集登记（反查兜底，覆盖「会话存在但从未 apply」）：装配层与读盘点并入 */
  noteKnownIds(ids: readonly string[]): void
}

export interface SessionProxyEngineDeps {
  extensionProxyFile?: string
  isSessionUsable?: (target: Session) => boolean
  /** 分区串单源（registry 的 partitionFor）：本模块禁止自拼分区字面量 */
  partitionFor: (id: string) => string
  /** 已知会话 id 兜底集现取（index.ts 注入启动快照 id；运行期增量由 registry 读盘点并入） */
  idsProvider?: () => readonly string[]
}

export function createSessionProxyEngine(deps: SessionProxyEngineDeps): SessionProxyEngine {
  /** 各会话最近一次应用的配置（null = 已应用直连；undefined 差异 = 从未应用，探测恢复按 Chromium 缺省「跟随系统」） */
  const applied = new Map<string, SessionProxyConfig | null>()
  /** apply 时捕获的 Session 实例（身份反查首选；fromPartition 同分区同实例，捕获即长期有效） */
  const appliedSessions = new Map<string, Session>()
  /** 内存凭据表（任务指定形态：只存用户名密码）；随应用/清除/销毁单源维护 */
  const credentials = new Map<string, { username: string; password: string }>()
  /** 已知会话 id 全集（storagePath 反解支线的校验集，防未知分区误认） */
  const knownIds = new Set<string>()

  const locked = createLock()
  let records: ExtensionProxyRecords = {}
  const ready = readExtensionProxyRecords(deps.extensionProxyFile).then((value) => {
    records = value
  })
  // 有损坏记录时操作明确失败，不按空配置覆盖；同时避免启动时未处理拒绝。
  void ready.catch(() => undefined)
  const effective = new Map<
    string,
    { key: string; native: ProxyConfig; marker?: string; owner?: string }
  >()
  const listeners = new Set<(target: Session) => void>()
  const errorListeners = new Set<(target: Session, error: string) => void>()
  const wiring = new Map<string, () => void>()
  const dead = new Set<string>()
  const applying = new Set<string>()
  const failedClosed = new Set<string>()
  const suspended = new Map<string, Set<string>>()
  const emitted = new Map<string, string>()
  const emit = (target: Session): void => {
    const id = findSessionIdBySession(target)
    if (!id) return
    const signature = JSON.stringify([
      effective.get(id)?.key,
      selected(id, target)?.[0],
      !!applied.get(id)
    ])
    if (emitted.get(id) === signature) return
    emitted.set(id, signature)
    for (const listener of listeners) {
      try {
        listener(target)
      } catch {
        console.warn('[proxy] 状态订阅执行失败')
      }
    }
  }

  function emitProxyError(target: Session, error: string): void {
    for (const listener of errorListeners) {
      try {
        listener(target, error)
      } catch {
        console.warn('[proxy] 错误订阅执行失败')
      }
    }
  }
  function selected(
    id: string,
    target: Session,
    source = records
  ): [string, ExtensionProxyConfig] | undefined {
    return Object.entries(source[id] ?? {})
      .filter(([extension]) => {
        const loaded = target.extensions?.getExtension(extension)
        return loaded?.manifest.permissions?.includes('proxy')
      })
      .sort(([a, x], [b, y]) => y.priority - x.priority || a.localeCompare(b))
      .map(([owner, entry]) => [owner, entry.config] as [string, ExtensionProxyConfig])[0]
  }
  function missingOwner(id: string, target: Session): boolean {
    const owner = Object.entries(records[id] ?? {}).sort(
      ([a, x], [b, y]) => y.priority - x.priority || a.localeCompare(b)
    )[0]?.[0]
    return (
      !!owner && !target.extensions.getExtension(owner)?.manifest.permissions?.includes('proxy')
    )
  }
  function desired(
    id: string,
    target: Session,
    manual: SessionProxyConfig | null | undefined,
    source = records
  ): ExtensionProxyConfig {
    if (manual)
      return {
        mode: 'fixed_servers',
        rules: { singleProxy: { scheme: manual.protocol, host: manual.host, port: manual.port } }
      }
    return selected(id, target, source)?.[1] ?? { mode: 'direct' }
  }
  function detailsFor(id: string, target: Session, extension: string): ExtensionProxyDetails {
    const winner = selected(id, target)
    return {
      value: desired(id, target, applied.get(id)),
      incognitoSpecific: false,
      levelOfControl:
        applied.get(id) || missingOwner(id, target)
          ? 'not_controllable'
          : winner
            ? winner[0] === extension
              ? 'controlled_by_this_extension'
              : 'controlled_by_other_extensions'
            : 'controllable_by_this_extension'
    }
  }
  async function bounded<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('PROXY_TIMEOUT')), ms)
        })
      ])
    } finally {
      clearTimeout(timer)
    }
  }
  async function materialize(
    config: ExtensionProxyConfig
  ): Promise<{ native: ProxyConfig; marker?: string }> {
    if (config.mode !== 'pac_script' || !config.pacScript?.mandatory)
      return { native: toElectronProxy(config) }
    let script = config.pacScript.data
    if (script === undefined) {
      const response = await net.fetch(config.pacScript.url!, {
        credentials: 'omit',
        redirect: 'error',
        signal: AbortSignal.timeout(5000)
      })
      if (!response.ok) throw new Error('PAC_DOWNLOAD_FAILED')
      const reader = response.body?.getReader()
      if (!reader) throw new Error('PAC_EMPTY')
      const chunks: Uint8Array[] = []
      let length = 0
      try {
        while (true) {
          const part = await reader.read()
          if (part.done) break
          length += part.value.length
          if (length > 1024 * 1024) throw new Error('PAC_TOO_LARGE')
          chunks.push(part.value)
        }
      } finally {
        await reader.cancel().catch(() => undefined)
      }
      script = Buffer.concat(chunks).toString('utf8')
    }
    const nonce = randomUUID()
    const originalName = '__msbOriginal_' + nonce.replaceAll('-', '')
    const marker = `PROXY ${nonce}.invalid:9`
    const wrapped = `var FindProxyForURL=(function(){try{${script}\n;var ${originalName}=FindProxyForURL;return function(url,host){try{var value=${originalName}(url,host);if(typeof value!=='string'||!value.trim())return '${marker}';return value+'; ${marker}'}catch(e){return '${marker}'}}}catch(e){return function(){return '${marker}'}}})();`
    return {
      native: {
        mode: 'pac_script',
        pacScript:
          'data:application/x-ns-proxy-autoconfig;base64,' + Buffer.from(wrapped).toString('base64')
      },
      marker
    }
  }
  function wire(id: string, target: Session): void {
    if (wiring.has(id)) return
    // 本项目没有其他 onBeforeRequest 所有者；所有代理策略仍由本引擎统一应用。
    target.webRequest?.onBeforeRequest({ urls: ['<all_urls>'] }, (request, callback) => {
      // chrome-extension 资源不经过代理；阻断它们会在切换配置时破坏后台初始化。
      if (!/^(https?|wss?):/.test(request.url)) {
        callback({})
        return
      }
      if (
        dead.has(id) ||
        failedClosed.has(id) ||
        (!applied.get(id) && missingOwner(id, target)) ||
        applying.has(id) ||
        (!applied.get(id) &&
          [...(suspended.get(id) ?? [])].some(
            (extension) => records[id]?.[extension] && !target.extensions.getExtension(extension)
          ))
      ) {
        callback({ cancel: true })
        return
      }
      const current = effective.get(id)
      if (!current?.marker || !/^https?:|^wss?:/.test(request.url)) {
        callback({})
        return
      }
      void bounded(target.resolveProxy(request.url), 5000).then(
        (result) => {
          const cancel =
            dead.has(id) ||
            effective.get(id) !== current ||
            !result.includes(current.marker!) ||
            result.trim() === current.marker
          if (cancel && !dead.has(id) && effective.get(id) === current)
            emitProxyError(target, 'ERR_PAC_SCRIPT_FAILED')
          callback({ cancel })
        },
        () => {
          emitProxyError(target, 'ERR_PAC_TIMEOUT')
          callback({ cancel: true })
        }
      )
    })
    const changed = (): void => {
      if (dead.has(id)) return
      void locked(async () => {
        await ready
        if (dead.has(id)) return
        await applyEffective(id, target, applied.get(id))
        emit(target)
      }).catch(() => console.warn('[proxy] 扩展生命周期变化后的代理应用失败'))
    }
    target.webRequest?.onErrorOccurred({ urls: ['<all_urls>'] }, (details) => {
      if (!dead.has(id) && /ERR_(PROXY|TUNNEL|PAC|SOCKS)/.test(details.error))
        emitProxyError(target, details.error)
    })
    const loaded = (_event: unknown, extension: Electron.Extension): void => {
      suspended.get(id)?.delete(extension.id)
      changed()
    }
    const unloaded = (_event: unknown, extension: Electron.Extension): void => {
      if (effective.get(id)?.owner === extension.id && records[id]?.[extension.id]) {
        const ids = suspended.get(id) ?? new Set<string>()
        ids.add(extension.id)
        suspended.set(id, ids)
      }
      changed()
    }
    target.extensions?.on('extension-loaded', loaded)
    target.extensions?.on('extension-unloaded', unloaded)
    wiring.set(id, () => {
      target.extensions?.off('extension-loaded', loaded)
      target.extensions?.off('extension-unloaded', unloaded)
      target.webRequest?.onBeforeRequest(null)
      target.webRequest?.onErrorOccurred(null)
    })
  }
  async function applyEffective(
    id: string,
    target: Session,
    manual: SessionProxyConfig | null | undefined,
    source = records
  ): Promise<void> {
    if (dead.has(id)) throw new Error('SESSION_RETIRED')
    const config = desired(id, target, manual, source),
      key = JSON.stringify(config)
    const previous = effective.get(id)
    const owner = manual ? undefined : selected(id, target, source)?.[0]
    if (previous?.key === key && !failedClosed.has(id)) {
      previous.owner = owner
      return
    }
    const next = await materialize(config)
    applying.add(id)
    try {
      await target.setProxy(next.native)
      await target.closeAllConnections()
      effective.set(id, { key, ...next, owner })
      if (next.marker) {
        const result = await bounded(
          target.resolveProxy('http://msb-pac-validation.invalid/'),
          5000
        )
        if (!result.includes(next.marker) || result.trim() === next.marker)
          throw new Error('PAC_VALIDATION_FAILED')
      }
      failedClosed.delete(id)
    } catch (error) {
      // 回滚同样等原生落定；回滚失败保留强制标记或封闭状态，不能悄悄直连。
      try {
        if (previous) {
          await target.setProxy(previous.native)
          effective.set(id, previous)
        } else {
          await target.setProxy({ mode: 'direct' })
          effective.delete(id)
        }
        await target.closeAllConnections()
      } catch {
        failedClosed.add(id)
        throw new Error('PROXY_ROLLBACK_FAILED')
      }
      throw error
    } finally {
      applying.delete(id)
    }
  }
  async function applySessionProxy(id: string, config: SessionProxyConfig | null): Promise<void> {
    return locked(async () => {
      await ready
      if (dead.has(id)) throw new Error('SESSION_RETIRED')
      const target = session.fromPartition(deps.partitionFor(id))
      appliedSessions.set(id, target)
      knownIds.add(id)
      wire(id, target)
      await applyEffective(id, target, config)
      applied.set(id, config)
      if (config && (config.username !== '' || config.password !== ''))
        credentials.set(id, { username: config.username, password: config.password })
      else credentials.delete(id)
      emit(target)
    })
  }
  async function extensionProxy(
    target: Session,
    extensionId: string,
    operation: string,
    raw: unknown,
    priority: number,
    hostRemoval = false
  ): Promise<ExtensionProxyDetails | undefined> {
    return locked(async () => {
      await ready
      const id = findSessionIdBySession(target)
      if (!id || dead.has(id) || (deps.isSessionUsable?.(target) === false && !hostRemoval))
        throw new Error('UNKNOWN_SESSION')
      if (
        !hostRemoval &&
        !target.extensions.getExtension(extensionId)?.manifest.permissions?.includes('proxy')
      )
        throw new Error('PROXY_PERMISSION_REQUIRED')
      const details = raw ?? {}
      if (!details || typeof details !== 'object' || Array.isArray(details))
        throw new Error('INVALID_PROXY_DETAILS')
      const allowed =
        operation === 'get' ? ['incognito'] : operation === 'set' ? ['scope', 'value'] : ['scope']
      if (Object.keys(details).some((key) => !allowed.includes(key)))
        throw new Error('INVALID_PROXY_DETAILS')
      const payload = details as { scope?: unknown; incognito?: unknown; value?: unknown }
      if (
        (payload.scope !== undefined && payload.scope !== 'regular') ||
        (payload.incognito !== undefined && payload.incognito !== false)
      )
        throw new Error('UNSUPPORTED_PROXY_SCOPE')
      if (operation === 'get') return detailsFor(id, target, extensionId)
      if (operation !== 'set' && operation !== 'clear') throw new Error('INVALID_PROXY_OPERATION')
      if (!Number.isSafeInteger(priority) || priority < 0) throw new Error('INVALID_PROXY_PRIORITY')
      const next = structuredClone(records)
      next[id] ??= {}
      if (operation === 'set')
        next[id][extensionId] = { config: normalizeExtensionProxy(payload.value), priority }
      else delete next[id][extensionId]
      const oldEffective = effective.get(id)
      await applyEffective(id, target, applied.get(id), next)
      try {
        await saveExtensionProxyRecords(deps.extensionProxyFile, next)
      } catch (error) {
        applying.add(id)
        try {
          await target.setProxy(oldEffective?.native ?? { mode: 'direct' })
          await target.closeAllConnections()
          if (oldEffective) effective.set(id, oldEffective)
          else effective.delete(id)
        } catch {
          failedClosed.add(id)
          throw new Error('PROXY_ROLLBACK_FAILED')
        } finally {
          applying.delete(id)
        }
        throw error
      }
      records = next
      emit(target)
      return undefined
    })
  }
  async function forgetUnloadedExtensionProxies(ids: readonly string[]): Promise<void> {
    await locked(async () => {
      await ready
      const next = structuredClone(records)
      for (const entries of Object.values(next)) for (const id of ids) delete entries[id]
      await saveExtensionProxyRecords(deps.extensionProxyFile, next)
      records = next
    })
  }
  async function removeExtensionProxy(target: Session, extensionId: string): Promise<void> {
    await extensionProxy(target, extensionId, 'clear', {}, 0, true)
  }

  function findSessionIdBySession(target: Session): string | null {
    // 首选：apply 时捕获的实例直接身份比对（无任何分区实例化副作用）
    for (const [id, known] of appliedSessions) {
      if (known === target) return id
    }
    // 兜底：storagePath 反解（覆盖「会话存在但从未 apply」——其 Session 由 registry 的
    // ensureManager 创建，未经本引擎登记）。目录名 = sess-<id>（去掉一层 sess- 前缀即
    // 会话 id），再过 SESSION_ID_RE + 已知 id 集合双重校验，未知分区一律不认
    const storagePath = target.storagePath
    if (typeof storagePath !== 'string') return null
    const name = basename(storagePath)
    if (!name.startsWith('sess-')) return null
    const id = name.slice('sess-'.length)
    if (!SESSION_ID_RE.test(id)) return null
    if (!knownIds.has(id) && !(deps.idsProvider?.().includes(id) ?? false)) return null
    return id
  }

  function getCredentials(id: string): { username: string; password: string } | null {
    return credentials.get(id) ?? null
  }

  /**
   * 探测请求本体：单发 GET（PROXY_PROBE_URL 单源），超时定时器 + clearTimeout 兜底，
   * 'login' 事件供凭据（同一凭据只供一次：Chromium 凭据错误会再触发一次 login——407
   * 重试，第二次回调不重复供，空回调取消让请求以 407 失败结束，防死循环）。错误分类
   * 按 ProxyCheckResult 契约三态：第①跳特征码 / 超时无代理可达证据 → 'unreachable'；
   * 407 响应或认证挑战后失败 → 'auth'；代理已连通但请求失败 / 响应非 IP 形态 → 'fetch'
   */
  function requestExitIp(target: Session, config: SessionProxyConfig): Promise<ProxyCheckResult> {
    return new Promise<ProxyCheckResult>((resolve) => {
      let settled = false
      let sawLogin = false // 代理认证挑战已到达 = 代理本身可达的证据
      let sawResponse = false // 响应头已到达 = 隧道已建通的证据
      let credSupplied = false // 同一凭据只供一次
      let loginRefused = false // 挑战未获供给（无凭据/已供过）= 认证失败收敛依据
      const chunks: Buffer[] = []
      let received = 0
      const finish = (result: ProxyCheckResult): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(result)
      }
      const request = net.request({ session: target, url: PROXY_PROBE_URL })
      request.on('login', (_authInfo, callback) => {
        sawLogin = true
        if (!credSupplied && (config.username !== '' || config.password !== '')) {
          credSupplied = true
          callback(config.username, config.password)
          return
        }
        // 无凭据可供或同一凭据已供过：空回调取消认证，请求将以 407 失败收敛 'auth' 态
        loginRefused = true
        callback()
      })
      request.on('response', (response) => {
        sawResponse = true
        response.on('data', (chunk) => {
          // 上限截断防异常响应刷内存；截断体过不了 IP 校验，按契约收敛 'fetch'
          if (received < PROBE_BODY_MAX_BYTES) {
            chunks.push(chunk)
            received += chunk.length
          }
        })
        response.on('end', () => {
          const status = response.statusCode
          if (status === 407) {
            finish({ ok: false, reason: 'auth' })
            return
          }
          if (status < 200 || status >= 300) {
            finish({ ok: false, reason: 'fetch' })
            return
          }
          const body = Buffer.concat(chunks).toString('utf8').trim()
          finish(PROBE_IP_RE.test(body) ? { ok: true, ip: body } : { ok: false, reason: 'fetch' })
        })
        response.on('aborted', () => finish({ ok: false, reason: 'fetch' }))
        response.on('error', () => finish({ ok: false, reason: 'fetch' }))
      })
      request.on('error', (error) => {
        const code = netErrorCode(error)
        if (code !== null && PROXY_FIRST_HOP_CODES.has(code)) {
          finish({ ok: false, reason: 'unreachable' })
          return
        }
        // 认证挑战未获供给后的失败（部分链路以 error 而非 407 响应收尾）→ 'auth'
        if (loginRefused) {
          finish({ ok: false, reason: 'auth' })
          return
        }
        finish({ ok: false, reason: 'fetch' })
      })
      const timer = setTimeout(() => {
        // 超时：有代理可达证据（认证挑战 / 响应头已到达）说明第①跳通、卡在第②跳，
        // 收敛 'fetch'（契约原文：fetch 含「探测地址不可达/超时」）；无证据才视为
        // 连不上代理收敛 'unreachable'；挑战未获供给挂死则按认证失败
        request.abort()
        if (loginRefused) finish({ ok: false, reason: 'auth' })
        else if (sawLogin || sawResponse) finish({ ok: false, reason: 'fetch' })
        else finish({ ok: false, reason: 'unreachable' })
      }, PROXY_PROBE_TIMEOUT_MS)
      request.end()
    })
  }

  /** 探测编排（两入口共用）：临时应用草稿值 → 请求 → 恢复原状（finally 恒恢复） */
  async function probeOnSession(
    id: string | null,
    target: Session,
    config: SessionProxyConfig
  ): Promise<ProxyCheckResult> {
    try {
      await target.setProxy({ proxyRules: toProxyRules(config) })
      return await requestExitIp(target, config)
    } finally {
      // 恢复依据在 finally 现读引擎登记值，而非探测开始时的快照：探测窗口（≤8s）内
      // 并发落地的 applySessionProxy（sheet 保存/清除、激活链、克隆预应用）已把新值
      // 写进登记表（applied.set 先于其 setProxy），按旧快照回写会覆盖新配置、且此后
      // 幂等守卫按登记值跳过重放——落盘/引擎/分区三方分歧无法自愈（审查高 1）。现读
      // 则并发场景恢复到的就是新值本身（等值重放幂等），净效果「不改变当前生效配置」
      // 对并发也成立。从未应用（undefined）的分区是 Chromium 缺省「跟随系统」，如实
      // 还原到 system（不得臆造 direct）
      try {
        const restore = id !== null ? effective.get(id)?.native : undefined
        await target.setProxy(restore ?? { mode: 'system' })
        await target.closeAllConnections()
      } catch {
        // 恢复失败必须覆盖探测结果，禁止将失去有效代理的探测报告为成功。
        // eslint-disable-next-line no-unsafe-finally
        throw new Error('PROXY_RESTORE_FAILED')
      }
    }
  }

  async function probeExitIpForId(
    id: string,
    config: SessionProxyConfig
  ): Promise<ProxyCheckResult> {
    return locked(async () => {
      await ready
      if (dead.has(id)) throw new Error('SESSION_RETIRED')
      const target = session.fromPartition(deps.partitionFor(id))
      return probeOnSession(id, target, config)
    })
  }

  async function dropSession(id: string): Promise<void> {
    dead.add(id)
    await locked(async () => {
      await ready
      const next = structuredClone(records)
      delete next[id]
      await saveExtensionProxyRecords(deps.extensionProxyFile, next)
      records = next
      wiring.get(id)?.()
      wiring.delete(id)
      effective.delete(id)
      emitted.delete(id)
      suspended.delete(id)
      failedClosed.delete(id)
      applied.delete(id)
      appliedSessions.delete(id)
      credentials.delete(id)
      knownIds.delete(id)
    })
  }

  function noteKnownIds(ids: readonly string[]): void {
    for (const id of ids) knownIds.add(id)
  }

  return {
    syncExtensionProxy: (target, reapply = true) =>
      locked(async () => {
        await ready
        const id = findSessionIdBySession(target)
        if (id && !dead.has(id) && reapply) {
          await applyEffective(id, target, applied.get(id))
          emit(target)
        }
      }),
    onExtensionProxyError: (listener) => {
      errorListeners.add(listener)
      return () => {
        errorListeners.delete(listener)
      }
    },
    extensionProxy,
    removeExtensionProxy,
    onExtensionProxyChanged: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    forgetUnloadedExtensionProxies,
    applySessionProxy,
    findSessionIdBySession,
    getCredentials,
    probeExitIpForId,
    dropSession,
    noteKnownIds
  }
}
