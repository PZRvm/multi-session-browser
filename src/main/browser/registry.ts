// 会话浏览器注册表：每会话一个独立分区的 TabManager（分区字符串 persist:sess-<id>
// 只在此处拼装，manager 只接收现成值），对外暴露 TabManager 兼容命令面（命令按来源
// 窗口作用域路由：主窗口 → 激活会话的 'main' 作用域，独立窗口 → 其绑定会话的该窗口
// 作用域，见 resolveSenderScope）+ tear-off 建窗编排 + 会话级生命周期（switchSession /
// destroySession / init）。本模块不含任何 IPC（命令通道与状态推送由 ipc.ts / index.ts
// 装配，分层同 manager.ts）；持久化上报与恢复集由 browser/persistence.ts 承担（L7
// 定案），落盘读写经 store.ts；独立窗口登记表经 deps 注入（windows.ts 的回调反向触达
// 也经 index.ts 晚绑定注入，模块间无 import 环）。

import { app, BrowserWindow, session, webContents, WebContentsView } from 'electron'
import type { Session, WebContents } from 'electron'
import { cp, rm, stat } from 'fs/promises'
import { basename, join } from 'path'
import { WINDOW_ID_MAIN, type BrowserSnapshot, type SetBoundsPayload } from '../../shared/browser'
import {
  SESSION_ID_RE,
  type SessionStatus,
  type SessionStatusesPayload
} from '../../shared/sessions'
import { loadSnapshot } from '../store'
import {
  BLANK_URL,
  createTabManager,
  type FindRequestListener,
  type FindResultListener,
  type FocusAddressListener,
  type SnapshotListener,
  type TabManager,
  type TearOffTabManager
} from './manager'
import { createCameraPermissionBroker } from './permissions'
import { createSessionPersistence, type RestoreSet } from './persistence'
import { createBrowserHistory, type BrowserHistory } from './history'
import { logLoadFailure } from './url'
import type { IndependentWindows } from './windows'

/**
 * 会话分区名（AGENTS.md 领域规则：persist:sess-<id>，一会话一分区禁止共享）。
 * 读入口拦截（F5 定案）：id 先过 SESSION_ID_RE 单源校验——被篡改的落盘 id 在拼分区串
 * 之前拒绝，否则非法分区串会被用于 WebContentsView/fromPartition 创建 session
 */
function partitionFor(sessionId: string): string {
  if (!SESSION_ID_RE.test(sessionId)) {
    throw new Error(`非法会话 id "${sessionId}"（疑似落盘数据被篡改），拒绝拼装分区`)
  }
  return `persist:sess-${sessionId}`
}

/** 分区落盘目录：userData/Partitions/<去掉 persist: 前缀>（阶段4步骤1 冒烟定案路径）。
 *  目录名 = sess-<id>，与 SESSION_ID_RE 同构（partitionFor 已在入口拦截，此处为
 *  删除路径的第二道防线——rm 的边界校验不依赖上游调用序） */
function partitionDir(partition: string): string {
  const name = partition.replace(/^persist:/, '')
  if (!SESSION_ID_RE.test(name)) {
    throw new Error(`非法分区名 "${name}"（疑似落盘数据被篡改），拒绝解析目录路径`)
  }
  return join(app.getPath('userData'), 'Partitions', name)
}

/** wc.close() 后等待自然销毁的宽限；超时（unload 卡住等极端场景）跳过 beforeunload 强制销毁 */
const DESTROY_GRACE_MS = 3000
/** 销毁重扫轮数上限：unload 期间页面仍可能经 window.open 在同分区补生 webContents */
const DESTROY_RESCAN_ROUNDS = 3
/**
 * 克隆复制时排除的缓存类目录（按 basename 匹配，任意层级）：Chromium 分区内可再生的
 * 纯缓存目录全集（Cache / GPUCache / Code Cache / DawnGraphiteCache / DawnWebGPUCache）；
 * 登录态与站点数据（Cookies / Local Storage / IndexedDB 等）不在此列，全量保真复制
 */
const CLONE_EXCLUDED_DIR_BASENAMES = new Set([
  'Cache',
  'GPUCache',
  'Code Cache',
  'DawnGraphiteCache',
  'DawnWebGPUCache'
])

/** fs 错误是否为 ENOENT（路径不存在）：clonePartition 判断源分区目录是否存在的唯一依据 */
function isENOENT(error: unknown): boolean {
  return error instanceof Error && (error as { code?: string }).code === 'ENOENT'
}

/** sender 作用域（ipc 装配的命令入口守卫用）：windowId + 该作用域当前会话 */
export interface SenderWindowScope {
  windowId: string
  /** 主窗口来源无激活会话时为 null（由 ipc 层按「未选择会话」拒绝命令） */
  sessionId: string | null
}

export interface SessionBrowserRegistry extends TabManager {
  /**
   * tear-off：把 windowId 作用域的 Tab 移出为新建独立窗口（读会话名 → windows.ts 建窗
   * → manager 迁移 + 双侧快照），返回发起窗口作用域快照。异步（读盘取会话名）——
   * browser 域唯一异步编排。at 为可选建窗落点（拖出释放位置，屏幕坐标 DIP），透传
   * windows.createWindow 定位（工作区 clamp，失败回退默认位置）。阶段 9 起为主进程
   * 内部接口（拖拽控制器空白裁决复用），IPC 面已随临时右键菜单退役
   */
  tearOffTab(
    id: string,
    windowId?: string,
    at?: { x?: number; y?: number }
  ): Promise<BrowserSnapshot>
  /**
   * 并入既有窗口（阶段 9 拖拽 'moved-window' 裁决的迁移编排）：Tab 从 source 作用域
   * 移入 target 窗口（activate 收尾防双 view 叠加，见 manager.moveTabToWindow）。
   * 强校验不留宽容路径：Tab 须属 source 作用域、target 须与 source 同会话——
   * target 为 'main' 时要求当前激活会话相符，独立窗口要求其绑定会话相符，异会话抛
   * 中文错误（拒绝判定在拖拽控制器按命中集预判，本接口兜底防竞态）。insertIndex 按
   * 目标窗作用域 Tab 序列计（阶段 10 按位插入），透传 manager（缺省 = 末位）。
   * 双侧作用域快照经 emitChange 自动分发，无返回值
   */
  moveTabToWindow(
    id: string,
    sourceWindowId: string,
    targetWindowId: string,
    insertIndex?: number
  ): void
  /** 当前激活会话 id（拖拽命中主窗口的判据：主窗激活会话 = 拖拽会话，PRD 3.6.2） */
  getActiveSessionId(): string | null
  /**
   * 该会话恢复集缓存（persistence 直通只读，阶段 10 克隆接线）：closeSession 冲刷前置
   * 后该缓存即「关闭发起时刻的完整归并集」，克隆元数据复制取此值不重读盘
   */
  getRestoreSet(id: string): RestoreSet | undefined
  /**
   * sender 作用域解析（15 条命令通道的统一入口守卫，ipc 装配用）：主窗口来源 →
   * 激活会话的 'main' 作用域；独立窗口来源 → windows.ts 登记的绑定会话的该窗口作用域；
   * 未知窗口/已销毁/绑定会话已不在注册表一律抛中文错误（契约点 3）
   */
  resolveSenderScope(sender: WebContents): SenderWindowScope
  /** 独立窗口就绪（ready-to-show 防白屏时点）：挂入该窗口作用域激活 Tab 的 view */
  onIndependentWindowReady(sessionId: string, windowId: string): void
  /** 独立窗口已销毁：销毁该窗口作用域全部 Tab（含 webContents）并清槽位 */
  onIndependentWindowClosed(sessionId: string, windowId: string): void
  /** 切换激活会话：旧 manager 激活 view 摘除但 webContents 全部保活，新 manager 即时挂入；null = 摘除全部 */
  switchSession(id: string | null): void
  /** 销毁该会话全部 webContents 并彻底清分区数据（销毁 → clearStorageData → 删分区目录，顺序不可颠倒） */
  destroySession(id: string): Promise<void>
  /**
   * 关闭该会话：销毁全部 webContents 但保留分区数据与元数据（与 destroySession 的语义分叉，
   * 克隆前收尾活库用）；关后 manager 从注册表摘除，下次激活懒创建按 lastUrl 重载
   */
  closeSession(id: string): Promise<void>
  /** 克隆分区目录（先 closeSession 源，再排除缓存目录递归复制）；源目录不存在时跳过复制（空白环境） */
  clonePartition(srcId: string, dstId: string): Promise<void>
  /** 批量打开测试地址：逐会话懒创建 manager 并新建 Tab 加载；后台会话摘 view 保活后台加载 */
  openUrlInSessions(ids: string[], url: string): void
  /** 启动恢复：读盘缓存各会话 lastUrl，恢复上次激活会话并重载其上次打开页 */
  init(activeId: string | null): void
  /** 订阅会话运行状态（idle/loading）全量 map；状态 map 有变化时回调，返回退订函数 */
  onSessionStatus(cb: (payload: SessionStatusesPayload) => void): () => void
  /** 当前全量状态 map 的同步快照（sessions:get-statuses 拉取通道的数据源，兜底启动期推送竞态） */
  getStatuses(): SessionStatusesPayload
  /** 退出前冲刷全部待写的上报去抖并封笔（此后 recordSnapshot/recordVisit no-op；index.ts 的 before-quit 钩子调用）；返回在途写盘的汇合 promise——before-quit 等它落定再放行（阶段 10 修复：异步写未落定即退进程会丢去抖窗口内的最后改动） */
  flushPendingReports(): Promise<void>
  /**
   * 会话浏览历史模块（地址栏补全的数据层）：ipc 装配层经此取 getEntries 与
   * onEntryChanged（推送桥接）；recordVisit/dropHistory/cloneHistory 的编排接线
   * 在本注册表内完成（ensureManager 采集、destroySession 清史、clonePartition 携带）
   */
  readonly history: BrowserHistory
}

export function createSessionBrowserRegistry(deps: {
  /**
   * 按宿主窗口 id 解析 BrowserWindow：'main' → 主窗口显式引用（index.ts 模块级引用，
   * macOS 关窗期间为 null），独立窗口 id → windows.ts 登记表现取。窗口引用一律现取
   * 不缓存（macOS 关窗重建场景）
   */
  getWindow: (windowId: string) => BrowserWindow | null
  /** 独立窗口登记表（index.ts 注入）：tear-off 建窗、空窗收口与作用域解析经此触达 */
  windows: IndependentWindows
}): SessionBrowserRegistry {
  const { getWindow, windows } = deps

  const managers = new Map<string, TearOffTabManager>()
  let activeSessionId: string | null = null

  /**
   * 摄像头站点授权随 Electron Session（即会话分区）安装，运行期决定仍由 broker 按
   * sessionId + origin 隔离。WebContentsView 不是 BrowserWindow.webContents，故原生
   * 对话框宿主需在窗口 contentView 子视图中反查；后台已摘 view 时返回 null 走应用级弹窗。
   */
  const cameraPermissions = createCameraPermissionBroker({
    resolveSessionName: async (id) =>
      (await loadSnapshot()).sessions.find((item) => item.id === id)?.name ?? null,
    resolveHostWindow: (requester) => {
      const candidates = [getWindow(WINDOW_ID_MAIN), ...windows.listAll().map((entry) => entry.win)]
      for (const win of candidates) {
        if (!win || win.isDestroyed()) continue
        const ownsView = win.contentView.children.some(
          (child) => child instanceof WebContentsView && child.webContents === requester
        )
        if (ownsView) return win
      }
      return null
    }
  })
  /** 最近一次非零内容区矩形：新建 manager 的 initialBounds（无窗口先建 manager 时的挂入兜底） */
  let globalBounds: SetBoundsPayload | null = null
  /**
   * 会话浏览历史（地址栏补全数据层）：每会话独立文件 userData/history/<id>.json，
   * 模块内自持懒加载/去抖落盘/封笔（对称 cameraPermissions 的注册表内自持先例，
   * index.ts 无需注入）；退出冲刷经 flushPendingReports 聚合
   */
  const history = createBrowserHistory({
    historyDir: () => join(app.getPath('userData'), 'history')
  })
  /**
   * 持久化上报与恢复集（阶段 6 自本文件抽出为 browser/persistence.ts，复审 L7 定案）：
   * 写侧去抖落盘与读侧恢复集缓存的唯一事实源，本文件只做生命周期编排。阶段 10 起落盘
   * 为归并口径，经 listSessionSnapshots 枚举该会话全部作用域快照（主窗在先 + 独立窗
   * 创建序）交 persistence 组合
   */
  const persistence = createSessionPersistence({
    hasManager: (id) => managers.has(id),
    listSessionSnapshots: (id): BrowserSnapshot[] | null => {
      const manager = managers.get(id)
      if (!manager) return null
      return [
        manager.getSnapshot(WINDOW_ID_MAIN),
        ...windows.listForSession(id).map((entry) => manager.getSnapshot(entry.windowId))
      ]
    }
  })

  /** init 已被显式切换（switchSession/destroySession）打断即不再补做启动恢复 */
  let initHandled = false

  const snapshotListeners = new Set<SnapshotListener>()
  const focusListeners = new Set<FocusAddressListener>()
  const findRequestListeners = new Set<FindRequestListener>()
  const findResultListeners = new Set<FindResultListener>()
  const statusListeners = new Set<(payload: SessionStatusesPayload) => void>()
  /** 会话 → 运行状态；只有建过 manager 的会话有条目，其余隐含 idle */
  const statuses = new Map<string, SessionStatus>()
  /** 状态 map 序列化指纹：仅在内容变化时回调监听者（全量 map，整体替换不合并） */
  let statusesKey = '{}'
  /**
   * 克隆进行中的会话 id（closeSession 源 → cp 完成 的窗口期，秒级）：期间禁止对其
   * 切换激活/批量打开/销毁——源分区正处于"已收尾待复制/复制中"状态，任何中途重建
   * manager 的路径都会让活库并发写入污染克隆副本（且无告警）。目标 id 一并占用，
   * 防复制落盘期间被提前懒创建
   */
  const cloningIds = new Set<string>()
  /**
   * 待补载集合（R1 定案）：ensureManager 安排了"缓存未命中现读补载"的会话 id。
   * 补载 .then 的守卫语义见 ensureManager 内注释（L4 修订后含批量打开叠加径）
   */
  const pendingBackfill = new Set<string>()

  function activeManager(): TearOffTabManager | null {
    return activeSessionId !== null ? (managers.get(activeSessionId) ?? null) : null
  }

  /**
   * 作用域 → manager：主窗口作用域路由激活 manager（现行为）；独立窗口作用域经登记表
   * 路由其绑定会话的 manager（ipc 命令面的统一出口；未登记/会话无 manager 返回 null，
   * 后者已在 resolveSenderScope 拒绝，此处兜底）
   */
  function scopedManager(windowId: string): TearOffTabManager | null {
    if (windowId === WINDOW_ID_MAIN) return activeManager()
    const sessionId = windows.getSessionId(windowId)
    return sessionId !== null ? (managers.get(sessionId) ?? null) : null
  }

  function emptySnapshot(): BrowserSnapshot {
    // 零会话空态恒属主窗口：无激活会话时不存在任何窗口托管该会话的 Tab（步骤 3 定向
    // 推送同此口径——空态快照只发主窗口）
    return {
      windowId: WINDOW_ID_MAIN,
      sessionId: null,
      tabs: [],
      activeTabId: null,
      devtoolsOpen: false
    }
  }

  function notifySnapshot(): void {
    const snapshot = getSnapshot()
    for (const cb of snapshotListeners) cb(snapshot)
  }

  /**
   * 摘除某 manager 指定窗口作用域激活 Tab 的页面 view：脱离 contentView 但 webContents
   * 保活（挂摘保活，阶段4步骤1 冒烟已证），重挂由 manager.attachToWindow 按其缓存矩形
   * 完成。view 未挂入（后台 manager）时自然 no-op。manager 未暴露 view 引用，经窗口
   * 子视图按 webContents 身份反查（同一时刻每个窗口每个 manager 至多一个激活 view 挂着）。
   * 现调用方均为主窗口作用域——会话切换/销毁收尾只发生在主窗口（独立窗口的摘挂由
   * manager 挂归窗口自决 + windows.ts closed 级联，不经此函数）
   */
  function detachActiveView(manager: TabManager, windowId: string = WINDOW_ID_MAIN): void {
    const win = getWindow(windowId)
    const wc = manager.getActiveWebContents(windowId)
    if (!win || !wc) return
    // 摘除前停止页内查找并清高亮（切会话/销毁/批量打开后台化路径的源头清理，与
    // manager.activate 的切 Tab 清理同规——陈旧高亮不得跨激活位留存）
    if (!wc.isDestroyed()) wc.stopFindInPage('clearSelection')
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
    // 已注销会话（destroySession 摘除后垂死 manager 的残余快照事件）不再回填，
    // 防幽灵状态条目常驻 map（id 含时间戳不复用，一旦回填无法自然清除）
    if (!managers.has(id)) return
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

  /**
   * 销毁某分区现存全部 webContents 的共享机制（destroySession 与 closeSession 复用，
   * 抽此防两份拷贝漂移）：有界重扫逐轮优雅 close（走页面 unload）+ 宽限内未死透强制销毁；
   * unload 期间页面仍可能经 window.open 在同分区补生 webContents（manager 已 dispose，
   * newTab 不再复生；扫描兜底历史在途者），扫到即补杀，超轮如实告警不静默。
   * 本函数只杀 webContents；清存储与删目录是 destroySession 独有步骤，closeSession 保留数据
   */
  async function killPartitionWebContents(
    target: Session,
    id: string,
    nextLabel: string
  ): Promise<void> {
    for (let round = 0; round < DESTROY_RESCAN_ROUNDS; round += 1) {
      const dying = webContents
        .getAllWebContents()
        .filter((wc) => !wc.isDestroyed() && wc.session === target)
      if (dying.length === 0) break
      await Promise.all(dying.map(closeGracefully))
    }
    // 重扫超轮仍有存活（unload 卡死等极端场景）：如实告警，不静默
    const survivors = webContents
      .getAllWebContents()
      .filter((wc) => !wc.isDestroyed() && wc.session === target)
    if (survivors.length > 0) {
      console.warn(
        `[registry] 会话 ${id} 销毁重扫 ${DESTROY_RESCAN_ROUNDS} 轮后仍有 ${survivors.length} 个 webContents 未死透（unload 卡死等极端场景），继续执行${nextLabel}；残留进程随应用退出回收`
      )
    }
  }

  /** 懒创建该会话的 manager（persist:sess-<id>）并接线：快照驱动转发/状态聚合/上报去抖 */
  function ensureManager(id: string): TabManager {
    const existing = managers.get(id)
    if (existing) return existing
    const partition = partitionFor(id)
    // handler 必须先于首个 WebContentsView 创建安装，避免页面首个 media 请求落入 Electron
    // 默认自动批准；同一分区重建 manager 时 install 幂等且保留本次运行内的站点决定。
    cameraPermissions.install(id, session.fromPartition(partition))
    const manager = createTabManager(getWindow, {
      sessionId: id,
      partition,
      initialBounds: globalBounds ?? undefined
    })
    managers.set(id, manager)

    // 每 manager 创建时接线一次（存活期内常驻，销毁即随 webContents 一同失效）：
    // ① 快照定向转发（主窗口只收激活会话的 'main' 作用域快照——后台会话快照在此
    // 丢弃防串台，既有行为；独立窗口作用域快照一律放行，ipc 按 windowId 定向——其
    // 绑定会话相对主窗口可能"后台"，但对那个窗口而言永远是前台）；
    // ② 状态聚合对全部作用域生效（后台会话的真实加载态如实驱动，不造假）；
    // ③ 持久化上报由该会话任一作用域快照触发（阶段 10 归并口径放开：recordSnapshot
    // 内部经 listSessionSnapshots 重算「主窗在先 + 独立窗创建序」归并视图——独立窗
    // 的 Tab 增删/导航/关窗级联收缩均如实驱动落盘）；④ 独立窗口作用域清空 → 收口关窗
    manager.onSnapshotChanged((snapshot) => {
      if (snapshot.windowId !== WINDOW_ID_MAIN || snapshot.sessionId === activeSessionId) {
        for (const cb of snapshotListeners) cb(snapshot)
      }
      setStatus(id, snapshot.tabs.some((tab) => tab.loading) ? 'loading' : 'idle')
      persistence.recordSnapshot(id)
      // 「窗口应销毁」信号取快照监听形态（设计取舍：closeTab 与 tear-off 两条清空
      // 路径一处收口，免为两处返回值扩签名；'main' 作用域空态合法，永不触发关窗）
      if (snapshot.windowId !== WINDOW_ID_MAIN && snapshot.tabs.length === 0) {
        windows.closeWindow(snapshot.windowId)
      }
    })
    manager.onFocusAddressRequest((windowId) => {
      // focus-address 只可能来自挂入中的页面（后台 view 收不到键盘输入）：主窗口来源
      // 要求会话激活；独立窗口来源要求窗口绑定会话相符（其会话相对主窗口可后台）
      const bound = windowId === WINDOW_ID_MAIN ? activeSessionId : windows.getSessionId(windowId)
      if (bound !== id) return
      for (const cb of focusListeners) cb(windowId)
    })
    manager.onFindRequest((windowId) => {
      // find 请求与 focus-address 同规：页面聚焦态按键只可能来自挂入中的页面
      const bound = windowId === WINDOW_ID_MAIN ? activeSessionId : windows.getSessionId(windowId)
      if (bound !== id) return
      for (const cb of findRequestListeners) cb(windowId)
    })
    manager.onFindResult((windowId, result) => {
      // found-in-page 计数只发往发生查找的宿主窗口（同上归属守卫——后台会话的查找
      // 计数不上浮主窗，陈旧会话的残余事件不外泄）
      const bound = windowId === WINDOW_ID_MAIN ? activeSessionId : windows.getSessionId(windowId)
      if (bound !== id) return
      for (const cb of findResultListeners) cb(windowId, result)
    })
    // 历史采集接线（地址栏补全）：manager 上抛的导航事实转发 history 模块合并落盘；
    // about:blank 过滤与超长拒绝在 recordVisit 内承担（manager 只上抛不过滤）
    manager.onVisit((fact) => history.recordVisit(id, fact))

    // 懒创建即按恢复集多开 Tab（阶段 6）：缓存有恢复集则逐条过白名单恢复（顺序 +
    // 激活位），缺失/空则建一个空白 Tab；页面运行态不还原（URL 级恢复，PRD 3.6.4）
    persistence.applyRestore(manager, id, false)
    // 缓存未命中即现读一次落盘补载：命中不了的两类场景——①启动预读未完成的毫秒窗口；
    // ②运行期新增的会话（克隆产物：其 id 只在落盘里，永不进内存缓存，启动预读的共享
    // promise 快照也不含它，故必须现读）。读回后若该会话仍处于"零恢复"状态（唯一 Tab
    // 还是空白页）才补做恢复（用户已自行导航/开 Tab 则不打扰），保住 PRD 3.1.4 的恢复语义
    if (!persistence.hasRestore(id)) {
      pendingBackfill.add(id)
      void loadSnapshot()
        .then((snapshot) => {
          // 已注销守卫（F2 定案）与补载资格守卫（R1 定案：复用路径已撤销），
          // 任一失效即不再补载；delete 恒执行保证集合条目总被清理
          const armed = pendingBackfill.delete(id)
          if (!managers.has(id) || !armed) return
          persistence.ingest(snapshot)
          const item = snapshot.sessions.find((entry) => entry.id === id)
          if (!item || item.tabs.length === 0) return
          // L4 定案叠加径：批量打开已在补载待定期叠加了 Tab——初始空白 Tab 由系统创建、
          // 非用户接管，关掉后全量恢复（恢复集不因批量打开而丢弃）
          if (persistence.takeBatchOpened(id)) {
            const snap = manager.getSnapshot()
            const blank = snap.tabs.find((tab) => tab.url === BLANK_URL)
            if (blank && snap.tabs.length > 1) manager.closeTab(blank.id)
            persistence.applyRestore(manager, id, false)
            return
          }
          // 常规径守卫：补载判据从"激活 Tab 是空白页"收紧为"唯一 Tab 是空白页"——
          // 多 Tab 恢复下，用户已自行加 Tab（tabs.length > 1）同样视为"已自行接管"，不打扰
          const current = manager.getSnapshot()
          if (current.tabs.length !== 1) return
          const activeTab = current.tabs.find((tab) => tab.id === current.activeTabId)
          if (!activeTab || activeTab.url !== BLANK_URL) return
          persistence.applyRestore(manager, id, true)
        })
        .catch(() => undefined) // loadSnapshot 坏数据自回退不 reject，此处仅兜底防未处理拒绝
    }
    return manager
  }

  function switchSession(id: string | null): void {
    initHandled = true
    if (id === activeSessionId) return // 同 id no-op
    // 被篡改 id 前置拒绝（R2 定案）：在任何副作用（摘旧 view、置 activeSessionId）之前
    // 早退——深层 ensureManager→partitionFor 的抛错点晚于摘 view，会让浏览器区冻结在
    // "有快照无视图"状态；此处早退保住旧会话画面可用（后续推送被 renderer 守卫丢弃
    // 属篡改数据固有的一致性破损，点击任一合法会话即恢复）
    if (id !== null && !SESSION_ID_RE.test(id)) {
      console.warn(`[registry] 拒绝切换到非法会话 id "${id}"（疑似落盘数据被篡改）`)
      return
    }
    // 克隆窗口期守卫：源/目标分区正被复制，中途激活会重建源 manager 使副本落入活库
    // （renderer 该行有「克隆中…」反馈；数秒窗口后 clone 收尾的 setActive 接管画面）
    if (id !== null && cloningIds.has(id)) return
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
    // 克隆窗口期守卫：正被复制的分区销毁会让 cp 半途落空且清数据与复制竞态；
    // 如实告警后跳过（会话元数据已删，分区残留由克隆失败清理路径或人工处理）
    if (cloningIds.has(id)) {
      console.warn(`[registry] 会话 ${id} 正在克隆中，本次销毁请求已跳过`)
      return
    }
    // 删除会话先封死该 Session 的权限 handler 与在途请求；closeSession（克隆临时收尾）
    // 不走此分支，源会话本次运行内的授权决定得以保留，目标 id 天然不继承。
    cameraPermissions.disposeSession(id)
    // 先关该会话全部独立窗壳（步骤 5 会话级联）：closeAllForSession 同步发起 win.close()
    // 即返回，closed（含页面 unload）异步落地——销毁链不必等它；窗口内页面 webContents
    // 由下方 killPartitionWebContents 按 session 分区扫杀兜底覆盖，两路都杀不冲突
    //（已销毁者被 isDestroyed 过滤）。壳先关让窗口即时从用户视野消失，随后照走既有销毁链
    windows.closeAllForSession(id)
    const manager = managers.get(id)
    // 先摘注册表引用再清除：清除后不得再实例化该分区（fromPartition 会惰性重建空目录，
    // 阶段4步骤1 冒烟定案），从 Map 移除 manager 即天然保证——本函数此后也不再触碰该分区 session
    managers.delete(id)
    persistence.dropSession(id)
    // 历史随会话销毁彻底清除（PRD 3.1.2「永久删除」；deleteBatch 级联逐会话走本链天然覆盖）
    await history.dropHistory(id)
    deleteStatus(id)
    // 正常编排里被删激活会话时 index.ts 已先切换走（onDeleted 级联）；此处兜底摘 view 与空态
    const wasActive = activeSessionId === id
    if (wasActive) activeSessionId = null

    const partition = partitionFor(id)
    const target = session.fromPartition(partition)
    if (manager) {
      // ② 先注销 manager（封死 newTab）：销毁等待期内垂死页面仍可能经 window.open
      //    触发 newTab 复生 webContents（复生 = 清除后数据覆写回盘 + 泄漏，H2 定案路径）
      manager.dispose()
      detachActiveView(manager)
      // ③ 先销毁该分区全部页面 webContents（原生受管 DevTools 随宿主 wc.close() 自然带走）；
      //    webContents 存活时清存储会被内存态覆写回盘（冒烟定案时序，顺序不可颠倒），
      //    销毁机制由 killPartitionWebContents 共享（closeSession 同用）
      await killPartitionWebContents(target, id, '清除')
    }
    // ② 清分区存储（cookies / localStorage / 缓存索引等）；失败如实告警不静默，
    //    文案带分区名与目录位置（userData/Partitions/ 下），残留可人工核查
    try {
      await target.clearStorageData()
    } catch (error) {
      console.warn(
        `[registry] 清除会话 ${id} 分区存储失败（分区 ${partition}，目录 userData/Partitions/ 下可能残留，请手动核查）:`,
        error
      )
    }
    // ③ 删分区落盘目录（force 容忍目录本就不存在——从未激活过的会话；
    //    partitionDir 对被篡改 id 抛错也落此 catch，目录不会被误删）
    try {
      await rm(partitionDir(partition), { recursive: true, force: true })
    } catch (error) {
      console.warn(
        `[registry] 删除会话 ${id} 分区目录失败（分区 ${partition}，目录位于 userData/Partitions/ 下，残留请手动核查）:`,
        error
      )
    }
    if (wasActive) notifySnapshot()
  }

  /**
   * 关闭该会话：销毁全部 webContents 但保留分区数据与元数据（与 destroySession 的语义
   * 分叉：跳过 clearStorageData 与删目录），供 clonePartition 在复制前收尾活库（活库的
   * LevelDB/Cookies journal 未落盘，直接 cp 会得到不一致副本）。关后 manager 从注册表
   * 摘除（reported/状态条目/去抖定时器一并清掉），下次激活该会话由 ensureManager 懒创建
   * 并按 restoreSets 缓存重载恢复集。被关的是激活会话时只摘 view、置空激活标记，
   * **不**切空态**不**广播空态快照——克隆完成后 renderer 的 setActive(新会话) 接管画面，
   * 全程只切一次，避免中间空态闪烁。manager 不存在（从未激活过或已关闭）时 no-op
   * resolve（窗口级联照走——克隆前源会话独立窗口全关的收口不依赖 manager 存在）
   */
  async function closeSession(id: string): Promise<void> {
    const manager = managers.get(id)
    if (manager) {
      // 显式操作打断启动恢复（与 switchSession 同规）：防止恢复路径在关闭后重建该会话的
      // manager，让随后的分区复制重新落入"活库"状态
      initHandled = true
      // 冲刷前置（阶段 10 时序翻转，契约点 4）：settleSession 在关窗级联之前——此刻
      // 独立窗全部存活，flushReport 捕获完整归并集（克隆恢复集语义 = 关闭发起时刻的
      // 归并快照）。关窗级联发生在下方 managers.delete 之后，flushReport 的
      // listSessionSnapshots 判据已摘空（manager 不在注册表返回 null），级联收缩不会
      // 再抢写缩水列表
      // await：克隆随后读 restoreSets 缓存，冲刷写盘与缓存前移须先落定（审查 B）
      await persistence.settleSession(id)
    }
    // 入口关该会话全部独立窗壳（步骤 5 会话级联，时序口径同 destroySession 内注释）；
    // clonePartition 经此入口调用天然覆盖——克隆前源会话独立窗口全关，窗内页面不再写入
    // 分区，复制不落入活库。manager 不存在（无窗可关）时此调用本身即 no-op
    windows.closeAllForSession(id)
    if (!manager) return
    managers.delete(id)
    // 恢复集保留（settleSession 的分叉点）：该会话仍在落盘元数据里存活，
    // 下次激活须按恢复集重载（PRD 3.1.4 恢复语义，计划用例 A 的"源会话切回重载"）
    deleteStatus(id)
    if (activeSessionId === id) activeSessionId = null
    // 先 dispose 封死 newTab（销毁等待期内垂死页面 window.open 的复生路径），再摘 view、
    // 杀 webContents（共享销毁机制，含宽限与有界重扫）
    manager.dispose()
    detachActiveView(manager)
    await killPartitionWebContents(session.fromPartition(partitionFor(id)), id, '关闭')
  }

  /**
   * 克隆分区目录（close-then-copy）：先 closeSession 源会话收尾活库，再递归复制分区目录
   * 到目标（排除缓存类目录，登录态与站点数据全量保真）。源目录不存在（从未激活过的会话）
   * 时跳过复制——产物为空白环境，克隆零异常边界。复制失败先清目标残留再上抛（handler 转
   * IPC 错误，元数据不落盘），残留路径如实告警不静默
   */
  async function clonePartition(srcId: string, dstId: string): Promise<void> {
    cloningIds.add(srcId)
    cloningIds.add(dstId)
    // closeSession 会置空 activeSessionId（当源是激活会话）：失败恢复的判据须先行捕获
    const wasActive = activeSessionId === srcId
    let failed = false
    try {
      await closeSession(srcId)
      const srcDir = partitionDir(partitionFor(srcId))
      const dstDir = partitionDir(partitionFor(dstId))
      // 源分区目录不存在：从未激活过的会话无数据可复制，产物为空白环境（零异常）
      let srcStat: Awaited<ReturnType<typeof stat>> | null = null
      try {
        srcStat = await stat(srcDir)
      } catch (error) {
        if (!isENOENT(error)) throw error
      }
      if (srcStat) {
        if (!srcStat.isDirectory()) {
          throw new Error(`源分区路径不是目录（${srcDir}），疑似数据损坏，拒绝克隆`)
        }
        try {
          await cp(srcDir, dstDir, {
            recursive: true,
            // 按 basename 排除缓存类目录（返回 false 的目录整体跳过，子内容不再遍历）
            filter: (srcPath: string): boolean =>
              !CLONE_EXCLUDED_DIR_BASENAMES.has(basename(srcPath))
          })
          // 复制完成后目标目录就位性复核：半成品复制在此暴露（失败走下方清理路径）
          const dstStat = await stat(dstDir)
          if (!dstStat.isDirectory()) {
            throw new Error(`目标分区路径不是目录（${dstDir}）`)
          }
          // 克隆携带历史（用户批复假设 2）：先冲刷源会话待写再复制文件与内存条目
          // （settle 时点快照语义，与分区复制同口径）；失败走同一清理路径视为克隆失败
          await history.cloneHistory(srcId, dstId)
        } catch (error) {
          failed = true
          // 任何失败先清目标残留再上抛：半成品目录会让新会话挂在不一致环境上；
          // 残留路径如实告警（清理自身失败也告警，交人工核查），不静默
          try {
            await rm(dstDir, { recursive: true, force: true })
          } catch (cleanupError) {
            console.warn(
              `[registry] 清理克隆目标残留目录失败（${dstDir}，请手动核查）:`,
              cleanupError
            )
          }
          console.warn(
            `[registry] 克隆分区目录失败（${srcDir} → ${dstDir}），已清理目标残留:`,
            error
          )
          throw error
        }
      }
    } finally {
      cloningIds.delete(srcId)
      cloningIds.delete(dstId)
      // 失败恢复（M2）：源是激活会话且克隆失败时，closeSession 已摘 view 置空激活标记、
      // renderer 侧 setActive 未发生（clone handler 抛错）——不恢复会让浏览器区冻结在
      // "有快照无视图"状态直到用户手动点击。守卫已解除，切回源会话（manager 重建 +
      // lastUrl 重载）即可恢复可用（活页面状态不还原，如实代价）
      if (failed && wasActive) switchSession(srcId)
    }
  }

  /**
   * 批量打开测试地址：逐会话懒创建 manager 并新建 Tab 加载 url（url 已在 handler 层过
   * normalizeInput 白名单规范化）。newTab 会把该 manager 激活 Tab 的 view 挂入窗口——
   * 对非当前激活的后台会话，newTab 后立即用 detachActiveView 摘回其 view（webContents
   * 保活后台加载，加载态经既有 statusChanged 推送如实驱动）；仅当前激活会话的 view 保持挂入
   */
  function openUrlInSessions(ids: string[], url: string): void {
    for (const id of ids) {
      // 克隆窗口期守卫：正被复制的分区若在此懒创建 manager，副本会落入活库
      if (cloningIds.has(id)) continue
      const existed = managers.has(id)
      const manager = ensureManager(id)
      if (!existed) {
        // 刚懒创建会话的三分支（L4 定案：批量打开绝不丢弃恢复集）：
        // ① 缓存有恢复集（ensureManager 已多开恢复）→ 直接叠加批量 Tab；
        // ② 缓存明确无恢复集（空数组，无补载待定）且初始 Tab 空白 → 复用该 Tab 直接
        //    加载目标地址，避免"新标签页 + 目标页"双 Tab；
        // ③ 缓存未命中（补载待定，落盘可能有恢复集）→ 不撤销补载、置叠加标记，批量 Tab
        //    先叠加；补载读盘后关掉系统创建的初始空白 Tab 全量恢复（见 ensureManager）
        const snap = manager.getSnapshot()
        const activeTab = snap.tabs.find((tab) => tab.id === snap.activeTabId)
        const restore = persistence.getRestore(id)
        if (restore && restore.tabs.length > 0) {
          // 分支 ①：落到末尾 newTab(url)
        } else if (activeTab && activeTab.url === BLANK_URL && restore) {
          const wc = manager.getActiveWebContents()
          if (wc && !wc.isDestroyed()) {
            void wc.loadURL(url).catch((error: unknown) => logLoadFailure(url, error))
            if (id !== activeSessionId) detachActiveView(manager)
            continue
          }
        } else if (activeTab && activeTab.url === BLANK_URL) {
          persistence.markBatchOpened(id)
        }
      }
      manager.newTab(url)
      if (id !== activeSessionId) detachActiveView(manager)
    }
  }

  function init(activeId: string | null): void {
    // 读盘一次缓存各会话恢复集（与 ensureManager 的补载共享同一 in-flight promise）：
    // switchSession 是同步签名，取值只能前置到缓存里
    const storeReady = persistence.preload()
    if (activeId === null) return
    // 启动恢复（PRD 3.1.4）：读盘完成后恢复上次激活会话，懒创建经恢复集缓存多开 Tab；
    // 读盘期间已有显式切换/销毁（极端竞态）则跳过，以显式操作为准
    void storeReady
      .then(() => {
        if (initHandled) return
        initHandled = true
        if (!persistence.hasRestore(activeId)) return // 悬空 activeId（loadSnapshot 已会重置，双保险）
        switchSession(activeId)
      })
      .catch((error: unknown) => {
        // 含被篡改 id 被 partitionFor 读入口拒绝等场景：启动恢复失败如实告警，不崩进程
        console.warn('[registry] 启动恢复激活会话失败:', error)
      })
  }

  // —— TabManager 兼容命令面：按 windowId 作用域路由（ipc 层经 sender 解析显式传入；
  // 缺省 'main' 兼容 registry 内部调用点与 persistence 恢复路径）——
  // 主窗口作用域无激活会话时命令类 no-op 返回空态快照（getActiveWebContents 返回
  // null）；真正的拒绝语义（「未选择会话」）由 ipc 层在通道入口守卫承担（阶段4 步骤 6）；
  // 独立窗口作用域的会话存活性已在 resolveSenderScope 校验（ipc 层拒绝）。

  function newTab(url?: string, windowId: string = WINDOW_ID_MAIN): BrowserSnapshot {
    const manager = scopedManager(windowId)
    return manager ? manager.newTab(url, windowId) : emptySnapshot()
  }

  function closeTab(id: string, windowId: string = WINDOW_ID_MAIN): BrowserSnapshot {
    const manager = scopedManager(windowId)
    return manager ? manager.closeTab(id, windowId) : emptySnapshot()
  }

  function switchTab(id: string, windowId: string = WINDOW_ID_MAIN): BrowserSnapshot {
    const manager = scopedManager(windowId)
    return manager ? manager.switchTab(id, windowId) : emptySnapshot()
  }

  function toggleDevTools(windowId: string = WINDOW_ID_MAIN): BrowserSnapshot {
    const manager = scopedManager(windowId)
    return manager ? manager.toggleDevTools(windowId) : emptySnapshot()
  }

  function closeDevTools(windowId: string = WINDOW_ID_MAIN): BrowserSnapshot {
    const manager = scopedManager(windowId)
    return manager ? manager.closeDevTools(windowId) : emptySnapshot()
  }

  function getActiveWebContents(windowId: string = WINDOW_ID_MAIN): WebContents | null {
    return scopedManager(windowId)?.getActiveWebContents(windowId) ?? null
  }

  function setBounds(rect: SetBoundsPayload, windowId: string = WINDOW_ID_MAIN): void {
    if (windowId === WINDOW_ID_MAIN) {
      // 全局缓存最近一次非零主窗口矩形：新建 manager 的 initialBounds（切换瞬间新
      // manager 无自身缓存时的挂入矩形兜底）；零矩形是收起信号（弹层悬挂），不进缓存。
      // 广播全部 manager：各自缓存 'main' 槽位布局、各自仅对激活 view 生效，悬挂态
      // 语义随 manager 既有实现
      if (rect.width > 0 && rect.height > 0) globalBounds = rect
      for (const manager of managers.values()) manager.setBounds(rect, WINDOW_ID_MAIN)
      return
    }
    // 独立窗口矩形只写该窗口绑定会话的 manager 槽位（其他会话无该窗口作用域，广播无意义）
    scopedManager(windowId)?.setBounds(rect, windowId)
  }

  function attachToWindow(windowId: string = WINDOW_ID_MAIN): void {
    // 路由到作用域 manager（主窗口重开由 index.ts 调用、独立窗口就绪由 windows.ts 回调
    // 经 onIndependentWindowReady 调用）；无该作用域 manager 时无 view 需要重挂
    scopedManager(windowId)?.attachToWindow(windowId)
  }

  function destroyTabsInWindow(windowId: string): void {
    scopedManager(windowId)?.destroyTabsInWindow(windowId)
  }

  function getSnapshot(windowId: string = WINDOW_ID_MAIN): BrowserSnapshot {
    return scopedManager(windowId)?.getSnapshot(windowId) ?? emptySnapshot()
  }

  /**
   * tearOffTab / moveTabToWindow 共享的作用域解析前导（L2 收敛，阶段 10 顺手抽取）：
   * sessionId 解析（'main' → 激活会话；独立窗 → 登记表绑定会话）+ manager 存在性 +
   * Tab 存在性三段，任一失败抛中文错误；返回 sessionId 供建窗/同会话校验续用
   */
  function requireScopeForTab(
    id: string,
    windowId: string
  ): { sessionId: string; manager: TearOffTabManager } {
    const sessionId = windowId === WINDOW_ID_MAIN ? activeSessionId : windows.getSessionId(windowId)
    if (sessionId === null) throw new Error('未选择会话')
    const manager = managers.get(sessionId)
    if (!manager) throw new Error('会话已不可用')
    if (!manager.getSnapshot(windowId).tabs.some((tab) => tab.id === id)) {
      throw new Error('标签页不存在')
    }
    return { sessionId, manager }
  }

  async function tearOffTab(
    id: string,
    windowId: string = WINDOW_ID_MAIN,
    at?: { x?: number; y?: number }
  ): Promise<BrowserSnapshot> {
    // 前导先行一次（L2 共享段）：会话解析供标题读取用；Tab 存在性提前到此与旧时点
    //（读盘 await 之后）等价——拖拽路径的 dragStart 侧已守卫过存在性，此处防内部误用
    const { sessionId } = requireScopeForTab(id, windowId)
    // 建窗标题=会话名（与会话名严格同源，不做乐观标题）：会话元数据只在落盘（store.ts），
    // 读盘异步——先读再建窗，期间被移出的 Tab 仍挂源窗口、用户无感；读不到回退占位
    // 标题，不阻断 tear-off 主流程（标题随后续重命名经 setTitleForSession 同步）
    let title = '会话窗口'
    try {
      const stored = await loadSnapshot()
      const found = stored.sessions.find((item) => item.id === sessionId)
      if (found) title = found.name
    } catch {
      // loadSnapshot 坏数据自回退不 reject，此处仅兜底 fs 层异常
    }
    // await 间隙事件循环让位、状态可能已变（会话被销毁/关闭、Tab 已被关闭）：建窗前重走
    // 共享前导重验三段，失效即抛中文错误（窗尚未建，无需回滚）；建窗绑定以后一次解析
    // 结果为准（与前导校验通过的作用域恒一致）
    const resolved = requireScopeForTab(id, windowId)
    const created = windows.createWindow(resolved.sessionId, title, at)
    return resolved.manager.tearOffTab(id, windowId, created.windowId)
  }

  function moveTabToWindow(
    id: string,
    sourceWindowId: string,
    targetWindowId: string,
    insertIndex?: number
  ): void {
    const { sessionId, manager } = requireScopeForTab(id, sourceWindowId)
    // 目标窗同会话强校验（拒绝判定已在拖拽控制器按命中集预判，此处兜底拦截竞态与
    // 内部误用——异会话一律拒绝，无任何宽容路径，计划 2.2 定案）
    if (targetWindowId === sourceWindowId) throw new Error('目标窗口与源窗口相同')
    const targetSessionId =
      targetWindowId === WINDOW_ID_MAIN ? activeSessionId : windows.getSessionId(targetWindowId)
    if (targetSessionId !== sessionId) throw new Error('目标窗口不属于该会话，拒绝转移')
    manager.moveTabToWindow(id, sourceWindowId, targetWindowId, insertIndex)
  }

  function getActiveSessionId(): string | null {
    return activeSessionId
  }

  function getRestoreSet(id: string): RestoreSet | undefined {
    return persistence.getRestore(id)
  }

  function resolveSenderScope(sender: WebContents): SenderWindowScope {
    const win = BrowserWindow.fromWebContents(sender)
    if (!win || win.isDestroyed()) throw new Error('无法识别命令来源窗口')
    if (win === getWindow(WINDOW_ID_MAIN)) {
      return { windowId: WINDOW_ID_MAIN, sessionId: activeSessionId }
    }
    const windowId = String(win.id)
    const sessionId = windows.getSessionId(windowId)
    if (sessionId === null) throw new Error('无法识别命令来源窗口')
    // 独立窗口守卫：绑定会话的 manager 须仍在注册表（会话销毁/关闭后的残余窗口命令
    // 一律拒绝——步骤 5 起会话级联会先关掉这些窗口，此处是过渡期兜底）
    if (!managers.has(sessionId)) throw new Error('会话已不可用')
    return { windowId, sessionId }
  }

  function onIndependentWindowReady(sessionId: string, windowId: string): void {
    // 按会话直查 manager（sessionId 由 windows.ts 显式携带，不依赖登记表反查——
    // 回调时序上窗口必在表，但显式传参免一次查表且语义更直）；manager 不存在说明
    // 会话已销毁/关闭（过渡期窗口未随之关闭的场景），无 view 可挂
    managers.get(sessionId)?.attachToWindow(windowId)
  }

  function onIndependentWindowClosed(sessionId: string, windowId: string): void {
    // 只做 manager 内存态清理（webContents 兜底补刀）；manager 可能已随会话销毁/关闭
    // 摘除——摘除时 killPartitionWebContents 已按分区扫杀其 webContents，无 Tab 可清
    managers.get(sessionId)?.destroyTabsInWindow(windowId)
  }

  function onSnapshotChanged(cb: SnapshotListener): () => void {
    snapshotListeners.add(cb)
    return () => snapshotListeners.delete(cb)
  }

  function onFocusAddressRequest(cb: FocusAddressListener): () => void {
    focusListeners.add(cb)
    return () => focusListeners.delete(cb)
  }

  function onFindRequest(cb: FindRequestListener): () => void {
    findRequestListeners.add(cb)
    return () => findRequestListeners.delete(cb)
  }

  function onFindResult(cb: FindResultListener): () => void {
    findResultListeners.add(cb)
    return () => findResultListeners.delete(cb)
  }

  function onSessionStatus(cb: (payload: SessionStatusesPayload) => void): () => void {
    statusListeners.add(cb)
    return () => statusListeners.delete(cb)
  }

  /** 退出前冲刷全部待写的上报去抖并封笔（index.ts 的 before-quit 钩子；聚合 persistence 与 history 两路写盘，返回全部在途写盘的汇合 promise） */
  function flushPendingReports(): Promise<void> {
    return Promise.all([persistence.flushAll(), history.flushAll()]).then(() => undefined)
  }

  function getStatuses(): SessionStatusesPayload {
    return statusesPayload()
  }

  /** 注销全部 manager（封死一切 newTab 创建路径）；单会话销毁走 destroySession */
  function dispose(): void {
    for (const manager of managers.values()) manager.dispose()
  }

  return {
    newTab,
    closeTab,
    tearOffTab,
    moveTabToWindow,
    getActiveSessionId,
    getRestoreSet,
    resolveSenderScope,
    onIndependentWindowReady,
    onIndependentWindowClosed,
    switchTab,
    setBounds,
    toggleDevTools,
    closeDevTools,
    getActiveWebContents,
    attachToWindow,
    destroyTabsInWindow,
    dispose,
    getSnapshot,
    onSnapshotChanged,
    onFocusAddressRequest,
    onFindRequest,
    onFindResult,
    switchSession,
    destroySession,
    closeSession,
    clonePartition,
    openUrlInSessions,
    init,
    onSessionStatus,
    getStatuses,
    flushPendingReports,
    history
  }
}
