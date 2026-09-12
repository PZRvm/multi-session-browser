// 浏览器 IPC handlers：十五条通道（13 条命令 + 2 条推送）的装配层。
// 命令一律先经 registry.resolveSenderScope 按来源窗口解析作用域——主窗口来源
//（sender 属主窗口 webContents）→ 激活会话的 'main' 作用域（现行为）；独立窗口来源
// → windows.ts 登记的绑定会话的该窗口作用域；未知窗口/已销毁/绑定会话失效一律抛
// 中文错误拒绝（契约点 3，通道名与 payload 零变更）。
// 推送（stateChanged/focusAddress）按快照/请求的 windowId 定向发对应窗口，不盲发
// 主窗口；主窗口空态快照（emptySnapshot）恒属 'main'，自然只发主窗口。
// 通道名一律取自 shared/browser 的 BROWSER_CHANNELS，禁止手写字符串。
// 入参先过运行时守卫（shared 中的 payload 类型只是编译期约定，跨 IPC 边界不可信任）。

import { ipcMain } from 'electron'
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import {
  BROWSER_CHANNELS,
  WINDOW_ID_MAIN,
  type BrowserSnapshot,
  type OkResult,
  type SetBoundsPayload
} from '../../shared/browser'
import { createIpcGuards, logFailure, logFailureAsync } from '../ipc-utils'
import type { SenderWindowScope, SessionBrowserRegistry } from './registry'
import type { IndependentWindows } from './windows'
import { logLoadFailure, normalizeInput } from './url'

const { invalidParams, isRecord, optionalString, parseRect } = createIpcGuards('无效的浏览器参数')

export function registerBrowserIpc(
  manager: SessionBrowserRegistry,
  deps: { getMainWindow: () => BrowserWindow | null; windows: IndependentWindows }
): void {
  const { getMainWindow, windows } = deps

  /** 推送目标窗口：'main' → 主窗口显式引用；独立窗口 → 登记表现取（销毁即跳过；主窗口 macOS 关窗期间为 null，均静默跳过） */
  function windowForId(windowId: string): BrowserWindow | null {
    const win = windowId === WINDOW_ID_MAIN ? getMainWindow() : windows.getWindowById(windowId)
    return win && !win.isDestroyed() ? win : null
  }

  // 快照变化定向推送：主进程是唯一事实源，renderer 只做镜像；按快照 windowId 发对应
  // 窗口（作用域快照防双窗串台），未登记/已销毁窗口静默跳过
  manager.onSnapshotChanged((snapshot) => {
    windowForId(snapshot.windowId)?.webContents.send(BROWSER_CHANNELS.stateChanged, snapshot)
  })

  // focus-address 桥接：manager 的页面侧请求点（Cmd/Ctrl+L、页面侧快捷键新建空 Tab）
  // 经此按来源窗口定向转发
  manager.onFocusAddressRequest((windowId) => {
    windowForId(windowId)?.webContents.send(BROWSER_CHANNELS.focusAddress)
  })

  /** 来源窗口作用域解析（未知来源抛中文错误）；空会话不在此拦——getState/setBounds 对空态合法 */
  function resolveScope(event: IpcMainInvokeEvent): SenderWindowScope {
    return manager.resolveSenderScope(event.sender)
  }

  /** 命令作用域守卫：解析来源 + 主窗口零会话拒绝（「未选择会话」仅对主窗口来源；独立窗口来源的会话存活性已在解析内校验） */
  function requireScope(event: IpcMainInvokeEvent): SenderWindowScope {
    const scope = manager.resolveSenderScope(event.sender)
    if (scope.sessionId === null) throw new Error('未选择会话')
    return scope
  }

  /** id 存在性校验（按来源窗口作用域）：不存在抛错（manager 对不存在 id 是静默 no-op，必须在 handler 层拦截） */
  function requireTabId(windowId: string, id: string): void {
    if (!manager.getSnapshot(windowId).tabs.some((tab) => tab.id === id)) {
      throw new Error('标签页不存在')
    }
  }

  // getState：返回来源窗口作用域的全量快照，只读（主窗口零会话空态合法，返回空态快照）
  ipcMain.handle(BROWSER_CHANNELS.getState, (event): BrowserSnapshot =>
    logFailure(BROWSER_CHANNELS.getState, undefined, () => {
      const scope = resolveScope(event)
      return manager.getSnapshot(scope.windowId)
    })
  )

  // newTab：url 可选——缺省新建空白新标签页并推送 focus-address（发起窗口聚焦地址栏）；
  // 携带 url 时先规范化，失败抛「无效的网址」
  ipcMain.handle(BROWSER_CHANNELS.newTab, (event, payload: unknown): BrowserSnapshot =>
    logFailure(BROWSER_CHANNELS.newTab, payload, () => {
      const scope = requireScope(event)
      const raw = isRecord(payload) ? payload : {}
      const url = optionalString(raw.url)
      if (url === undefined) {
        const snapshot = manager.newTab(undefined, scope.windowId)
        windowForId(scope.windowId)?.webContents.send(BROWSER_CHANNELS.focusAddress)
        return snapshot
      }
      const normalized = normalizeInput(url)
      if (!normalized) throw new Error('无效的网址')
      return manager.newTab(normalized, scope.windowId)
    })
  )

  // closeTab：id 必须属来源作用域；主窗口「最后留一」由 manager 静默 no-op，独立窗口
  // 最后一个 Tab 关闭后由 registry 快照监听收口关窗（manager 不直接关窗）
  ipcMain.handle(BROWSER_CHANNELS.closeTab, (event, payload: unknown): BrowserSnapshot =>
    logFailure(BROWSER_CHANNELS.closeTab, payload, () => {
      const scope = requireScope(event)
      if (!isRecord(payload) || typeof payload.id !== 'string') throw invalidParams()
      requireTabId(scope.windowId, payload.id)
      return manager.closeTab(payload.id, scope.windowId)
    })
  )

  // switchTab：id 必须属来源作用域；已激活时 manager 静默 no-op
  ipcMain.handle(BROWSER_CHANNELS.switchTab, (event, payload: unknown): BrowserSnapshot =>
    logFailure(BROWSER_CHANNELS.switchTab, payload, () => {
      const scope = requireScope(event)
      if (!isRecord(payload) || typeof payload.id !== 'string') throw invalidParams()
      requireTabId(scope.windowId, payload.id)
      return manager.switchTab(payload.id, scope.windowId)
    })
  )

  // navigate：作用于来源窗口作用域的激活 Tab；规范化失败抛「无效的网址」；导航失败由
  // Chromium 内建错误页如实呈现，loadURL 的 reject 走统一日志（ERR_ABORTED 静默）
  ipcMain.handle(BROWSER_CHANNELS.navigate, (event, payload: unknown): BrowserSnapshot =>
    logFailure(BROWSER_CHANNELS.navigate, payload, () => {
      const scope = requireScope(event)
      if (!isRecord(payload) || typeof payload.url !== 'string') throw invalidParams()
      const normalized = normalizeInput(payload.url)
      if (!normalized) throw new Error('无效的网址')
      const wc = manager.getActiveWebContents(scope.windowId)
      if (wc)
        void wc.loadURL(normalized).catch((error: unknown) => logLoadFailure(normalized, error))
      return manager.getSnapshot(scope.windowId)
    })
  )

  // back/forward/reload/stop：无 payload（入参忽略），作用于来源窗口作用域的激活 Tab；
  // 动作引发的快照变化经事件重算推送，handler 返回动作发起时的快照
  ipcMain.handle(BROWSER_CHANNELS.back, (event): BrowserSnapshot =>
    logFailure(BROWSER_CHANNELS.back, undefined, () => {
      const scope = requireScope(event)
      const wc = manager.getActiveWebContents(scope.windowId)
      if (wc && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
      return manager.getSnapshot(scope.windowId)
    })
  )

  ipcMain.handle(BROWSER_CHANNELS.forward, (event): BrowserSnapshot =>
    logFailure(BROWSER_CHANNELS.forward, undefined, () => {
      const scope = requireScope(event)
      const wc = manager.getActiveWebContents(scope.windowId)
      if (wc && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward()
      return manager.getSnapshot(scope.windowId)
    })
  )

  ipcMain.handle(BROWSER_CHANNELS.reload, (event): BrowserSnapshot =>
    logFailure(BROWSER_CHANNELS.reload, undefined, () => {
      const scope = requireScope(event)
      manager.getActiveWebContents(scope.windowId)?.reload()
      return manager.getSnapshot(scope.windowId)
    })
  )

  ipcMain.handle(BROWSER_CHANNELS.stop, (event): BrowserSnapshot =>
    logFailure(BROWSER_CHANNELS.stop, undefined, () => {
      const scope = requireScope(event)
      manager.getActiveWebContents(scope.windowId)?.stop()
      return manager.getSnapshot(scope.windowId)
    })
  )

  // setBounds：四字段必须为有限非负数（零合法——renderer 以零矩形作收起信号）；
  // windowId 由 sender 推导（payload 不加字段，契约点 3）；空态合法，不设会话守卫
  ipcMain.handle(BROWSER_CHANNELS.setBounds, (event, payload: unknown): OkResult =>
    logFailure(BROWSER_CHANNELS.setBounds, payload, () => {
      const scope = resolveScope(event)
      const rect: SetBoundsPayload = parseRect(payload)
      manager.setBounds(rect, scope.windowId)
      return { ok: true }
    })
  )

  // toggleDevTools：无 payload，作用于来源窗口作用域的激活 Tab；无激活 Tab 时 manager 静默 no-op
  ipcMain.handle(BROWSER_CHANNELS.toggleDevTools, (event): BrowserSnapshot =>
    logFailure(BROWSER_CHANNELS.toggleDevTools, undefined, () => {
      const scope = requireScope(event)
      return manager.toggleDevTools(scope.windowId)
    })
  )

  // closeDevTools：无 payload，只关不开（未开启时主进程原子 no-op）——renderer 的
  // close 语义直连本通道，消除「读镜像态守卫 + toggle」的毫秒级 TOCTOU 误重开窗口
  ipcMain.handle(BROWSER_CHANNELS.closeDevTools, (event): BrowserSnapshot =>
    logFailure(BROWSER_CHANNELS.closeDevTools, undefined, () => {
      const scope = requireScope(event)
      return manager.closeDevTools(scope.windowId)
    })
  )

  // tearOffTab：把发起窗口作用域的 Tab 移出为独立窗口（registry 内：读会话名 →
  // windows.ts 建窗 → manager 迁移 + 双侧快照）；webContents 保活原样迁移（重开同 URL
  // 的伪迁移禁止）；browser 域唯一异步命令（读盘取会话名），失败日志走 logFailureAsync
  ipcMain.handle(BROWSER_CHANNELS.tearOffTab, (event, payload: unknown): Promise<BrowserSnapshot> =>
    logFailureAsync(BROWSER_CHANNELS.tearOffTab, payload, async () => {
      const scope = requireScope(event)
      if (!isRecord(payload) || typeof payload.id !== 'string') throw invalidParams()
      requireTabId(scope.windowId, payload.id)
      return manager.tearOffTab(payload.id, scope.windowId)
    })
  )

  console.log('[browser] IPC handlers 已注册（15 条通道）')
}
