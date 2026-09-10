import { useRef } from 'react'
import TabStrip from './browser/TabStrip'
import Toolbar from './browser/Toolbar'
import { useBrowserBounds } from './browser/useBrowserBounds'
import { useBrowserShortcuts } from './browser/useBrowserShortcuts'

// 右侧浏览器框架：Tab 栏 + 工具栏 + 内容锚点三段组装；
// 内容区由主进程 WebContentsView 按锚点矩形覆盖，shell 内不放任何可见内容
function BrowserFrame(): React.JSX.Element {
  const contentRef = useRef<HTMLDivElement>(null)
  useBrowserBounds(contentRef)
  useBrowserShortcuts()

  return (
    <section className="browser-frame">
      <TabStrip />
      <Toolbar />
      <div ref={contentRef} className="chrome-content" />
    </section>
  )
}

export default BrowserFrame
