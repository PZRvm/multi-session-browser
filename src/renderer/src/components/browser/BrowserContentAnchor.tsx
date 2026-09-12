import { useRef } from 'react'
import { useBrowserBounds } from './useBrowserBounds'

// 内容锚点：锚点存在期间持续上报矩形（ResizeObserver + rAF 节流，见 useBrowserBounds），
// 主进程 WebContentsView 按该矩形覆盖，shell 内不放页面可见内容；suspended（全局弹层
// 悬挂，ui store overlayDepth > 0）时上报零矩形收起原生层防遮挡。
// 主窗口（BrowserFrame）与独立窗口（IndependentWindowFrame）共用同一锚点（L2 定案抽取）。
function BrowserContentAnchor({ suspended }: { suspended: boolean }): React.JSX.Element {
  const contentRef = useRef<HTMLDivElement>(null)
  useBrowserBounds(contentRef, !suspended)
  return <div ref={contentRef} className="chrome-content" />
}

export default BrowserContentAnchor
