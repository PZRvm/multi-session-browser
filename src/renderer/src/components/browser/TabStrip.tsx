import { useEffect, useRef, useState } from 'react'
import { CloseOutlined, LoadingOutlined, PlusOutlined } from '@ant-design/icons'
import type { BrowserTabState } from '../../../../shared/browser'
import { useAppearanceStore } from '../../stores/appearance'
import { useBrowserStore, windowIdentity } from '../../stores/browser'
import { useT } from '../../i18n'

interface TabItemProps {
  tab: BrowserTabState
  active: boolean
  /** 仅剩 1 个 tab 时关闭钮禁用（主窗口作用域规则，见下方 lastOne 注释） */
  lastOne: boolean
}

/** 指针拖拽进入阈值（px）：按下后位移超过此半径才认定为拖拽，防点击误判 */
const DRAG_ENGAGE_RADIUS_PX = 5

// 单个 tab（独立组件）。阶段 9 修订：拖拽手势由 HTML5 DnD（draggable +
// dragstart/dragend）改为指针捕获自绘——原生拖放在窗外释放时，松手位置下方的
// 窗口未「接受投放」，macOS 会先播放系统级拖影飞回原位的动画，随后我们的异步
// 裁决才把 Tab 搬走，叠加成「先回原位再跳走」的两段视觉（用户实测反馈）。指针
// 捕获自绘后没有 OS 拖影，松手即裁决；跨窗命中本就由主进程光标轮询承担，不依赖
// HTML5 拖放事件（dropEffect 裁决不采用的冒烟定案继续有效）。拖拽三态视觉
// （源半透明 / 悬停高亮 / 拒绝回弹）挂 chrome-tab 类系，样式见 app.css。
// 指针手势三态：idle → armed（已按下未过阈值，仍是点击候选）→ dragging（位移
// 过阈值，已上报主进程开轮询）。
function TabItem({ tab, active, lastOne }: TabItemProps): React.JSX.Element {
  const t = useT()
  const switchTab = useBrowserStore((s) => s.switchTab)
  const closeTab = useBrowserStore((s) => s.closeTab)
  const dragStart = useBrowserStore((s) => s.dragStart)
  const dragEnd = useBrowserStore((s) => s.dragEnd)
  const dragging = useBrowserStore((s) => s.draggingTabId === tab.id)
  const [rejected, setRejected] = useState(false)
  // 指针手势状态机与 Esc 放回监听、回弹兜底计时器均经 ref 持有：释放可能在组件
  // 卸载后不可达（Tab 已被主进程移除，React 合成事件不派发到脱离文档的节点），
  // 卸载清理（下方 useEffect return）须能独立于事件流安全收尾；拖拽中卸载的
  // 清态由 store.applySnapshot 自愈与主进程 60s 过期兜底
  const gestureRef = useRef<{
    mode: 'idle' | 'armed' | 'dragging'
    pointerId: number
    originX: number
    originY: number
    /** 按下点 client 坐标：虚影抓取偏移的精确锚定源（engageDrag 时的指针已离开按下点 5px+） */
    downClientX: number
    downClientY: number
    lastX: number
    lastY: number
  }>({
    mode: 'idle',
    pointerId: -1,
    originX: 0,
    originY: 0,
    downClientX: 0,
    downClientY: 0,
    lastX: 0,
    lastY: 0
  })
  const escCancelRef = useRef<((e: KeyboardEvent) => void) | null>(null)
  const rejectTimerRef = useRef<number | null>(null)
  // 吞掉拖拽结束的随尾 click：pointerup 后浏览器仍会派发 click（HTML5 原生拖拽
  // 会压制它，自绘手势不会）——若不吞，Tab 拖走后紧随的 click 会对已移出作用域
  // 的 Tab 报「标签页不存在」，源窗内小拖释放（stayed）也会误激活被拖 Tab，
  // 点击语义混入拖拽语义。消费一次即复位；新一轮 pointerdown 先清残留
  //（click 未随拖拽派发的罕见路径，如 pointercancel 后无 click）
  const suppressClickRef = useRef(false)

  useEffect(() => {
    const gesture = gestureRef.current
    return () => {
      if (escCancelRef.current !== null) {
        document.removeEventListener('keydown', escCancelRef.current, true)
        escCancelRef.current = null
      }
      if (rejectTimerRef.current !== null) {
        window.clearTimeout(rejectTimerRef.current)
        rejectTimerRef.current = null
      }
      gesture.mode = 'idle'
    }
  }, [])

  /** 拖拽收尾（pointerup / 取消 / Esc 放回共用）：摘 Esc 监听 → 复位手势态 → 上报落点取裁决 */
  const finishDrag = (screenX: number, screenY: number, canceled = false): void => {
    const g = gestureRef.current
    if (g.mode !== 'dragging') return
    g.mode = 'idle'
    suppressClickRef.current = true
    if (escCancelRef.current !== null) {
      document.removeEventListener('keydown', escCancelRef.current, true)
      escCancelRef.current = null
    }
    // 落点为屏幕坐标（DIP，与主进程窗口 bounds 同系）；本地拖拽态清理由
    // store.dragEnd 的 finally 兜底（含 IPC 失败路径）
    void dragEnd(tab.id, screenX, screenY, canceled).then((outcome) => {
      if (outcome === 'rejected') {
        // 异会话释放被拒：源 Tab 原位回弹（右侧唯一允许的位移动效）；
        // animationend 移除动画类，计时器兜底动画事件缺席的场景（如合成测试）
        setRejected(true)
        if (rejectTimerRef.current !== null) window.clearTimeout(rejectTimerRef.current)
        rejectTimerRef.current = window.setTimeout(() => setRejected(false), 400)
      }
    })
  }

  const title = tab.title || t('common.blankTabTitle')

  /** 位移过阈值，正式进入拖拽：上报主进程开轮询（携带虚影描述）+ 挂 Esc 放回 */
  const engageDrag = (e: React.PointerEvent<HTMLDivElement>): void => {
    gestureRef.current.mode = 'dragging'
    // 虚影描述：卡片度量与按下点在卡内偏移（主进程预览窗按「光标 - 偏移」锚定跟随，
    // 与真实抓取手感一致）、标题/favicon、当前解析主题（亮暗与壳一致）
    const rect = e.currentTarget.getBoundingClientRect()
    const g = gestureRef.current
    dragStart(tab.id, {
      width: rect.width,
      height: rect.height,
      // 抓取偏移取按下点而非本次 move 事件（此刻指针已偏离按下点 5px+，用 move 会
      // 让虚影锚点整体偏移同样距离）
      grabX: g.downClientX - rect.x,
      grabY: g.downClientY - rect.y,
      title,
      faviconUrl: tab.loading ? null : (tab.faviconUrl ?? null),
      theme: useAppearanceStore.getState().resolvedTheme
    })
    // Esc 放回（Chrome 对齐）：拖拽中 Esc 语义 = 取消并放回源窗。capture 阶段挂
    // document 抢在 window 级 close-devtools 快捷键之前吞键（拖拽中不该关
    // DevTools）；落点取源窗口内部坐标，保证主进程裁决为 stayed 零副作用
    const onEsc = (ev: KeyboardEvent): void => {
      if (ev.key !== 'Escape') return
      ev.preventDefault()
      ev.stopPropagation()
      // canceled 显式携带（阶段 10 修订）：坐标假想点在源窗与他窗重叠时会误命中他窗
      finishDrag(window.screenX + 100, window.screenY + 100, true)
    }
    escCancelRef.current = onEsc
    document.addEventListener('keydown', onEsc, true)
  }

  return (
    <div
      role="tab"
      tabIndex={0}
      aria-selected={active}
      title={title}
      className={`chrome-tab${active ? ' active' : ''}${dragging ? ' dragging' : ''}${
        rejected ? ' drag-rejected' : ''
      }`}
      onClick={() => {
        if (suppressClickRef.current) {
          suppressClickRef.current = false
          return
        }
        switchTab(tab.id)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          switchTab(tab.id)
        }
      }}
      onPointerDown={(e) => {
        // 仅主键、且落点不在关闭钮上（关闭钮自有点击语义）；已有手势进行中忽略；
        // 新手势开启即清上一轮吞 click 残留（click 未随拖拽派发的罕见路径）
        if (e.button !== 0) return
        if ((e.target as HTMLElement).closest('.chrome-tab-close')) return
        suppressClickRef.current = false
        const g = gestureRef.current
        if (g.mode !== 'idle') return
        g.mode = 'armed'
        g.pointerId = e.pointerId
        g.originX = e.screenX
        g.originY = e.screenY
        g.downClientX = e.clientX
        g.downClientY = e.clientY
        g.lastX = e.screenX
        g.lastY = e.screenY
        // 指针捕获：按住期间 pointermove/up 持续送达本元素（含光标移出窗口），
        // 这是替代 HTML5 DnD 跨窗送达的关键；极端平台态捕获失败则降级窗内手势
        try {
          e.currentTarget.setPointerCapture(e.pointerId)
        } catch {
          /* 窗内拖拽仍由元素自身 move/up 事件覆盖 */
        }
      }}
      onPointerMove={(e) => {
        const g = gestureRef.current
        if (g.mode === 'idle' || e.pointerId !== g.pointerId) return
        g.lastX = e.screenX
        g.lastY = e.screenY
        if (g.mode !== 'armed') return
        const dx = e.screenX - g.originX
        const dy = e.screenY - g.originY
        if (dx * dx + dy * dy < DRAG_ENGAGE_RADIUS_PX * DRAG_ENGAGE_RADIUS_PX) return
        engageDrag(e)
      }}
      onPointerUp={(e) => {
        const g = gestureRef.current
        if (g.mode === 'idle' || e.pointerId !== g.pointerId) return
        if (g.mode === 'dragging') finishDrag(e.screenX, e.screenY)
        else g.mode = 'idle'
      }}
      onPointerCancel={(e) => {
        // 系统接管（如应用切换/触控抬笔）：按最后已知坐标收尾，等同释放裁决
        const g = gestureRef.current
        if (g.mode === 'idle' || e.pointerId !== g.pointerId) return
        if (g.mode === 'dragging') finishDrag(g.lastX, g.lastY)
        else g.mode = 'idle'
      }}
      onLostPointerCapture={(e) => {
        // 兜底：up/cancel 之外的异常失捕（如元素中途移出 DOM）按最后坐标收尾，
        // 不悬挂半透明态；正常路径 up/cancel 已把 mode 复位为 idle，此处自然跳过
        const g = gestureRef.current
        if (e.pointerId !== g.pointerId) return
        if (g.mode === 'dragging') finishDrag(g.lastX, g.lastY)
        else if (g.mode === 'armed') g.mode = 'idle'
      }}
      onAnimationEnd={(e) => {
        // animationend 会冒泡（favicon 旋转等子动画）：只认本元素回弹动画的结束
        if (e.target !== e.currentTarget) return
        if (rejectTimerRef.current !== null) {
          window.clearTimeout(rejectTimerRef.current)
          rejectTimerRef.current = null
        }
        setRejected(false)
      }}
    >
      {tab.loading ? (
        <LoadingOutlined spin className="chrome-tab-favicon" />
      ) : tab.faviconUrl ? (
        // favicon 禁止自身成为拖拽源（img 原生可拖会劫持手势），保证整 Tab 拖拽一致
        <img className="chrome-tab-favicon" src={tab.faviconUrl} alt="" draggable={false} />
      ) : (
        <span className="chrome-tab-favicon chrome-tab-favicon-dot" />
      )}
      <span className="chrome-tab-title">{title}</span>
      <button
        type="button"
        className="chrome-tab-close"
        aria-label={t('browser.tabs.closeWith', { title })}
        disabled={lastOne}
        // 关闭钮显式不可拖（阻断继承自 Tab 的拖拽源），点击与键盘激活不受手势扰动
        draggable={false}
        onClick={(e) => {
          e.stopPropagation()
          closeTab(tab.id)
        }}
        // 键盘激活（Enter/Space）不冒泡到父级 tab：父级 onKeyDown 会
        // preventDefault 吞掉按钮原生激活，导致键盘永远关不掉标签页
        onKeyDown={(e) => e.stopPropagation()}
      >
        <CloseOutlined />
      </button>
    </div>
  )
}

// Tab 栏：渲染主进程推送的真实 tab 列表；store 初始为空（init 未 resolve 前）只显示新建按钮，
// 零会话（快照 sessionId === null）时新建按钮禁用（主进程命令守卫同拒「未选择会话」）。
// 0-Tab 组合（sessionId 非 null 且 tabs 空，移出唯一 Tab 后可达）：列表区天然为空、
// 新建钮可用，不伪造占位 Tab；工具栏禁用链由 !activeTab 自然覆盖。
function TabStrip(): React.JSX.Element {
  const t = useT()
  const tabs = useBrowserStore((s) => s.tabs)
  const activeTabId = useBrowserStore((s) => s.activeTabId)
  const sessionId = useBrowserStore((s) => s.sessionId)
  const newTab = useBrowserStore((s) => s.newTab)
  // 同会话拖拽悬停落点（阶段 9）：store 已把悬停推送归一化为「本窗口 id 或 null」，
  // 命中即整条 Tab 栏高亮——可落的是整窗，Tab 栏是 app 在窗顶的自有可视面
  const dragTarget = useBrowserStore((s) => s.hoverWindowId === windowIdentity.windowId)

  // 拖拽插入指示器（阶段 10）：悬停落点本窗时按光标对各 Tab 中点判定插入位
  // （0..tabs.length）。指示器是单元素绝对定位位移——不进列表流、不推挤 Tab、
  // pointer-events 关闭不参与手势命中；位置更新经 store 直订阅驱动，16ms 悬停
  // 推送不进 React 渲染通道；插入位变化才上报 dragInsert hint（尽力而为，失败
  // 静默丢弃，主进程末位回退兜底）
  const tabsElRef = useRef<HTMLDivElement | null>(null)
  const insertElRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const container = tabsElRef.current
    const indicator = insertElRef.current
    if (!container || !indicator) return
    // 上次已上报的插入位：仅变化时发 IPC；隐藏即复位——再悬停即使同位也须重报
    //（主进程在悬停窗切换时已清 hint）
    let reportedIndex: number | null = null
    const hide = (): void => {
      indicator.hidden = true
      reportedIndex = null
    }
    const unsubscribe = useBrowserStore.subscribe((state, prev) => {
      // 悬停瞬态字段全未变（快照等其他 set）时跳过测量
      if (
        state.hoverWindowId === prev.hoverWindowId &&
        state.dragCursorX === prev.dragCursorX &&
        state.dragHoverTabId === prev.dragHoverTabId
      ) {
        return
      }
      const cursorX = state.dragCursorX
      const dragTabId = state.dragHoverTabId
      const hovering = state.hoverWindowId === windowIdentity.windowId
      if (!hovering || cursorX === null || dragTabId === null) {
        if (reportedIndex !== null) hide()
        return
      }
      const tabEls = container.querySelectorAll<HTMLElement>(':scope > .chrome-tab')
      // 0-Tab 目标窗无锚可依：不指示不上报（末位 = 0 位，主进程回退同结果）
      if (tabEls.length === 0) {
        if (reportedIndex !== null) hide()
        return
      }
      // 中点判定：光标落在首个中点之前的 Tab 前；越过全部中点即末位
      const rects = Array.from(tabEls, (el) => el.getBoundingClientRect())
      let index = rects.length
      for (let i = 0; i < rects.length; i++) {
        if (cursorX < rects[i].left + rects[i].width / 2) {
          index = i
          break
        }
      }
      if (index === reportedIndex) return
      reportedIndex = index
      // 竖线落邻接 Tab 边界中点（两端外移半间隙）；光标坐标为窗口内容坐标（DIP），
      // 与 getBoundingClientRect 同基线；容器无 border，border box 原点即定位原点
      const halfGap = 2
      const barX = container.getBoundingClientRect().left
      const boundary =
        index === 0
          ? rects[0].left - halfGap
          : index === rects.length
            ? rects[rects.length - 1].right + halfGap
            : (rects[index - 1].right + rects[index].left) / 2
      indicator.hidden = false
      indicator.style.left = `${boundary - barX}px`
      window.api.browser.dragInsert({ tabId: dragTabId, index }).catch(() => {})
    })
    return () => {
      unsubscribe()
      // 卸载清指示器（DOM 随组件销毁，此处复位隐藏态兜底）
      indicator.hidden = true
    }
  }, [])

  // 「最后留一」仅是主窗口作用域规则（主进程同 no-op，此处只管视觉与可点性）；
  // 独立窗口允许关闭最后一个 Tab——关掉即销毁窗口（契约：阶段 7—8 计划第 3 节点 5），
  // tear-off 不受最后留一限制（主窗口可至 0 Tab，阶段 9 拖拽手势可达）
  const lastOne = windowIdentity.mode === 'main' && tabs.length <= 1

  return (
    <div
      ref={tabsElRef}
      className={`chrome-tabs${dragTarget ? ' drag-target' : ''}`}
      role="tablist"
      aria-label={t('browser.tabs.listAria')}
    >
      {tabs.map((tab) => (
        <TabItem key={tab.id} tab={tab} active={tab.id === activeTabId} lastOne={lastOne} />
      ))}
      {/* 插入指示竖线：纯视觉元素（不进可达树），显隐与位置由上方 effect 写入 */}
      <div className="chrome-tab-insert" ref={insertElRef} hidden aria-hidden="true" />
      <button
        type="button"
        className="chrome-newtab"
        aria-label={t('browser.tabs.newTab')}
        disabled={sessionId === null}
        onClick={() => newTab()}
      >
        <PlusOutlined />
      </button>
    </div>
  )
}

export default TabStrip
