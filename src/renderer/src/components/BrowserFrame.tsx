import { Tooltip } from 'antd'
import {
  HomeOutlined,
  LeftOutlined,
  PlusOutlined,
  ReloadOutlined,
  RightOutlined
} from '@ant-design/icons'
import { useSessionsStore } from '../stores/sessions'

const phase2Tip = '浏览器引擎将在阶段 2 接入'

function BrowserFrame(): React.JSX.Element {
  const sessions = useSessionsStore((s) => s.sessions)
  const activeId = useSessionsStore((s) => s.activeId)
  const activeIndex = sessions.findIndex((s) => s.id === activeId)
  const active = activeIndex >= 0 ? sessions[activeIndex] : null

  return (
    <section className="browser-frame">
      <div className="chrome-tabs">
        <div className="chrome-tab active">
          <span className="chrome-tab-title">新标签页</span>
        </div>
        <Tooltip title={phase2Tip} mouseEnterDelay={0.4}>
          <button type="button" className="chrome-newtab" aria-label="新建标签页" disabled>
            <PlusOutlined />
          </button>
        </Tooltip>
      </div>
      <div className="chrome-toolbar">
        <div className="chrome-nav">
          <Tooltip title={phase2Tip} mouseEnterDelay={0.4}>
            <button type="button" aria-label="后退" disabled>
              <LeftOutlined />
            </button>
          </Tooltip>
          <Tooltip title={phase2Tip} mouseEnterDelay={0.4}>
            <button type="button" aria-label="前进" disabled>
              <RightOutlined />
            </button>
          </Tooltip>
          <Tooltip title={phase2Tip} mouseEnterDelay={0.4}>
            <button type="button" aria-label="刷新" disabled>
              <ReloadOutlined />
            </button>
          </Tooltip>
          <Tooltip title={phase2Tip} mouseEnterDelay={0.4}>
            <button type="button" aria-label="主页" disabled>
              <HomeOutlined />
            </button>
          </Tooltip>
        </div>
        <div className="chrome-omnibox">会话浏览器引擎 · 阶段 2 接入</div>
        <span className="chrome-devtools-hint">F12 开发者工具</span>
      </div>
      <div className="chrome-content">
        {active ? (
          <>
            <div className="content-flap" aria-hidden="true">
              <span className="flap-tile">
                <span className="flap-digit">
                  {String(activeIndex + 1)
                    .padStart(2, '0')
                    .slice(0, 1)}
                </span>
              </span>
              <span className="flap-tile">
                <span className="flap-digit">
                  {String(activeIndex + 1)
                    .padStart(2, '0')
                    .slice(1)}
                </span>
              </span>
            </div>
            <p className="content-session-name">{active.name}</p>
            <p className="content-session-status">
              空闲 · {active.pageTitle}
              {active.note ? ` · ${active.note}` : ''}
            </p>
            <p className="content-hint">Chromium 渲染区将在阶段 2 接入，当前为界面预演</p>
          </>
        ) : (
          <>
            <div className="content-flap" aria-hidden="true">
              <span className="flap-tile">
                <span className="flap-digit">-</span>
              </span>
              <span className="flap-tile">
                <span className="flap-digit">-</span>
              </span>
            </div>
            <p className="content-session-name">未选择会话</p>
            <p className="content-hint">在左侧选择或新建一个会话，开始多账号测试</p>
          </>
        )}
      </div>
    </section>
  )
}

export default BrowserFrame
