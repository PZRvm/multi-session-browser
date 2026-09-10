import { useEffect } from 'react'
import type { RefObject } from 'react'

const ZERO_RECT = { x: 0, y: 0, width: 0, height: 0 }

/**
 * 内容锚点矩形采集：ResizeObserver 观察锚点，rAF 合并节流后上报主进程
 * （一帧内多次变化只发一次 IPC，覆盖窗口缩放与左栏分隔条拖动）；挂载即上报首帧。
 * 卸载时上报零矩形并断开观察，防止视图残留旧矩形形成错位。
 */
export function useBrowserBounds(ref: RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const el = ref.current
    if (!el) return

    let rafId = 0

    // 视口坐标即窗口内容坐标（DIP 与 CSS px 同值）；布局上报为尽力而为的
    // fire-and-forget 调用，失败静默，不阻塞渲染
    const report = (): void => {
      const rect = el.getBoundingClientRect()
      window.api.browser
        .setBounds({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })
        .catch(() => {})
    }

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
      window.api.browser.setBounds(ZERO_RECT).catch(() => {})
    }
  }, [ref])
}
