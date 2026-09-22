import { useCallback, useEffect, useRef } from 'react'

/** 菜单关闭动画的经验时长（单源本处，调用方不感知） */
const MENU_CLOSE_DEFER_MS = 300

/**
 * 菜单收起动画期间挂窗口模态弹层的延迟动作（2026-09-21 反馈轮：重命名 sheet /
 * 原生确认框挂出即窗口模态，主窗被系统遮挡会冻结 rc-motion 关闭动画——end 回调
 * 永不触发致菜单永久卡显，CDP 实证——先让菜单动画走完再挂弹层）。
 * 卸载清理：宿主卸载时取消未触发的延迟动作（旧行为「已确认动作跨卸载仍执行」
 * 随之收敛为「宿主存活才执行」）。同一宿主内连发后发优先：前一个未触发的动作
 * 被取消。
 */
export function useDeferredMenuAction(): (action: () => void) => void {
  const timerRef = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    },
    []
  )
  return useCallback((action: () => void) => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      action()
    }, MENU_CLOSE_DEFER_MS)
  }, [])
}
