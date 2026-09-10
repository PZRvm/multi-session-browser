import { useEffect } from 'react'
import type { RefObject } from 'react'

const ZERO_RECT = { x: 0, y: 0, width: 0, height: 0 }

/**
 * DevTools 停靠锚点矩形采集：与 useBrowserBounds 同一模式（ResizeObserver 观察 +
 * rAF 合并节流 + 挂载即上报首帧 + 卸载零矩形并断开），上报走 setDevToolsBounds 通道。
 * 卸载即收起：锚点随 devtoolsOpen 条件挂载，关闭时卸载并上报零矩形，防止 DevTools
 * view 残留旧矩形形成错位。停靠高度固定（未拖拽为 40%、拖拽后为像素值），窗口纵向
 * 缩放只平移锚点不改变其尺寸，故同时观察父容器，父容器尺寸变化即重报当前矩形。
 */
export function useDevToolsBounds(ref: RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const el = ref.current
    if (!el) return

    let rafId = 0

    // 视口坐标即窗口内容坐标（DIP 与 CSS px 同值）；布局上报为尽力而为的
    // fire-and-forget 调用，失败静默，不阻塞渲染
    const report = (): void => {
      const rect = el.getBoundingClientRect()
      window.api.browser
        .setDevToolsBounds({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })
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
    const parent = el.parentElement
    if (parent) observer.observe(parent)
    schedule()

    return () => {
      if (rafId !== 0) window.cancelAnimationFrame(rafId)
      observer.disconnect()
      window.api.browser.setDevToolsBounds(ZERO_RECT).catch(() => {})
    }
  }, [ref])
}
