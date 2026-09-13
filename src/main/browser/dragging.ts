// 拖拽会话控制器（阶段 9）：Tab 拖出/拖入手势的主进程裁决中枢。dragStart 开启光标
// 轮询（约 16ms）驱动同会话窗口命中与悬停高亮推送（仅变化时经回调广播），dragEnd
// 按上报屏幕坐标四态裁决——语义冻结于 notes/plans/20260913023538-阶段9拖出拖入手势
// 开发计划.md 第 3 节契约点 3。
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
  type TabDragHoverPayload,
  type TabDragOutcome,
  type TabDragPreviewPayload
} from '../../shared/browser'
import type { DragPreview } from './dragPreview'
import type { IndependentWindows } from './windows'

/** 光标轮询间隔（约一帧）：拖拽期间唯一的高频工作，窗口期外不存在 */
const POLL_INTERVAL_MS = 16
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
  /** 当前悬停窗（无悬停为 null）；仅变化时经回调广播 */
  hoverWindowId: string | null
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
    screenX: number
    screenY: number
  }): Promise<TabDragOutcome>
  onHoverChanged(cb: (p: TabDragHoverPayload) => void): () => void
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
  moveTabToWindow: (tabId: string, sourceWindowId: string, targetWindowId: string) => void
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

  function emitHover(target: DragSession, hoverWindowId: string | null): void {
    const payload: TabDragHoverPayload = {
      sessionId: target.sessionId,
      tabId: target.tabId,
      hoverWindowId
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

  /** 点是否命中窗口 bounds（getBounds 与 getCursorScreenPoint 同为 DIP 屏幕系，含边界） */
  function hitTest(candidate: HitCandidate, point: { x: number; y: number }): boolean {
    const b = candidate.win.getBounds()
    return point.x >= b.x && point.x <= b.x + b.width && point.y >= b.y && point.y <= b.y + b.height
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

  /** 当前悬停窗：同会话命中集减源窗口后命中测试（源窗上方无高亮——释放即 stayed） */
  function hoverWindowAt(target: DragSession, point: { x: number; y: number }): string | null {
    const hits = sameSessionCandidates(target)
      .filter((candidate) => candidate.windowId !== target.sourceWindowId)
      .filter((candidate) => hitTest(candidate, point))
    return pickHit(hits)?.windowId ?? null
  }

  /** 上报点在全应用窗口集的命中（四态裁决入口；无命中返回 null） */
  function hitAnyWindowAt(point: { x: number; y: number }): HitCandidate | null {
    return pickHit(allAppCandidates().filter((candidate) => hitTest(candidate, point)))
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
   * 命中窗口的裁决：源窗 → stayed（零副作用）；同会话窗（非源，含激活会话相符时的
   * 主窗）→ moveTabToWindow 并入末位；异会话窗（含主窗激活会话不符）→ rejected
   * （零副作用，源 Tab 原位不丢）。迁移原语失败（与预判间的极端竞态）按 stayed 收场
   * 并如实告警——dragEnd 是收尾语义，不抛错
   */
  function adjudicateHit(active: DragSession, hit: HitCandidate): TabDragOutcome {
    if (hit.windowId === active.sourceWindowId) return 'stayed'
    if (hit.sessionId !== active.sessionId) return 'rejected'
    try {
      moveTabToWindow(active.tabId, active.sourceWindowId, hit.windowId)
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
      hoverWindowId: null
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
    // 仅悬停变化时广播（轮询 16ms 一帧，无变化广播会刷爆 IPC）
    if (hover === active.hoverWindowId) return
    active.hoverWindowId = hover
    emitHover(active, hover)
  }

  async function dragEnd(p: {
    tabId: string
    sourceWindowId: string
    screenX: number
    screenY: number
  }): Promise<TabDragOutcome> {
    const active = session
    // 无匹配活动会话（tabId/来源对不上，或已过期——过期钩子清态时已广播终态）：
    // 收尾语义不抛错，径返 stayed。此处不广播清态——stray 上报可能撞上另一个活动
    // 会话的窗口期，清态会踩掉它的高亮态
    if (!active || active.tabId !== p.tabId || active.sourceWindowId !== p.sourceWindowId) {
      return 'stayed'
    }
    // 先收场（停轮询、摘会话、广播 hover 终态 null）：裁决含 await（空白径读盘建窗），
    // 收场前置让紧随的新 dragStart 无缝接管、已死会话不再轮询
    endSession(active)
    // 全量重验（契约点 f）：Tab 仍在源窗作用域——失效（Tab 被关/会话被删/主窗来源的
    // 激活会话已切走）即 stayed，零副作用不抛错
    if (!isTabInScope(p.tabId, p.sourceWindowId)) return 'stayed'

    const reported = { x: p.screenX, y: p.screenY }
    const polled = active.lastPolledPoint
    const stale = isStaleReport(reported, polled)
    // 裁决点：上报坐标；(0,0) 陈旧形态（Windows 窗外释放坐标缺失的已知取值，与最后
    // 轮询点联合判定）径用轮询点
    const primary = stale && polled ? polled : reported
    const primaryHit = hitAnyWindowAt(primary)
    if (primaryHit) return adjudicateHit(active, primaryHit)
    // 裁决点零命中 → 空白释放，落点即裁决点。刻意不做"零命中改用轮询点复检"：
    // 轮询点滞后最多一帧（16ms），快速甩出窗缘释放时轮询点仍可能落在源窗内，会把
    // 合法的空白拖出误裁成 stayed；非 (0,0) 的平台坐标缺陷形态留 Windows 实测裁决
    //（计划第 3 节契约点 3，波次 3 检查点定案），不为投机兜底牺牲正常路径
    return tearOffAtPoint(active, primary)
  }

  function onHoverChanged(cb: (p: TabDragHoverPayload) => void): () => void {
    hoverListeners.add(cb)
    return () => hoverListeners.delete(cb)
  }

  return { dragStart, dragEnd, onHoverChanged }
}
