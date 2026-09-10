import { useState } from 'react'
import { App, ConfigProvider, Dropdown, Input, theme } from 'antd'
import type { MenuProps } from 'antd'
import { MoreOutlined, PlusOutlined } from '@ant-design/icons'
import FlapCounter from './FlapCounter'
import { useSessionsStore } from '../stores/sessions'
import type { SessionItem } from '../stores/sessions'

const statusText: Record<SessionItem['status'], string> = {
  idle: '空闲',
  loading: '加载中'
}

function SessionRow({ session }: { session: SessionItem }): React.JSX.Element {
  const { activeId, renameSession, removeSession, selectSession } = useSessionsStore()
  const { modal } = App.useApp()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(session.name)
  const selected = activeId === session.id

  const commitRename = (): void => {
    setEditing(false)
    renameSession(session.id, draft)
  }

  const menuItems: MenuProps['items'] = [
    {
      key: 'rename',
      label: '重命名'
    },
    {
      key: 'delete',
      label: '删除会话',
      danger: true
    }
  ]

  const onMenuClick: MenuProps['onClick'] = ({ key, domEvent }) => {
    domEvent.stopPropagation()
    if (key === 'rename') {
      setDraft(session.name)
      setEditing(true)
    } else if (key === 'delete') {
      modal.confirm({
        title: '删除会话',
        content: `将永久删除「${session.name}」及其全部本地数据，且不可恢复。`,
        okText: '删除',
        okButtonProps: { danger: true },
        cancelText: '取消',
        onOk: () => removeSession(session.id)
      })
    }
  }

  return (
    <li
      className={`session-row${selected ? ' selected' : ''}`}
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
      <div className="session-row-main">
        <span className={`session-dot ${session.status}`} />
        {editing ? (
          <Input
            className="session-rename"
            size="small"
            value={draft}
            autoFocus
            variant="borderless"
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setDraft(e.target.value)}
            onPressEnter={commitRename}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setEditing(false)
            }}
          />
        ) : (
          <span className="session-name">{session.name}</span>
        )}
        <span className="session-page">{session.pageTitle}</span>
      </div>
      <div className="session-row-sub">
        <span className="session-note">{session.note || '未填写备注'}</span>
        <span className={`session-status ${session.status}`}>{statusText[session.status]}</span>
        <Dropdown
          menu={{ items: menuItems, onClick: onMenuClick }}
          trigger={['click']}
          placement="bottomRight"
        >
          <button
            type="button"
            className="session-menu"
            aria-label="会话操作"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreOutlined />
          </button>
        </Dropdown>
      </div>
    </li>
  )
}

function SessionPanel(): React.JSX.Element {
  const sessions = useSessionsStore((s) => s.sessions)
  const addSession = useSessionsStore((s) => s.addSession)

  return (
    <ConfigProvider
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: '#FFB000',
          colorInfo: '#FFB000',
          borderRadius: 6,
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif'
        }
      }}
    >
      <aside className="session-panel">
        <header className="board-head">
          <span className="board-title">
            <span className="board-title-text">多会话测试浏览器</span>
          </span>
          <span className="board-count">
            <span className="board-count-label">会话</span>
            <FlapCounter value={sessions.length} />
          </span>
        </header>
        {sessions.length === 0 ? (
          <div className="session-empty">
            <p className="session-empty-title">尚无会话</p>
            <p className="session-empty-desc">新建第一个隔离环境，并行测试多账号</p>
          </div>
        ) : (
          <ul className="session-list">
            {sessions.map((session) => (
              <SessionRow key={session.id} session={session} />
            ))}
          </ul>
        )}
        <footer className="board-foot">
          <button type="button" className="new-session" onClick={addSession}>
            <PlusOutlined />
            新建会话
          </button>
        </footer>
      </aside>
    </ConfigProvider>
  )
}

export default SessionPanel
