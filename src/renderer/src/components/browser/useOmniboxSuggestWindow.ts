import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { useRectObserver } from './useRectObserver'
import type {
  OmniboxSuggestAnchorPayload,
  OmniboxSuggestItemPayload
} from '../../../../shared/omniboxSuggest'

/**
 * 地址栏建议原生子窗编排 hook（原生子窗口化专项；审查修复轮自 Toolbar 抽出，回归
 * 组件编排薄层职责——与 useBrowserBounds / useSessionDragReorder 抽取先例同构）。
 * 替代旧 overlayDepth 整页收起路线：面板打开期间页面保持可见、快捷键不再冻结。
 * ①锚点采集——开面板期间 ResizeObserver 观察 omnibox host 矩形（rAF 合并；宿主窗口
 *   move/resize 的跟随由主进程以缓存锚点独立完成，无需本侧参与）；
 * ②数据推送——panelOpen 期间任一状态变化（锚点/条目/高亮位/查询）即 show 幂等全量
 *   重发（无 cleanup，杜绝逐键 hide/show 闪烁）；
 * ③收合——panelOpen 翻 false 或卸载时 hide（hide 唯一驱动源是本状态机）；
 * ④子窗鼠标转发消费——悬停 → onHover、点选 → onPick（回调经 latest-ref 透传防陈旧
 *   捕获，订阅随首挂常驻）；
 * ⑤融合态回执（2026-10-28 融合契约）——show 的返回 canPresent 以请求代号核对后
 *   消费为 presented（面板实际呈现态，调用方据此加持/收回输入框融合态 class）：
 *   更晚的 show 已发出或面板已收时，旧回执一律丢弃——不复活已关闭的面板、不把
 *   空间不足的裁定回写到已切走的作用域。
 * 检索计算仍在调用方本地完成（编辑期零 IPC 不变），本 hook 只做展示数据编排。
 * 返回 presented：面板当前按主进程裁定实际呈现中（true = 融合态）。
 */
export function useOmniboxSuggestWindow(options: {
  /** omnibox host 元素 ref（面板锚定其正下方等宽） */
  hostRef: RefObject<HTMLDivElement | null>
  panelOpen: boolean
  items: OmniboxSuggestItemPayload[]
  query: string
  activeIndex: number
  onHover: (index: number) => void
  onPick: (url: string) => void
}): boolean {
  const { hostRef, panelOpen, items, query, activeIndex, onHover, onPick } = options
  const [hostAnchor, setHostAnchor] = useState<OmniboxSuggestAnchorPayload | null>(null)
  // 面板实际呈现态（主进程 canPresent 裁定的镜像）；show 回执请求代号——每发一次
  // show 自增，回执到达时代号已过期即作废
  const [presented, setPresented] = useState(false)
  const showSeq = useRef(0)

  // panelOpen 翻 false 即拍收回融合态（渲染期状态调整，无 effect 二段帧）；重开面板
  // 从未融合起步，待新回执确认后再融合——上一开合期的旧确认不跨期存续
  const [prevPanelOpen, setPrevPanelOpen] = useState(panelOpen)
  if (prevPanelOpen !== panelOpen) {
    setPrevPanelOpen(panelOpen)
    if (!panelOpen) setPresented(false)
  }

  useRectObserver(hostRef, panelOpen, (rect) => {
    setHostAnchor({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })
  })

  useEffect(() => {
    if (!panelOpen || hostAnchor === null) return
    const seq = ++showSeq.current
    void window.api.omniboxSuggest
      .show({
        anchor: hostAnchor,
        items,
        query,
        activeIndex
      })
      .then((result) => {
        // 旧回执不消费：期间已有更晚的 show 发出、或面板已收（作用域漂移清 draft、
        // Esc、失焦等），按当前有效请求的裁定为准
        if (showSeq.current !== seq || !result.ok) return
        setPresented(result.canPresent)
      })
      .catch(() => {})
  }, [panelOpen, hostAnchor, items, query, activeIndex])

  // 面板收起：令在途回执过期（防晚到的 true 复活已关闭面板）；融合态已在渲染期收回
  useEffect(() => {
    if (panelOpen) return
    showSeq.current++
  }, [panelOpen])

  useEffect(() => {
    if (!panelOpen) return
    return () => {
      void window.api.omniboxSuggest.hide().catch(() => {})
    }
  }, [panelOpen])

  // 子窗鼠标事件转发消费（订阅随首挂常驻；onHover/onPick 每渲染经 latest-ref 透传
  // 最新闭包——onPick 闭包含 pending 基线（当前 Tab/URL），防陈旧捕获）
  const onHoverRef = useRef(onHover)
  const onPickRef = useRef(onPick)
  useEffect(() => {
    onHoverRef.current = onHover
    onPickRef.current = onPick
  })
  useEffect(() => {
    const offHovered = window.api.omniboxSuggest.onHovered(({ index }) => onHoverRef.current(index))
    const offPicked = window.api.omniboxSuggest.onPicked(({ url }) => onPickRef.current(url))
    return () => {
      offHovered()
      offPicked()
    }
  }, [])

  // 呈现确认只在面板开期间有效（panelOpen 门控兜底——即便极端时序下晚到回执写了
  // presented，收起期恒 false）
  return panelOpen && presented
}
