// 浏览器 IPC handlers：十三条通道的业务实现，命令转发给 TabManager。
// 通道名一律取自 shared/browser 的 BROWSER_CHANNELS，禁止手写字符串。
// 入参先过运行时守卫（shared 中的 payload 类型只是编译期约定，跨 IPC 边界不可信任）。

import { ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import {
  BROWSER_CHANNELS,
  type BrowserSnapshot,
  type OkResult,
  type SetBoundsPayload
} from '../../shared/browser'
import type { TabManager } from './manager'
import { normalizeInput } from './url'

/** 守卫失败统一抛出的业务错误 */
function invalidParams(): Error {
  return new Error('无效的浏览器参数')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 读取可选 string 字段：缺省返回 undefined，存在但非 string 判为非法入参 */
function optionalString(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw invalidParams()
  return value
}

/** 读取必填有限 number 字段：缺省或非有限数字判为非法入参 */
function requiredNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw invalidParams()
  return value
}

/** 入参内容摘要（截断，避免垃圾入参刷屏控制台） */
function summarize(data: unknown): string {
  let text: string
  try {
    text = JSON.stringify(data) ?? String(data)
  } catch {
    text = String(data)
  }
  const MAX = 200
  return text.length > MAX ? `${text.slice(0, MAX)}...(截断，总长 ${text.length})` : text
}

/** handler 统一包裹：失败路径主进程留 warn 日志（通道名 + 入参摘要）后原样 rethrow */
function logFailure<T>(channel: string, payload: unknown, run: () => T): T {
  try {
    return run()
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn(`[browser] ${channel} 失败: ${message} payload=${summarize(payload)}`)
    throw err
  }
}

/** id 存在性校验：不存在抛错（manager 对不存在 id 是静默 no-op，必须在 handler 层拦截） */
function requireTabId(manager: TabManager, id: string): void {
  if (!manager.getSnapshot().tabs.some((tab) => tab.id === id)) {
    throw new Error('标签页不存在')
  }
}

export function registerBrowserIpc(
  manager: TabManager,
  getMainWindow: () => BrowserWindow | null
): void {
  // 快照变化推送到当前主窗口：主进程是唯一事实源，renderer 只做镜像；
  // 窗口引用现取不缓存，无窗口（macOS 关窗期间）时静默跳过
  manager.onSnapshotChanged((snapshot) => {
    getMainWindow()?.webContents.send(BROWSER_CHANNELS.stateChanged, snapshot)
  })

  // focus-address 桥接：manager 的页面侧请求点（Cmd/Ctrl+L、页面侧快捷键新建空 Tab）经此转发主窗口
  manager.onFocusAddressRequest(() => {
    getMainWindow()?.webContents.send(BROWSER_CHANNELS.focusAddress)
  })

  // getState：返回当前全量快照，只读
  ipcMain.handle(BROWSER_CHANNELS.getState, (): BrowserSnapshot =>
    logFailure(BROWSER_CHANNELS.getState, undefined, () => manager.getSnapshot())
  )

  // newTab：url 可选——缺省新建空白新标签页并推送 focus-address（renderer 聚焦地址栏）；
  // 携带 url 时先规范化，失败抛「无效的网址」
  ipcMain.handle(BROWSER_CHANNELS.newTab, (_event, payload: unknown): BrowserSnapshot =>
    logFailure(BROWSER_CHANNELS.newTab, payload, () => {
      const raw = isRecord(payload) ? payload : {}
      const url = optionalString(raw.url)
      if (url === undefined) {
        const snapshot = manager.newTab()
        getMainWindow()?.webContents.send(BROWSER_CHANNELS.focusAddress)
        return snapshot
      }
      const normalized = normalizeInput(url)
      if (!normalized) throw new Error('无效的网址')
      return manager.newTab(normalized)
    })
  )

  // closeTab：id 必须存在；「最后留一」由 manager 静默 no-op，不在 handler 层拦截
  ipcMain.handle(BROWSER_CHANNELS.closeTab, (_event, payload: unknown): BrowserSnapshot =>
    logFailure(BROWSER_CHANNELS.closeTab, payload, () => {
      if (!isRecord(payload) || typeof payload.id !== 'string') throw invalidParams()
      requireTabId(manager, payload.id)
      return manager.closeTab(payload.id)
    })
  )

  // switchTab：id 必须存在；已激活时 manager 静默 no-op
  ipcMain.handle(BROWSER_CHANNELS.switchTab, (_event, payload: unknown): BrowserSnapshot =>
    logFailure(BROWSER_CHANNELS.switchTab, payload, () => {
      if (!isRecord(payload) || typeof payload.id !== 'string') throw invalidParams()
      requireTabId(manager, payload.id)
      return manager.switchTab(payload.id)
    })
  )

  // navigate：作用于激活 Tab；规范化失败抛「无效的网址」；导航失败由 Chromium
  // 内建错误页如实呈现，loadURL 的 reject 在此吞掉（与 manager 内 newTab 同策略）
  ipcMain.handle(BROWSER_CHANNELS.navigate, (_event, payload: unknown): BrowserSnapshot =>
    logFailure(BROWSER_CHANNELS.navigate, payload, () => {
      if (!isRecord(payload) || typeof payload.url !== 'string') throw invalidParams()
      const normalized = normalizeInput(payload.url)
      if (!normalized) throw new Error('无效的网址')
      const wc = manager.getActiveWebContents()
      if (wc) void wc.loadURL(normalized).catch(() => {})
      return manager.getSnapshot()
    })
  )

  // back/forward/reload/stop：无 payload（入参忽略），作用于激活 Tab；
  // 动作引发的快照变化经事件重算推送，handler 返回动作发起时的快照
  ipcMain.handle(BROWSER_CHANNELS.back, (): BrowserSnapshot =>
    logFailure(BROWSER_CHANNELS.back, undefined, () => {
      const wc = manager.getActiveWebContents()
      if (wc && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
      return manager.getSnapshot()
    })
  )

  ipcMain.handle(BROWSER_CHANNELS.forward, (): BrowserSnapshot =>
    logFailure(BROWSER_CHANNELS.forward, undefined, () => {
      const wc = manager.getActiveWebContents()
      if (wc && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward()
      return manager.getSnapshot()
    })
  )

  ipcMain.handle(BROWSER_CHANNELS.reload, (): BrowserSnapshot =>
    logFailure(BROWSER_CHANNELS.reload, undefined, () => {
      manager.getActiveWebContents()?.reload()
      return manager.getSnapshot()
    })
  )

  ipcMain.handle(BROWSER_CHANNELS.stop, (): BrowserSnapshot =>
    logFailure(BROWSER_CHANNELS.stop, undefined, () => {
      manager.getActiveWebContents()?.stop()
      return manager.getSnapshot()
    })
  )

  // setBounds：四个坐标必须为有限数字；转发 manager（仅作用于激活 view）
  ipcMain.handle(BROWSER_CHANNELS.setBounds, (_event, payload: unknown): OkResult =>
    logFailure(BROWSER_CHANNELS.setBounds, payload, () => {
      if (!isRecord(payload)) throw invalidParams()
      const rect: SetBoundsPayload = {
        x: requiredNumber(payload.x),
        y: requiredNumber(payload.y),
        width: requiredNumber(payload.width),
        height: requiredNumber(payload.height)
      }
      manager.setBounds(rect)
      return { ok: true }
    })
  )

  // toggleDevTools：无 payload，作用于激活 Tab；无激活 Tab 时 manager 静默 no-op 返回当前快照
  ipcMain.handle(BROWSER_CHANNELS.toggleDevTools, (): BrowserSnapshot =>
    logFailure(BROWSER_CHANNELS.toggleDevTools, undefined, () => manager.toggleDevTools())
  )

  console.log('[browser] IPC handlers 已注册（13 条通道）')
}
