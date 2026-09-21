import { useEffect, useMemo, useRef, useState } from 'react'
import { App, Button, Input, Modal } from 'antd'
import type { InputRef } from 'antd'
import { CheckOutlined, DownOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons'
import { WORKSPACE_NAME_MAX, WORKSPACE_VIEW_ALL } from '../../../shared/sessions'
import { useSessionsStore } from '../stores/sessions'
import { useUiStore } from '../stores/ui'
import { confirmDestructive } from '../dialogs'
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
 * + 过滤无精确命中时的「新建工作区」尾行。右键工作区项在该行内展开「重命名/删除」
 * 操作条（行内渲染不越左栏，规避 antd 子菜单飞出分隔条被右区 WebContentsView
 * 原生层遮挡的风险——原生层约束下的形态裁定，与概念演示的悬停子菜单不同）；
 * 重命名确认走 antd Modal 经 overlay 悬挂登记收起原生层，删除确认走主进程原生
 * 对话框（PRD 4.10，页面视图不收起）。下拉面板自绘锚在
 * .session-panel 内（宽随左栏、不越分隔条）；过滤/键盘/开关/操作条均为组件本地
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
  const reorderWorkspaces = useSessionsStore((s) => s.reorderWorkspaces)
  const openOverlay = useUiStore((s) => s.openOverlay)
  const closeOverlay = useUiStore((s) => s.closeOverlay)
  const { message } = App.useApp()

  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  // 右键操作条：正在显示「重命名/删除」的选项 id
  const [ctxRow, setCtxRow] = useState<string | null>(null)
  // 重命名弹层（受控 Modal + Input，开关经 overlay 登记）
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameTarget, setRenameTarget] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const searchRef = useRef<InputRef | null>(null)
  const optionsRef = useRef<HTMLDivElement | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)

  const viewName =
    activeWorkspaceId === WORKSPACE_VIEW_ALL
      ? t('sessions.workspaceSwitcher.allSessions')
      : (workspaces.find((w) => w.id === activeWorkspaceId)?.name ??
        t('sessions.workspaceSwitcher.allSessions'))

  const allOptions: WsOption[] = useMemo(
    () => [
      { id: WORKSPACE_VIEW_ALL, name: t('sessions.workspaceSwitcher.allSessions') },
      ...workspaces
    ],
    [workspaces, t]
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
    setCtxRow(null)
  }

  // 展开即聚焦过滤输入（过滤为主路径）；外点关闭（含分隔条右缘）。
  // closePanel/setCtxRow 等为稳定的组件闭包，仅 open 为触发依赖
  useEffect(() => {
    if (!open) return
    searchRef.current?.focus()
    const onMousedown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) closePanel()
    }
    document.addEventListener('mousedown', onMousedown)
    return () => document.removeEventListener('mousedown', onMousedown)
  }, [open])

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

  const startRename = (id: string, name: string): void => {
    openOverlay()
    setRenameTarget(id)
    setRenameDraft(name)
    setRenameOpen(true)
  }

  const confirmRename = (): void => {
    const id = renameTarget
    const name = renameDraft.trim()
    if (!id || !name) return
    void renameWorkspace(id, name).then((ok) => {
      if (!ok) message.error(t('sessions.workspaceSwitcher.errors.renameFailed'))
      setRenameOpen(false)
    })
  }

  const confirmDelete = (id: string, name: string): void => {
    const count = sessions.filter((s) => s.workspaceId === id).length
    // 删除确认走主进程原生对话框（PRD 4.10）：window-modal 模态阻塞输入，弹框
    // 期间页面视图保持可见且内容原样，不经 overlay 悬挂登记收起右区（重命名弹层
    // 仍为渲染层 Modal，登记保留）。只确认不执行：确认后经既有 workspaces:delete
    // 链路删除（会话降级未分组）；取消/Esc/关闭/调用失败零副作用（吞错按取消
    // 语义统一收敛在 renderer dialogs 薄封装）
    void confirmDestructive({ kind: 'workspace-delete', name, count }).then((confirmed) => {
      if (!confirmed) return
      void deleteWorkspace(id).then((ok) => {
        if (!ok) message.error(t('sessions.workspaceSwitcher.errors.deleteFailed'))
      })
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
              onFocus={() => setCtxRow(null)}
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
              const isCtx = ctxRow === option.id
              // 拖拽视觉态（哨兵行恒不可拖——rowProps 对 WORKSPACE_VIEW_ALL 全否）
              const { isDraggable, isDragSource, dropPos } = rowProps(option.id)
              return (
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
                    option.id === WORKSPACE_VIEW_ALL
                      ? option.name
                      : t('sessions.workspaceSwitcher.optionHint', { name: option.name })
                  }
                  onClick={() => {
                    if (isCtx) return
                    pick(option)
                  }}
                  onContextMenu={(e) => {
                    if (option.id === WORKSPACE_VIEW_ALL) return
                    e.preventDefault()
                    setCtxRow(isCtx ? null : option.id)
                  }}
                >
                  {isCtx ? (
                    <span className="ws-row-actions">
                      <Button
                        type="text"
                        size="small"
                        onClick={() => startRename(option.id, option.name)}
                      >
                        {t('sessions.workspaceSwitcher.rowRename')}
                      </Button>
                      <Button
                        type="text"
                        size="small"
                        danger
                        onClick={() => confirmDelete(option.id, option.name)}
                      >
                        {t('sessions.workspaceSwitcher.rowDelete')}
                      </Button>
                    </span>
                  ) : (
                    <>
                      <span className="ws-option-name">{option.name}</span>
                      {isCurrent && (
                        <span className="ws-option-check">
                          <CheckOutlined />
                        </span>
                      )}
                    </>
                  )}
                </div>
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

      <Modal
        title={t('sessions.workspaceSwitcher.renameModalTitle')}
        open={renameOpen}
        okText={t('sessions.workspaceSwitcher.saveText')}
        cancelText={t('common.cancel')}
        onOk={confirmRename}
        onCancel={() => setRenameOpen(false)}
        afterClose={() => {
          setRenameOpen(false)
          setRenameTarget(null)
          closeOverlay()
        }}
      >
        <Input
          value={renameDraft}
          maxLength={WORKSPACE_NAME_MAX}
          aria-label={t('sessions.workspaceSwitcher.nameAria')}
          onChange={(e) => setRenameDraft(e.target.value)}
          onPressEnter={confirmRename}
        />
      </Modal>
    </div>
  )
}
