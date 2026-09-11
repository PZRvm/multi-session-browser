// 会话浏览器注册表：每会话一个独立分区的 TabManager（分区字符串 persist:sess-<id>
// 只在此处拼装，manager 只接收现成值），对外暴露 TabManager 兼容命令面（命令一律
// 路由到当前激活会话的 manager）+ 会话级生命周期（switchSession / destroySession / init）。
// 本模块不含任何 IPC（命令通道与状态推送由 ipc.ts / index.ts 装配，分层同 manager.ts）；
// 落盘读写一律经 store.ts 的 loadSnapshot / mutateSnapshot，不自行组合读写。

import { app, session, webContents, WebContentsView } from 'electron'
import type { BrowserWindow, WebContents } from 'electron'
import { rm } from 'fs/promises'
import { join } from 'path'
import type { BrowserSnapshot, SetBoundsPayload } from '../../shared/browser'
import type { SessionStatus, SessionStatusesPayload } from '../../shared/sessions'
import { loadSnapshot, mutateSnapshot } from '../store'
import {
  createTabManager,
  type FocusAddressListener,
  type SnapshotListener,
  type TabManager
} from './manager'
import { isOpenableUrl } from './url'

/** 会话分区名（AGENTS.md 领域规则：persist:sess-<id>，一会话一分区禁止共享） */
function partitionFor(sessionId: string): string {
  return `persist:sess-${sessionId}`
}

/** 分区落盘目录：userData/Partitions/<去掉 persist: 前缀>（阶段4步骤1 冒烟定案路径） */
function partitionDir(partition: string): string {
  return join(app.getPath('userData'), 'Partitions', partition.replace(/^persist:/, ''))
}

/** pageTitle/lastUrl 上报去抖（trailing）：导航与标题事件密集，写盘前先静默一段时间 */
const REPORT_DEBOUNCE_MS = 500
/** pageTitle 落盘截断上限，与会话侧 clampString / manager 的 TITLE_MAX 一致 */
const PAGE_TITLE_MAX = 200
/** wc.close() 后等待自然销毁的宽限；超时（unload 卡住等极端场景）跳过 beforeunload 强制销毁 */
const DESTROY_GRACE_MS = 3000
/** 销毁重扫轮数上限：unload 期间页面仍可能经 window.open 在同分区补生 webContents */
const DESTROY_RESCAN_ROUNDS = 3

export interface SessionBrowserRegistry extends TabManager {
  /** 切换激活会话：旧 manager 激活 view 摘除但 webContents 全部保活，新 manager 即时挂入；null = 摘除全部 */
  switchSession(id: string | null): void
  /** 销毁该会话全部 webContents 并彻底清分区数据（销毁 → clearStorageData → 删分区目录，顺序不可颠倒） */
  destroySession(id: string): Promise<void>
  /** 启动恢复：读盘缓存各会话 lastUrl，恢复上次激活会话并重载其上次打开页 */
  init(activeId: string | null): void
  /** 订阅会话运行状态（idle/loading）全量 map；状态 map 有变化时回调，返回退订函数 */
  onSessionStatus(cb: (payload: SessionStatusesPayload) => void): () => void
}

export function createSessionBrowserRegistry(deps: {
  getWindow: () => BrowserWindow | null
}): SessionBrowserRegistry {
  const { getWindow } = deps

  const managers = new Map<string, TabManager>()
  let activeSessionId: string | null = null
  /** 最近一次非零内容区矩形：新建 manager 的 initialBounds（无窗口先建 manager 时的挂入兜底） */
  let globalBounds: SetBoundsPayload | null = null
  /** 各会话 lastUrl 缓存（init 读盘填充 + 上报写盘时同步），懒创建初始 Tab 的取用源 */
  const lastUrls = new Map<string, string>()
  /** init 已被显式切换（switchSession/destroySession）打断即不再补做启动恢复 */
  let initHandled = false

  const snapshotListeners = new Set<SnapshotListener>()
  const focusListeners = new Set<FocusAddressListener>()
  const statusListeners = new Set<(payload: SessionStatusesPayload) => void>()
  /** 会话 → 运行状态；只有建过 manager 的会话有条目，其余隐含 idle */
  const statuses = new Map<string, SessionStatus>()
  /** 状态 map 序列化指纹：仅在内容变化时回调监听者（全量 map，整体替换不合并） */
  let statusesKey = '{}'
  /** 会话 → 最近一次写盘的 {url,title}，上报去抖的变化判据 */
  const reported = new Map<string, { url: string; title: string }>()
  const reportTimers = new Map<string, ReturnType<typeof setTimeout>>()

  function activeManager(): TabManager | null {
    return activeSessionId !== null ? (managers.get(activeSessionId) ?? null) : null
  }

  function emptySnapshot(): BrowserSnapshot {
    return { sessionId: null, tabs: [], activeTabId: null, devtoolsOpen: false }
  }

  function notifySnapshot(): void {
    const snapshot = getSnapshot()
    for (const cb of snapshotListeners) cb(snapshot)
  }

  /**
   * 摘除某 manager 激活 Tab 的页面 view：脱离 contentView 但 webContents 保活
   * （挂摘保活，阶段4步骤1 冒烟已证），重挂由 manager.attachToWindow 按其缓存矩形完成。
   * view 未挂入（后台 manager）时自然 no-op。manager 未暴露 view 引用，经窗口子视图
   * 按 webContents 身份反查（同一时刻每个 manager 至多一个激活 view 挂在窗口上）。
   */
  function detachActiveView(manager: TabManager): void {
    const win = getWindow()
    const wc = manager.getActiveWebContents()
    if (!win || !wc) return
    const view = win.contentView.children.find(
      (child): child is WebContentsView =>
        child instanceof WebContentsView && child.webContents === wc
    )
    if (view) win.contentView.removeChildView(view)
  }

  function statusesPayload(): SessionStatusesPayload {
    const sorted = [...statuses.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return { statuses: Object.fromEntries(sorted) }
  }

  function notifyStatuses(): void {
    const payload = statusesPayload()
    const key = JSON.stringify(payload.statuses)
    if (key === statusesKey) return
    statusesKey = key
    for (const cb of statusListeners) cb(payload)
  }

  function setStatus(id: string, status: SessionStatus): void {
    if (statuses.get(id) === status) return
    statuses.set(id, status)
    notifyStatuses()
  }

  function deleteStatus(id: string): void {
    if (!statuses.delete(id)) return
    notifyStatuses()
  }

  /**
   * 优雅销毁单个 webContents：先 close()（走页面 unload），等 destroyed 事件确认死透；
   * 宽限内未销毁（beforeunload 卡住等极端场景）再以 waitForBeforeUnload: false 强制销毁，
   * 不让删除流程无限等待
   */
  function closeGracefully(wc: WebContents): Promise<void> {
    return new Promise((resolve) => {
      if (wc.isDestroyed()) {
        resolve()
        return
      }
      let settled = false
      const done = (): void => {
        if (settled) return
        settled = true
        resolve()
      }
      wc.once('destroyed', done)
      wc.close()
      setTimeout(() => {
        if (settled) return
        if (!wc.isDestroyed()) wc.close({ waitForBeforeUnload: false })
        done()
      }, DESTROY_GRACE_MS)
    })
  }

  /** 取 fire 时刻的最新值写盘（去抖期内后续变化不必再各写一次） */
  function flushReport(id: string): void {
    const manager = managers.get(id)
    if (!manager) return // 会话已销毁，静默跳过
    const snapshot = manager.getSnapshot()
    const tab = snapshot.tabs.find((item) => item.id === snapshot.activeTabId) ?? null
    const url = tab?.url ?? ''
    const title = tab ? tab.title : ''
    reported.set(id, { url, title })
    void mutateSnapshot((data) => {
      const target = data.sessions.find((item) => item.id === id)
      if (!target) return // 会话已从落盘数据移除（删除竞态），静默跳过
      target.pageTitle = title.length > PAGE_TITLE_MAX ? title.slice(0, PAGE_TITLE_MAX) : title
      target.lastUrl = url
      // 同步本地缓存：会话若被销毁重建（实践不会发生，id 含时间戳），懒创建也能读到最新值
      lastUrls.set(id, url)
    }).catch((error: unknown) => {
      console.warn(`[registry] 写会话 ${id} 的 pageTitle/lastUrl 失败:`, error)
    })
  }

  function scheduleReport(id: string): void {
    const pending = reportTimers.get(id)
    if (pending) clearTimeout(pending)
    reportTimers.set(
      id,
      setTimeout(() => {
        reportTimers.delete(id)
        flushReport(id)
      }, REPORT_DEBOUNCE_MS)
    )
  }

  /** 懒创建该会话的 manager（persist:sess-<id>）并接线：快照驱动转发/状态聚合/上报去抖 */
  function ensureManager(id: string): TabManager {
    const existing = managers.get(id)
    if (existing) return existing
    const manager = createTabManager(getWindow, {
      sessionId: id,
      partition: partitionFor(id),
      initialBounds: globalBounds ?? undefined
    })
    managers.set(id, manager)

    // 每 manager 创建时接线一次（存活期内常驻，销毁即随 webContents 一同失效）：
    // ① 快照仅当该会话处于激活态才转发外部监听者（后台会话的过期快照在此被丢弃，防串台）；
    // ② 状态聚合与 ③ 上报去抖对全部 manager 生效（后台会话的真实加载态如实驱动，不造假）
    manager.onSnapshotChanged((snapshot) => {
      if (snapshot.sessionId === activeSessionId) {
        for (const cb of snapshotListeners) cb(snapshot)
      }
      setStatus(id, snapshot.tabs.some((tab) => tab.loading) ? 'loading' : 'idle')
      const tab = snapshot.tabs.find((item) => item.id === snapshot.activeTabId) ?? null
      const url = tab?.url ?? ''
      const title = tab ? tab.title : ''
      const prev = reported.get(id)
      if (!prev || prev.url !== url || prev.title !== title) scheduleReport(id)
    })
    manager.onFocusAddressRequest(() => {
      // focus-address 只可能来自挂入中的页面（后台 view 收不到键盘输入），过滤保语义正确
      if (id !== activeSessionId) return
      for (const cb of focusListeners) cb()
    })

    // 懒创建即建初始 Tab：有可打开的上次打开页则加载之，无则 about:blank（newTab 缺省）。
    // lastUrl 来自落盘文件（跨信任边界），按 window.open 同一白名单校验，坏值回退空白页
    const lastUrl = lastUrls.get(id)
    manager.newTab(lastUrl && isOpenableUrl(lastUrl) ? lastUrl : undefined)
    return manager
  }

  function switchSession(id: string | null): void {
    initHandled = true
    if (id === activeSessionId) return // 同 id no-op
    // ① 摘除旧激活 manager 的激活 view：webContents 全部保活（Tab、滚动、登录态原样保留），
    //    切回时由 attachToWindow 按其缓存矩形重挂
    const prev = activeManager()
    if (prev) detachActiveView(prev)
    activeSessionId = id
    // ② null = 摘除全部（零会话空态），快照同步广播空态
    if (id === null) {
      notifySnapshot()
      return
    }
    // ③ 懒创建（新建的 manager 在 newTab 内已按 initialBounds/缓存矩形即时挂入）并重挂；
    //    懒创建路径 newTab 已自行 emitChange，此处再广播一次同值快照（幂等，覆盖切回既有会话路径）
    const manager = ensureManager(id)
    manager.attachToWindow()
    notifySnapshot()
  }

  async function destroySession(id: string): Promise<void> {
    const manager = managers.get(id)
    // 先摘注册表引用再清除：清除后不得再实例化该分区（fromPartition 会惰性重建空目录，
    // 阶段4步骤1 冒烟定案），从 Map 移除 manager 即天然保证——本函数此后也不再触碰该分区 session
    managers.delete(id)
    lastUrls.delete(id)
    reported.delete(id)
    deleteStatus(id)
    const pending = reportTimers.get(id)
    if (pending) {
      clearTimeout(pending)
      reportTimers.delete(id)
    }
    // 正常编排里被删激活会话时 index.ts 已先切换走（onDeleted 级联）；此处兜底摘 view 与空态
    const wasActive = activeSessionId === id
    if (wasActive) activeSessionId = null

    const partition = partitionFor(id)
    const target = session.fromPartition(partition)
    if (manager) {
      detachActiveView(manager)
      // ① 先销毁该分区全部页面 webContents（原生受管 DevTools 随宿主 wc.close() 自然带走）；
      //    webContents 存活时清存储会被内存态覆写回盘（冒烟定案时序，顺序不可颠倒）。
      //    有界重扫：unload 期间页面仍可能经 window.open（manager 的 deny+newTab 转换）
      //    在同分区补生 webContents，扫到即补杀，超轮按现状继续并靠后续如实告警兜底
      for (let round = 0; round < DESTROY_RESCAN_ROUNDS; round += 1) {
        const dying = webContents
          .getAllWebContents()
          .filter((wc) => !wc.isDestroyed() && wc.session === target)
        if (dying.length === 0) break
        await Promise.all(dying.map(closeGracefully))
      }
    }
    // ② 清分区存储（cookies / localStorage / 缓存索引等）；失败如实告警不静默
    try {
      await target.clearStorageData()
    } catch (error) {
      console.warn(`[registry] 清除会话 ${id} 分区存储失败:`, error)
    }
    // ③ 删分区落盘目录（force 容忍目录本就不存在——从未激活过的会话）
    try {
      await rm(partitionDir(partition), { recursive: true, force: true })
    } catch (error) {
      console.warn(`[registry] 删除会话 ${id} 分区目录失败:`, error)
    }
    if (wasActive) notifySnapshot()
  }

  function init(activeId: string | null): void {
    // 读盘一次，缓存各会话 lastUrl：switchSession 是同步签名，取值只能前置到缓存里
    const storeReady = loadSnapshot()
      .then((snapshot) => {
        for (const item of snapshot.sessions) lastUrls.set(item.id, item.lastUrl)
      })
      .catch(() => undefined) // loadSnapshot 自带回退空快照不 reject，此处仅兜底防未处理拒绝
    if (activeId === null) return
    // 启动恢复（PRD 3.1.4）：读盘完成后恢复上次激活会话，懒创建经 lastUrls 缓存重载上次打开页；
    // 读盘期间已有显式切换/销毁（极端竞态）则跳过，以显式操作为准
    void storeReady.then(() => {
      if (initHandled) return
      initHandled = true
      if (!lastUrls.has(activeId)) return // 悬空 activeId（loadSnapshot 已会重置，双保险）
      switchSession(activeId)
    })
  }

  // —— TabManager 兼容命令面：全部委托激活 manager ——
  // 无激活会话时命令类 no-op 返回空态快照（getActiveWebContents 返回 null）；
  // 真正的拒绝语义（「未选择会话」）由 ipc 层在通道入口守卫承担（阶段4 步骤 6）。

  function newTab(url?: string): BrowserSnapshot {
    const manager = activeManager()
    return manager ? manager.newTab(url) : emptySnapshot()
  }

  function closeTab(id: string): BrowserSnapshot {
    const manager = activeManager()
    return manager ? manager.closeTab(id) : emptySnapshot()
  }

  function switchTab(id: string): BrowserSnapshot {
    const manager = activeManager()
    return manager ? manager.switchTab(id) : emptySnapshot()
  }

  function toggleDevTools(): BrowserSnapshot {
    const manager = activeManager()
    return manager ? manager.toggleDevTools() : emptySnapshot()
  }

  function closeDevTools(): BrowserSnapshot {
    const manager = activeManager()
    return manager ? manager.closeDevTools() : emptySnapshot()
  }

  function getActiveWebContents(): WebContents | null {
    return activeManager()?.getActiveWebContents() ?? null
  }

  function setBounds(rect: SetBoundsPayload): void {
    // 全局缓存最近一次非零矩形：新建 manager 以其为 initialBounds（切换瞬间新 manager
    // 无自身缓存时的挂入矩形兜底）；零矩形是收起信号（弹层悬挂），不进缓存
    if (rect.width > 0 && rect.height > 0) globalBounds = rect
    // 广播全部现存 manager：各自缓存布局、各自仅对激活 view 生效，悬挂态语义随 manager 既有实现
    for (const manager of managers.values()) manager.setBounds(rect)
  }

  function attachToWindow(): void {
    // 路由到激活 manager（macOS 关窗重开由 index.ts 调用）；无激活会话时无 view 需要重挂
    activeManager()?.attachToWindow()
  }

  function getSnapshot(): BrowserSnapshot {
    return activeManager()?.getSnapshot() ?? emptySnapshot()
  }

  function onSnapshotChanged(cb: SnapshotListener): () => void {
    snapshotListeners.add(cb)
    return () => snapshotListeners.delete(cb)
  }

  function onFocusAddressRequest(cb: FocusAddressListener): () => void {
    focusListeners.add(cb)
    return () => focusListeners.delete(cb)
  }

  function onSessionStatus(cb: (payload: SessionStatusesPayload) => void): () => void {
    statusListeners.add(cb)
    return () => statusListeners.delete(cb)
  }

  return {
    newTab,
    closeTab,
    switchTab,
    setBounds,
    toggleDevTools,
    closeDevTools,
    getActiveWebContents,
    attachToWindow,
    getSnapshot,
    onSnapshotChanged,
    onFocusAddressRequest,
    switchSession,
    destroySession,
    init,
    onSessionStatus
  }
}
