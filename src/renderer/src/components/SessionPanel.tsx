import { useEffect, useMemo, useRef, useState } from 'react'
import { App, Button, ConfigProvider, Input, Modal, Tooltip, theme } from 'antd'
import {
  CheckSquareOutlined,
  DoubleLeftOutlined,
  DoubleRightOutlined,
  FolderOpenOutlined,
  PlusOutlined,
  SettingOutlined
} from '@ant-design/icons'
import AppearanceEntry from './AppearanceEntry'
import CountTiles from './CountTiles'
import { windowTrafficControls } from '../stores/browser'
import SessionRow from './SessionRow'
import WorkspaceSwitcher from './WorkspaceSwitcher'
import { useSessionDragReorder } from './useSessionDragReorder'
import { useT } from '../i18n'
import { confirmDestructive, showWorkspacePicker } from '../dialogs'
import { WORKSPACE_VIEW_ALL, WORKSPACE_VIEW_UNGROUPED } from '../../../shared/sessions'
import { THEME_SYSTEMS } from '../../../shared/themeSystems'
import { useAppearanceStore } from '../stores/appearance'
import { useSessionsStore } from '../stores/sessions'
import type { SessionItem } from '../stores/sessions'
import { useUiStore } from '../stores/ui'

interface SessionPanelProps {
  panelWidth: number
  /* 收起态轨道（2026-09-28 专项）：布局态由 MainShell 持有（同时决定 panel-left
     宽度与分隔条去留），面板只按此渲染收起变体并回报按钮动作 */
  collapsed: boolean
  onToggleCollapse: () => void
}

function SessionPanel({
  panelWidth,
  collapsed,
  onToggleCollapse
}: SessionPanelProps): React.JSX.Element {
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
  // 模式开关、勾选集、URL 弹层 open 与草稿、克隆中的行 id
  const [batchMode, setBatchMode] = useState(false)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [urlOpen, setUrlOpen] = useState(false)
  const [urlDraft, setUrlDraft] = useState('')
  // URL 弹层行内错误态（整单拒绝时保持弹层开启并提示，对齐地址栏无效提示惯例）
  const [urlInvalid, setUrlInvalid] = useState(false)
  const [cloningIds, setCloningIds] = useState<Set<string>>(new Set())
  // 批量移动板脚反馈条（2026-09-17 增量）：反馈为面板本地 UI 态——成功次墨
  // ~2.4s 淡出、失败 danger 持续至下一次操作（对齐打开测试地址失败不静默惯例）。
  // 弹层本体已于 2026-09-21 迁主进程模态子窗口（原生 sheet，PRD 4.11），不再有
  // 渲染层移动弹层状态
  const [batchFeedback, setBatchFeedback] = useState<{
    tone: 'success' | 'danger'
    text: string
    fading?: boolean
  } | null>(null)
  const feedbackTimer = useRef<number | undefined>(undefined)
  // 批量移动在途守卫（审查修复轮低 6）：sheet 关闭后执行 IPC 在途窗口内忽略后续
  // 触发，防重复 IPC 与「已移动 0 个」的困惑反馈
  const batchMoveInFlight = useRef(false)
  // 批量关闭原生确认框在途守卫：弹框期间连点按钮忽略后续触发，防重复弹框
  const closeConfirmInFlight = useRef(false)

  // 工作区视野：'all' 全量，'ungrouped' 仅未分组（2026-09-21 增量），否则按归属
  // 过滤（store 仍持全量——拖拽全序、级联与批量「关闭选中」的集合判定都以全量为
  // 准，视野只是渲染过滤，PRD 4.8）
  const viewIsAll = activeWorkspaceId === WORKSPACE_VIEW_ALL
  const viewIsUngrouped = activeWorkspaceId === WORKSPACE_VIEW_UNGROUPED
  const visibleSessions = useMemo(
    () =>
      viewIsAll
        ? sessions
        : viewIsUngrouped
          ? sessions.filter((s) => s.workspaceId === null)
          : sessions.filter((s) => s.workspaceId === activeWorkspaceId),
    [sessions, viewIsAll, viewIsUngrouped, activeWorkspaceId]
  )
  // 新建/克隆落点：当前视野对应的工作区（'all' 与 'ungrouped' 视野 = 未分组 null，
  // PRD 3.1.5）
  const membership = viewIsAll || viewIsUngrouped ? null : activeWorkspaceId
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

  // 收起即退出批量态（计划 2.4 契约）：批量板脚操作栏与行级勾选在 48px 轨道上
  // 结构性不可达，僵尸勾选会随展开复活——收起时整组清零；展开态不受影响
  useEffect(() => {
    if (!collapsed) return
    setBatchMode(false)
    setChecked(new Set())
    setUrlOpen(false)
  }, [collapsed])

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

  // 移动到工作区（原生模态框，PRD 4.11，2026-09-21 迁移）：入口不再弹渲染层 Modal，
  // 经 dialog 域 show 通道弹主进程模态子窗口（macOS 原生 sheet）——模态由窗口系统
  // 承担、页面视图保持可见，不经 overlay 悬挂登记。只选择不执行：picked 后经既有
  // workspaces:move-session 闭环；cancelled（Esc/关窗/建窗失败）零副作用；执行失败
  // 行内反馈（一次性模态，可从入口再次发起）
  const openMoveModal = (session: SessionItem): void => {
    void showWorkspacePicker({ kind: 'workspace-move-single', sessionId: session.id }).then(
      async (result) => {
        if (result.status !== 'picked') return
        const ok = await moveSessionToWorkspace(session.id, result.workspaceId)
        if (!ok) message.error(t('sessions.panel.moveFailed'))
      }
    )
  }

  // 批量移动（原生模态框同规）：幂等语义由主进程承担——moved/skipped 为真实计数；
  // 成功清空勾选保持批量态并反馈（~2.4s 淡出），失败反馈条 danger 持续（一次性
  // 模态不再保持弹层供重试——对齐删除确认框一次性口径，PRD 4.11），可从入口再次发起
  const openBatchMoveModal = (): void => {
    setBatchFeedback(null)
    void showWorkspacePicker({ kind: 'workspace-move-batch', ids: checkedIds }).then((result) => {
      if (result.status !== 'picked') return
      return pickBatchMoveTarget(result.workspaceId)
    })
  }
  const pickBatchMoveTarget = async (workspaceId: string | null): Promise<void> => {
    if (checkedCount === 0 || batchMoveInFlight.current) return
    batchMoveInFlight.current = true
    try {
      const result = await moveSessionsToWorkspace(checkedIds, workspaceId)
      if (!result) {
        setBatchFeedback({ tone: 'danger', text: t('sessions.batchFeedback.moveFailed') })
        return
      }
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

  // Esc 退出批量模式：仅模式激活、焦点不在输入控件、且 URL 弹层未开启时生效
  // （弹层开关用组件状态标记，不依赖 antd 内部类名。批量移动的模态子窗口不在此
  // 列：窗口模态吞键，Esc 不会抵达 renderer——sheet 自身消费 Esc 即取消）
  useEffect(() => {
    if (!batchMode) return
    const onKeydown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      const el = document.activeElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
      if (urlOpen) return
      setBatchMode(false)
      setChecked(new Set())
    }
    window.addEventListener('keydown', onKeydown)
    return () => window.removeEventListener('keydown', onKeydown)
  }, [batchMode, urlOpen])

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
      <aside className={`session-panel${collapsed ? ' collapsed' : ''}`}>
        <header className="board-head">
          {/* macOS 主窗（winc=traffic 门控）：原生标题条已去，左上角为系统原生三灯
              （trafficLightPosition 定位，主进程 index.ts），此处仅留占位防内容顶入
              灯区，原标题文字随之移除（原生/页内双份展示一并收敛）；其余平台保持
              页内标题现状（Windows 原生标题栏并存为既有设计）。收起态按用户裁决
              「顶部功能按钮全部隐藏，左上角只保留关闭钮」：三灯照常，页内标题在
              48px 轨道上无处容身，一并隐藏（含 Windows 页内标题变体） */}
          {windowTrafficControls && <span className="traffic-spacer" aria-hidden="true" />}
          {!collapsed && !windowTrafficControls && (
            <span className="board-title">
              <span className="board-title-text">{t('common.appName')}</span>
            </span>
          )}
          <span className="board-head-right">
            {!collapsed && <AppearanceEntry panelWidth={panelWidth} />}
            {!collapsed && (
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
            )}
            {/* 设置齿轮（设置专项阶段一）：恒渲染不随左栏宽度降级——它是 Windows 的
                唯一发现路径，宽度降级由外观三段阈值（AppearanceEntry）承担；开窗/
                聚焦单例由主进程裁决（重复点击聚焦既有窗）。收起态例外（DESIGN 收起态
                条目，2026-09-28 用户裁决）：收起是用户显式选择的模式而非宽度降级，
                齿轮随板头整组隐藏、展开即恢复可达 */}
            {!collapsed && (
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
            )}
            {!collapsed && (
              <span className="board-count">
                <span className="board-count-label">{t('sessions.panel.countLabel')}</span>
                <CountTiles value={visibleSessions.length} />
              </span>
            )}
            {/* 收起/展开钮（侧边栏收起专项 2026-09-28）：板头右侧控件带末位（紧贴
                分隔条，「往左收」的空间隐喻）；双箭头对偶——展开态 DoubleLeft 收起、
                收起态 DoubleRight 展开；20×20 度量镜像 settings-toggle 族。
                macOS 收起态例外：原生灯组实测绘占 x 37–69px，76px 轨道内板头行被
                灯组占满，钮下移到板头下方专用行（.collapse-row）；Windows 无灯，
                钮留在板头右侧原位 */}
            {!(collapsed && windowTrafficControls) && (
              <button
                type="button"
                className="collapse-toggle"
                title={
                  collapsed
                    ? t('sessions.panel.expandSidebar')
                    : t('sessions.panel.collapseSidebar')
                }
                aria-label={
                  collapsed
                    ? t('sessions.panel.expandSidebar')
                    : t('sessions.panel.collapseSidebar')
                }
                aria-expanded={!collapsed}
                onClick={onToggleCollapse}
              >
                {collapsed ? <DoubleRightOutlined /> : <DoubleLeftOutlined />}
              </button>
            )}
          </span>
        </header>
        {/* macOS 收起态专用展开行：板头被原生灯组占满后的钮位（灯行 + 钮行两段，
            与展开态板头/工作区条的两段节奏同构） */}
        {collapsed && windowTrafficControls && (
          <div className="collapse-row">
            <button
              type="button"
              className="collapse-toggle"
              title={t('sessions.panel.expandSidebar')}
              aria-label={t('sessions.panel.expandSidebar')}
              aria-expanded={false}
              onClick={onToggleCollapse}
            >
              <DoubleRightOutlined />
            </button>
          </div>
        )}
        {!collapsed && <WorkspaceSwitcher />}
        {collapsed ? (
          // 收起态轨道（2026-09-28 专项）：只渲染当前视野会话的状态点行（收起前
          // 所选组 = activeWorkspaceId 既有视野过滤，零新逻辑）；空视野轨道区空白，
          // 不渲染空态文案（收起态零文案原则，计划 2.3）
          <ul className="session-list">
            {visibleSessions.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                collapsed
                batchMode={false}
                checked={false}
                cloning={cloningIds.has(session.id)}
                dragEnabled={false}
                isDragSource={false}
                dropPos={null}
                wsTag={null}
                onToggleCheck={toggleChecked}
                onClone={handleClone}
                onMove={openMoveModal}
              />
            ))}
          </ul>
        ) : sessions.length === 0 ? (
          <div className="session-empty">
            <p className="session-empty-title">{t('sessions.panel.emptyAll.title')}</p>
            <p className="session-empty-desc">{t('sessions.panel.emptyAll.desc')}</p>
          </div>
        ) : visibleSessions.length === 0 ? (
          // 工作区/未分组视野空态：全局有会话但当前视野没有（板脚新建仍可用，落本
          // 视野——未分组视野的落点即未分组，审查低 4 文案分流）
          <div className="session-empty">
            <p className="session-empty-title">
              {viewIsUngrouped
                ? t('sessions.panel.emptyUngrouped.title')
                : t('sessions.panel.emptyWorkspace.title')}
            </p>
            <p className="session-empty-desc">
              {viewIsUngrouped
                ? t('sessions.panel.emptyUngrouped.desc')
                : t('sessions.panel.emptyWorkspace.desc')}
            </p>
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
          {collapsed ? (
            // 收起态板脚（2026-09-28 用户裁决「新建会话只留小图标」）：20×20 图标钮
            // 居中，保留板脚唯一大面积琥珀惯例的迷你形态（accent 底 + accent-ink 字）；
            // 文案复用既有 newSession 键作 title/aria，零新增字典项。落点 = 当前视野
            // 归属（membership 现逻辑不变）；批量操作栏在收起态结构性不可达（收起即
            // 退出批量态）
            <button
              type="button"
              className="new-session new-session-icon"
              title={t('sessions.panel.newSession')}
              aria-label={t('sessions.panel.newSession')}
              onClick={() => {
                void addSession(membership)
              }}
            >
              <PlusOutlined />
            </button>
          ) : batchMode ? (
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
              {batchFeedback && (
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
    </ConfigProvider>
  )
}

export default SessionPanel
