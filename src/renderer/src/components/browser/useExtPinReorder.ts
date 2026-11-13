import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/** 槽位间距（px）：按钮 28 + 胶囊 gap 2，与 CSS .chrome-ext-bar 对账，改一处必改另一处 */
export const EXT_PIN_PITCH = 30

/** 过阈值半径（px）：按下位移过此半径才认定拖拽（TabStrip 手势同值），导出供手势层（Toolbar）分流点击与拖拽 */
export const ENGAGE_RADIUS_PX = 5

/** 提交后禁过渡窗（ms）：覆盖 would-be 过渡时长，防「先滑回再跳位」伪动画（FLIP 收口） */
const SETTLE_MS = 200

export interface ExtPinReorderApi {
  /** 拖拽中的插件 id（null = 无重排进行） */
  reorderId: string | null
  /** 槽位位移 px 表（null = 无重排）：非拖动钮 = (预览槽位 − 基准槽位) × 间距，拖动钮恒 0 */
  slotOffsets: Map<string, number> | null
  /** 拖动钮跟手位移（按下点起算的水平偏移，渲染层写内联 translateX） */
  dragOffsetX: number
  /** 提交落地帧的禁过渡窗：渲染层据此挂容器 settle 类 */
  settling: boolean
  /** 开始重排（手势层过阈值后调用）：快照基准序 + 预览序起 = 已提交序 */
  begin: (id: string) => void
  /** 拖动中更新：基准几何槽位中点判定换位（不测动画中的邻居 rect）；返回换位增量（0=未换位，±1=相邻单步） */
  move: (id: string, clientX: number) => number
  /** 跟手位移写入 */
  setDragOffsetX: (x: number) => void
  /** 提交预览序（无位移短路零 IPC；回执 ok 落地新序 + settle 窗） */
  commit: () => Promise<boolean>
  /** 放回原位（Esc/pointercancel）：清预览零 IPC，transform 过渡滑回 */
  cancel: () => void
  /** 拖拽进行中镜像：调用方在拖拽期间抑制 changed 广播重取 */
  dragActiveRef: { current: boolean }
}

/**
 * 工具栏固定图标拖拽重排 hook（插件固定专项 2026-11-13；useTabReorder 同构 + 槽位滑动
 * 动画）：DOM 恒按已提交序渲染（拖拽中不重排 DOM），预览序以槽位 transform 呈现——
 * 非拖动钮 translateX = (预览槽位 − 基准槽位) × 槽位间距，CSS transition 承担 Chrome 式
 * 邻居滑移；拖动钮 translateX = 槽位差 + 跟手位移（换位重置基准后槽位差承接已过位移，
 * 无 transition）。换位判定用基准几何槽位中点（自身基准位 + 间距常量推算，相邻单步、
 * 快速甩动由连续 move 收敛；不测动画中的邻居 rect——rect 滞后槽位会在边界来回换位
 * 振荡，2026-11-13 用户反馈鬼畜修复）。提交走 extensions:order-pinned 全序
 * 覆盖，回执 ok 后 onApplied 落地本地新序并置 settle 禁过渡窗（DOM 位移与 transform
 * 清零等效换位，放任过渡会「先滑回再跳位」伪动画，FLIP 收口惯例）；失败预览清空自然
 * 滑回（useTabReorder 先例：无显式反馈为设计定案）。Esc/pointercancel 放回原位。
 */
export function useExtPinReorder(
  pins: string[],
  onApplied: (next: string[]) => void
): ExtPinReorderApi {
  // 已提交序镜像（props.pins 的 ref）：begin 快照基准序、commit 短路比对用
  const pinsRef = useRef(pins)
  useEffect(() => {
    pinsRef.current = pins
  })
  /** 基准序（begin 时刻快照） */
  const [baseIds, setBaseIds] = useState<string[]>(pins)
  const [reorderId, setReorderId] = useState<string | null>(null)
  const reorderIdRef = useRef<string | null>(null)
  useEffect(() => {
    reorderIdRef.current = reorderId
  })
  const [previewIds, setPreviewIds] = useState<string[] | null>(null)
  const previewRef = useRef<string[] | null>(null)
  const [dragOffsetX, setDragOffsetXState] = useState(0)
  /** 跟手位移镜像（事件期读取）：move 换位判定扣除自身 transform 用 */
  const dragOffsetRef = useRef(0)
  const setDragOffsetX = useCallback((x: number): void => {
    dragOffsetRef.current = x
    setDragOffsetXState(x)
  }, [])
  const [settling, setSettling] = useState<boolean>(false)
  const settleTimerRef = useRef<number | null>(null)
  const dragActiveRef = useRef(false)
  useEffect(() => {
    dragActiveRef.current = reorderId !== null
  })
  const onAppliedRef = useRef(onApplied)
  useEffect(() => {
    onAppliedRef.current = onApplied
  })

  const applyPreview = useCallback((next: string[] | null): void => {
    previewRef.current = next
    setPreviewIds(next)
  }, [])

  const begin = useCallback(
    (id: string): void => {
      setBaseIds([...pinsRef.current])
      applyPreview([...pinsRef.current])
      setReorderId(id)
      setDragOffsetX(0)
    },
    [applyPreview]
  )

  const move = useCallback(
    (id: string, clientX: number): number => {
      const preview = previewRef.current
      if (!preview) return 0
      const from = preview.indexOf(id)
      if (from === -1) return 0
      const baseIdx = baseIds.indexOf(id)
      if (baseIdx === -1) return 0
      // 换位判定用基准几何槽位中点（自身基准位 + 间距常量推槽位中点），不测邻居 live rect：
      // 邻居滑移动画进行中的 rect 滞后于槽位，指针在边界微动即来回换位（振荡鬼畜）；
      // 锚定 = 自身 live rect − 自身当前 transform（槽位差 + 跟手位移），与动画解耦
      const el = document.querySelector<HTMLElement>(`[data-ext-pin-id="${id}"]`)
      if (!el) return 0
      const ownSlotTerm = (from - baseIdx) * EXT_PIN_PITCH
      const ownBaseLeft = el.getBoundingClientRect().left - ownSlotTerm - dragOffsetRef.current
      const slotMid = (i: number): number =>
        ownBaseLeft + (i - baseIdx) * EXT_PIN_PITCH + el.offsetWidth / 2
      let to = from
      if (from > 0 && clientX < slotMid(from - 1)) to = from - 1
      if (to === from && from < preview.length - 1 && clientX > slotMid(from + 1)) to = from + 1
      if (to === from) return 0
      const next = [...preview]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      applyPreview(next)
      return to - from
    },
    [baseIds, applyPreview]
  )

  /**
   * 槽位位移表（渲染期派生，含拖动钮）：各 id = (预览槽位 − 基准槽位) × 间距。
   * 拖动钮渲染时在表值上叠加 dragOffsetX 跟手位移（换位重置基准后槽位差承接已过
   * 位移，拖动钮不再瞬跳回原槽重走——2026-11-13 用户反馈鬼畜修复）
   */
  const slotOffsets = useMemo<Map<string, number> | null>(() => {
    if (previewIds === null) return null
    const base = baseIds
    const offsets = new Map<string, number>()
    previewIds.forEach((id, idx) => {
      const baseIdx = base.indexOf(id)
      offsets.set(id, baseIdx === -1 ? 0 : (idx - baseIdx) * EXT_PIN_PITCH)
    })
    return offsets
  }, [previewIds, baseIds])

  const commit = useCallback(async (): Promise<boolean> => {
    const preview = previewRef.current
    const id = reorderIdRef.current
    if (!preview || id === null) return false
    const base = baseIds
    /** 清态统一出口：预览与跟手位移清零（transform 过渡滑回原槽） */
    const resetAll = (): void => {
      setReorderId(null)
      setDragOffsetX(0)
      applyPreview(null)
    }
    // 无位移释放：清态即滑回原槽（跟手位移归零的过渡滑回，Chrome 同款手感）
    if (base.join('\u0000') === preview.join('\u0000')) {
      resetAll()
      return false
    }
    try {
      // 回执后再落地：预览保持到 ok——ok 时 DOM 重排 + transform 清零 + settle 禁过渡
      // 同帧生效（等效换位，零跳变）；fail/catch 清态自然滑回
      const r = await window.api.extensions.orderPinned(preview)
      if (!r.ok) {
        resetAll()
        return false
      }
      setSettling(true)
      onAppliedRef.current(preview)
      resetAll()
      window.setTimeout(() => {
        settleTimerRef.current = null
        setSettling(false)
      }, SETTLE_MS)
      return true
    } catch {
      resetAll()
      return false
    }
  }, [applyPreview, baseIds])

  const cancel = useCallback((): void => {
    if (settleTimerRef.current !== null) {
      window.clearTimeout(settleTimerRef.current)
      settleTimerRef.current = null
    }
    setReorderId(null)
    setDragOffsetX(0)
    applyPreview(null)
  }, [applyPreview])

  // 卸载清理（审查清单 20261113124504 低项）：settle 定时器悬挂会在卸载后触发
  // setSettling（React 18 起 no-op 无害但定时器悬挂），卸载时清除
  useEffect(() => {
    return () => {
      if (settleTimerRef.current !== null) {
        window.clearTimeout(settleTimerRef.current)
        settleTimerRef.current = null
      }
    }
  }, [])

  return {
    reorderId,
    slotOffsets,
    dragOffsetX,
    settling,
    begin,
    move,
    setDragOffsetX,
    commit,
    cancel,
    dragActiveRef
  }
}
