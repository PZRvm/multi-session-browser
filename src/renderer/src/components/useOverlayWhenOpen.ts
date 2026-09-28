import { useEffect } from 'react'
import { useUiStore } from '../stores/ui'

/**
 * 跨入右区原生层的弹层登记（ui.ts 约束「跨入右区的弹层必须登记」）：open 为真期间
 * 登记 overlay 收起页面视图，使弹层不被页面遮挡；关闭/卸载（cleanup 兜底）必然释放。
 * 收起态会话名/新建钮 popover 与既有菜单登记（ctx/dots）共用同一 overlay 计数。
 */
export function useOverlayWhenOpen(open: boolean): void {
  const openOverlay = useUiStore((s) => s.openOverlay)
  const closeOverlay = useUiStore((s) => s.closeOverlay)
  useEffect(() => {
    if (!open) return
    openOverlay()
    return () => closeOverlay()
  }, [open, openOverlay, closeOverlay])
}
