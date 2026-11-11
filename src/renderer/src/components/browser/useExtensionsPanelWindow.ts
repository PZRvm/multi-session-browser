import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

/**
 * 扩展面板原生子窗口编排 hook（原生子窗口化，白屏根除专项；建议子窗 hook 同构，
 * 开合驱动源是本 hook 的 open state 而非地址栏编辑态）：
 * ①开面板：onButtonClick 翻 open → 现读按钮 rect 全量锚点 → extensions.list 现取
 *   → show 幂等全量（canPresent=false 时收回开合态不展示）；
 * ②收合：open 翻 false 即 hide；主进程 blur 关闭/销毁经 closed 推送收回开合态；
 * ③pick 消费（三语义状态机唯一在本 shell）：open → extensions.openPopup（复用开面板
 *   时捕获的锚点）→ 收面板；manage → extensions.manage 深链设置窗 → 收面板；
 *   close → 仅收面板；
 * ④mousedown-toggle 竞态处理（Chrome 菜单语义）：面板开着时点击拼图按钮，mousedown
 *   先使面板失焦关闭（blur → closed 推送 → open 翻 false），随后到达的 click 若按
 *   当前态 toggle 会立即重开——onButtonMouseDown 捕获「按下时面板是否已开」快照，
 *   该次点击只关不开。
 * 页面保持可见可交互（overlayDepth 不再登记，原生层零触碰）。
 * 返回 presented：面板当前实际呈现态（aria-expanded 用）。
 */
export function useExtensionsPanelWindow(hostRef: RefObject<HTMLButtonElement | null>): {
  presented: boolean
  onButtonMouseDown: () => void
  onButtonClick: () => void
} {
  const [open, setOpen] = useState(false)
  // 面板实际呈现态（主进程 canPresent 裁定的镜像）
  const [presented, setPresented] = useState(false)
  const openRef = useRef(open)
  // 最新开合态镜像供 mousedown 快照读取（commit 后更新；事件回调读，不涉渲染期访问）
  useEffect(() => {
    openRef.current = open
  })
  /** 开面板时捕获的按钮锚点（pick open 语义给 extensions.openPopup 复用） */
  const anchorRef = useRef<{ x: number; y: number } | null>(null)

  // open 翻 false 即渲染期拍收回呈现态（无 effect 二段帧；建议子窗 hook 同款先例）
  const [prevOpen, setPrevOpen] = useState(open)
  if (prevOpen !== open) {
    setPrevOpen(open)
    if (!open) setPresented(false)
  }

  // 开面板：现读按钮 rect（打开瞬时的视口坐标）→ list 现取 → show 全量
  useEffect(() => {
    if (!open) return
    let alive = true
    const rect = hostRef.current?.getBoundingClientRect()
    if (!rect) {
      setOpen(false)
      return
    }
    anchorRef.current = { x: Math.round(rect.left), y: Math.round(rect.top) }
    void window.api.extensions
      .list()
      .then((items) => {
        if (!alive || !openRef.current) return
        return window.api.extensionsPanel.show({
          anchor: {
            x: Math.round(rect.left),
            y: Math.round(rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          },
          items
        })
      })
      .then((result) => {
        if (!alive) return
        // 主进程裁定不可呈现（工作区下方空间不足）：收回开合态不展示
        if (!result || !result.ok || !result.canPresent) {
          setOpen(false)
          return
        }
        setPresented(true)
      })
      .catch(() => {
        if (alive) setOpen(false)
      })
    return () => {
      alive = false
    }
  }, [open, hostRef])

  // 收面板：open 翻 false 即 hide（closed 推送驱动的关闭也经 setOpen 汇入本 effect）
  useEffect(() => {
    if (!open) void window.api.extensionsPanel.hide().catch(() => {})
  }, [open])

  // pick 转发消费（订阅随首挂常驻；三语义无最新闭包依赖，锚点经 anchorRef 透传）
  useEffect(() => {
    const offPicked = window.api.extensionsPanel.onPicked((payload) => {
      if (payload.kind === 'open' && payload.id) {
        const anchor = anchorRef.current ?? { x: 0, y: 0 }
        void window.api.extensions.openPopup(payload.id, anchor).catch(() => undefined)
      } else if (payload.kind === 'manage') {
        void window.api.extensions.manage().catch(() => undefined)
      }
      setOpen(false)
    })
    const offClosed = window.api.extensionsPanel.onClosed(() => {
      setOpen(false)
    })
    return () => {
      offPicked()
      offClosed()
    }
  }, [])

  // mousedown-toggle：捕获「按下时面板是否已开」——面板开着时 mousedown 先触发
  // blur 关闭（open 已翻 false），随后 click 按快照跳过重开（只关不开）
  const wasOpenRef = useRef(false)
  const onButtonMouseDown = (): void => {
    wasOpenRef.current = openRef.current
  }
  const onButtonClick = (): void => {
    if (wasOpenRef.current) {
      wasOpenRef.current = false
      return
    }
    setOpen(true)
  }

  return { presented, onButtonMouseDown, onButtonClick }
}
