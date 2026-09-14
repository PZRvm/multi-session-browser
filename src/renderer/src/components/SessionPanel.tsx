import { useEffect, useRef, useState } from 'react'
import { App, Button, Checkbox, ConfigProvider, Dropdown, Input, Modal, theme } from 'antd'
import type { MenuProps } from 'antd'
import { CheckSquareOutlined, MoreOutlined, PlusOutlined } from '@ant-design/icons'
import AppearanceEntry from './AppearanceEntry'
import FlapCounter from './FlapCounter'
import { useAppearanceStore } from '../stores/appearance'
import { useSessionsStore } from '../stores/sessions'
import type { SessionItem } from '../stores/sessions'
import { useUiStore } from '../stores/ui'

const statusText: Record<SessionItem['status'], string> = {
  idle: '空闲',
  loading: '加载中'
}

interface SessionRowProps {
  session: SessionItem
  batchMode: boolean
  checked: boolean
  cloning: boolean
  // 拖拽排序（面板级手势的面注入）：dragEnabled = 普通态（批量态整列禁拖）；
  // 编辑态由行内自行并入 draggable；isDragSource/dropPos 只驱视觉
  dragEnabled: boolean
  isDragSource: boolean
  dropPos: 'before' | 'after' | null
  onToggleCheck: (id: string) => void
  onClone: (id: string) => Promise<void>
}

function SessionRow({
  session,
  batchMode,
  checked,
  cloning,
  dragEnabled,
  isDragSource,
  dropPos,
  onToggleCheck,
  onClone
}: SessionRowProps): React.JSX.Element {
  const { activeId, renameSession, removeSession, selectSession } = useSessionsStore()
  const openOverlay = useUiStore((s) => s.openOverlay)
  const closeOverlay = useUiStore((s) => s.closeOverlay)
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
      key: 'clone',
      label: '克隆会话'
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
    } else if (key === 'clone') {
      void onClone(session.id)
    } else if (key === 'delete') {
      // WebContentsView 是 renderer DOM 之上的原生层；先登记弹层（ui store overlayDepth）
      // 收起页面视图，确保确认框完整可见。约束见 stores/ui.ts：新增任何可能延伸到
      // 右区的 portal 弹层都必须走同一登记，否则会被原生层遮挡。
      openOverlay()
      try {
        modal.confirm({
          title: '删除会话',
          content: `将永久删除「${session.name}」及其全部本地数据，且不可恢复。`,
          okText: '删除',
          okButtonProps: { danger: true },
          cancelText: '取消',
          onOk: () => removeSession(session.id),
          afterClose: () => closeOverlay()
        })
      } catch (error) {
        // confirm 同步异常时回滚弹层登记，防页面视图永久隐藏
        closeOverlay()
        console.error('打开删除确认框失败', error)
      }
    }
  }

  // 批量态行：勾选行背景常驻 raised；激活反白（selected）不渲染——反白语义专属
  // 单选激活，批量态不激活，当前激活会话由右侧浏览器表明
  const rowClass = batchMode
    ? `session-row${checked ? ' batch-checked' : ''}`
    : `session-row${selected ? ' selected' : ''}${isDragSource ? ' drag-source' : ''}`

  return (
    <li
      className={rowClass}
      // 拖拽排序：面板级 dragstart/dragover/drop/dragend 经事件委托挂在 ul 上，
      // 行只携带身份属性与瞬态视觉态（data-drop-pos 驱动伪元素插入线）
      data-session-id={session.id}
      data-drop-pos={dropPos ?? undefined}
      draggable={dragEnabled && !editing}
      tabIndex={0}
      // 批量态声明 checkbox 语义（aria-checked 才对辅助技术可达）；非批量态保持
      // 默认 listitem + aria-current 的激活语义
      role={batchMode ? 'checkbox' : undefined}
      aria-current={!batchMode && selected ? 'true' : undefined}
      aria-checked={batchMode ? checked : undefined}
      onClick={() => (batchMode ? onToggleCheck(session.id) : selectSession(session.id))}
      onKeyDown={(e) => {
        if (batchMode) {
          // 复选框等内部控件自带键盘语义，行级不再处理，避免双切抵消
          if (e.target !== e.currentTarget) return
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onToggleCheck(session.id)
          }
          return
        }
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          selectSession(session.id)
        }
      }}
    >
      <div className="session-row-main">
        {batchMode && (
          // 复选框自身点击/空格即切勾选，阻止冒泡防止行级再切一次
          <span className="session-check" onClick={(e) => e.stopPropagation()}>
            <Checkbox checked={checked} onChange={() => onToggleCheck(session.id)} />
          </span>
        )}
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
        <span className={`session-status ${cloning ? 'loading' : session.status}`}>
          {cloning ? '克隆中…' : statusText[session.status]}
        </span>
        {!batchMode && (
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
        )}
      </div>
    </li>
  )
}

interface SessionPanelProps {
  panelWidth: number
}

function SessionPanel({ panelWidth }: SessionPanelProps): React.JSX.Element {
  const resolvedTheme = useAppearanceStore((s) => s.resolvedTheme)
  const sessions = useSessionsStore((s) => s.sessions)
  const addSession = useSessionsStore((s) => s.addSession)
  const cloneSession = useSessionsStore((s) => s.cloneSession)
  const deleteSessions = useSessionsStore((s) => s.deleteSessions)
  const batchOpenUrl = useSessionsStore((s) => s.batchOpenUrl)
  const reorderSessions = useSessionsStore((s) => s.reorderSessions)
  const openOverlay = useUiStore((s) => s.openOverlay)
  const closeOverlay = useUiStore((s) => s.closeOverlay)
  const { modal, message } = App.useApp()

  // 批量模式与克隆反馈均为面板本地 UI 态（不进 store、不进主进程）：
  // 模式开关、勾选集、URL 弹层 open 与草稿、确认框开关标记、克隆中的行 id
  const [batchMode, setBatchMode] = useState(false)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [urlOpen, setUrlOpen] = useState(false)
  const [urlDraft, setUrlDraft] = useState('')
  // URL 弹层行内错误态（整单拒绝时保持弹层开启并提示，对齐地址栏无效提示惯例）
  const [urlInvalid, setUrlInvalid] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [cloningIds, setCloningIds] = useState<Set<string>>(new Set())

  // 拖拽排序瞬态（面板本地，不进 store、不进 IPC、不落盘）：源行 id 与当前插入位。
  // dragOriginRef 记录 pointerdown 手势原点——dragstart 的 e.target 恒为 li 本身，
  // 交互后代（重命名 Input、菜单钮、勾选框）为起点的拖拽只能靠原点追踪事后取消
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropHint, setDropHint] = useState<{ id: string; pos: 'before' | 'after' } | null>(null)
  const dragOriginRef = useRef<EventTarget | null>(null)

  // 拖拽排序手势（HTML5 DnD，引擎选型与 Tab Drag 的适用边界差异见 DESIGN.md）：
  // dragstart 记源行 + 只写自定义 MIME；dragover 按目标行垂直中点算 before/after；
  // drop 生成一次完整全序提交 store；dragend 无条件清态（列表外/右区/窗外/Esc 全覆盖）
  const handleListPointerDown = (e: React.PointerEvent<HTMLUListElement>): void => {
    dragOriginRef.current = e.target
  }

  const handleListDragStart = (e: React.DragEvent<HTMLUListElement>): void => {
    const row = (e.target as HTMLElement).closest('li.session-row') as HTMLLIElement | null
    if (!row) return
    // 交互控件起点的拖拽直接取消（dragstart 的 target 恒为 li，以 pointerdown 原点判定）
    const origin = dragOriginRef.current
    if (
      origin instanceof HTMLElement &&
      origin.closest('input, button, .ant-checkbox, .session-check')
    ) {
      e.preventDefault()
      return
    }
    const id = row.dataset.sessionId
    if (!id) {
      e.preventDefault()
      return
    }
    setDragId(id)
    e.dataTransfer.effectAllowed = 'move'
    // 清空默认数据后只写应用自定义 MIME——不携带 URL/纯文本，拖影越界到右侧网页
    // 时不构成导航或文本投放
    e.dataTransfer.clearData()
    e.dataTransfer.setData('application/x-msb-session', id)
  }

  /** 目标行与插入位（按垂直中点）；非行内命中返回 null */
  const hitRow = (
    e: React.DragEvent<HTMLUListElement>
  ): { id: string; pos: 'before' | 'after' } | null => {
    const row = (e.target as HTMLElement).closest('li.session-row') as HTMLLIElement | null
    const id = row?.dataset.sessionId
    if (!row || !id) return null
    const rect = row.getBoundingClientRect()
    return {
      id,
      pos: e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    }
  }

  const handleListDragOver = (e: React.DragEvent<HTMLUListElement>): void => {
    if (!dragId) return
    const hit = hitRow(e)
    if (!hit) return
    // 仅列表内有效源存在时 preventDefault（此时才允许 drop）；列表外/右区不
    // preventDefault，系统自动呈现"不可投放"光标
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDropHint((prev) => (prev?.id === hit.id && prev.pos === hit.pos ? prev : hit))
  }

  const handleListDrop = (e: React.DragEvent<HTMLUListElement>): void => {
    if (!dragId) return
    e.preventDefault()
    const hit = hitRow(e)
    if (!hit) return
    const ids = sessions.map((s) => s.id)
    const without = ids.filter((id) => id !== dragId)
    const targetIndex = without.indexOf(hit.id)
    if (targetIndex === -1) return
    // 生成一次完整新序（源行移出后按插入位插回）；无位移时与原序相同，
    // store 侧短路不发 IPC
    without.splice(hit.pos === 'before' ? targetIndex : targetIndex + 1, 0, dragId)
    const nextIds = without
    void (async () => {
      const ok = await reorderSessions(nextIds)
      if (!ok) message.error('会话排序失败，列表顺序已恢复')
    })()
  }

  // dragend 在源元素上无条件触发（列表内、右区、窗外、Esc 取消全覆盖）——
  // 全部瞬态在此收敛，不存在冻结或残留指示的路径
  const handleListDragEnd = (): void => {
    setDragId(null)
    setDropHint(null)
    dragOriginRef.current = null
  }

  // 勾选集以现存会话为准（已删除会话的残留 id 不计数、不参与批量指令）
  const checkedIds = sessions.filter((s) => checked.has(s.id)).map((s) => s.id)
  const checkedCount = checkedIds.length
  const allChecked = sessions.length > 0 && checkedCount === sessions.length

  const toggleChecked = (id: string): void => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = (): void => {
    setChecked(allChecked ? new Set() : new Set(sessions.map((s) => s.id)))
  }

  const toggleBatchMode = (): void => {
    // 退出时清空勾选集
    if (batchMode) setChecked(new Set())
    setBatchMode(!batchMode)
  }

  // 克隆含分区复制可能数秒：以 store.cloneSession 的函数体为耗时边界，
  // 前后置位/复位 cloningIds（Set 支持并发克隆互不覆盖指示），该行状态字临时显示「克隆中…」
  const handleClone = async (id: string): Promise<void> => {
    setCloningIds((prev) => new Set(prev).add(id))
    try {
      await cloneSession(id)
    } finally {
      setCloningIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  const openUrlModal = (): void => {
    // portal 弹层可能延伸到右区，开关经 overlay 悬挂登记（声明式 Modal 无同步
    // 抛出路径，登记释放在 afterClose，含 Esc/取消关闭）
    openOverlay()
    setUrlInvalid(false)
    setUrlOpen(true)
  }

  const confirmUrl = async (): Promise<void> => {
    const url = urlDraft.trim()
    if (!url) return
    const ok = await batchOpenUrl(checkedIds, url)
    if (!ok) {
      // 整单拒绝（地址无效或选中会话已变化）：保持弹层开启，行内提示（不静默）
      setUrlInvalid(true)
      return
    }
    setUrlOpen(false)
    setUrlDraft('')
  }

  const confirmCloseSelected = (): void => {
    openOverlay()
    setConfirmOpen(true)
    try {
      modal.confirm({
        title: '关闭选中会话',
        content: `将永久删除选中的 ${checkedCount} 个会话及其全部本地数据，且不可恢复。`,
        okText: '删除',
        okButtonProps: { danger: true },
        cancelText: '取消',
        // 整单拒绝（选中集在窗口期内变化等）：message 提示原因 + onOk reject 保持
        // 确认框开启（对齐打开测试地址弹层「整单拒绝不静默、保持开启」惯例）
        onOk: async () => {
          const ok = await deleteSessions(checkedIds)
          if (!ok) {
            message.error('关闭选中会话失败：选中会话已发生变化，请重试')
            throw new Error('关闭选中会话被整单拒绝')
          }
        },
        afterClose: () => {
          setConfirmOpen(false)
          closeOverlay()
        }
      })
    } catch (error) {
      // confirm 同步异常时回滚弹层标记与登记，防页面视图永久隐藏
      setConfirmOpen(false)
      closeOverlay()
      console.error('打开关闭选中确认框失败', error)
    }
  }

  // Esc 退出批量模式：仅模式激活、焦点不在输入控件、且两个弹层均未开启时生效
  // （弹层开关用组件状态标记，不依赖 antd 内部类名）
  useEffect(() => {
    if (!batchMode) return
    const onKeydown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      const el = document.activeElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
      if (urlOpen || confirmOpen) return
      setBatchMode(false)
      setChecked(new Set())
    }
    window.addEventListener('keydown', onKeydown)
    return () => window.removeEventListener('keydown', onKeydown)
  }, [batchMode, urlOpen, confirmOpen])

  return (
    <ConfigProvider
      theme={{
        algorithm: resolvedTheme === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
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
          <span className="board-head-right">
            <AppearanceEntry panelWidth={panelWidth} />
            <button
              type="button"
              className={`batch-toggle${batchMode ? ' active' : ''}`}
              title="批量操作"
              aria-label="批量操作"
              disabled={sessions.length === 0 && !batchMode}
              onClick={toggleBatchMode}
            >
              <CheckSquareOutlined />
            </button>
            <span className="board-count">
              <span className="board-count-label">会话</span>
              <FlapCounter value={sessions.length} />
            </span>
          </span>
        </header>
        {sessions.length === 0 ? (
          <div className="session-empty">
            <p className="session-empty-title">尚无会话</p>
            <p className="session-empty-desc">新建第一个隔离环境，并行测试多账号</p>
          </div>
        ) : (
          <ul
            className="session-list"
            onPointerDown={handleListPointerDown}
            onDragStart={handleListDragStart}
            onDragOver={handleListDragOver}
            onDrop={handleListDrop}
            onDragEnd={handleListDragEnd}
          >
            {sessions.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                batchMode={batchMode}
                checked={checked.has(session.id)}
                cloning={cloningIds.has(session.id)}
                dragEnabled={!batchMode}
                isDragSource={dragId === session.id}
                dropPos={dropHint?.id === session.id ? dropHint.pos : null}
                onToggleCheck={toggleChecked}
                onClone={handleClone}
              />
            ))}
          </ul>
        )}
        <footer className="board-foot">
          {batchMode ? (
            <div className="batch-bar">
              <div className="batch-bar-row">
                <div className="batch-bar-left">
                  <span className="batch-count">已选 {checkedCount}</span>
                  <button type="button" className="batch-select-all" onClick={toggleAll}>
                    {allChecked ? '取消全选' : '全选'}
                  </button>
                </div>
                <Button
                  type="text"
                  danger
                  size="small"
                  className="batch-close-selected"
                  disabled={checkedCount === 0}
                  onClick={confirmCloseSelected}
                >
                  关闭选中会话
                </Button>
              </div>
              <button
                type="button"
                className="new-session"
                disabled={checkedCount === 0}
                onClick={openUrlModal}
              >
                打开测试地址
              </button>
            </div>
          ) : (
            <button type="button" className="new-session" onClick={addSession}>
              <PlusOutlined />
              新建会话
            </button>
          )}
        </footer>
      </aside>
      <Modal
        title="打开测试地址"
        open={urlOpen}
        okText="确定"
        cancelText="取消"
        okButtonProps={{ disabled: !urlDraft.trim() }}
        onOk={confirmUrl}
        onCancel={() => setUrlOpen(false)}
        afterClose={() => closeOverlay()}
      >
        <Input
          placeholder="输入测试地址，将打开在每个选中会话的新标签页"
          value={urlDraft}
          autoFocus
          status={urlInvalid ? 'error' : undefined}
          aria-invalid={urlInvalid}
          onChange={(e) => {
            setUrlDraft(e.target.value)
            setUrlInvalid(false)
          }}
        />
        {urlInvalid && (
          <p className="batch-url-invalid">打开失败：地址无效或选中会话已变化，请修正后重试</p>
        )}
      </Modal>
    </ConfigProvider>
  )
}

export default SessionPanel
