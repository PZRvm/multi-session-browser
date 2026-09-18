import { useEffect, useMemo, useRef, useState } from 'react'
import { App, Button, ConfigProvider, Input, Modal, Tooltip, theme } from 'antd'
import {
  CheckSquareOutlined,
  FolderOpenOutlined,
  PlusOutlined,
  SettingOutlined
} from '@ant-design/icons'
import AppearanceEntry from './AppearanceEntry'
import FlapCounter from './FlapCounter'
import SessionRow from './SessionRow'
import WorkspaceSwitcher from './WorkspaceSwitcher'
import { useSessionDragReorder } from './useSessionDragReorder'
import { useT } from '../i18n'
import { confirmDestructive } from '../dialogs'
import { WORKSPACE_VIEW_ALL } from '../../../shared/sessions'
import { THEME_SYSTEMS } from '../../../shared/themeSystems'
import { useAppearanceStore } from '../stores/appearance'
import { useSessionsStore } from '../stores/sessions'
import type { SessionItem } from '../stores/sessions'
import { useUiStore } from '../stores/ui'

interface SessionPanelProps {
  panelWidth: number
}

function SessionPanel({ panelWidth }: SessionPanelProps): React.JSX.Element {
  const t = useT()
  const resolvedTheme = useAppearanceStore((s) => s.resolvedTheme)
  const themeColor = useAppearanceStore((s) => s.themeColor)
  const sessions = useSessionsStore((s) => s.sessions)
  const workspaces = useSessionsStore((s) => s.workspaces)
  const activeWorkspaceId = useSessionsStore((s) => s.activeWorkspaceId)
  const addSession = useSessionsStore((s) => s.addSession)
  const cloneSession = useSessionsStore((s) => s.cloneSession)
  const deleteSessions = useSessionsStore((s) => s.deleteSessions)
  const batchOpenUrl = useSessionsStore((s) => s.batchOpenUrl)
  const reorderSessions = useSessionsStore((s) => s.reorderSessions)
  const moveSessionToWorkspace = useSessionsStore((s) => s.moveSessionToWorkspace)
  const moveSessionsToWorkspace = useSessionsStore((s) => s.moveSessionsToWorkspace)
  const openOverlay = useUiStore((s) => s.openOverlay)
  const closeOverlay = useUiStore((s) => s.closeOverlay)
  const { message } = App.useApp()

  // 批量模式与克隆反馈均为面板本地 UI 态（不进 store、不进主进程）：
  // 模式开关、勾选集、URL 弹层 open 与草稿、克隆中的行 id、
  // 移动到工作区弹层的目标会话
  const [batchMode, setBatchMode] = useState(false)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [urlOpen, setUrlOpen] = useState(false)
  const [urlDraft, setUrlDraft] = useState('')
  // URL 弹层行内错误态（整单拒绝时保持弹层开启并提示，对齐地址栏无效提示惯例）
  const [urlInvalid, setUrlInvalid] = useState(false)
  const [cloningIds, setCloningIds] = useState<Set<string>>(new Set())
  const [moveTarget, setMoveTarget] = useState<SessionItem | null>(null)
  // 批量移动弹层与板脚反馈条（2026-09-17 增量）：反馈为面板本地 UI 态——成功次墨
  // ~2.4s 淡出、失败 danger 持续至下一次操作（对齐打开测试地址失败不静默惯例）
  const [batchMoveOpen, setBatchMoveOpen] = useState(false)
  const [batchFeedback, setBatchFeedback] = useState<{
    tone: 'success' | 'danger'
    text: string
    fading?: boolean
  } | null>(null)
  const feedbackTimer = useRef<number | undefined>(undefined)
  // 批量移动在途守卫（审查修复轮低 6）：弹层目标按钮连点时忽略后续触发，防重复
  // IPC 与「已移动 0 个」的困惑反馈
  const batchMoveInFlight = useRef(false)
  // 批量关闭原生确认框在途守卫：弹框期间连点按钮忽略后续触发，防重复弹框
  const closeConfirmInFlight = useRef(false)

  // 工作区视野：'all' 全量，否则按归属过滤（store 仍持全量——拖拽全序、级联与
  // 批量「关闭选中」的集合判定都以全量为准，视野只是渲染过滤，PRD 4.8）
  const viewIsAll = activeWorkspaceId === WORKSPACE_VIEW_ALL
  const visibleSessions = useMemo(
    () => (viewIsAll ? sessions : sessions.filter((s) => s.workspaceId === activeWorkspaceId)),
    [sessions, viewIsAll, activeWorkspaceId]
  )
  // 新建/克隆落点：当前视野对应的工作区（'all' 视野 = 未分组 null，PRD 3.1.5）
  const membership = viewIsAll ? null : activeWorkspaceId
  const wsNameById = useMemo(() => new Map(workspaces.map((w) => [w.id, w.name])), [workspaces])

  // 拖拽排序手势整体在 useSessionDragReorder（瞬态本地持有，不进 store/IPC/落盘）。
  // 入参恒为全量 sessions：drop 全序合成天然保持不可见会话原相对位置（工作区视野
  // 内只重排可见子序列）；失败反馈走整单拒绝不静默惯例
  const { listHandlers, rowProps } = useSessionDragReorder(sessions, reorderSessions, () =>
    message.error(t('sessions.panel.reorderFailed'))
  )

  // 勾选集以当前视野的现存会话为准（已删除/不可见会话的残留 id 不计数、不参与
  // 批量指令——PRD 3.1.5 批量作用域）
  const checkedIds = visibleSessions.filter((s) => checked.has(s.id)).map((s) => s.id)
  const checkedCount = checkedIds.length
  const allChecked = visibleSessions.length > 0 && checkedCount === visibleSessions.length

  // 反馈条定时器随卸载清理（防卸载后写状态）
  useEffect(() => () => window.clearTimeout(feedbackTimer.current), [])

  const showBatchFeedback = (tone: 'success' | 'danger', text: string): void => {
    setBatchFeedback({ tone, text })
    window.clearTimeout(feedbackTimer.current)
    if (tone === 'success') {
      // 真实淡出（审查修复轮低 4）：2400ms 先入 fading 态（opacity 过渡 240ms），
      // 过渡结束后再摘除内容
      feedbackTimer.current = window.setTimeout(() => {
        setBatchFeedback((prev) => (prev ? { ...prev, fading: true } : prev))
        feedbackTimer.current = window.setTimeout(() => setBatchFeedback(null), 260)
      }, 2400)
    }
  }

  const toggleChecked = (id: string): void => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = (): void => {
    setChecked(allChecked ? new Set() : new Set(visibleSessions.map((s) => s.id)))
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
      await cloneSession(id, membership)
    } finally {
      setCloningIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  // 移动到工作区：行菜单入口 → 弹层列目标工作区（排除当前归属）+ 移出未分组。
  // 弹层经 overlay 登记（portal 可能延伸到右区，与既有弹层同规）
  const openMoveModal = (session: SessionItem): void => {
    openOverlay()
    setMoveTarget(session)
  }
  const closeMoveModal = (): void => setMoveTarget(null)
  const pickMoveTarget = (workspaceId: string | null): void => {
    const target = moveTarget
    if (!target) return
    void moveSessionToWorkspace(target.id, workspaceId).then((ok) => {
      if (!ok) message.error(t('sessions.panel.moveFailed'))
      setMoveTarget(null)
    })
  }

  // 批量移动（2026-09-17 增量）：弹层经 overlay 登记；幂等语义由主进程承担——
  // moved/skipped 为真实计数；成功清空勾选保持批量态并反馈（~2.4s 淡出），
  // 失败反馈条 danger 持续、弹层保持开启供重试（对齐打开测试地址失败惯例）
  const openBatchMoveModal = (): void => {
    openOverlay()
    setBatchFeedback(null)
    setBatchMoveOpen(true)
  }
  const closeBatchMoveModal = (): void => setBatchMoveOpen(false)
  const pickBatchMoveTarget = async (workspaceId: string | null): Promise<void> => {
    if (checkedCount === 0 || batchMoveInFlight.current) return
    batchMoveInFlight.current = true
    try {
      const result = await moveSessionsToWorkspace(checkedIds, workspaceId)
      if (!result) {
        setBatchFeedback({ tone: 'danger', text: t('sessions.batchFeedback.moveFailed') })
        return
      }
      setBatchMoveOpen(false)
      setChecked(new Set())
      const targetName = workspaceId
        ? (wsNameById.get(workspaceId) ?? t('sessions.shared.workspaceFallback'))
        : t('sessions.shared.ungrouped')
      showBatchFeedback(
        'success',
        result.skipped > 0
          ? t('sessions.batchFeedback.movedSkipped', {
              n: result.moved,
              name: targetName,
              skipped: result.skipped
            })
          : t('sessions.batchFeedback.moved', { n: result.moved, name: targetName })
      )
    } finally {
      batchMoveInFlight.current = false
    }
  }
  // 弹层计数徽标：勾选中已在该工作区数 / 勾选总数（混合归属预览，demo 裁决）
  const batchInTargetCount = (workspaceId: string): number =>
    visibleSessions.filter((s) => checked.has(s.id) && s.workspaceId === workspaceId).length
  const batchHasGrouped = visibleSessions.some((s) => checked.has(s.id) && s.workspaceId != null)

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
    if (closeConfirmInFlight.current) return
    closeConfirmInFlight.current = true
    // 破坏性确认走主进程原生对话框（PRD 4.10）：window-modal 模态阻塞输入，弹框
    // 期间页面视图保持可见且内容原样，不经 overlay 悬挂登记收起右区（渲染层弹层
    // 才需要）。只确认不执行：确认后经既有 sessions:delete-batch 链路删除；整单
    // 拒绝（选中集在窗口期内变化）不再保持弹框——原生框一次性确认，行内反馈后
    // 可从入口再次发起。守卫整链（确认+删除）落定才释放，对齐 batchMoveInFlight
    // 先例——否则删除在途窗口内可再弹框对在途集合二次发起（审查中 1）
    void confirmDestructive({ kind: 'sessions-batch-close', count: checkedCount })
      .then((confirmed) => {
        if (!confirmed) return undefined
        return deleteSessions(checkedIds).then((ok) => {
          if (!ok) message.error(t('sessions.batchBar.closeConfirm.failed'))
        })
      })
      .finally(() => {
        closeConfirmInFlight.current = false
      })
  }

  // Esc 退出批量模式：仅模式激活、焦点不在输入控件、且两个弹层均未开启时生效
  // （弹层开关用组件状态标记，不依赖 antd 内部类名；批量移动弹层豁免——审查修复轮
  // 中 1：否则 Esc 关弹层的同时批量态连带退出、勾选被清空，违背「弹层开启时豁免」。
  // 批量关闭的原生确认框不在此列：窗口模态吞键，Esc 不会抵达 renderer）
  useEffect(() => {
    if (!batchMode) return
    const onKeydown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      const el = document.activeElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
      if (urlOpen || batchMoveOpen) return
      setBatchMode(false)
      setChecked(new Set())
    }
    window.addEventListener('keydown', onKeydown)
    return () => window.removeEventListener('keydown', onKeydown)
  }, [batchMode, urlOpen, batchMoveOpen])

  // 视野切换清空勾选集：批量作用域随视野（PRD 3.1.3），跨视野残留的勾选不显示
  // 却仍占着 Set，与全选状态联动产生"已选数对不上所见"的困惑（审查低 5）。
  // 渲染期调整状态模式（React 官方推荐，替代 effect 内同步 setState）
  const [prevViewId, setPrevViewId] = useState(activeWorkspaceId)
  if (prevViewId !== activeWorkspaceId) {
    setPrevViewId(activeWorkspaceId)
    setChecked(new Set())
  }

  return (
    <ConfigProvider
      theme={{
        algorithm: resolvedTheme === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          // 与 App 根 ConfigProvider 同源：主色经同一 store 镜像取主题配置单源
          //（accent 落在昼夜两态 token 内，取当前 resolvedTheme 态）
          colorPrimary: THEME_SYSTEMS[themeColor][resolvedTheme].accent,
          colorInfo: THEME_SYSTEMS[themeColor][resolvedTheme].accent,
          borderRadius: 6,
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif'
        }
      }}
    >
      <aside className="session-panel">
        <header className="board-head">
          <span className="board-title">
            <span className="board-title-text">{t('common.appName')}</span>
          </span>
          <span className="board-head-right">
            <AppearanceEntry panelWidth={panelWidth} />
            <button
              type="button"
              className={`batch-toggle${batchMode ? ' active' : ''}`}
              title={t('sessions.panel.batchToggle')}
              aria-label={t('sessions.panel.batchToggle')}
              disabled={visibleSessions.length === 0 && !batchMode}
              onClick={toggleBatchMode}
            >
              <CheckSquareOutlined />
            </button>
            {/* 设置齿轮（设置专项阶段一）：恒渲染不随左栏宽度降级——它是 Windows 的
                唯一发现路径，宽度降级由外观三段阈值（AppearanceEntry）承担；开窗/
                聚焦单例由主进程裁决（重复点击聚焦既有窗） */}
            <button
              type="button"
              className="settings-toggle"
              title={t('sessions.panel.settings')}
              aria-label={t('sessions.panel.settings')}
              onClick={() => {
                window.api.settings.open().catch((error: unknown) => {
                  console.warn('打开设置窗口失败:', error)
                })
              }}
            >
              <SettingOutlined />
            </button>
            <span className="board-count">
              <span className="board-count-label">{t('sessions.panel.countLabel')}</span>
              <FlapCounter value={visibleSessions.length} />
            </span>
          </span>
        </header>
        <WorkspaceSwitcher />
        {sessions.length === 0 ? (
          <div className="session-empty">
            <p className="session-empty-title">{t('sessions.panel.emptyAll.title')}</p>
            <p className="session-empty-desc">{t('sessions.panel.emptyAll.desc')}</p>
          </div>
        ) : visibleSessions.length === 0 ? (
          // 工作区视野空态：全局有会话但当前工作区没有（板脚新建仍可用，落本工作区）
          <div className="session-empty">
            <p className="session-empty-title">{t('sessions.panel.emptyWorkspace.title')}</p>
            <p className="session-empty-desc">{t('sessions.panel.emptyWorkspace.desc')}</p>
          </div>
        ) : (
          <ul className="session-list" {...listHandlers}>
            {visibleSessions.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                batchMode={batchMode}
                checked={checked.has(session.id)}
                cloning={cloningIds.has(session.id)}
                dragEnabled={!batchMode}
                wsTag={
                  // 归属标记仅在有工作区存在时的「全部会话」视野渲染——零工作区时
                  // 每行挂「未分组」是零信息噪音，违反 PRD 4.8 零噪音基线
                  viewIsAll && workspaces.length > 0
                    ? session.workspaceId !== null
                      ? (wsNameById.get(session.workspaceId) ?? t('sessions.shared.ungrouped'))
                      : t('sessions.shared.ungrouped')
                    : null
                }
                {...rowProps(session)}
                onToggleCheck={toggleChecked}
                onClone={handleClone}
                onMove={openMoveModal}
              />
            ))}
          </ul>
        )}
        <footer className="board-foot">
          {batchMode ? (
            <div className="batch-bar">
              <div className="batch-bar-row">
                <div className="batch-bar-left">
                  <span className="batch-count">
                    {t('sessions.batchBar.selectedCount', { n: checkedCount })}
                  </span>
                  <button type="button" className="batch-select-all" onClick={toggleAll}>
                    {allChecked
                      ? t('sessions.batchBar.selectNone')
                      : t('sessions.batchBar.selectAll')}
                  </button>
                  {panelWidth >= 340 ? (
                    <button
                      type="button"
                      className="batch-move-btn"
                      disabled={checkedCount === 0}
                      onClick={openBatchMoveModal}
                    >
                      {t('sessions.batchBar.moveToWorkspace')}
                    </button>
                  ) : (
                    <Tooltip
                      title={t('sessions.batchBar.moveToWorkspaceIcon')}
                      mouseEnterDelay={0.2}
                    >
                      {/* 禁用态原生 button 不派发鼠标事件——外层 span 承接 hover
                          让 Tooltip 在禁用时仍可解释图标用途（审查修复轮低 5） */}
                      <span className="batch-move-icon-wrap">
                        <button
                          type="button"
                          className="batch-move-btn batch-move-icon"
                          disabled={checkedCount === 0}
                          aria-label={t('sessions.batchBar.moveToWorkspaceIcon')}
                          onClick={openBatchMoveModal}
                        >
                          <FolderOpenOutlined />
                        </button>
                      </span>
                    </Tooltip>
                  )}
                </div>
                <Button
                  type="text"
                  danger
                  size="small"
                  className="batch-close-selected"
                  disabled={checkedCount === 0}
                  onClick={confirmCloseSelected}
                >
                  {t('sessions.batchBar.closeSelected')}
                </Button>
              </div>
              <button
                type="button"
                className="new-session"
                disabled={checkedCount === 0}
                onClick={openUrlModal}
              >
                {t('sessions.batchBar.openTestUrl')}
              </button>
              {batchFeedback && !batchMoveOpen && (
                <div
                  className={`batch-feedback${batchFeedback.fading ? ' batch-feedback-fading' : ''}${batchFeedback.tone === 'danger' ? ' batch-feedback-danger' : ''}`}
                  role="status"
                >
                  {batchFeedback.text}
                </div>
              )}
            </div>
          ) : (
            <button
              type="button"
              className="new-session"
              onClick={() => {
                void addSession(membership)
              }}
            >
              <PlusOutlined />
              {t('sessions.panel.newSession')}
            </button>
          )}
        </footer>
      </aside>
      <Modal
        title={t('sessions.urlModal.title')}
        open={urlOpen}
        okText={t('sessions.urlModal.okText')}
        cancelText={t('common.cancel')}
        okButtonProps={{ disabled: !urlDraft.trim() }}
        onOk={confirmUrl}
        onCancel={() => setUrlOpen(false)}
        afterClose={() => closeOverlay()}
      >
        <Input
          placeholder={t('sessions.urlModal.placeholder')}
          value={urlDraft}
          autoFocus
          status={urlInvalid ? 'error' : undefined}
          aria-invalid={urlInvalid}
          onChange={(e) => {
            setUrlDraft(e.target.value)
            setUrlInvalid(false)
          }}
        />
        {urlInvalid && <p className="batch-url-invalid">{t('sessions.urlModal.invalid')}</p>}
      </Modal>

      <Modal
        title={
          moveTarget
            ? t('sessions.moveModal.title', { name: moveTarget.name })
            : t('sessions.moveModal.titleFallback')
        }
        open={moveTarget !== null}
        footer={null}
        onCancel={closeMoveModal}
        afterClose={closeOverlay}
      >
        <div className="ws-move-list">
          {workspaces
            .filter((w) => w.id !== moveTarget?.workspaceId)
            .map((w) => (
              <Button key={w.id} block onClick={() => pickMoveTarget(w.id)}>
                {w.name}
              </Button>
            ))}
          {moveTarget?.workspaceId != null && (
            <Button block onClick={() => pickMoveTarget(null)}>
              {t('sessions.moveModal.moveOut')}
            </Button>
          )}
          {workspaces.filter((w) => w.id !== moveTarget?.workspaceId).length === 0 &&
            moveTarget?.workspaceId == null && (
              <p className="ws-move-empty">{t('sessions.moveModal.emptyOther')}</p>
            )}
        </div>
      </Modal>

      <Modal
        title={t('sessions.moveModal.batchTitle', { n: checkedCount })}
        open={batchMoveOpen}
        footer={null}
        onCancel={closeBatchMoveModal}
        afterClose={closeOverlay}
      >
        <p className="batch-move-sub">{t('sessions.moveModal.batchSub')}</p>
        <div className="ws-move-list">
          {workspaces.map((w) => (
            <Button
              key={w.id}
              block
              className="ws-move-item"
              onClick={() => {
                void pickBatchMoveTarget(w.id)
              }}
            >
              <span>{w.name}</span>
              <span className="ws-move-count">
                {t('sessions.moveModal.inTargetCount', {
                  here: batchInTargetCount(w.id),
                  total: checkedCount
                })}
              </span>
            </Button>
          ))}
          {batchHasGrouped && (
            <Button
              block
              className="ws-move-item"
              onClick={() => {
                void pickBatchMoveTarget(null)
              }}
            >
              <span>{t('sessions.moveModal.moveOut')}</span>
            </Button>
          )}
          {workspaces.length === 0 && !batchHasGrouped && (
            <p className="ws-move-empty">{t('sessions.moveModal.emptyNone')}</p>
          )}
        </div>
        {batchFeedback?.tone === 'danger' && (
          <p className="batch-move-error" role="alert">
            {batchFeedback.text}
          </p>
        )}
      </Modal>
    </ConfigProvider>
  )
}

export default SessionPanel
