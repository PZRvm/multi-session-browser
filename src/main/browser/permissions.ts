// 会话网页摄像头权限 broker：Electron 的站点权限 handler 挂在 Session 上，本模块按
// 「会话 + 安全 origin + video」维护仅本次应用运行有效的授权；操作系统权限仍属于应用
// 身份和物理设备，不伪装为会话级隔离。摄像头只支持纯视频请求；剪贴板仅放行写入
// （clipboard-sanitized-write——网页复制按钮所需，用户手势驱动的主动写入），剪贴板
// 读取与其余权限一律默认拒绝。

import { dialog, systemPreferences } from 'electron'
import type {
  BrowserWindow,
  MediaAccessPermissionRequest,
  MessageBoxOptions,
  Session,
  WebContents
} from 'electron'
import { t } from '../i18n'

type CameraDecision = 'allow' | 'deny'

interface DecisionOutcome {
  decision: CameraDecision
  /** 页面/会话在询问期间失效时不缓存，后续合法请求仍应重新询问。 */
  cache: boolean
}

interface SessionBinding {
  sessionId: string
  target: Session
  active: boolean
  decisions: Map<string, CameraDecision>
  pending: Map<string, Promise<boolean>>
}

export interface CameraPermissionBroker {
  /** 为会话分区幂等安装权限策略；同一 sessionId/Session 重复调用不会重置运行期决定 */
  install: (sessionId: string, target: Session) => void
  /** 删除会话前封死权限请求并清理决定；不得恢复 Electron 的默认自动批准 handler */
  disposeSession: (sessionId: string) => void
}

interface CameraPermissionBrokerDeps {
  resolveSessionName: (sessionId: string) => Promise<string | null>
  resolveHostWindow: (webContents: WebContents) => BrowserWindow | null
}

/** 仅允许 Web 标准视为安全上下文的 HTTPS 与本机 localhost HTTP。 */
function secureOrigin(value: string): string | null {
  try {
    const parsed = new URL(value)
    if (parsed.username || parsed.password || parsed.origin === 'null') return null
    if (parsed.protocol === 'https:') return parsed.origin
    const loopback =
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '[::1]'
    return parsed.protocol === 'http:' && loopback ? parsed.origin : null
  } catch {
    return null
  }
}

/** securityOrigin 一旦由 Electron 提供便是权威值；不能在其非法时降级到另一个 URL。 */
function requestOrigin(
  securityOrigin: string | undefined,
  requestingUrl: string | undefined
): string | null {
  if (securityOrigin !== undefined) return secureOrigin(securityOrigin)
  return requestingUrl ? secureOrigin(requestingUrl) : null
}

function isPureVideoRequest(details: MediaAccessPermissionRequest): boolean {
  return details.mediaTypes?.length === 1 && details.mediaTypes[0] === 'video'
}

export function createCameraPermissionBroker(
  deps: CameraPermissionBrokerDeps
): CameraPermissionBroker {
  const bindings = new Map<string, SessionBinding>()

  function isCurrent(binding: SessionBinding): boolean {
    return binding.active && bindings.get(binding.sessionId) === binding
  }

  function hostWindow(webContents: WebContents): BrowserWindow | null {
    try {
      const win = deps.resolveHostWindow(webContents)
      return win && !win.isDestroyed() ? win : null
    } catch {
      return null
    }
  }

  async function showMessage(
    webContents: WebContents,
    options: MessageBoxOptions
  ): Promise<Electron.MessageBoxReturnValue> {
    const win = hostWindow(webContents)
    if (win) {
      try {
        return await dialog.showMessageBox(win, options)
      } catch {
        // 对话框创建前宿主窗恰好销毁时退回应用级对话框；授权判据不因定位失败放宽。
      }
    }
    return dialog.showMessageBox(options)
  }

  async function showSystemBlocked(
    webContents: WebContents,
    platform: 'darwin' | 'win32',
    status: string
  ): Promise<void> {
    console.warn(`[permissions] 摄像头被系统阻止（${platform}/${status}）`)
    // 对话框文案构造期经 t 取词（dialogs 命名空间；询问/阻止可能发生在语言切换前后，
    // 报错语言 = 对话框构造时语言）；OS 设置路径文案同为用户可见，一并入字典
    const path =
      platform === 'darwin'
        ? t('dialogs.camera.blockedPathMac')
        : t('dialogs.camera.blockedPathWindows')
    await showMessage(webContents, {
      type: 'warning',
      title: t('dialogs.camera.blockedTitle'),
      message: t('dialogs.camera.blockedMessage', { name: t('common.appName') }),
      detail: t('dialogs.camera.blockedDetail', { status, path }),
      buttons: [t('dialogs.camera.blockedButton')],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    })
  }

  async function ensureSystemCameraAccess(
    webContents: WebContents,
    requestAlive: () => boolean
  ): Promise<boolean> {
    if (webContents.isDestroyed() || !requestAlive()) return false
    if (process.platform === 'darwin') {
      const status = systemPreferences.getMediaAccessStatus('camera')
      if (status === 'granted') return true
      if (status === 'not-determined') {
        try {
          const granted = await systemPreferences.askForMediaAccess('camera')
          if (granted) return true
          if (webContents.isDestroyed() || !requestAlive()) return false
          await showSystemBlocked(webContents, 'darwin', 'denied')
          return false
        } catch (error) {
          console.warn('[permissions] 请求 macOS 摄像头权限失败:', error)
          if (webContents.isDestroyed() || !requestAlive()) return false
          await showSystemBlocked(webContents, 'darwin', 'unknown')
          return false
        }
      }
      if (webContents.isDestroyed() || !requestAlive()) return false
      await showSystemBlocked(webContents, 'darwin', status)
      return false
    }

    if (process.platform === 'win32') {
      const status = systemPreferences.getMediaAccessStatus('camera')
      if (status === 'denied' || status === 'restricted') {
        if (webContents.isDestroyed() || !requestAlive()) return false
        await showSystemBlocked(webContents, 'win32', status)
        return false
      }
      // Windows 的桌面应用开关由系统在真正取流时执行；unknown/not-determined 不在站点层误拒绝。
      return true
    }

    // PRODUCT 只承诺 Windows/Mac；其他平台不调用受限 API，由 Chromium/系统决定硬件结果。
    return true
  }

  async function decide(
    binding: SessionBinding,
    webContents: WebContents,
    origin: string,
    requestAlive: () => boolean
  ): Promise<DecisionOutcome> {
    let sessionName: string | null = null
    try {
      sessionName = await deps.resolveSessionName(binding.sessionId)
    } catch (error) {
      console.warn(`[permissions] 读取会话 ${binding.sessionId} 名称失败，使用 id 回退:`, error)
    }
    if (!isCurrent(binding) || webContents.isDestroyed() || !requestAlive()) {
      return { decision: 'deny', cache: false }
    }

    const result = await showMessage(webContents, {
      type: 'question',
      title: t('dialogs.camera.requestTitle'),
      message: t('dialogs.camera.requestMessage'),
      detail: t('dialogs.camera.requestDetail', {
        session: sessionName || binding.sessionId,
        origin
      }),
      buttons: [t('dialogs.camera.requestDeny'), t('dialogs.camera.requestAllow')],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    })
    if (!isCurrent(binding) || webContents.isDestroyed() || !requestAlive()) {
      return { decision: 'deny', cache: false }
    }
    if (result.response !== 1) return { decision: 'deny', cache: true }

    const allowed = await ensureSystemCameraAccess(webContents, requestAlive)
    if (!isCurrent(binding) || webContents.isDestroyed() || !requestAlive()) {
      return { decision: 'deny', cache: false }
    }
    // 系统层拒绝不缓存：用户随后在系统设置放行时，同源重试必须重走完整询问流程，
    // 否则本次运行内的旧决定把站点静默封死；只缓存用户显式拒绝与放行结果。
    return allowed ? { decision: 'allow', cache: true } : { decision: 'deny', cache: false }
  }

  function resolveDecision(
    binding: SessionBinding,
    webContents: WebContents,
    origin: string,
    requestAlive: () => boolean
  ): Promise<boolean> {
    const cached = binding.decisions.get(origin)
    if (cached) return Promise.resolve(cached === 'allow')

    const existing = binding.pending.get(origin)
    if (existing) return existing

    const pending = decide(binding, webContents, origin, requestAlive)
      .then((outcome) => {
        if (outcome.cache && isCurrent(binding)) {
          binding.decisions.set(origin, outcome.decision)
        }
        return outcome.decision === 'allow' && isCurrent(binding)
      })
      .catch((error) => {
        console.warn(`[permissions] 会话 ${binding.sessionId} 的摄像头授权流程失败:`, error)
        if (isCurrent(binding)) binding.decisions.set(origin, 'deny')
        return false
      })
    binding.pending.set(origin, pending)
    void pending.finally(() => {
      if (binding.pending.get(origin) === pending) binding.pending.delete(origin)
    })
    return pending
  }

  function install(sessionId: string, target: Session): void {
    const existing = bindings.get(sessionId)
    if (existing?.active && existing.target === target) return
    if (existing) existing.active = false

    const binding: SessionBinding = {
      sessionId,
      target,
      active: true,
      decisions: new Map(),
      pending: new Map()
    }
    bindings.set(sessionId, binding)

    target.setPermissionCheckHandler(
      (_webContents, permission, requestingOrigin, details): boolean => {
        // 剪贴板写入放行：网页复制按钮（navigator.clipboard）与复制前的 permissions.query
        // 探测都经此路径；Chromium 仅在安全上下文暴露该 API，无会话级询问必要。
        if (permission === 'clipboard-sanitized-write') return true
        // HTML 全屏探测（permissions.query('fullscreen')）放行：与 request handler 同口径
        if (permission === 'fullscreen') return true
        if (!isCurrent(binding) || permission !== 'media' || details.mediaType !== 'video') {
          return false
        }
        const origin = requestOrigin(
          details.securityOrigin,
          details.requestingUrl ?? requestingOrigin
        )
        return origin !== null && binding.decisions.get(origin) === 'allow'
      }
    )

    target.setPermissionRequestHandler((webContents, permission, callback, rawDetails) => {
      let completed = false
      let requestActive = true
      const finish = (allowed: boolean): void => {
        if (completed) return
        completed = true
        webContents.removeListener('destroyed', abort)
        webContents.removeListener('did-start-navigation', abort)
        callback(allowed)
      }
      const abort = (): void => {
        requestActive = false
        finish(false)
      }

      // 剪贴板写入放行：用户点击复制按钮即意图写入，无需会话级询问；拒绝会令
      // navigator.clipboard.writeText 抛 NotAllowedError、复制按钮失效。
      if (permission === 'clipboard-sanitized-write') {
        finish(true)
        return
      }
      // HTML 全屏（视频全屏按钮等 Fullscreen API 路径）放行：浏览器语义权限、用户
      // 手势驱动，无站点级询问必要；拒绝会让网页全屏请求静默失败（点按钮无反应）
      if (permission === 'fullscreen') {
        finish(true)
        return
      }
      if (!isCurrent(binding) || permission !== 'media') {
        finish(false)
        return
      }
      const details = rawDetails as MediaAccessPermissionRequest
      if (!isPureVideoRequest(details)) {
        finish(false)
        return
      }
      const origin = requestOrigin(details.securityOrigin, details.requestingUrl)
      if (!origin) {
        finish(false)
        return
      }

      // 对话框窗口期页面销毁或任一 frame 开始新导航均视为请求过期；保守拒绝，防旧 origin
      // 的授权结果回填到已换页的 webContents。finish 的一次性守卫保证 callback 恰好完成一次。
      webContents.once('destroyed', abort)
      webContents.once('did-start-navigation', abort)
      void resolveDecision(binding, webContents, origin, () => requestActive).then((allowed) => {
        if (!allowed || !isCurrent(binding) || webContents.isDestroyed()) {
          finish(false)
          return
        }
        if (details.isMainFrame && secureOrigin(webContents.getURL()) !== origin) {
          finish(false)
          return
        }
        finish(true)
      })
    })
  }

  function disposeSession(sessionId: string): void {
    const binding = bindings.get(sessionId)
    if (!binding) return
    binding.active = false
    binding.decisions.clear()
    binding.pending.clear()
    bindings.delete(sessionId)
    // 先封死 handler 再由 registry 销毁 webContents/分区，避免销毁窗口期回落到默认自动批准。
    binding.target.setPermissionCheckHandler(() => false)
    binding.target.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false)
    })
  }

  return { install, disposeSession }
}
