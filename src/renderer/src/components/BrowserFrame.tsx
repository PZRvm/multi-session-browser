import { useRef } from 'react'
import TabStrip from './browser/TabStrip'
import Toolbar from './browser/Toolbar'
import { useBrowserBounds } from './browser/useBrowserBounds'
import { useBrowserShortcuts } from './browser/useBrowserShortcuts'
import { useBrowserStore } from '../stores/browser'
import { useUiStore } from '../stores/ui'

// 内容区宿主：锚点存在期间持续上报矩形；切到零会话空态时本组件整体卸载，
// useBrowserBounds 随之走既有卸载清理上报零矩形，主进程收起原生视图。
// 挂在 BrowserFrame 内联而不进 browser/ 子目录：仅空态分支的挂载形态差异，
// 无独立复用价值。
function BrowserContent({ suspended }: { suspended: boolean }): React.JSX.Element {
  const contentRef = useRef<HTMLDivElement>(null)
  useBrowserBounds(contentRef, !suspended)
  return <div ref={contentRef} className="chrome-content" />
}

// 右侧浏览器框架：Tab 栏 + 工具栏 + 内容区三段组装；内容区由主进程 WebContentsView
// 按锚点矩形覆盖，shell 内不放页面可见内容；原生 DevTools 在该 WebContentsView
// 内部自行停靠和布局，renderer 不再创建第二套停靠占位。Chrome 框体（Tab 栏/工具栏）
// 常驻；零会话（快照 sessionId === null）时内容区改呈空态，锚点不挂载。
// 全局弹层（ui store 的 overlayDepth）打开时暂停上报，主进程按零矩形收起原生层，
// 弹层不被遮挡。
function BrowserFrame(): React.JSX.Element {
  const suspended = useUiStore((s) => s.overlayDepth > 0)
  const sessionId = useBrowserStore((s) => s.sessionId)
  useBrowserShortcuts()

  return (
    <section className="browser-frame">
      <TabStrip />
      <Toolbar />
      <div className="chrome-body">
        {sessionId === null ? (
          <div className="chrome-empty" role="status" aria-label="尚无会话">
            <p className="chrome-empty-title">尚无会话</p>
            <p className="chrome-empty-hint">在左侧新建或选择会话，开始隔离浏览</p>
          </div>
        ) : (
          <BrowserContent suspended={suspended} />
        )}
      </div>
    </section>
  )
}

export default BrowserFrame
