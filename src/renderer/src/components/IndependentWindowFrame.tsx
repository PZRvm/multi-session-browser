import TabStrip from './browser/TabStrip'
import Toolbar from './browser/Toolbar'
import FindBar from './browser/FindBar'
import BrowserContentAnchor from './browser/BrowserContentAnchor'
import { useBrowserShortcuts } from './browser/useBrowserShortcuts'
import { useUiStore } from '../stores/ui'

// 独立窗口框架：与主窗口 BrowserFrame 同构的三段（Tab 栏 + 工具栏 + 内容区），无左栏
// 与分隔条；会话由主进程建窗时经 query 固定绑定，不存在零会话空态——内容锚点常驻，
// 空 Tab 期（init 未 resolve 或 0-Tab 瞬态）如实呈空白壳，浏览器区壳不消失。
// TabStrip/Toolbar 与快捷键（F12/ESC）原样复用、随本窗生效；快照守卫按 windowId
// 分流（stores/browser.ts），命令作用域由主进程按 sender 路由，本组件不做窗口特判。
// 全局弹层（ui store overlayDepth，Tab 右键菜单等）打开时同样暂停上报收起原生层。
function IndependentWindowFrame(): React.JSX.Element {
  const suspended = useUiStore((s) => s.overlayDepth > 0)
  useBrowserShortcuts()

  return (
    <section className="browser-frame">
      <TabStrip />
      <Toolbar />
      <div className="chrome-body">
        {/* 查找栏停靠在锚点上方：挂载即压缩锚点，bounds 重报让位原生层（零新增布局机制） */}
        <FindBar />
        <BrowserContentAnchor suspended={suspended} />
      </div>
    </section>
  )
}

export default IndependentWindowFrame
