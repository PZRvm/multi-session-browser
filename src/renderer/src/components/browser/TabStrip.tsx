import { CloseOutlined, LoadingOutlined, PlusOutlined } from '@ant-design/icons'
import { useBrowserStore } from '../../stores/browser'

// Tab 栏：渲染主进程推送的真实 tab 列表；store 初始为空（init 未 resolve 前）只显示新建按钮，
// 零会话（快照 sessionId === null）时新建按钮禁用（主进程命令守卫同拒「未选择会话」）
function TabStrip(): React.JSX.Element {
  const tabs = useBrowserStore((s) => s.tabs)
  const activeTabId = useBrowserStore((s) => s.activeTabId)
  const sessionId = useBrowserStore((s) => s.sessionId)
  const switchTab = useBrowserStore((s) => s.switchTab)
  const closeTab = useBrowserStore((s) => s.closeTab)
  const newTab = useBrowserStore((s) => s.newTab)

  // 最后留一：仅剩 1 个 tab 时关闭钮禁用（主进程同为 no-op，此处只管视觉与可点性）
  const lastOne = tabs.length <= 1

  return (
    <div className="chrome-tabs" role="tablist" aria-label="浏览器标签页">
      {tabs.map((tab) => {
        const title = tab.title || '新标签页'
        return (
          <div
            key={tab.id}
            role="tab"
            tabIndex={0}
            aria-selected={tab.id === activeTabId}
            title={title}
            className={`chrome-tab${tab.id === activeTabId ? ' active' : ''}`}
            onClick={() => switchTab(tab.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                switchTab(tab.id)
              }
            }}
          >
            {tab.loading ? (
              <LoadingOutlined spin className="chrome-tab-favicon" />
            ) : tab.faviconUrl ? (
              <img className="chrome-tab-favicon" src={tab.faviconUrl} alt="" />
            ) : (
              <span className="chrome-tab-favicon chrome-tab-favicon-dot" />
            )}
            <span className="chrome-tab-title">{title}</span>
            <button
              type="button"
              className="chrome-tab-close"
              aria-label={`关闭标签页：${title}`}
              disabled={lastOne}
              onClick={(e) => {
                e.stopPropagation()
                closeTab(tab.id)
              }}
              // 键盘激活（Enter/Space）不冒泡到父级 tab：父级 onKeyDown 会
              // preventDefault 吞掉按钮原生激活，导致键盘永远关不掉标签页
              onKeyDown={(e) => e.stopPropagation()}
            >
              <CloseOutlined />
            </button>
          </div>
        )
      })}
      <button
        type="button"
        className="chrome-newtab"
        aria-label="新建标签页"
        disabled={sessionId === null}
        onClick={() => newTab()}
      >
        <PlusOutlined />
      </button>
    </div>
  )
}

export default TabStrip
