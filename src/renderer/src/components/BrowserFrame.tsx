import TabStrip from './browser/TabStrip'
import Toolbar from './browser/Toolbar'
import FindBar from './browser/FindBar'
import BrowserContentAnchor from './browser/BrowserContentAnchor'
import { useBrowserShortcuts } from './browser/useBrowserShortcuts'
import { useBrowserStore } from '../stores/browser'
import { useUiStore } from '../stores/ui'
import { useT } from '../i18n'

// 右侧浏览器框架：Tab 栏 + 工具栏 + 内容区三段组装；内容区由主进程 WebContentsView
// 按锚点矩形覆盖，shell 内不放页面可见内容；原生 DevTools 在该 WebContentsView
// 内部自行停靠和布局，renderer 不再创建第二套停靠占位。Chrome 框体（Tab 栏/工具栏）
// 常驻；零会话（快照 sessionId === null）时内容区改呈空态，锚点不挂载。
// HTML 全屏（视频全屏等）期间壳层整体不渲染（Chrome 对齐）：三段均 flex 自然占位，
// 锚点随即扩满窗口、bounds 沿既有上报链路跟随，退出后随快照回落复原；锚点永不
// 卸载（卸载即上报零矩形收起原生层）。
// 全局弹层（ui store 的 overlayDepth）打开时暂停上报，主进程按零矩形收起原生层，
// 弹层不被遮挡。
function BrowserFrame(): React.JSX.Element {
  const t = useT()
  const suspended = useUiStore((s) => s.overlayDepth > 0)
  const sessionId = useBrowserStore((s) => s.sessionId)
  const htmlFullscreen = useBrowserStore((s) => s.htmlFullscreen)
  useBrowserShortcuts()

  return (
    <section className="browser-frame">
      {!htmlFullscreen && <TabStrip />}
      {!htmlFullscreen && <Toolbar />}
      <div className="chrome-body">
        {sessionId === null ? (
          <div className="chrome-empty" role="status" aria-label={t('browser.frame.noSession')}>
            <p className="chrome-empty-title">{t('browser.frame.noSession')}</p>
            <p className="chrome-empty-hint">{t('browser.frame.noSessionHint')}</p>
          </div>
        ) : (
          <>
            {/* 查找栏停靠在锚点上方：挂载即压缩锚点，bounds 重报让位原生层（零新增布局机制）；
                HTML 全屏期间不可达（PRD 3.7.3），全屏态不渲染兜底。截图反馈条随反馈轮
                三迁原生子窗悬浮（盖在网页上方、内容区零压缩），不再挂载壳内 */}
            {!htmlFullscreen && <FindBar />}
            <BrowserContentAnchor suspended={suspended} />
          </>
        )}
      </div>
    </section>
  )
}

export default BrowserFrame
