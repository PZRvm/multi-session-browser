import { useEffect, useRef, useState } from 'react'
import OmniboxSuggestPanel from './OmniboxSuggestPanel'
import { SUGGEST_SHADOW_MARGIN } from '../../../../shared/omniboxSuggest'
import type { OmniboxSuggestDataPayload } from '../../../../shared/omniboxSuggest'

// 建议子窗渲染端（原生子窗口化专项）：纯展示零自治——宿主 shell 经 show 命令全量
// 推送面板数据（items/query/activeIndex），本组件渲染最新一帧；hover/pick 经 invoke
// 上报，主进程转发回宿主 shell 键盘状态机（选中状态机唯一在 shell）。
// 就绪时序（审查中 1 修复）：data 订阅在模块求值期同步建立——先于首帧 paint 与主
// 进程 ready-to-show 后的数据推送，从结构上消除「推送先于订阅」的竞态窗口；推送到达
// 早于 React 挂载时暂存 latest，挂载即取初值。视觉复用 .chrome-omnibox-suggest 语系，
// 满窗定位由 app.css 的 body[data-role] 作用域承担（窗口边界即面板边界，高度由主进程
// 按行数确定性计算）；主题随 nativeTheme themeSource 驱动的 prefers-color-scheme
// 自动亮暗，无需订阅 appearance。

let latest: OmniboxSuggestDataPayload | null = null
const listeners = new Set<(payload: OmniboxSuggestDataPayload) => void>()

const unsubscribeData = window.api.omniboxSuggest.onData((payload) => {
  latest = payload
  for (const notify of listeners) notify(payload)
})

// HMR 热更新该模块时退订并清空监听集，防旧模块实例的订阅残留在 ipcRenderer 上
// （审查修复轮复审低 1；比照 appearance store 的 import.meta.hot dispose 先例）
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    unsubscribeData()
    listeners.clear()
  })
}

function subscribe(notify: (payload: OmniboxSuggestDataPayload) => void): () => void {
  listeners.add(notify)
  return () => {
    listeners.delete(notify)
  }
}

export default function OmniboxSuggestWindow(): React.JSX.Element | null {
  // 初值取模块级暂存：推送可能早于组件挂载到达（ready-to-show 先 flush 再显窗）
  const [data, setData] = useState<OmniboxSuggestDataPayload | null>(latest)

  useEffect(() => subscribe(setData), [])

  // 阴影边距环带鼠标穿通（2026-10-28 阴影专项）：光标落在边距环带（纯阴影像素，
  // 无可交互内容）时整窗 setIgnoreMouseEvents(forward)——环带点击穿透回工具栏按钮/
  // 页面；forward 使忽略态下 mousemove 仍达本页，光标回到面板实域即切回接收态。
  // 主进程侧按宿主复显兜底重置，本侧以声明式状态差异发送（去重）
  const passthroughRef = useRef(false)
  useEffect(() => {
    const onMouseMove = (e: MouseEvent): void => {
      const m = SUGGEST_SHADOW_MARGIN
      const inMargin =
        e.clientX < m || e.clientX > window.innerWidth - m || e.clientY > window.innerHeight - m
      if (inMargin !== passthroughRef.current) {
        passthroughRef.current = inMargin
        void window.api.omniboxSuggest.setMousePassthrough(inMargin).catch(() => {})
      }
    }
    window.addEventListener('mousemove', onMouseMove)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      // 卸载（子窗隐藏/销毁）复位接收态，防隐藏期停在忽略态影响复显
      if (passthroughRef.current) {
        passthroughRef.current = false
        void window.api.omniboxSuggest.setMousePassthrough(false).catch(() => {})
      }
    }
  }, [])

  // 子窗显窗前必有数据推送（ready-to-show 先 flush 再 showInactive），空态仅为防御
  if (!data) return null

  return (
    <OmniboxSuggestPanel
      items={data.items.map((entry) => ({ entry }))}
      activeIndex={data.activeIndex}
      query={data.query}
      onHover={(index) => {
        void window.api.omniboxSuggest.hover({ index }).catch(() => {})
      }}
      onPick={(url) => {
        void window.api.omniboxSuggest.pick({ url }).catch(() => {})
      }}
    />
  )
}
