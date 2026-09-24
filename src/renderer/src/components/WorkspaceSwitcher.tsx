import { useEffect, useMemo, useRef, useState } from 'react'
import { App, Dropdown, Input } from 'antd'
import type { InputRef, MenuProps } from 'antd'
import { CheckOutlined, DownOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons'
import {
  WORKSPACE_NAME_MAX,
  WORKSPACE_VIEW_ALL,
  WORKSPACE_VIEW_UNGROUPED
} from '../../../shared/sessions'
import { useSessionsStore } from '../stores/sessions'
import { useUiStore } from '../stores/ui'
import { useDeferredMenuAction } from './useDeferredMenuAction'
import { confirmWorkspaceDelete, showWorkspacePicker } from '../dialogs'
import { useT } from '../i18n'
import { useWorkspaceDragReorder } from './useWorkspaceDragReorder'

/** 下拉选项（全部会话 + 各工作区；新建行独立渲染不入 options） */
interface WsOption {
  id: string
  name: string
}

/**
 * 工作区切换框（板头下唯一新表面，形态与视觉定稿见 DESIGN.md「工作区切换框」条目）：
 * 收起态 = 当前视野名 + 箭头 + 「+」新建钮；展开态 = 顶部过滤输入（键入即按名称
 * 子串过滤、↑↓ 导航、Enter 选中、Esc/外点关闭）+ 选项列表（当前视野加粗 + 对勾）
 * + 过滤无精确命中时的「新建工作区」尾行；「未分组」固定末位哨兵行（零工作区不
 * 渲染——零噪音基线）。右键工作区项弹下拉菜单（2026-09-21 反馈轮：原行内
 * 「重命名/删除」操作条退役，与会话行菜单同形态——触发 ['contextMenu'] 定位鼠标
 * 点，菜单 portal 锁挂 .session-panel 内不越左栏，即不被右区 WebContentsView
 * 原生层遮挡；面板外点关闭对 .ant-dropdown 豁免防菜单随面板自卸载）；
 * 重命名与删除确认均走主进程原生弹层（PRD 4.10/4.11，页面视图不收起，2026-09-21
 * 重命名自渲染层 Modal 迁移）。下拉面板自绘锚在
 * .session-panel 内（宽随左栏、不越分隔条）；过滤/键盘/开关均为组件本地
 * 瞬态，不进 store、不进 IPC；持久动作经 store 工作区动作落盘
 */
export default function WorkspaceSwitcher(): React.JSX.Element {
  const t = useT()
  const workspaces = useSessionsStore((s) => s.workspaces)
  const activeWorkspaceId = useSessionsStore((s) => s.activeWorkspaceId)
  const sessions = useSessionsStore((s) => s.sessions)
  const switchWorkspace = useSessionsStore((s) => s.switchWorkspace)
  const createWorkspace = useSessionsStore((s) => s.createWorkspace)
  const renameWorkspace = useSessionsStore((s) => s.renameWorkspace)
  const deleteWorkspace = useSessionsStore((s) => s.deleteWorkspace)
  const deleteSessions = useSessionsStore((s) => s.deleteSessions)
  const reorderWorkspaces = useSessionsStore((s) => s.reorderWorkspaces)
  const { message } = App.useApp()

  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  // 右键菜单受控开关（antd contextMenu 触发不随菜单项点击自动关闭——受控 open
  // 在 onClick 内显式收敛；外点/Esc 仍由 onOpenChange 收敛）
  const [ctxMenuId, setCtxMenuId] = useState<string | null>(null)
  const openOverlay = useUiStore((s) => s.openOverlay)
  const closeOverlay = useUiStore((s) => s.closeOverlay)
  const searchRef = useRef<InputRef | null>(null)
  const optionsRef = useRef<HTMLDivElement | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)

  const ungroupedName = t('sessions.shared.ungrouped')
  const viewName =
    activeWorkspaceId === WORKSPACE_VIEW_ALL
      ? t('sessions.workspaceSwitcher.allSessions')
      : activeWorkspaceId === WORKSPACE_VIEW_UNGROUPED
        ? ungroupedName
        : (workspaces.find((w) => w.id === activeWorkspaceId)?.name ??
          t('sessions.workspaceSwitcher.allSessions'))

  // 视野哨兵：全部会话固定首位；未分组固定末位（2026-09-21 用户反馈增量——
  // 仅存留未分组会话的视野）。零工作区时不渲染未分组行（全员未分组时它就是
  // 全部列表，单独成行是零信息噪音——与归属标记的零噪音基线同规），例外：
  // 当前视野即未分组时恒渲染（审查低 3——当前视野行不得从自己的列表里消失）
  const allOptions: WsOption[] = useMemo(
    () => [
      { id: WORKSPACE_VIEW_ALL, name: t('sessions.workspaceSwitcher.allSessions') },
      ...workspaces,
      ...(workspaces.length > 0 || activeWorkspaceId === WORKSPACE_VIEW_UNGROUPED
        ? [{ id: WORKSPACE_VIEW_UNGROUPED, name: ungroupedName }]
        : [])
    ],
    [workspaces, activeWorkspaceId, t, ungroupedName]
  )
  const keyword = filter.trim().toLowerCase()
  const filtered = useMemo(
    () => (keyword ? allOptions.filter((o) => o.name.toLowerCase().includes(keyword)) : allOptions),
    [allOptions, keyword]
  )
  // 新建候选：有过滤词且不与既有名称精确同名（同名时选既有即可，不重复建）
  const createCandidate =
    filter.trim() && !allOptions.some((o) => o.name === filter.trim()) ? filter.trim() : null
  const selectableCount = filtered.length + (createCandidate ? 1 : 0)

  // 拖拽排序手势（拖动排序专项 2026-09-21）：仅面板展开且无过滤词时启用——过滤视图
  // 是子集，子序重排语义含混，宁缺勿滥。入参恒为全量 workspaces（drop 全序合成即
  // 持久化顺序）；失败走整单拒绝不静默惯例（文案复用会话列表排序失败键，i18n 零新增）
  const dragEnabled = open && filter.trim() === ''
  const { panelHandlers, rowProps } = useWorkspaceDragReorder(
    workspaces,
    dragEnabled,
    reorderWorkspaces,
    () => message.error(t('sessions.panel.reorderFailed'))
  )

  const closePanel = (): void => {
    setOpen(false)
    setFilter('')
    setActiveIdx(0)
    setCtxMenuId(null)
  }

  // 右键菜单开启期间登记 overlay（ui.ts 约束，与会话行菜单同规）：右区原生层
  // 吞掉页面区点击、「外部点击关闭」对页面区不生效——登记后页面视图收起、点击
  // 落进 shell 文档，外点关闭才全区域生效；菜单关闭即恢复页面视图
  useEffect(() => {
    if (ctxMenuId === null) return
    openOverlay()
    return () => closeOverlay()
  }, [ctxMenuId, openOverlay, closeOverlay])

  // 展开即聚焦过滤输入（过滤为主路径）；外点关闭（含分隔条右缘）。
  // closePanel 等为稳定的组件闭包，仅 open 为触发依赖
  useEffect(() => {
    if (!open) return
    searchRef.current?.focus()
    const onMousedown = (e: MouseEvent): void => {
      const target = e.target as Element
      // 右键菜单 portal（.ant-dropdown）在 rootRef 外：点按菜单不能关面板，
      // 否则菜单锚随面板卸载、菜单项点不中
      if (
        rootRef.current &&
        !rootRef.current.contains(target) &&
        !target.closest?.('.ant-dropdown')
      )
        closePanel()
    }
    document.addEventListener('mousedown', onMousedown)
    return () => document.removeEventListener('mousedown', onMousedown)
  }, [open])

  // 挂窗口模态弹层的菜单动作统一经共享 hook 延迟（机制与单源见 useDeferredMenuAction）
  const deferWhileMenuCloses = useDeferredMenuAction()

  // 右键菜单项（重命名/删除工作区，danger 供色）——标签复用既有键，i18n 零新增
  const wsMenuItems: MenuProps['items'] = [
    { key: 'rename', label: t('sessions.workspaceSwitcher.rowRename') },
    { key: 'delete', label: t('sessions.workspaceSwitcher.rowDelete'), danger: true }
  ]

  const pick = (option: WsOption): void => {
    closePanel()
    void switchWorkspace(option.id).then((ok) => {
      if (!ok) message.error(t('sessions.workspaceSwitcher.errors.switchFailed'))
    })
  }

  const pickCreate = (): void => {
    const name = createCandidate
    if (!name) return
    void createWorkspace(name).then((created) => {
      if (!created) {
        message.error(t('sessions.workspaceSwitcher.errors.createFailed'))
        return
      }
      // 建即切入（空工作区空态引导用户就地新建会话）
      void switchWorkspace(created.id).then((ok) => {
        if (!ok) message.error(t('sessions.workspaceSwitcher.errors.switchFailed'))
      })
    })
    closePanel()
  }

  const pickActive = (): void => {
    if (activeIdx < filtered.length) pick(filtered[activeIdx])
    else if (createCandidate) pickCreate()
  }

  const onSearchKeydown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (selectableCount === 0) return
      setActiveIdx(
        (prev) => (prev + (e.key === 'ArrowDown' ? 1 : -1) + selectableCount) % selectableCount
      )
    } else if (e.key === 'Enter') {
      e.preventDefault()
      pickActive()
    } else if (e.key === 'Escape') {
      e.stopPropagation()
      closePanel()
    }
  }

  // 键盘高亮行滚入可视区（选项超出 224px 滚动容器时，↑↓ 不可见即不可选——审查低 2）
  const activeOptionDomId =
    activeIdx < filtered.length ? `ws-opt-${filtered[activeIdx].id}` : 'ws-opt-create'
  useEffect(() => {
    if (!open) return
    optionsRef.current?.querySelector('.ws-option.active')?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx, open, filter])

  // 重命名走主进程原生模态框（PRD 4.11，2026-09-21 自渲染层 Modal 迁移）：sheet
  // 预填现名由主进程快照现取，模态由窗口系统承担、页面视图保持可见，不经 overlay
  // 悬挂登记；submitted 后经既有 workspaces:rename 通道闭环（失败行内反馈，一次性
  // 模态可从入口再次发起）；cancelled（Esc/关窗/工作区已消失）零副作用
  const startRename = (id: string): void => {
    void showWorkspacePicker({ kind: 'workspace-rename', workspaceId: id }).then((result) => {
      if (result.status !== 'submitted') return
      void renameWorkspace(id, result.name).then((ok) => {
        if (!ok) message.error(t('sessions.workspaceSwitcher.errors.renameFailed'))
      })
    })
  }

  // 删除工作区走主进程原生对话框会话处置三选（PRD 4.10 / 验收 34，2026-09-24）：
  // 含会话呈「取消 / 保留会话 / 删除全部会话」，空工作区维持两键确认；window-modal
  // 模态阻塞输入，弹框期间页面视图保持可见且内容原样，不经 overlay 悬挂登记收起
  // 右区（菜单触发经 deferWhileMenuCloses 延迟挂出，见下方菜单接线）。只确认不
  // 执行：delete-all 由本处编排既有 sessions:delete-batch → workspaces:delete
  // （id 集在结论后从 store 现取防闭包旧值；delete-batch 整单拒绝则工作区不删、
  // 行内反馈可从入口再次发起），keep-sessions 经既有 workspaces:delete 降级未分组；
  // 取消/Esc/关闭/调用失败零副作用（吞错按 cancel 语义统一收敛在 renderer dialogs
  // 薄封装）
  // 在途守卫（对齐 SessionPanel closeConfirmInFlight 先例）：弹窗为窗口模态天然
  // 防重入，但结论返回后的编排链（delete-batch → workspaces:delete 两次 IPC 往返）
  // 飞行期主窗输入已恢复，此窗口内重入直接忽略，防双弹窗连发与交错反馈；守卫整链
  // （确认+删除）落定才释放（.finally 覆盖 取消/失败/成功 全部路径）
  const confirmInFlight = useRef(false)
  const confirmDelete = (id: string, name: string): void => {
    if (confirmInFlight.current) return
    const count = sessions.filter((s) => s.workspaceId === id).length
    confirmInFlight.current = true
    void confirmWorkspaceDelete({ name, count })
      .then((choice) => {
        if (choice === 'cancel') return undefined
        // afterSessionsDeleted 区分终态反馈：delete-all 链上工作区删除失败时会话
        // 已实际删除，复用 deleteFailed 会让用户误以为零变化（审查低 3）
        const finishDelete = (afterSessionsDeleted: boolean): Promise<void> =>
          deleteWorkspace(id).then((ok) => {
            if (!ok) {
              message.error(
                t(
                  afterSessionsDeleted
                    ? 'sessions.workspaceSwitcher.errors.deleteWorkspaceAfterSessionsFailed'
                    : 'sessions.workspaceSwitcher.errors.deleteFailed'
                )
              )
            }
          })
        if (choice !== 'delete-all') return finishDelete(false)
        const ids = useSessionsStore
          .getState()
          .sessions.filter((s) => s.workspaceId === id)
          .map((s) => s.id)
        if (ids.length === 0) return finishDelete(false)
        return deleteSessions(ids).then((ok) => {
          if (!ok) {
            message.error(t('sessions.workspaceSwitcher.errors.deleteSessionsFailed'))
            return
          }
          return finishDelete(true)
        })
      })
      .finally(() => {
        confirmInFlight.current = false
      })
  }

  return (
    <div className="workspace-bar" ref={rootRef}>
      <button
        type="button"
        className={`ws-combobox${open ? ' open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={t('sessions.workspaceSwitcher.comboboxTitle')}
        onClick={() => (open ? closePanel() : setOpen(true))}
      >
        <span className="ws-combobox-label">{viewName}</span>
        <span className="ws-combobox-caret">
          <DownOutlined />
        </span>
      </button>

      {open && (
        <div
          className="ws-panel"
          role="listbox"
          aria-label={t('sessions.workspaceSwitcher.panelAria')}
        >
          <div className="ws-search-host">
            <span className="ws-search-icon">
              <SearchOutlined />
            </span>
            <Input
              ref={searchRef}
              className="ws-search"
              size="small"
              variant="borderless"
              placeholder={t('sessions.workspaceSwitcher.searchPlaceholder')}
              aria-label={t('sessions.workspaceSwitcher.searchAria')}
              // combobox 键盘域：读屏经 aria-activedescendant 感知 ↑↓ 高亮行（审查低 4）
              id="ws-search-input"
              aria-controls="ws-listbox"
              aria-activedescendant={open ? activeOptionDomId : undefined}
              value={filter}
              maxLength={WORKSPACE_NAME_MAX}
              onChange={(e) => {
                setFilter(e.target.value)
                setActiveIdx(0)
              }}
              onKeyDown={onSearchKeydown}
            />
          </div>
          <div
            className={`ws-options${dragEnabled ? ' drag-enabled' : ''}`}
            id="ws-listbox"
            ref={optionsRef}
            {...panelHandlers}
          >
            {filtered.map((option, i) => {
              const isCurrent = option.id === activeWorkspaceId
              const isSentinel =
                option.id === WORKSPACE_VIEW_ALL || option.id === WORKSPACE_VIEW_UNGROUPED
              // 拖拽视觉态（哨兵行恒不可拖——rowProps 对 WORKSPACE_VIEW_ALL 全否）
              const { isDraggable, isDragSource, dropPos } = rowProps(option.id)
              const row = (
                <div
                  key={option.id}
                  id={`ws-opt-${option.id}`}
                  className={`ws-option${isCurrent ? ' current' : ''}${i === activeIdx ? ' active' : ''}${isDragSource ? ' drag-source' : ''}`}
                  role="option"
                  aria-selected={isCurrent}
                  data-ws={option.id}
                  data-drop-pos={dropPos ?? undefined}
                  draggable={isDraggable}
                  title={
                    isSentinel
                      ? option.name
                      : t('sessions.workspaceSwitcher.optionHint', { name: option.name })
                  }
                  onClick={() => pick(option)}
                >
                  <span className="ws-option-name">{option.name}</span>
                  {isCurrent && (
                    <span className="ws-option-check">
                      <CheckOutlined />
                    </span>
                  )}
                </div>
              )
              // 视野哨兵行非工作区实体，无右键菜单；工作区行右键弹下拉菜单
              // （与会话行菜单同形态，定位鼠标点）：重命名/删除走既有原生弹层链路。
              // 菜单 portal 锁挂 .session-panel 内 + bottomLeft——不越左栏即不被
              // 右区 WebContentsView 原生层遮挡
              if (isSentinel) return row
              return (
                <Dropdown
                  key={option.id}
                  open={ctxMenuId === option.id}
                  onOpenChange={(visible) => setCtxMenuId(visible ? option.id : null)}
                  menu={{
                    items: wsMenuItems,
                    onClick: ({ key, domEvent }) => {
                      domEvent.stopPropagation()
                      setCtxMenuId(null)
                      deferWhileMenuCloses(() =>
                        key === 'rename'
                          ? startRename(option.id)
                          : confirmDelete(option.id, option.name)
                      )
                    }
                  }}
                  trigger={['contextMenu']}
                  placement="bottomLeft"
                  getPopupContainer={(node) =>
                    node.closest<HTMLElement>('.session-panel') ?? node.parentElement!
                  }
                >
                  {row}
                </Dropdown>
              )
            })}
            {createCandidate && (
              <div
                id="ws-opt-create"
                className={`ws-option ws-option-create${activeIdx === filtered.length ? ' active' : ''}`}
                role="option"
                onClick={pickCreate}
              >
                <span className="ws-create-icon">
                  <PlusOutlined />
                </span>
                <span className="ws-option-name">
                  {t('sessions.workspaceSwitcher.createOption', { name: createCandidate })}
                </span>
              </div>
            )}
            {selectableCount === 0 && (
              <div className="ws-option-empty">{t('sessions.workspaceSwitcher.noMatch')}</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
