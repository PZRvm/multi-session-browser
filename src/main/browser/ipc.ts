// 浏览器 IPC handlers：三十三条通道（浏览器域 26 条（20 命令 + 6 推送）+ 建议子窗域
// 7 条（原生子窗口化专项：4 命令 + 3 推送））的装配层。
// 命令一律先经 registry.resolveSenderScope 按来源窗口解析作用域——主窗口来源
//（sender 属主窗口 webContents）→ 激活会话的 'main' 作用域（现行为）；独立窗口来源
// → windows.ts 登记的绑定会话的该窗口作用域；未知窗口/已销毁/绑定会话失效一律抛
// 中文错误拒绝（契约点 3，通道名与 payload 零变更）。
// 推送（stateChanged/focusAddress/dragHover/historyChanged）按快照/请求/悬停/条目的
// windowId 会话归属定向发对应窗口，不盲发主窗口；主窗口空态快照（emptySnapshot）恒属
// 'main'，自然只发主窗口。阶段 9：tear-off 的 IPC 通道随临时右键菜单入口退役（建窗/
// 迁移编排下沉 registry 内部接口，由拖拽控制器复用）；拖拽通道（tab-drag-start/end
// 命令 + tab-drag-hover 推送）在此接线。阶段 10：dragInsert 插入位上报命令在此接线
//（hint 尽力而为语义——结构守卫后的匹配校验不符静默返回 ok，不抛错）。地址栏历史
// 补全：historyGet 命令（作用域会话解析，renderer 不传 sessionId）+ historyChanged
// 增量推送（dragHover 同款定向集合）在此接线（契约见 shared/history.ts）。
// 页内查找（会话网页内查找开发计划 2.4）：findStart/findStop 命令作用于来源窗口作用域
// 激活 Tab 的 webContents（text 非空 ≤ FIND_TEXT_MAX 守卫；stop 后 focus 归还页面焦点）；
// findRequest 推送为 focus-address 同构定向，findResult 按 Tab 归属窗口定向。
// 通道名一律取自 shared/browser 的 BROWSER_CHANNELS 与 shared/history 的
// HISTORY_CHANNELS，禁止手写字符串。
// 入参先过运行时守卫（shared 中的 payload 类型只是编译期约定，跨 IPC 边界不可信任）。

import { BrowserWindow, ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import {
  BROWSER_CHANNELS,
  FIND_TEXT_MAX,
  WINDOW_ID_MAIN,
  type BrowserSnapshot,
  type OkResult,
  type SetBoundsPayload,
  type TabDragOutcome,
  type TabDragPreviewPayload
} from '../../shared/browser'
import { HISTORY_CHANNELS, SUGGEST_MAX_RESULTS } from '../../shared/history'
import type { HistoryEntry } from '../../shared/history'
import { OMNIBOX_SUGGEST_CHANNELS, SUGGEST_TEXT_MAX } from '../../shared/omniboxSuggest'
import type { OmniboxSuggestShowPayload } from '../../shared/omniboxSuggest'
import { createIpcGuards, logFailure, logFailureAsync } from '../ipc-utils'
import { t } from '../i18n'
import type { TabDragController } from './dragging'
import type { OmniboxSuggestWindows } from './omniboxSuggest'
import type { SenderWindowScope, SessionBrowserRegistry } from './registry'
import type { IndependentWindows } from './windows'
import { normalizeInput } from './url'

// 守卫消息构造期经 t 取词（errors 命名空间）——语言 = 装配时语言（语言切换后新建的
// 守卫消息不重译，风险口径见计划：报错语言 = 构造时语言，如实接受）
const { invalidParams, isRecord, optionalString, parseRect, requiredNumber } = createIpcGuards(
  t('errors.invalidBrowserParams')
)

/**
 * 拖拽虚影载荷（dragStart 可选携带）运行时守卫：结构垃圾按命令口径拒绝（dragStart
 * 是命令语义，与 dragEnd 收尾不抛错的口径不同）；faviconUrl 仅收字符串（协议白名单
 * 在 dragPreview 内再校验），theme 限亮暗二值
 */
function parseDragPreview(value: unknown): TabDragPreviewPayload {
  if (
    !isRecord(value) ||
    typeof value.title !== 'string' ||
    typeof value.width !== 'number' ||
    !Number.isFinite(value.width) ||
    typeof value.height !== 'number' ||
    !Number.isFinite(value.height) ||
    typeof value.grabX !== 'number' ||
    !Number.isFinite(value.grabX) ||
    typeof value.grabY !== 'number' ||
    !Number.isFinite(value.grabY) ||
    (value.theme !== 'light' && value.theme !== 'dark')
  ) {
    throw invalidParams()
  }
  return {
    width: value.width,
    height: value.height,
    grabX: value.grabX,
    grabY: value.grabY,
    title: value.title,
    faviconUrl: typeof value.faviconUrl === 'string' ? value.faviconUrl : null,
    theme: value.theme
  }
}

/**
 * 建议子窗 show 载荷运行时守卫：anchor 四有限数（x/y 非负——内容坐标系不会为负，
 * 负值属垃圾入参整单拒绝；宽高须为正）、items 非空且不超过建议上限（条目结构宽容
 * 归一——title 非 string 以空串、favicon 非 string 以 null 收口，与拖拽虚影 favicon
 * 同口径；title/query 超 SUGGEST_TEXT_MAX 截断而非拒绝——超长标题页面建议仍可用，
 * 与 dragPreview 截断先例同口径）、query string、activeIndex -1 起且不越 items。
 * 子窗定位/高度计算依赖这些字段可信（面板高度 = 行数 × SUGGEST_ROW_HEIGHT 常量）
 */
function parseSuggestShow(value: unknown): OmniboxSuggestShowPayload {
  if (!isRecord(value) || !isRecord(value.anchor) || typeof value.query !== 'string') {
    throw invalidParams()
  }
  const anchor = {
    x: requiredNumber(value.anchor.x),
    y: requiredNumber(value.anchor.y),
    width: requiredNumber(value.anchor.width),
    height: requiredNumber(value.anchor.height)
  }
  if (anchor.x < 0 || anchor.y < 0) throw invalidParams()
  if (anchor.width <= 0 || anchor.height <= 0) throw invalidParams()
  if (
    !Array.isArray(value.items) ||
    value.items.length === 0 ||
    value.items.length > SUGGEST_MAX_RESULTS
  ) {
    throw invalidParams()
  }
  const items = value.items.map((item) => {
    if (!isRecord(item) || typeof item.url !== 'string' || item.url.length === 0) {
      throw invalidParams()
    }
    return {
      url: item.url,
      title: typeof item.title === 'string' ? item.title.slice(0, SUGGEST_TEXT_MAX) : '',
      faviconUrl: typeof item.faviconUrl === 'string' ? item.faviconUrl : null
    }
  })
  if (
    typeof value.activeIndex !== 'number' ||
    !Number.isInteger(value.activeIndex) ||
    value.activeIndex < -1 ||
    value.activeIndex >= items.length
  ) {
    throw invalidParams()
  }
  return {
    anchor,
    items,
    query: value.query.slice(0, SUGGEST_TEXT_MAX),
    activeIndex: value.activeIndex
  }
}

export function registerBrowserIpc(
  manager: SessionBrowserRegistry,
  deps: {
    getMainWindow: () => BrowserWindow | null
    windows: IndependentWindows
    dragController: TabDragController
    /** 建议子窗池（原生子窗口化专项）：show/hide 编排 + 子窗 sender 身份判别 */
    suggestWindows: OmniboxSuggestWindows
  }
): void {
  const { getMainWindow, windows, dragController, suggestWindows } = deps

  /** 推送目标窗口：'main' → 主窗口显式引用；独立窗口 → 登记表现取（销毁即跳过；主窗口 macOS 关窗期间为 null，均静默跳过） */
  function windowForId(windowId: string): BrowserWindow | null {
    const win = windowId === WINDOW_ID_MAIN ? getMainWindow() : windows.getWindowById(windowId)
    return win && !win.isDestroyed() ? win : null
  }

  /**
   * 焦点归还式定向推送（focusAddress / findRequest 两桥共用，审查 L1 抽出）：send 前
   * 先把宿主窗口键盘焦点交还 shell——页面 webContents 持焦时 renderer 的
   * input.focus() 无法跨 webContents 抢回（Chromium 焦点控制约束，实测表现「全选但
   * 不聚焦」），主进程 focus() 是唯一通路
   */
  function focusShellAndSend(windowId: string, channel: string): void {
    const win = windowForId(windowId)
    if (!win) return
    win.webContents.focus()
    win.webContents.send(channel)
  }

  // 快照变化定向推送：主进程是唯一事实源，renderer 只做镜像；按快照 windowId 发对应
  // 窗口（作用域快照防双窗串台），未登记/已销毁窗口静默跳过
  manager.onSnapshotChanged((snapshot) => {
    windowForId(snapshot.windowId)?.webContents.send(BROWSER_CHANNELS.stateChanged, snapshot)
  })

  // focus-address 桥接：manager 的页面侧请求点（Cmd/Ctrl+L、页面侧快捷键新建空 Tab）
  // 经此按来源窗口定向转发（焦点归还语义见 focusShellAndSend）
  manager.onFocusAddressRequest((windowId) => {
    focusShellAndSend(windowId, BROWSER_CHANNELS.focusAddress)
  })

  // 拖拽悬停桥接：控制器只在悬停变化时回调（含 dragStart 初始态与收尾/过期的 null
  // 终态）。广播目标 = 被拖 Tab 同会话的窗口全集——主窗口（仅当其激活会话 = 拖拽会话，
  // 各窗口与自身 windowId 比对画高亮）+ 该会话全部独立窗口（含源窗口：源窗需据
  // payload.tabId 渲染半透明并在 null 终态时清场）；异会话窗口零触达（计划 2.3）
  dragController.onHoverChanged((payload) => {
    if (manager.getActiveSessionId() === payload.sessionId) {
      windowForId(WINDOW_ID_MAIN)?.webContents.send(BROWSER_CHANNELS.dragHover, payload)
    }
    for (const entry of windows.listForSession(payload.sessionId)) {
      windowForId(entry.windowId)?.webContents.send(BROWSER_CHANNELS.dragHover, payload)
    }
  })

  // 历史变化桥接（地址栏补全）：history 模块内存合并后即回调（镜像即时语义），
  // 定向集合与 dragHover 同款——主窗口仅当激活会话 = 条目归属会话时发 + 该会话全部
  // 独立窗发；异会话窗口零触达（会话隔离硬边界）
  manager.history.onEntryChanged((payload) => {
    if (manager.getActiveSessionId() === payload.sessionId) {
      windowForId(WINDOW_ID_MAIN)?.webContents.send(HISTORY_CHANNELS.changed, payload)
    }
    for (const entry of windows.listForSession(payload.sessionId)) {
      windowForId(entry.windowId)?.webContents.send(HISTORY_CHANNELS.changed, payload)
    }
  })

  // find-request 桥接：页面聚焦态 Cmd/Ctrl+F 请求唤起来源窗口 shell 查找栏
  //（registry 接线已含会话归属守卫，此处定向 + 焦点归还见 focusShellAndSend）
  manager.onFindRequest((windowId) => {
    focusShellAndSend(windowId, BROWSER_CHANNELS.findRequest)
  })

  // find-result 桥接：found-in-page 计数按发生查找的 Tab 归属窗口定向推送
  manager.onFindResult((windowId, result) => {
    windowForId(windowId)?.webContents.send(BROWSER_CHANNELS.findResult, result)
  })

  /** 来源窗口作用域解析（未知来源抛中文错误）；空会话不在此拦——getState/setBounds 对空态合法 */
  function resolveScope(event: IpcMainInvokeEvent): SenderWindowScope {
    return manager.resolveSenderScope(event.sender)
  }

  /** 命令作用域守卫：解析来源 + 主窗口零会话拒绝（「未选择会话」仅对主窗口来源；独立
   * 窗口来源的会话存活性已在解析内校验）。返回类型收窄 sessionId 为非空——函数对
   * null 已抛错，守卫后的调用方（如 dragStart 的会话参数）无需再判空 */
  function requireScope(event: IpcMainInvokeEvent): SenderWindowScope & { sessionId: string } {
    const { windowId, sessionId } = manager.resolveSenderScope(event.sender)
    if (sessionId === null) throw new Error(t('errors.noSessionSelected'))
    return { windowId, sessionId }
  }

  /** id 存在性校验（按来源窗口作用域）：不存在抛错（manager 对不存在 id 是静默 no-op，必须在 handler 层拦截） */
  function requireTabId(windowId: string, id: string): void {
    if (!manager.getSnapshot(windowId).tabs.some((tab) => tab.id === id)) {
      throw new Error(t('errors.tabNotFound'))
    }
  }

  // getState：返回来源窗口作用域的全量快照，只读（主窗口零会话空态合法，返回空态快照）
  ipcMain.handle(BROWSER_CHANNELS.getState, (event): BrowserSnapshot =>
    logFailure(BROWSER_CHANNELS.getState, undefined, () => {
      const scope = resolveScope(event)
      return manager.getSnapshot(scope.windowId)
    })
  )

  // newTab：url 可选——缺省为用户语义新标签页（主页非空加载主页，PRD 3.8.2 修订）
  // 并推送 focus-address（发起窗口聚焦地址栏，Chrome ⌘T 惯例）；携带 url 时先规范化，
  // 失败抛「无效的网址」
  ipcMain.handle(BROWSER_CHANNELS.newTab, (event, payload: unknown): BrowserSnapshot =>
    logFailure(BROWSER_CHANNELS.newTab, payload, () => {
      const scope = requireScope(event)
      const raw = isRecord(payload) ? payload : {}
      const url = optionalString(raw.url)
      if (url === undefined) {
        const snapshot = manager.newUserTab(scope.windowId)
        windowForId(scope.windowId)?.webContents.send(BROWSER_CHANNELS.focusAddress)
        return snapshot
      }
      const normalized = normalizeInput(url)
      if (!normalized) throw new Error(t('errors.invalidUrl'))
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

  // reorderTabs：同窗口 Tab 重排（栏内拖拽排序）。结构守卫（ids 非空数组、每项
  // string、量级按该窗快照防御封顶）后委托 manager 全序整单校验（不匹配抛中文
  // 错误，对齐 sessions reorder 整单拒绝口径），成功返回该窗作用域新快照
  ipcMain.handle(BROWSER_CHANNELS.reorderTabs, (event, payload: unknown): BrowserSnapshot =>
    logFailure(BROWSER_CHANNELS.reorderTabs, payload, () => {
      const scope = requireScope(event)
      if (
        !isRecord(payload) ||
        !Array.isArray(payload.ids) ||
        payload.ids.length === 0 ||
        payload.ids.some((id) => typeof id !== 'string')
      ) {
        throw invalidParams()
      }
      const tabCount = manager.getSnapshot(scope.windowId).tabs.length
      if (payload.ids.length > Math.max(tabCount, 1) * 2) throw invalidParams()
      return manager.reorderTabs(payload.ids, scope.windowId)
    })
  )

  // navigate：作用于来源窗口作用域的激活 Tab；规范化失败抛「无效的网址」；导航失败由
  // Chromium 内建错误页如实呈现，日志由 manager 的 did-fail-load 单点承担（ERR_ABORTED 静默）
  ipcMain.handle(BROWSER_CHANNELS.navigate, (event, payload: unknown): BrowserSnapshot =>
    logFailure(BROWSER_CHANNELS.navigate, payload, () => {
      const scope = requireScope(event)
      if (!isRecord(payload) || typeof payload.url !== 'string') throw invalidParams()
      const normalized = normalizeInput(payload.url)
      if (!normalized) throw new Error(t('errors.invalidUrl'))
      const wc = manager.getActiveWebContents(scope.windowId)
      if (wc) void wc.loadURL(normalized).catch(() => {})
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

  // dragStart：拖拽开始。命令语义守卫（来源作用域 + Tab 存在性 + payload 结构），
  // 通过后交控制器开启拖拽会话与光标轮询；返回 OkResult——裁决结果在 dragEnd 取回
  ipcMain.handle(BROWSER_CHANNELS.dragStart, (event, payload: unknown): OkResult =>
    logFailure(BROWSER_CHANNELS.dragStart, payload, () => {
      const scope = requireScope(event)
      if (!isRecord(payload) || typeof payload.id !== 'string') throw invalidParams()
      requireTabId(scope.windowId, payload.id)
      // 虚影描述可选携带（缺省 = 无虚影拖拽，功能不受影响）
      const preview = payload.preview === undefined ? undefined : parseDragPreview(payload.preview)
      dragController.dragStart({
        sessionId: scope.sessionId,
        tabId: payload.id,
        sourceWindowId: scope.windowId,
        preview
      })
      return { ok: true }
    })
  )

  // dragEnd：拖拽收尾上报落点坐标，取回四态裁决（TabDragOutcome）。与命令通道的关键
  // 差异——收尾语义不是命令语义：陈旧/失效拖拽一律返回 'stayed' 不抛错（dragStart
  // 守卫后的状态漂移在控制器全量重验消化），仅 payload 结构垃圾仍按命令口径拒绝。
  // 异步（空白裁决建窗读盘），失败日志走 logFailureAsync
  ipcMain.handle(BROWSER_CHANNELS.dragEnd, (event, payload: unknown): Promise<TabDragOutcome> =>
    logFailureAsync(BROWSER_CHANNELS.dragEnd, payload, async () => {
      if (!isRecord(payload) || typeof payload.id !== 'string') throw invalidParams()
      const screenX = requiredNumber(payload.screenX)
      const screenY = requiredNumber(payload.screenY)
      // 来源解析失败（拖拽窗口期窗口销毁等极端时序）按 stayed 收场——收尾不抛错
      let scope: SenderWindowScope
      try {
        scope = resolveScope(event)
      } catch {
        return 'stayed'
      }
      return dragController.dragEnd({
        tabId: payload.id,
        sourceWindowId: scope.windowId,
        scopeSessionId: scope.sessionId,
        screenX,
        screenY,
        canceled: payload.canceled === true ? true : undefined
      })
    })
  )

  // dragInsert：目标窗插入位上报（阶段 10）。结构垃圾按命令口径拒绝（tabId string +
  // index 有限非负整数）；通过结构守卫后按「hint 口径」处理——sender 解析出的 windowId
  // 须等于当前活动拖拽会话的悬停窗且 tabId 匹配才存储，不符静默返回 ok（hint 是尽力
  // 而为通道，陈旧属设计内常态：悬停已切走 / 会话已收尾 / 异窗上报都不是错误）
  ipcMain.handle(BROWSER_CHANNELS.dragInsert, (event, payload: unknown): OkResult =>
    logFailure(BROWSER_CHANNELS.dragInsert, payload, () => {
      const scope = resolveScope(event)
      if (
        !isRecord(payload) ||
        typeof payload.tabId !== 'string' ||
        typeof payload.index !== 'number' ||
        !Number.isInteger(payload.index) ||
        payload.index < 0
      ) {
        throw invalidParams()
      }
      const hover = dragController.getDragHoverState()
      if (hover && hover.hoverWindowId === scope.windowId && hover.tabId === payload.tabId) {
        dragController.setInsertHint({ windowId: scope.windowId, index: payload.index })
      }
      return { ok: true }
    })
  )

  // reportTabstripRect：Tab 栏矩形上报（2026-09-25 拖出裁决阈值修订）。尽力而为
  // 布局通道（同 dragInsert 口径）：结构垃圾按命令口径拒绝（四有限 number，零/负尺寸
  // = TabStrip 卸载清条目），通过后按 sender 归属窗口存入控制器缓存——丢失/陈旧
  // 上报的后果是该窗 Tab 栏不被命中（释放走建窗），TabStrip 重挂载/resize 即自愈。
  // 作用域解析用 resolveScope（不要求激活会话）：主窗零会话空态 Tab 栏仍在，矩形
  // 须可上报
  ipcMain.handle(BROWSER_CHANNELS.reportTabstripRect, (event, payload: unknown): OkResult =>
    logFailure(BROWSER_CHANNELS.reportTabstripRect, payload, () => {
      const scope = resolveScope(event)
      if (
        !isRecord(payload) ||
        typeof payload.x !== 'number' ||
        typeof payload.y !== 'number' ||
        typeof payload.width !== 'number' ||
        typeof payload.height !== 'number' ||
        !Number.isFinite(payload.x) ||
        !Number.isFinite(payload.y) ||
        !Number.isFinite(payload.width) ||
        !Number.isFinite(payload.height)
      ) {
        throw invalidParams()
      }
      dragController.setTabstripRect(scope.windowId, {
        x: payload.x,
        y: payload.y,
        width: payload.width,
        height: payload.height
      })
      return { ok: true }
    })
  )

  // findStart：页内查找发起/步进，作用于来源窗口作用域激活 Tab 的 webContents。
  // text 非空且 ≤ FIND_TEXT_MAX（结构守卫，命令口径拒绝）；forward/findNext 布尔归一
  // （初搜 findNext=true 自顶部起新会话，Enter/Shift+Enter 步进 findNext=false 换向）
  ipcMain.handle(BROWSER_CHANNELS.findStart, (event, payload: unknown): OkResult =>
    logFailure(BROWSER_CHANNELS.findStart, payload, () => {
      const scope = requireScope(event)
      if (!isRecord(payload) || typeof payload.text !== 'string') throw invalidParams()
      if (payload.text.length === 0 || payload.text.length > FIND_TEXT_MAX) throw invalidParams()
      const forward = payload.forward === true
      const findNext = payload.findNext === true
      manager.getActiveWebContents(scope.windowId)?.findInPage(payload.text, { forward, findNext })
      return { ok: true }
    })
  )

  // findStop：结束页内查找（action 仅认两枚举值，缺省 clearSelection 清除高亮），
  // 停止后对目标 webContents.focus()——关栏焦点归还页面（Chrome 对齐）
  ipcMain.handle(BROWSER_CHANNELS.findStop, (event, payload: unknown): OkResult =>
    logFailure(BROWSER_CHANNELS.findStop, payload, () => {
      const scope = requireScope(event)
      const action =
        isRecord(payload) && payload.action === 'keepSelection' ? 'keepSelection' : 'clearSelection'
      const wc = manager.getActiveWebContents(scope.windowId)
      if (wc) {
        wc.stopFindInPage(action)
        wc.focus()
      }
      return { ok: true }
    })
  )

  // historyGet：拉取来源窗口作用域会话（主窗→激活会话，独立窗→绑定会话）的全量历史
  // 镜像。无 payload——renderer 不传 sessionId，作用域由 sender 解析（防越权读他窗
  // 会话历史）；主窗口零会话拒绝（「未选择会话」，与命令通道同规）。异步（首触懒
  // 加载读盘），失败日志走 logFailureAsync
  ipcMain.handle(HISTORY_CHANNELS.get, (event): Promise<HistoryEntry[]> =>
    logFailureAsync(HISTORY_CHANNELS.get, undefined, async () => {
      const scope = requireScope(event)
      return manager.history.getEntries(scope.sessionId)
    })
  )

  // —— 建议子窗域（原生子窗口化专项，契约见 shared/omniboxSuggest.ts）——

  /** show/hide 的宿主身份解析：sender 所属窗口须为主窗口或登记独立窗口（建议面板是
   * 窗口级 UI，不做会话守卫——零会话时地址栏禁用，面板开合本就不可达） */
  function requireOwnerWindow(event: IpcMainInvokeEvent): string {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) throw new Error(t('errors.unknownCommandSource'))
    if (win === getMainWindow()) return WINDOW_ID_MAIN
    for (const entry of windows.listAll()) {
      if (entry.win === win) return entry.windowId
    }
    throw new Error(t('errors.unknownCommandSource'))
  }

  /** hover/pick 的子窗身份解析：sender 须属池内子窗，返回宿主 windowId 供定向转发 */
  function requireChildOwner(event: IpcMainInvokeEvent): string {
    const windowId = suggestWindows.resolveOwnerOf(event.sender)
    if (windowId === null) throw new Error(t('errors.unknownCommandSource'))
    return windowId
  }

  // suggest-show：开/更新面板（幂等全量）。宿主解析 → 守卫 → 子窗池承载
  ipcMain.handle(OMNIBOX_SUGGEST_CHANNELS.show, (event, payload: unknown): OkResult =>
    logFailure(OMNIBOX_SUGGEST_CHANNELS.show, payload, () => {
      const windowId = requireOwnerWindow(event)
      suggestWindows.show(windowId, parseSuggestShow(payload))
      return { ok: true }
    })
  )

  // suggest-hide：收起面板（无 payload，隐藏不销毁）
  ipcMain.handle(OMNIBOX_SUGGEST_CHANNELS.hide, (event): OkResult =>
    logFailure(OMNIBOX_SUGGEST_CHANNELS.hide, undefined, () => {
      suggestWindows.hide(requireOwnerWindow(event))
      return { ok: true }
    })
  )

  // suggest-hover：子窗悬停行上报 → 转发宿主 shell（消费回 setSuggestIndex，
  // 越界由 shell 渲染期钳制兜底，此处守卫整数与上限）
  ipcMain.handle(OMNIBOX_SUGGEST_CHANNELS.hover, (event, payload: unknown): OkResult =>
    logFailure(OMNIBOX_SUGGEST_CHANNELS.hover, payload, () => {
      const windowId = requireChildOwner(event)
      if (
        !isRecord(payload) ||
        typeof payload.index !== 'number' ||
        !Number.isInteger(payload.index) ||
        payload.index < -1 ||
        payload.index >= SUGGEST_MAX_RESULTS
      ) {
        throw invalidParams()
      }
      windowForId(windowId)?.webContents.send(OMNIBOX_SUGGEST_CHANNELS.hovered, {
        index: payload.index
      })
      return { ok: true }
    })
  )

  // suggest-pick：子窗点选行上报 → 转发宿主 shell（导航与失败提示走 shell 既有链）
  ipcMain.handle(OMNIBOX_SUGGEST_CHANNELS.pick, (event, payload: unknown): OkResult =>
    logFailure(OMNIBOX_SUGGEST_CHANNELS.pick, payload, () => {
      const windowId = requireChildOwner(event)
      if (!isRecord(payload) || typeof payload.url !== 'string' || payload.url.length === 0) {
        throw invalidParams()
      }
      windowForId(windowId)?.webContents.send(OMNIBOX_SUGGEST_CHANNELS.picked, {
        url: payload.url
      })
      return { ok: true }
    })
  )

  console.log(
    '[browser] IPC handlers 已注册（33 条通道：浏览器域 26 + 建议子窗域 7，含历史补全与页内查找各 2 条）'
  )
}
