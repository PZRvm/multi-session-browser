import { useEffect } from 'react'
import type { RefObject } from 'react'
import { useRectObserver } from './useRectObserver'

const ZERO_RECT = { x: 0, y: 0, width: 0, height: 0 }

/**
 * 内容锚点矩形采集：ResizeObserver 观察锚点，rAF 合并节流后上报主进程
 * （一帧内多次变化只发一次 IPC，覆盖窗口缩放与左栏分隔条拖动）；挂载即上报首帧。
 * 卸载或暂停时上报零矩形并断开观察，防止视图残留旧矩形形成错位或遮挡 renderer 弹层。
 * 采集骨架共享自 useRectObserver（审查修复轮抽出）。
 */
export function useBrowserBounds(ref: RefObject<HTMLDivElement | null>, enabled = true): void {
  // 暂停（全局弹层悬挂）或卸载：上报零矩形收起原生层（enabled 翻转与卸载各一次，幂等）
  useEffect(() => {
    if (!enabled) {
      window.api.browser.setBounds(ZERO_RECT).catch(() => {})
    }
    return () => {
      window.api.browser.setBounds(ZERO_RECT).catch(() => {})
    }
  }, [enabled])
  // 视口坐标即窗口内容坐标（DIP 与 CSS px 同值）；布局上报为尽力而为的
  // fire-and-forget 调用，失败静默，不阻塞渲染
  useRectObserver(ref, enabled, (rect) => {
    window.api.browser
      .setBounds({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })
      .catch(() => {})
  })
}
