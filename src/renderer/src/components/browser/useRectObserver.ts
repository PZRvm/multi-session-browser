import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

/**
 * 矩形采集共享骨架（地址栏建议原生子窗口化专项修复轮抽出）：ResizeObserver 观察 +
 * rAF 合并节流（一帧内多次变化只回调一次），挂载即回调首帧；enabled 翻 false（或
 * 卸载）断开观察并取消在途 rAF。回调语义由调用方定义——useBrowserBounds 据此上报
 * 内容锚点 IPC，useOmniboxSuggestWindow 据此采集建议子窗锚点 setState。回调经
 * latest-ref 透传：观察连接只在 enabled 翻转时重建，回调身份变化不触发重连。
 */
export function useRectObserver(
  ref: RefObject<HTMLElement | null>,
  enabled: boolean,
  onRect: (rect: DOMRect) => void
): void {
  const onRectRef = useRef(onRect)
  useEffect(() => {
    onRectRef.current = onRect
  })
  useEffect(() => {
    if (!enabled) return
    const el = ref.current
    if (!el) return
    let rafId = 0
    const report = (): void => onRectRef.current(el.getBoundingClientRect())
    const schedule = (): void => {
      if (rafId !== 0) return
      rafId = window.requestAnimationFrame(() => {
        rafId = 0
        report()
      })
    }
    const observer = new ResizeObserver(schedule)
    observer.observe(el)
    schedule()
    return () => {
      if (rafId !== 0) window.cancelAnimationFrame(rafId)
      observer.disconnect()
    }
  }, [enabled, ref])
}
