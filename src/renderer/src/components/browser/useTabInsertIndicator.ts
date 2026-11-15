import { useEffect } from 'react'
import type { RefObject } from 'react'
import { useBrowserStore, windowIdentity } from '../../stores/browser'

/** 跨窗口拖拽的插入指示器：直订阅悬停瞬态，避免16ms推送触发React重渲染。 */
export function useTabInsertIndicator(
  listElRef: RefObject<HTMLDivElement | null>,
  insertElRef: RefObject<HTMLDivElement | null>
): void {
  useEffect(() => {
    // 插入位测量基准 = Tab 序列裁切层（低-3 修复结构下沉：Tab 的直系父级由本栏改为此
    // 层，':scope > .chrome-tab' 随之；层无 padding/margin，barX 与原值同位）
    const container = listElRef.current
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
  }, [listElRef, insertElRef])
}
