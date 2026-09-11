import { useRef } from 'react'
import TabStrip from './browser/TabStrip'
import Toolbar from './browser/Toolbar'
import { useBrowserBounds } from './browser/useBrowserBounds'
import { useBrowserShortcuts } from './browser/useBrowserShortcuts'
import { useUiStore } from '../stores/ui'

// 右侧浏览器框架：Tab 栏 + 工具栏 + 内容区三段组装；内容区由主进程 WebContentsView
// 按锚点矩形覆盖，shell 内不放页面可见内容；原生 DevTools 在该 WebContentsView
// 内部自行停靠和布局，renderer 不再创建第二套停靠占位。全局弹层（ui store 的
// overlayDepth）打开时暂停上报，主进程按零矩形收起原生层，弹层不被遮挡。
function BrowserFrame(): React.JSX.Element {
  const contentRef = useRef<HTMLDivElement>(null)
  const suspended = useUiStore((s) => s.overlayDepth > 0)
  useBrowserBounds(contentRef, !suspended)
  useBrowserShortcuts()

  return (
    <section className="browser-frame">
      <TabStrip />
      <Toolbar />
      <div className="chrome-body">
        <div ref={contentRef} className="chrome-content" />
      </div>
    </section>
  )
}

export default BrowserFrame
