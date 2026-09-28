import { useState } from 'react'
import { Tooltip } from 'antd'
import { DoubleRightOutlined, PlusOutlined } from '@ant-design/icons'
import CollapsedSessionRow from './CollapsedSessionRow'
import { useOverlayWhenOpen } from './useOverlayWhenOpen'
import { useT } from '../i18n'
import type { SessionItem } from '../stores/sessions'

interface CollapsedRailProps {
  /** 收起前当前视野的可见会话（过滤在 SessionPanel 既有视野逻辑内完成） */
  sessions: SessionItem[]
  /** 克隆中的行 id 集（状态点转 loading 信号） */
  cloningIds: Set<string>
  onToggleCollapse: () => void
  onAddSession: () => void
}

/**
 * 侧边栏收起态轨道（收起态专项 2026-09-28，反馈轮三/四定稿）：展开钮占原工作区
 * 条槽位行（.collapse-row）、会话退化为状态点行、板脚撑满直角图标新建钮。
 * 独立成组件的副作用红利：新建钮 popover 的 plusTipOpen 随本组件卸载（展开切换）
 * 整体销毁，无「Tooltip 随触发器卸载不回调 onOpenChange(false)」的开关滞留问题
 * （该问题在行级 tipOpen 仍存在，SessionRow 渲染期复位兜底）。空视野轨道区空白，
 * 不渲染空态文案（收起态零文案原则）。
 */
function CollapsedRail({
  sessions,
  cloningIds,
  onToggleCollapse,
  onAddSession
}: CollapsedRailProps): React.JSX.Element {
  const t = useT()
  const [plusTipOpen, setPlusTipOpen] = useState(false)
  useOverlayWhenOpen(plusTipOpen)

  return (
    <>
      {/* 展开钮：占原工作区条槽位行（40px、底部发丝线同节奏）；popover 右侧弹跨入
          右区原生层——钮固定在板头 40px 高度带邻位，弹层落 Tab 条/工具栏壳层高度带
          不越原生层，无需 overlay 登记 */}
      <div className="collapse-row">
        <Tooltip title={t('sessions.panel.expandSidebar')} placement="right" mouseEnterDelay={0.2}>
          <button
            type="button"
            className="collapse-toggle"
            aria-label={t('sessions.panel.expandSidebar')}
            aria-expanded={false}
            onClick={onToggleCollapse}
          >
            <DoubleRightOutlined />
          </button>
        </Tooltip>
      </div>
      <ul className="session-list">
        {sessions.map((session) => (
          <CollapsedSessionRow
            key={session.id}
            session={session}
            cloning={cloningIds.has(session.id)}
          />
        ))}
      </ul>
      {/* 板脚撑满直角图标新建钮：.new-session 全宽琥珀三态全量继承；popover 右侧弹
          跨入右区原生层，plusTipOpen 登记 overlay 收起页面视图（0.1 进/0.2 出延迟差
          与会话行 Tooltip 交接期计数不归零） */}
      <footer className="board-foot">
        <Tooltip
          title={t('sessions.panel.newSession')}
          placement="right"
          mouseEnterDelay={0.1}
          mouseLeaveDelay={0.2}
          overlayStyle={{ pointerEvents: 'none' }}
          onOpenChange={setPlusTipOpen}
        >
          <button
            type="button"
            className="new-session new-session-icon"
            aria-label={t('sessions.panel.newSession')}
            onClick={onAddSession}
          >
            <PlusOutlined />
          </button>
        </Tooltip>
      </footer>
    </>
  )
}

export default CollapsedRail
