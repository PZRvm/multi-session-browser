import { useMemo, useState } from 'react'
import { App, ConfigProvider, theme } from 'antd'
import { PlusOutlined, SettingOutlined } from '@ant-design/icons'
import AppearanceEntry from './AppearanceEntry'
import CountTiles from './CountTiles'
import { windowTrafficControls, useBrowserStore } from '../stores/browser'
import SessionRow from './SessionRow'
import WorkspaceSwitcher from './WorkspaceSwitcher'
import { useSessionDragReorder } from './useSessionDragReorder'
import { useT } from '../i18n'
import { closeWorkspacePicker, showWorkspacePicker } from '../dialogs'
import { WORKSPACE_VIEW_ALL, WORKSPACE_VIEW_UNGROUPED } from '../../../shared/sessions'
import type { ChromeImportPolicy } from '../../../shared/chromeImport'
import { THEME_SYSTEMS } from '../../../shared/themeSystems'
import { useAppearanceStore } from '../stores/appearance'
import { useSessionsStore } from '../stores/sessions'
import type { SessionItem } from '../stores/sessions'

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
  const reorderSessions = useSessionsStore((s) => s.reorderSessions)
  const moveSessionToWorkspace = useSessionsStore((s) => s.moveSessionToWorkspace)
  const setSessionProxy = useSessionsStore((s) => s.setSessionProxy)
  const refetchHistory = useBrowserStore((s) => s.refetchHistory)
  const { message } = App.useApp()

  // 克隆反馈为面板本地 UI 态（不进 store、不进主进程）：克隆中的行 id。
  // 批量模式（勾选集/URL 弹层/反馈条）已于 2026-10-23 随批量多选功能整体退役删除
  const [cloningIds, setCloningIds] = useState<Set<string>>(new Set())

  // 工作区视野：'all' 全量，'ungrouped' 仅未分组（2026-09-21 增量），否则按归属
  // 过滤（store 仍持全量——拖拽全序与级联判定都以全量为准，视野只是渲染过滤，PRD 4.8）
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

  // 代理设置（独立代理专项 2026-10-15，PRD 4.11/4.14）：原生 sheet 只出结论，
  // 保存/清除经既有 sessions:set-proxy 通道闭环（确认与执行两段解耦同 openMoveModal）；
  // 失败反馈走主进程原生信息框（set-proxy handler 失败点内联弹出，chromeImport
  // 完成点先例）。renderer 只消化结论：成功以返回快照
  // 更新镜像（徽标随动），false（invoke 失败）时主进程已弹框、此处静默
  const openProxySettings = (session: SessionItem): void => {
    void showWorkspacePicker({ kind: 'session-proxy', sessionId: session.id }).then(
      async (result) => {
        if (result.status !== 'session-proxy-submitted') return
        await setSessionProxy(session.id, result.proxy)
      }
    )
  }

  // 批量移动编排（openBatchMoveModal/pickBatchMoveTarget）已于 2026-10-23 随批量
  // 多选功能退役删除（单条移动入口 openMoveModal 保留）

  // 导入 Chrome 数据编排（反馈轮原生化）：结论经原生 sheet（picker 通道）两段闭环——
  // select（profile + 勾选）→ dry-run → 无冲突直接 execute；有冲突二次弹 conflict
  // sheet 裁决 → execute。结果/错误的原生框由主进程完成点弹出（chromeImport/index.ts
  // 内联 showMessageBox），此处只消化拒绝与驱动历史镜像重拉。确认与执行两段解耦同
  // showWorkspacePicker 先例（移动/重命名的执行均走既有通道）
  const openImportChrome = (session: SessionItem): void => {
    void (async () => {
      const picked = await showWorkspacePicker({
        kind: 'chrome-import-select',
        sessionId: session.id
      })
      if (picked.status !== 'chrome-import-picked') return
      try {
        const plan = await window.api.chromeImport.dryRun({
          sessionId: session.id,
          profileDir: picked.profileDir,
          scopes: picked.scopes
        })
        // dry-run 完成：关掉加载态选择 sheet（反馈轮三）；冲突则二次弹裁决 sheet
        await closeWorkspacePicker()
        const lsPlan = plan.scopes.find((item) => item.scope === 'localStorage')
        let policy: ChromeImportPolicy = 'session'
        if (lsPlan !== undefined && lsPlan.conflictKeys > 0) {
          const verdict = await showWorkspacePicker({
            kind: 'chrome-import-conflict',
            sessionId: session.id,
            keys: lsPlan.conflictKeys,
            origins: lsPlan.conflictOrigins
          })
          if (verdict.status !== 'chrome-import-policy') return
          policy = verdict.policy
        }
        const result = await window.api.chromeImport.execute({
          planId: plan.planId,
          localStoragePolicy: policy
        })
        // 导入不经 recordVisit 链路（无逐条推送），完成后重拉镜像使建议即时可用；
        // 原生结果框已由主进程弹出
        if (result.results.some((item) => item.scope === 'history' && item.status === 'done')) {
          refetchHistory()
        }
        await closeWorkspacePicker()
      } catch {
        // dry-run/execute 失败的原生错误框已由主进程失败点弹出，此处消化拒绝并
        // 关掉可能残留的加载态 sheet
        await closeWorkspacePicker()
      }
    })()
  }

  // 打开测试地址弹层与批量关闭确认（openUrlModal/confirmUrl/confirmCloseSelected）
  // 已于 2026-10-23 随批量多选功能退役删除——「打开测试地址」渲染层 modal 例外随之归零

  // 会话行映射（收起态行渲染已随 2026-10-23 侧边栏收起退役删除，恒为展开形态）
  const renderRows = (): React.JSX.Element[] =>
    visibleSessions.map((session) => (
      <SessionRow
        key={session.id}
        session={session}
        cloning={cloningIds.has(session.id)}
        wsTag={
          viewIsAll && workspaces.length > 0
            ? session.workspaceId !== null
              ? (wsNameById.get(session.workspaceId) ?? t('sessions.shared.ungrouped'))
              : t('sessions.shared.ungrouped')
            : null
        }
        {...rowProps(session)}
        onClone={handleClone}
        onMove={openMoveModal}
        onProxySettings={openProxySettings}
        onImportChrome={openImportChrome}
      />
    ))

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
          {/* macOS 主窗（winc=traffic 门控）：原生标题条已去，左上角为系统原生三灯
              （trafficLightPosition 定位，主进程 index.ts），此处仅留占位防内容顶入
              灯区；其余平台保持页内标题现状（Windows 原生标题栏并存为既有设计）。
              侧边栏收起态（含自绘关闭点）已于 2026-10-23 用户裁决整体退役删除 */}
          {windowTrafficControls ? (
            <span className="traffic-spacer" aria-hidden="true" />
          ) : (
            <span className="board-title">
              <span className="board-title-text">{t('common.appName')}</span>
            </span>
          )}
          <span className="board-head-right">
            <AppearanceEntry panelWidth={panelWidth} />
            {/* 批量入口（batch-toggle）已于 2026-10-23 随批量多选功能退役删除 */}
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
              <CountTiles value={visibleSessions.length} />
            </span>
            {/* 收起钮已于 2026-10-23 随侧边栏收起态整体退役删除 */}
          </span>
        </header>
        <WorkspaceSwitcher />
        {sessions.length === 0 ? (
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
            {renderRows()}
          </ul>
        )}
        <footer className="board-foot">
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
        </footer>
      </aside>
    </ConfigProvider>
  )
}

export default SessionPanel
