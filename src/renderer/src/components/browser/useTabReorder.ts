import { useCallback, useMemo, useRef, useState } from 'react'
import type { BrowserTabState } from '../../../../shared/browser'
import { useBrowserStore } from '../../stores/browser'

/** 重排编排器类型（TabItem 手势层消费）：begin/move/commit 等见 useTabReorder 返回值 */
export type TabReorderApi = ReturnType<typeof useTabReorder>

/**
 * Tab 栏内拖拽重排手势 hook（tab栏分隔线与栏内拖动排序专项，2026-09-18）：与
 * useSessionDragReorder 对称的本地瞬态编排——预览序（拖拽中 Tab 的实时换位）、
 * 中点换位判定（与跨窗悬停插入指示器同源算法）、提交（一次完整全序 reorderTabs，
 * 无位移短路零 IPC）、失败回滚（快照未变即自然回滚，failed 回调作视觉反馈）。
 * 事实源约束：tabs 顺序唯一事实源 = 主进程 tabs Map 迭代序，本 hook 只持本地预览，
 * 提交即全序覆盖。入参恒为该窗作用域全量 tabs（快照镜像）。预览仅持 id 序，渲染
 * 数据实时派生自最新 tabs——拖拽期间的快照推送（loading/favicon 变化）照常反映，
 * 不因预览停格（review 20260918144549 低-1）。提交失败（整单拒绝/IPC 失败，仅
 * 竞态可达）无显式用户反馈为设计定案：预览清空即回滚原位、顺序未变即用户可感知
 * 结果，Chrome 同款；不为低概率路径引入反馈层（review 20260918144549 低-2）。
 *
 * 跟手位移契约：dragOffsetX 由手势层写入渲染（内联 translateX）；move 返回 true
 * （发生换位）时手势层必须重置偏移基准（setDragOffsetX(0) 并更新自身基准点）——
 * 换位后 DOM 位置已变，跨换位累积偏移会叠加错位；吸附新槽再继续跟手。
 *
 * 升级 tear-off 契约（重排 → 拖出）：拖动中光标离开 Tab 栏矩形时先 commitIfMoved()
 * 提交已发生位移（保证主进程序与新窗 tear-off 起点一致），再由调用方走既有
 * dragStart 链路；提交的快照推送与 dragStart 的会话开启顺序由调用方保证（先 await
 * 提交再上报拖出）。反向不降级：tear-off 拖拽中拖回栏上仍走既有释放语义。
 */
export function useTabReorder(tabs: BrowserTabState[]): {
  /** 拖拽中的 Tab id（null = 无重排进行）；渲染层据此加 .reordering 与内联位移 */
  reorderTabId: string | null
  /** 拖拽中的本地预览序（预览 id 序映射**最新 tabs** 的元素数据；null = 无重排） */
  previewTabs: BrowserTabState[] | null
  /** 开始重排（指针手势过阈值且判定为栏内重排时调用） */
  begin: (tabId: string) => void
  /** 拖动中更新：按光标 clientX 对当前预览序各 Tab 中点判定换位，返回是否发生位移 */
  move: (tabId: string, clientX: number) => boolean
  /** 跟手位移（按下点起算的水平偏移，渲染层写内联 translateX） */
  dragOffsetX: number
  setDragOffsetX: (x: number) => void
  /** 栏内释放：提交当前预览序（无位移短路零 IPC）；返回是否有位移提交发生 */
  commit: () => Promise<boolean>
  /** 升级 tear-off 前的位移提交（语义同 commit，供拖离栏矩形时调用） */
  commitIfMoved: () => Promise<boolean>
  /** 取消（Esc / pointercancel）：清预览序零 IPC，放回原位 */
  cancel: () => void
} {
  const [reorderTabId, setReorderTabId] = useState<string | null>(null)
  const [dragOffsetX, setDragOffsetX] = useState(0)
  // 预览仅持 id 序（ref 供 move 高频判定免渲染，state 驱动渲染），元素数据由
  // previewTabs 从最新 tabs 派生——快照推送更新字段时拖拽预览照常反映
  const previewRef = useRef<string[] | null>(null)
  const [previewIds, setPreviewIds] = useState<string[] | null>(null)
  const applyPreview = useCallback((next: string[] | null) => {
    previewRef.current = next
    setPreviewIds(next)
  }, [])
  const previewTabs = useMemo<BrowserTabState[] | null>(() => {
    if (previewIds === null) return null
    const byId = new Map(tabs.map((t) => [t.id, t] as const))
    // id 在最新快照已不存在（拖拽中该 Tab 被关等竞态）：跳过渲染，提交时全序校验
    // 不一致整单拒绝自然回滚
    return previewIds.map((id) => byId.get(id)).filter((t): t is BrowserTabState => t !== undefined)
  }, [previewIds, tabs])

  const begin = useCallback(
    (tabId: string) => {
      setReorderTabId(tabId)
      setDragOffsetX(0)
      applyPreview(null)
    },
    [applyPreview]
  )

  const move = useCallback(
    (tabId: string, clientX: number): boolean => {
      const base = previewRef.current ?? tabs.map((t) => t.id)
      const from = base.indexOf(tabId)
      if (from === -1) return false
      // 中点判定与跨窗悬停插入指示器（TabStrip 指示器 effect）同源：光标越过相邻
      // Tab 中点即换位——彼为全量 index 定位（一次可跳多位），此处为相邻单步
      // （一次 move 至多一位，快速甩动由连续 move 收敛，与光标实时性对齐）
      let to = from
      if (from > 0) {
        const el = document.querySelector<HTMLElement>(`[data-tab-id="${base[from - 1]}"]`)
        if (el && clientX < el.getBoundingClientRect().left + el.offsetWidth / 2) to = from - 1
      }
      if (to === from && from < base.length - 1) {
        const el = document.querySelector<HTMLElement>(`[data-tab-id="${base[from + 1]}"]`)
        if (el && clientX > el.getBoundingClientRect().left + el.offsetWidth / 2) to = from + 1
      }
      if (to === from) return false
      const next = [...base]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      applyPreview(next)
      return true
    },
    [tabs, applyPreview]
  )

  const commit = useCallback(async (): Promise<boolean> => {
    const preview = previewRef.current
    const id = reorderTabId
    setReorderTabId(null)
    setDragOffsetX(0)
    applyPreview(null)
    if (!preview || id === null) return false
    const nextIds = preview
    const originalIds = tabs.map((t) => t.id)
    // 无位移/拖回原位：与原序相同即短路零 IPC（对齐会话重排先例）
    if (originalIds.join('\u0000') === nextIds.join('\u0000')) return false
    try {
      // await 到快照回达：升级 tear-off 路径保证「主进程已应用重排」后 dragStart 才
      // 上报（commitIfMoved 的 settle 即此语义）；renderer↔main IPC 本就按序处理，
      // await 把依赖显式化不依赖隐式排队
      await useBrowserStore.getState().reorderTabs(nextIds)
      return true
    } catch {
      // 快照未动（IPC 失败或整单拒绝，仅竞态可达）：预览已清即回滚原位，无显式
      // 反馈为设计定案（见头注），store 层另有 console 留痕
      return false
    }
  }, [reorderTabId, tabs, applyPreview])

  const commitIfMoved = useCallback((): Promise<boolean> => commit(), [commit])

  const cancel = useCallback(() => {
    setReorderTabId(null)
    setDragOffsetX(0)
    applyPreview(null)
  }, [applyPreview])

  return {
    reorderTabId,
    previewTabs,
    begin,
    move,
    dragOffsetX,
    setDragOffsetX,
    commit,
    commitIfMoved,
    cancel
  }
}
