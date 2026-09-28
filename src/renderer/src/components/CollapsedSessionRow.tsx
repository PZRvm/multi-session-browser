import { useState } from 'react'
import { Tooltip } from 'antd'
import { useSessionsStore } from '../stores/sessions'
import { useOverlayWhenOpen } from './useOverlayWhenOpen'
import type { SessionItem } from '../stores/sessions'

interface CollapsedSessionRowProps {
  session: SessionItem
  /** 克隆中的行（状态点转 loading 信号） */
  cloning: boolean
}

/**
 * 收起态轨道行（侧边栏收起态专项反馈轮四定稿，修复轮复审低 1 自 SessionRow 拆出）：
 * 只渲染状态点（idle/loading 语义色与展开态同源），激活行沿用琥珀反白——反白底上
 * idle 点与 loading 点均转 accent-ink（loading 信号色与琥珀底同族对比不足，脉冲
 * 动画保留）；hover Tooltip 出会话全名（placement right 在侧边栏右侧弹出、与展开钮
 * 提示同位——tipOpen 经 useOverlayWhenOpen 登记 overlay 收起页面视图后完整可见；
 * 0.1 进 / 0.2 出延迟差让相邻行交接期 overlay 计数不归零，页面不闪抖；pointerEvents
 * none 保持指针穿透；getPopupContainer 锁挂 .session-panel）。点击/Enter/Space 切换
 * 激活会话。拖拽/右键/⋮ 菜单/行内编辑/批量在窄轨上结构性不可达。开关状态随本组件
 * 卸载（展开切换）整体销毁，无 Tooltip 无回调路径的滞留问题。
 */
function CollapsedSessionRow({ session, cloning }: CollapsedSessionRowProps): React.JSX.Element {
  const { activeId, selectSession } = useSessionsStore()
  const selected = activeId === session.id
  const [tipOpen, setTipOpen] = useState(false)
  useOverlayWhenOpen(tipOpen)

  return (
    <Tooltip
      title={session.name}
      placement="right"
      mouseEnterDelay={0.1}
      mouseLeaveDelay={0.2}
      overlayStyle={{ pointerEvents: 'none' }}
      onOpenChange={setTipOpen}
      getPopupContainer={(triggerNode) =>
        triggerNode.closest<HTMLElement>('.session-panel') ?? triggerNode.parentElement!
      }
    >
      <li
        className={`session-row session-row-collapsed${selected ? ' selected' : ''}`}
        data-session-id={session.id}
        tabIndex={0}
        aria-current={selected ? 'true' : undefined}
        onClick={() => selectSession(session.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            selectSession(session.id)
          }
        }}
      >
        <span className={`session-dot ${cloning ? 'loading' : session.status}`} />
      </li>
    </Tooltip>
  )
}

export default CollapsedSessionRow
