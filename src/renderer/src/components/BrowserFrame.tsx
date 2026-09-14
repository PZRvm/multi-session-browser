import TabStrip from './browser/TabStrip'
import Toolbar from './browser/Toolbar'
import FindBar from './browser/FindBar'
import BrowserContentAnchor from './browser/BrowserContentAnchor'
import { useBrowserShortcuts } from './browser/useBrowserShortcuts'
import { useBrowserStore } from '../stores/browser'
import { useUiStore } from '../stores/ui'

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
          <>
            {/* 查找栏停靠在锚点上方：挂载即压缩锚点，bounds 重报让位原生层（零新增布局机制） */}
            <FindBar />
            <BrowserContentAnchor suspended={suspended} />
          </>
        )}
      </div>
    </section>
  )
}

export default BrowserFrame
