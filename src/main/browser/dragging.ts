// 拖拽会话控制器（阶段 9）：Tab 拖出/拖入手势的主进程裁决中枢。dragStart 开启光标
// 轮询（约 16ms）驱动同会话窗口命中与悬停高亮推送（仅变化时经回调广播），dragEnd
// 按上报屏幕坐标四态裁决——语义冻结于 notes/plans/20260913023538-阶段9拖出拖入手势
// 开发计划.md 第 3 节契约点 3。
// 阶段 10：悬停推送携带悬停窗内容坐标（cursorX/cursorY）；目标窗经 dragInsert 命令
// 上报插入位 hint（setInsertHint 只存不验，匹配守卫在 ipc 层），moved-window 裁决按
// hint 插入、无 hint / hint 异窗回退末位（契约点 1/3，阶段 10 计划第 3 节）。
// 2026-09-25 拖出裁决阈值修订（Chrome 对齐）：命中测试从「窗口 bounds」细化为
// 「Tab 栏矩形」（各窗 renderer 经 report-tabstrip-rect 上报关栏视口矩形，本控制器
// 叠加 contentBounds 原点换算屏幕矩形）——释放点落在某窗口 Tab 栏内才走三态裁决
//（源栏 stayed / 同会话栏 moved-window / 异会话栏 rejected），离开 Tab 栏的一切
// 位置（源窗内容区、他窗内容区、软件外空白）一律建新窗。修订记录见
// notes/plans/20260925085925-拖出裁决阈值修订.md 第 1 节。
// 分层约束：不拼分区串（persist:sess-<id> 单源在 registry）、不碰持久化、不直接持有
// WebContentsView——迁移一律经注入的 registry 原语（moveTabToWindow / tearOffAt）；
// 悬停推送不在此发 IPC，经 onHoverChanged 回调交 ipc.ts 定向发送（同会话窗口全集，
// 异会话窗口零触达）。
// 轮询定时器生命周期：随 dragStart 建立、随 dragEnd 收尾 / 60s 过期 / 后到者接管而
// 清除——仅存在于 dragStart—dragEnd 窗口期，应用内无任何常驻轮询。

import { screen } from 'electron'
import type { BrowserWindow } from 'electron'
import {
  WINDOW_ID_MAIN,
  type SetBoundsPayload,
  type TabDragHoverPayload,
  type TabDragOutcome,
  type TabDragPreviewPayload
} from '../../shared/browser'
import type { DragPreview } from './dragPreview'
import type { IndependentWindows } from './windows'

/** 光标轮询间隔（约一帧）：拖拽期间唯一的高频工作，窗口期外不存在 */
const POLL_INTERVAL_MS = 16
/**
 * 悬停窗内光标位移重发阈值：悬停窗不变但光标仍在窗内移动时（插入指示器须随光标
 * 实时更新），位移超过此值即重发悬停推送（携带新 cursorX/cursorY）；静止时零流量。
 * 值取 2px——低于人手抖动噪声、高于亚像素舍入误差
 */
const HOVER_CURSOR_EMIT_DELTA_PX = 2
/** 拖拽会话过期时限：dragend 丢失（平台极端场景）时的轮询泄漏兜底，超时清态并告警 */
const SESSION_EXPIRE_MS = 60_000
/**
 * 上报坐标陈旧判定半径：dragend 上报恰为 (0,0)（Windows 窗外释放坐标缺失的常见
 * 取值）且与最后轮询光标相距超此值时视为无效上报，径用轮询点裁决——(0,0) 也可能
 * 是主屏左上角的真实释放点，两条件缺一不可
 */
const STALE_REPORT_RADIUS_PX = 100

/** 命中候选窗口：sessionId 为该窗对拖拽会话而言的归属（主窗口随当前激活会话，可 null） */
interface HitCandidate {
  windowId: string
  win: BrowserWindow
  sessionId: string | null
}

interface DragSession {
  sessionId: string
  tabId: string
  sourceWindowId: string
  /** 最后一次轮询光标点（dragEnd 复检与陈旧上报的兜底坐标源；null = 尚无样本） */
  lastPolledPoint: { x: number; y: number } | null
  /** 当前悬停窗（无悬停为 null）；窗口变化时广播，窗内光标位移超阈值亦重发（见 pollOnce） */
  hoverWindowId: string | null
  /** 最近一次悬停推送发出时的光标点（窗内位移重发的判据；null = 未发过） */
  lastHoverCursor: { x: number; y: number } | null
  /**
   * 目标窗上报的插入位 hint（阶段 10，尽力而为瞬态）：只存不验（匹配守卫在 ipc 层
   * ——sender 窗 = 当前悬停窗且 tabId 匹配）；悬停窗变化即清（新悬停窗的指示器上报前
   * 回退末位）。收尾不清本字段——endSession 只摘 session 引用，dragEnd 的裁决在收场
   * 之后仍需从该对象读取 hint，hint 随会话对象丢弃而一并消亡
   */
  insertHint: { windowId: string; index: number } | null
}

export interface TabDragController {
  dragStart(p: {
    sessionId: string
    tabId: string
    sourceWindowId: string
    preview?: TabDragPreviewPayload
  }): void
  dragEnd(p: {
    tabId: string
    sourceWindowId: string
    /** 释放时来源窗口的会话绑定（ipc 层现解析）：与拖拽会话不符即 stayed——切会话/删会话 mid-drag 后 isTabInScope 会按当前激活 manager 查 id，跨会话 tab id 撞号会别名命中（阶段 10 实证） */
    scopeSessionId: string | null
    screenX: number
    screenY: number
    canceled?: boolean
  }): Promise<TabDragOutcome>
  onHoverChanged(cb: (p: TabDragHoverPayload) => void): () => void
  /**
   * 当前活动拖拽会话的悬停态（dragInsert 的 hint 匹配守卫用，ipc 层拉取）：无活动会话
   * 返回 null；hoverWindowId 为 null = 无悬停（任何 hint 上报都不应匹配）
   */
  getDragHoverState(): { tabId: string; hoverWindowId: string | null } | null
  /** 存储目标窗上报的插入位 hint（只存不验——守卫在 ipc 层；无活动会话时 no-op） */
  setInsertHint(hint: { windowId: string; index: number } | null): void
  /**
   * 存储某窗口 TabStrip 视口矩形（窗口内容坐标 DIP；ipc 层经 sender 归属该窗口，
   * 结构守卫后透传）。零/负尺寸 = TabStrip 已卸载（HTML 全屏壳层隐藏等），清条目。
   * 尽力而为缓存：丢失上报的后果是该窗 Tab 栏不被命中（释放走建窗），TabStrip
   * 重挂载/resize 即自愈
   */
  setTabstripRect(windowId: string, rect: SetBoundsPayload | null): void
}

export function createTabDragController(deps: {
  getMainWindow: () => BrowserWindow | null
  windows: IndependentWindows
  getActiveSessionId: () => string | null
  /**
   * dragEnd 全量重验：Tab 是否仍在源窗作用域（会话 manager 摘除后快照为空态、必不
   * 含该 Tab——本谓词天然覆盖契约点 f 的「会话 manager 仍在注册表」判据）
   */
  isTabInScope: (tabId: string, windowId: string) => boolean
  moveTabToWindow: (
    tabId: string,
    sourceWindowId: string,
    targetWindowId: string,
    insertIndex?: number
  ) => void
  tearOffAt: (tabId: string, sourceWindowId: string, at: { x: number; y: number }) => Promise<void>
  /** 跟随虚影窗（可选携带时 dragStart 建窗，轮询驱动跟随，收口统一销毁） */
  preview: DragPreview
}): TabDragController {
  const {
    getMainWindow,
    windows,
    getActiveSessionId,
    isTabInScope,
    moveTabToWindow,
    tearOffAt,
    preview
  } = deps

  const hoverListeners = new Set<(p: TabDragHoverPayload) => void>()
  // 全局单活动拖拽会话（契约点 3）：后到 dragStart 先清旧态再接管
  let session: DragSession | null = null
  // 轮询/过期定时器与 session 同生命周期成对出现（见文件头注释的结构性保证）
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let expireTimer: ReturnType<typeof setTimeout> | null = null
  // 各窗口 TabStrip 视口矩形缓存（窗口内容坐标）：命中测试的唯一布局事实源。条目
  // 不随窗口销毁清理——已销毁窗口不进候选集、其矩形自然不被查询；Electron 窗口 id
  // 单调不复用，残留条目无别名风险（量级 = 历史窗口数，个位数）
  const tabstripRects = new Map<string, SetBoundsPayload>()

  /**
   * 悬停推送：hoverWindowId 非 null 时对当前悬停窗计算光标内容坐标（getContentBounds
   * 原点起算的 DIP，与 renderer CSS px 同值）——坐标随悬停窗计算一次（不是各广播目标
   * 各算），广播桥接原样转发；取值失败（窗口已销毁/无边窗/getContentBounds 异常）静默
   * 省略字段，消费方按无坐标处理（只高亮不指示）
   */
  function emitHover(target: DragSession, hoverWindowId: string | null): void {
    const payload: TabDragHoverPayload = {
      sessionId: target.sessionId,
      tabId: target.tabId,
      hoverWindowId
    }
    const point = target.lastPolledPoint
    if (hoverWindowId !== null && point) {
      const win =
        hoverWindowId === WINDOW_ID_MAIN ? getMainWindow() : windows.getWindowById(hoverWindowId)
      try {
        if (win && !win.isDestroyed()) {
          const bounds = win.getContentBounds()
          payload.cursorX = point.x - bounds.x
          payload.cursorY = point.y - bounds.y
        }
      } catch {
        // 极端窗口态下 getContentBounds 抛错：省略坐标，悬停高亮不受影响
      }
    }
    for (const cb of hoverListeners) cb(payload)
  }

  function stopTimers(): void {
    if (pollTimer !== null) {
      clearInterval(pollTimer)
      pollTimer = null
    }
    if (expireTimer !== null) {
      clearTimeout(expireTimer)
      expireTimer = null
    }
  }

  /** 会话收场（dragEnd / 过期 / 后到者接管共用）：停轮询 + 摘会话 + 销虚影 + 广播 hover 终态 null */
  function endSession(target: DragSession): void {
    // 已被先行清场/接管的防御（幂等）
    if (session !== target) return
    session = null
    stopTimers()
    preview.hide()
    emitHover(target, null)
  }

  /** 主窗口候选：存活且未最小化才进命中集（sessionId 随当前激活会话，不符即拒绝态） */
  function mainCandidate(): HitCandidate | null {
    const win = getMainWindow()
    if (!win || win.isDestroyed() || win.isMinimized()) return null
    return { windowId: WINDOW_ID_MAIN, win, sessionId: getActiveSessionId() }
  }

  /**
   * 全应用窗口集（任意会话）：主窗口 + 全部独立窗口——四态裁决的入口命中（命中源窗
   * → stayed、同会话 → moved、异会话 → rejected），排除最小化与已销毁
   */
  function allAppCandidates(): HitCandidate[] {
    const candidates: HitCandidate[] = []
    const main = mainCandidate()
    if (main) candidates.push(main)
    for (const entry of windows.listAll()) {
      if (entry.win.isMinimized()) continue
      candidates.push({ windowId: entry.windowId, win: entry.win, sessionId: entry.sessionId })
    }
    return candidates
  }

  /**
   * 同会话命中集：主窗口（仅当主窗激活会话 = 拖拽会话，PRD 3.6.2）+ 该会话全部独立
   * 窗口——悬停候选的基础集合（再减源窗口）
   */
  function sameSessionCandidates(target: DragSession): HitCandidate[] {
    const candidates: HitCandidate[] = []
    const main = mainCandidate()
    if (main && main.sessionId === target.sessionId) candidates.push(main)
    for (const entry of windows.listForSession(target.sessionId)) {
      if (entry.win.isMinimized()) continue
      candidates.push({ windowId: entry.windowId, win: entry.win, sessionId: entry.sessionId })
    }
    return candidates
  }

  /**
   * 点是否命中该窗口的 Tab 栏（2026-09-25 修订：Tab 栏矩形取代窗口 bounds——Chrome
   * 对齐，Tab 级语义只在 Tab 栏上成立）。屏幕矩形 = 窗口 contentBounds 原点（现取，
   * 窗口移动自动跟随）+ renderer 上报的视口矩形；未上报（新窗首帧未落/上报丢失）或
   * 窗口已销毁视为不命中——矩形缺失走建窗属自愈路径（TabStrip 重挂载/resize 重报）
   */
  function tabstripHit(candidate: HitCandidate, point: { x: number; y: number }): boolean {
    const rect = tabstripRects.get(candidate.windowId)
    if (!rect || rect.width <= 0 || rect.height <= 0) return false
    if (candidate.win.isDestroyed()) return false
    let origin: { x: number; y: number }
    try {
      const bounds = candidate.win.getContentBounds()
      origin = { x: bounds.x, y: bounds.y }
    } catch {
      return false
    }
    const sx = origin.x + rect.x
    const sy = origin.y + rect.y
    return (
      point.x >= sx && point.x <= sx + rect.width && point.y >= sy && point.y <= sy + rect.height
    )
  }

  /**
   * 多窗 bounds 重叠的确定性 tiebreak（契约点 c）：当前聚焦者优先；其次最近聚焦序
   * （windows.ts 序表，主窗口不在登记表恒为最旧序）；序号并列时非主窗口优先——即
   * 「主窗口兜底最后」。Electron 无 z 序 API，他应用窗口遮挡我方窗口属已知边界，
   * 如实记录不做原生探测
   */
  function pickHit(hits: HitCandidate[]): HitCandidate | null {
    let best: HitCandidate | null = null
    for (const cur of hits) {
      if (!best) {
        best = cur
        continue
      }
      if (best.win.isFocused() !== cur.win.isFocused()) {
        if (cur.win.isFocused()) best = cur
        continue
      }
      const curSeq = windows.getFocusSeq(cur.windowId)
      const bestSeq = windows.getFocusSeq(best.windowId)
      if (curSeq !== bestSeq) {
        if (curSeq > bestSeq) best = cur
        continue
      }
      if (best.windowId === WINDOW_ID_MAIN) best = cur
    }
    return best
  }

  /**
   * 当前悬停窗：同会话命中集减源窗口后按 Tab 栏矩形命中（修订后悬停反馈只在目标窗
   * Tab 栏上呈现——可落的是 Tab 栏而非整窗，Chrome 对齐；源窗栏上方无高亮，释放即
   * stayed）
   */
  function hoverWindowAt(target: DragSession, point: { x: number; y: number }): string | null {
    const hits = sameSessionCandidates(target)
      .filter((candidate) => candidate.windowId !== target.sourceWindowId)
      .filter((candidate) => tabstripHit(candidate, point))
    return pickHit(hits)?.windowId ?? null
  }

  /** 上报点在全应用窗口集的 Tab 栏命中（四态裁决入口；无命中返回 null → 建新窗） */
  function hitAnyTabstripAt(point: { x: number; y: number }): HitCandidate | null {
    return pickHit(allAppCandidates().filter((candidate) => tabstripHit(candidate, point)))
  }

  /** 上报坐标陈旧形态判定（常量注释见 STALE_REPORT_RADIUS_PX） */
  function isStaleReport(
    reported: { x: number; y: number },
    polled: { x: number; y: number } | null
  ): boolean {
    if (!polled) return false
    if (reported.x !== 0 || reported.y !== 0) return false
    const dx = reported.x - polled.x
    const dy = reported.y - polled.y
    return dx * dx + dy * dy > STALE_REPORT_RADIUS_PX * STALE_REPORT_RADIUS_PX
  }

  /**
   * 命中 Tab 栏的裁决：源窗栏 → stayed（零副作用）；同会话窗栏（非源，含激活会话
   * 相符时的主窗）→ moveTabToWindow 按 hint 插入（hint 的 windowId 匹配命中窗才透传
   * ——悬停已切走 / 无上报时 undefined = 末位）；异会话窗栏（含主窗激活会话不符）→
   * rejected（零副作用，源 Tab 原位不丢）。迁移原语失败（与预判间的极端竞态）按
   * stayed 收场并如实告警——dragEnd 是收尾语义，不抛错
   */
  function adjudicateHit(active: DragSession, hit: HitCandidate): TabDragOutcome {
    if (hit.windowId === active.sourceWindowId) return 'stayed'
    if (hit.sessionId !== active.sessionId) return 'rejected'
    try {
      const insertIndex =
        active.insertHint !== null && active.insertHint.windowId === hit.windowId
          ? active.insertHint.index
          : undefined
      moveTabToWindow(active.tabId, active.sourceWindowId, hit.windowId, insertIndex)
      return 'moved-window'
    } catch (error) {
      console.warn(`[dragging] 并入窗口 ${hit.windowId} 失败，Tab 保持原位:`, error)
      return 'stayed'
    }
  }

  /** 空白裁决：落点附近建新窗（tearOffAt 内读盘取会话名，异步）；失败按 stayed 收场 */
  async function tearOffAtPoint(
    active: DragSession,
    at: { x: number; y: number }
  ): Promise<TabDragOutcome> {
    try {
      await tearOffAt(active.tabId, active.sourceWindowId, at)
      return 'moved-new-window'
    } catch (error) {
      console.warn(`[dragging] 落点建窗失败（${at.x},${at.y}），Tab 保持原位:`, error)
      return 'stayed'
    }
  }

  function dragStart(p: {
    sessionId: string
    tabId: string
    sourceWindowId: string
    preview?: TabDragPreviewPayload
  }): void {
    if (session) {
      // 单活动会话约束：后到 dragStart 接管——先广播旧会话清态（旧源窗半透明/悬停
      // 高亮/虚影回收）再重置；正常 UI 流不应出现（释放必达或 60s 过期先行），告警留痕
      console.warn(
        `[dragging] 拖拽会话未收尾即收到新 dragStart（旧 tab ${session.tabId}，新 tab ${p.tabId}），清旧态后接管`
      )
      endSession(session)
    }
    const created: DragSession = {
      sessionId: p.sessionId,
      tabId: p.tabId,
      sourceWindowId: p.sourceWindowId,
      lastPolledPoint: null,
      hoverWindowId: null,
      lastHoverCursor: null,
      insertHint: null
    }
    session = created
    // 轮询与过期定时器随会话成对建立（生命周期保证见文件头注释）
    pollTimer = setInterval(pollOnce, POLL_INTERVAL_MS)
    expireTimer = setTimeout(() => {
      // 60s 无释放：dragend 丢失的平台兜底，清态（停轮询 + 销虚影 + 广播终态）并告警
      if (session !== created) return
      console.warn(
        `[dragging] 拖拽会话 ${SESSION_EXPIRE_MS / 1000} 秒未收到 dragEnd（tab ${created.tabId}），按过期清态`
      )
      endSession(created)
    }, SESSION_EXPIRE_MS)
    // 初始态广播一次（悬停即时计算，通常为 null——dragStart 时光标仍在源 Tab 上）；
    // 同时垫底 lastPolledPoint，保证紧随的 dragEnd 有复检坐标可用
    const cursor = screen.getCursorScreenPoint()
    created.lastPolledPoint = { x: cursor.x, y: cursor.y }
    created.hoverWindowId = hoverWindowAt(created, created.lastPolledPoint)
    // 初始广播即垫底 lastHoverCursor：初始悬停非 null 时，后续窗内位移的重发判据从
    // 此基线起算（否则 pollOnce 的 null 早退会让指示器冻结在入窗位置）
    created.lastHoverCursor = { x: cursor.x, y: cursor.y }
    emitHover(created, created.hoverWindowId)
    // 跟随虚影（可选）：锚定抓取点建窗，此后由轮询逐帧 moveTo（endSession 统一销毁）。
    // 建窗属纯视觉增强，极端资源态失败不阻断拖拽会话与命令成功——告警降级为无虚影
    try {
      if (p.preview) preview.show(p.preview, created.lastPolledPoint)
    } catch (error) {
      console.warn('[dragging] 拖拽虚影建窗失败，本次拖拽以无虚影继续:', error)
    }
  }

  function pollOnce(): void {
    const active = session
    if (!active) {
      // 防御（endSession 已停表）；真到此处也自查停表，杜绝泄漏轮询
      stopTimers()
      return
    }
    const cursor = screen.getCursorScreenPoint()
    active.lastPolledPoint = { x: cursor.x, y: cursor.y }
    preview.moveTo(active.lastPolledPoint)
    const hover = hoverWindowAt(active, active.lastPolledPoint)
    // 悬停窗不变时：窗内光标位移超阈值才重发（插入指示器随光标更新，静止零流量）；
    // 同窗重发不清插入位 hint——旧 hint 是该窗的最后已知位，优于无 hint 的末位回退
    //（新 index 上报到达前的毫秒级窗口内，last-known 比回退更接近真实意图）
    if (hover === active.hoverWindowId) {
      if (hover === null || active.lastHoverCursor === null) return
      const dx = cursor.x - active.lastHoverCursor.x
      const dy = cursor.y - active.lastHoverCursor.y
      if (dx * dx + dy * dy <= HOVER_CURSOR_EMIT_DELTA_PX * HOVER_CURSOR_EMIT_DELTA_PX) return
      active.lastHoverCursor = { x: cursor.x, y: cursor.y }
      emitHover(active, hover)
      return
    }
    // 悬停切换：清插入位 hint——旧窗 hint 对新窗无意义，新悬停窗的指示器上报前回退末位
    active.hoverWindowId = hover
    active.insertHint = null
    active.lastHoverCursor = { x: cursor.x, y: cursor.y }
    emitHover(active, hover)
  }

  async function dragEnd(p: {
    tabId: string
    sourceWindowId: string
    scopeSessionId: string | null
    screenX: number
    screenY: number
    canceled?: boolean
  }): Promise<TabDragOutcome> {
    const active = session
    // 无匹配活动会话（tabId/来源对不上，或已过期——过期钩子清态时已广播终态）：
    // 收尾语义不抛错，径返 stayed。此处不广播清态——stray 上报可能撞上另一个活动
    // 会话的窗口期，清态会踩掉它的高亮态
    if (!active || active.tabId !== p.tabId || active.sourceWindowId !== p.sourceWindowId) {
      return 'stayed'
    }
    // 先收场（停轮询、摘会话、广播 hover 终态 null）：裁决含 await（空白径读盘建窗），
    // 收场前置让紧随的新 dragStart 无缝接管、已死会话不再轮询；一切 stayed 早退都在
    // 收场之后，杜轮询/虚影/高亮残留
    endSession(active)
    // 会话绑定漂移守卫（阶段 10）：拖拽期间来源窗口的会话绑定已变（删会话级联切换/
    // 显式切会话）——本拖拽的上下文已失效；且 isTabInScope 按当前激活 manager 查 id，
    // 跨会话 tab id 撞号会别名命中他窗会话的 Tab，必须前置拦截
    if (active.sessionId !== p.scopeSessionId) return 'stayed'
    // 全量重验（契约点 f）：Tab 仍在源窗作用域——失效（Tab 被关/会话被删/主窗来源的
    // 激活会话已切走）即 stayed，零副作用不抛错
    if (!isTabInScope(p.tabId, p.sourceWindowId)) return 'stayed'
    // 显式取消（Esc，阶段 10 修订）：一律 stayed——坐标假想点在窗口重叠下会误命中
    // 他窗（执行期实证），取消语义不参与坐标裁决
    if (p.canceled === true) return 'stayed'

    const reported = { x: p.screenX, y: p.screenY }
    const polled = active.lastPolledPoint
    const stale = isStaleReport(reported, polled)
    // 裁决点：上报坐标；(0,0) 陈旧形态（Windows 窗外释放坐标缺失的已知取值，与最后
    // 轮询点联合判定）径用轮询点
    const primary = stale && polled ? polled : reported
    const primaryHit = hitAnyTabstripAt(primary)
    if (primaryHit) return adjudicateHit(active, primaryHit)
    // 裁决点未命中任何 Tab 栏 → 离开 Tab 栏的一切位置（源窗/他窗内容区、软件外空白）
    // 均建新窗（2026-09-25 修订，Chrome 对齐——「拖离 Tab 栏即可拖出」），落点即裁决
    // 点。刻意不做"零命中改用轮询点复检"：轮询点滞后最多一帧（16ms），快速甩出栏外
    // 释放时轮询点仍可能落在源窗 Tab 栏内，会把合法的拖出误裁成 stayed；非 (0,0) 的
    // 平台坐标缺陷形态留 Windows 实测裁决（计划第 3 节契约点 3，波次 3 检查点定案），
    // 不为投机兜底牺牲正常路径
    return tearOffAtPoint(active, primary)
  }

  function onHoverChanged(cb: (p: TabDragHoverPayload) => void): () => void {
    hoverListeners.add(cb)
    return () => hoverListeners.delete(cb)
  }

  function getDragHoverState(): { tabId: string; hoverWindowId: string | null } | null {
    if (!session) return null
    return { tabId: session.tabId, hoverWindowId: session.hoverWindowId }
  }

  function setInsertHint(hint: { windowId: string; index: number } | null): void {
    if (!session) return
    session.insertHint = hint
  }

  function setTabstripRect(windowId: string, rect: SetBoundsPayload | null): void {
    if (rect === null || rect.width <= 0 || rect.height <= 0) {
      tabstripRects.delete(windowId)
      return
    }
    tabstripRects.set(windowId, rect)
  }

  return {
    dragStart,
    dragEnd,
    onHoverChanged,
    getDragHoverState,
    setInsertHint,
    setTabstripRect
  }
}
