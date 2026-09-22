import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { App, Checkbox, Dropdown, Input, Tooltip } from 'antd'
import type { MenuProps } from 'antd'
import { MoreOutlined } from '@ant-design/icons'
import { useT } from '../i18n'
import { confirmDestructive } from '../dialogs'
import { SESSION_NOTE_MAX } from '../../../shared/sessions'
import { useSessionsStore } from '../stores/sessions'
import { useDeferredMenuAction } from './useDeferredMenuAction'
import { useUiStore } from '../stores/ui'
import type { SessionItem } from '../stores/sessions'

type RowEditMode = 'none' | 'name' | 'note'

/**
 * 会话行内编辑状态机（审查低 3 自 SessionRow 抽出）：名称/备注两种行内编辑共用
 * 一个互斥模式位——mode 即唯一真相，「双 Input 叠态」在结构上不可能发生。
 * 提交经 store 的 renameSession/setSessionNote（boolean 反馈），失败行内 message
 * 不静默（审查低 2）；草稿在进入时以会话现值重置防上轮残留，cancelEdit 放回不提交。
 */
interface RowEditModeApi {
  mode: RowEditMode
  nameDraft: string
  noteDraft: string
  setNameDraft: (value: string) => void
  setNoteDraft: (value: string) => void
  startNameEdit: () => void
  startNoteEdit: () => void
  cancelEdit: () => void
  commitNameEdit: () => void
  commitNoteEdit: () => void
}

function useRowEditMode(session: SessionItem): RowEditModeApi {
  const { message } = App.useApp()
  const t = useT()
  const renameSession = useSessionsStore((s) => s.renameSession)
  const setSessionNote = useSessionsStore((s) => s.setSessionNote)
  const [mode, setMode] = useState<RowEditMode>('none')
  const [nameDraft, setNameDraft] = useState(session.name)
  const [noteDraft, setNoteDraft] = useState(session.note)

  const startNameEdit = (): void => {
    setNameDraft(session.name)
    setMode('name')
  }
  const startNoteEdit = (): void => {
    setNoteDraft(session.note)
    setMode('note')
  }
  const cancelEdit = (): void => setMode('none')

  // 提交前先退出编辑态（Input 卸载即失焦，blur 不再二次提交）
  const commitNameEdit = (): void => {
    setMode('none')
    void renameSession(session.id, nameDraft).then((ok) => {
      if (!ok) message.error(t('sessions.sessionRow.editFailed'))
    })
  }
  // 备注提交：空串 = 清除（store/主进程同语义），行内恢复「未填写备注」占位
  const commitNoteEdit = (): void => {
    setMode('none')
    void setSessionNote(session.id, noteDraft).then((ok) => {
      if (!ok) message.error(t('sessions.sessionRow.editFailed'))
    })
  }

  return {
    mode,
    nameDraft,
    noteDraft,
    setNameDraft,
    setNoteDraft,
    startNameEdit,
    startNoteEdit,
    cancelEdit,
    commitNameEdit,
    commitNoteEdit
  }
}

/**
 * 备注 Tooltip 悬停现测（审查低 3 自 SessionRow 抽出）：仅文本实际溢出（单行
 * 省略号生效中）才显示；悬停进入时现测，渲染期不测（resize 后以再次悬停为准，
 * 瞬态无需跟随）。maxWidth 同时在此定格：弹层超宽时 rc-align 会水平翻转为
 * 「左缘对齐备注左缘、向右展开」，封顶须扣除备注左缘（面板宽 − 备注左缘 − 16px）
 * 才能保证右缘不出面板——出面板即被右区原生层遮挡。
 */
interface NoteTipApi {
  noteRef: RefObject<HTMLSpanElement | null>
  noteTip: { truncated: boolean; maxWidth?: number }
  measureNoteTruncated: () => void
}

function useNoteTip(): NoteTipApi {
  const noteRef = useRef<HTMLSpanElement>(null)
  const [noteTip, setNoteTip] = useState<{ truncated: boolean; maxWidth?: number }>({
    truncated: false
  })
  const measureNoteTruncated = (): void => {
    const el = noteRef.current
    if (!el) return
    const panel = el.closest<HTMLElement>('.session-panel')
    const panelWidth = panel?.getBoundingClientRect().width
    const spanLeft = el.getBoundingClientRect().left - (panel?.getBoundingClientRect().left ?? 0)
    setNoteTip({
      truncated: el.scrollWidth > el.clientWidth,
      maxWidth:
        typeof panelWidth === 'number'
          ? Math.max(160, Math.round(panelWidth - spanLeft - 16))
          : undefined
    })
  }
  return { noteRef, noteTip, measureNoteTruncated }
}

interface SessionRowProps {
  session: SessionItem
  batchMode: boolean
  checked: boolean
  cloning: boolean
  // 拖拽排序（面板级手势的面注入）：dragEnabled = 普通态（批量态整列禁拖）；
  // 行内编辑态由本组件并入 draggable；isDragSource/dropPos 只驱视觉
  dragEnabled: boolean
  isDragSource: boolean
  dropPos: 'before' | 'after' | null
  // 「全部会话」视野下在第二行行首显示归属标记（工作区名或「未分组」）；
  // 工作区视野内全员同归属，不渲染标记
  wsTag: string | null
  onToggleCheck: (id: string) => void
  onClone: (id: string) => Promise<void>
  onMove: (session: SessionItem) => void
}

function SessionRow({
  session,
  batchMode,
  checked,
  cloning,
  dragEnabled,
  isDragSource,
  dropPos,
  wsTag,
  onToggleCheck,
  onClone,
  onMove
}: SessionRowProps): React.JSX.Element {
  const t = useT()
  const { activeId, removeSession, selectSession } = useSessionsStore()
  const {
    mode,
    nameDraft,
    noteDraft,
    setNameDraft,
    setNoteDraft,
    startNameEdit,
    startNoteEdit,
    cancelEdit,
    commitNameEdit,
    commitNoteEdit
  } = useRowEditMode(session)
  const { noteRef, noteTip, measureNoteTruncated } = useNoteTip()
  const selected = activeId === session.id
  // 右键菜单受控开关（antd contextMenu 触发不随菜单项点击自动关闭——受控 open
  // 在 onClick 内显式收敛；外点/Esc 仍由 onOpenChange 收敛）
  const [ctxOpen, setCtxOpen] = useState(false)
  // ⋮ 菜单受控开关（与右键菜单互斥协调 + overlay 登记同步）
  const [dotsOpen, setDotsOpen] = useState(false)
  const openOverlay = useUiStore((s) => s.openOverlay)
  const closeOverlay = useUiStore((s) => s.closeOverlay)

  // 状态字渲染期取词（i18n：模块级常量不得持有语言文案，原 statusText 常量随之入字典）
  const statusText: Record<SessionItem['status'], string> = {
    idle: t('sessions.sessionRow.status.idle'),
    loading: t('sessions.sessionRow.status.loading')
  }

  const menuItems: MenuProps['items'] = [
    {
      key: 'rename',
      label: t('sessions.sessionRow.menu.rename')
    },
    {
      key: 'editNote',
      label: t('sessions.sessionRow.menu.editNote')
    },
    {
      key: 'clone',
      label: t('sessions.sessionRow.menu.clone')
    },
    {
      key: 'move',
      label: t('sessions.sessionRow.menu.move')
    },
    {
      key: 'delete',
      label: t('sessions.sessionRow.menu.delete'),
      danger: true
    }
  ]

  // 行菜单开启期间登记 overlay（ui.ts 约束）：右区是 WebContentsView 原生层，
  // 页面视图挂载时其点击事件永远进不了 shell 文档，rc-trigger 的「外部点击关闭」
  // 对页面区点击不生效、菜单会残留——登记后页面视图收起、点击落进 shell 文档，
  // 外点关闭才全区域生效；菜单关闭即恢复页面视图。ctx/dots 互斥不并存，计数式
  // 登记对称加减，卸载走 effect cleanup 兜底
  useEffect(() => {
    if (!ctxOpen && !dotsOpen) return
    openOverlay()
    return () => closeOverlay()
  }, [ctxOpen, dotsOpen, openOverlay, closeOverlay])

  // 挂窗口模态弹层的菜单动作（移动 sheet / 删除确认框）统一经共享 hook 延迟：
  // 先让菜单关闭动画走完再挂弹层（防窗口模态遮挡冻结动画致菜单卡显），宿主卸载
  // 时取消未触发动作（机制与单源见 useDeferredMenuAction）
  const deferWhileMenuCloses = useDeferredMenuAction()

  const onMenuClick: MenuProps['onClick'] = ({ key, domEvent }) => {
    domEvent.stopPropagation()
    if (key === 'rename') {
      startNameEdit()
    } else if (key === 'editNote') {
      startNoteEdit()
    } else if (key === 'clone') {
      void onClone(session.id)
    } else if (key === 'move') {
      deferWhileMenuCloses(() => onMove(session))
    } else if (key === 'delete') {
      // 破坏性确认走主进程原生对话框（PRD 4.10）：window-modal 模态阻塞输入，
      // 弹框期间页面视图保持可见且内容原样——不经 overlay 悬挂登记收起右区
      // （那是渲染层弹层换可见性的手段，原生框无遮挡问题）。只确认不执行：
      // 确认后经既有 sessions:delete 链路删除；取消/Esc/关闭/调用失败零副作用
      // （吞错按取消语义统一收敛在 renderer dialogs 薄封装）
      deferWhileMenuCloses(() => {
        void confirmDestructive({ kind: 'session-delete', name: session.name }).then(
          (confirmed) => {
            if (confirmed) void removeSession(session.id)
          }
        )
      })
    }
  }

  // 批量态行：勾选行背景常驻 raised；激活反白（selected）不渲染——反白语义专属
  // 单选激活，批量态不激活，当前激活会话由右侧浏览器表明
  const rowClass = batchMode
    ? `session-row${checked ? ' batch-checked' : ''}`
    : `session-row${selected ? ' selected' : ''}${isDragSource ? ' drag-source' : ''}`

  // 右键唤起与 ⋮ 钮同款菜单（2026-09-21 反馈轮）：整行包 contextMenu Dropdown
  // 复用同一份 menuItems；批量态（无行菜单入口）与行内编辑态触发器置空——菜单
  // 语义随模式休眠，不与勾选/输入争交互。portal 至 body 与 ⋮ 钮菜单同规
  return (
    <Dropdown
      open={!batchMode && mode === 'none' && ctxOpen}
      onOpenChange={setCtxOpen}
      menu={{
        items: menuItems,
        onClick: (info) => {
          setCtxOpen(false)
          onMenuClick(info)
        }
      }}
      trigger={!batchMode && mode === 'none' ? ['contextMenu'] : []}
      placement="bottomRight"
    >
      <li
        className={rowClass}
        // 拖拽排序：面板级 dragstart/dragover/drop/dragend 经事件委托挂在 ul 上，
        // 行只携带身份属性与瞬态视觉态（data-drop-pos 驱动伪元素插入线）
        data-session-id={session.id}
        data-drop-pos={dropPos ?? undefined}
        draggable={dragEnabled && mode === 'none'}
        tabIndex={0}
        // 批量态声明 checkbox 语义（aria-checked 才对辅助技术可达）；非批量态保持
        // 默认 listitem + aria-current 的激活语义
        role={batchMode ? 'checkbox' : undefined}
        aria-current={!batchMode && selected ? 'true' : undefined}
        aria-checked={batchMode ? checked : undefined}
        onClick={() => {
          // 行体在右键菜单的触发域内：左键点行不构成「外部点击」不会自动收菜单，
          // 选会话/勾选前显式收起，防菜单残留（2026-09-21 反馈轮）
          setCtxOpen(false)
          if (batchMode) onToggleCheck(session.id)
          else selectSession(session.id)
        }}
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
          // 编辑态/内部控件按键不归行级：Input 内 Enter/Space 会冒泡至此，无守卫会
          // 吞空格字符并顺带切换会话（审查高 1）——镜像批量态分支的 target 守卫
          if (e.target !== e.currentTarget) return
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
          {mode === 'name' ? (
            <Input
              className="session-rename"
              size="small"
              value={nameDraft}
              autoFocus
              variant="borderless"
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setNameDraft(e.target.value)}
              onPressEnter={commitNameEdit}
              onBlur={commitNameEdit}
              onKeyDown={(e) => {
                if (e.key === 'Escape') cancelEdit()
              }}
            />
          ) : (
            <span className="session-name">{session.name}</span>
          )}
          <span className="session-page">{session.pageTitle}</span>
        </div>
        <div className="session-row-sub">
          {wsTag !== null && <span className="ws-tag">{wsTag}</span>}
          {mode === 'note' ? (
            // 编辑态与重命名 Input 同构：borderless 小号、autoFocus、点击不冒泡防触
            // 发行选中；Enter/失焦经 store 提交（trim 后空串 = 清除）、Esc 放回现值；
            // maxLength 取 shared 单源，超限在输入端截断防主进程静默截断
            <Input
              className="session-note-edit"
              size="small"
              value={noteDraft}
              autoFocus
              variant="borderless"
              maxLength={SESSION_NOTE_MAX}
              aria-label={t('sessions.sessionRow.noteInputAria')}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setNoteDraft(e.target.value)}
              onPressEnter={commitNoteEdit}
              onBlur={commitNoteEdit}
              onKeyDown={(e) => {
                if (e.key === 'Escape') cancelEdit()
              }}
            />
          ) : session.note ? (
            // 悬停看全文（2026-09-18 增量）：仅行内省略号截断时显示（未溢出不弹）；
            // 占位「未填写备注」不挂 Tooltip（重复展示是零信息噪音，PRD 4.8）。
            // getPopupContainer 锁挂 .session-panel（AppearanceEntry 惯例）+ maxWidth
            // 悬停时按面板与备注左缘现算（见 useNoteTip 注）——右区是
            // WebContentsView 原生层，弹层不越面板即不被遮挡。
            // placement bottomRight：弹层在备注下方、右上角对齐备注右下角向左展开
            // （用户裁决 2026-09-18：上方会盖住会话名与上方行）。箭头保留（用户裁决
            // 同日：tip 上缘要有箭头），底色经 .session-note-tip 覆盖为板面抬升层。
            // 0.2s 延迟防鼠标扫过行间频闪（批量图标先例）
            <Tooltip
              title={noteTip.truncated ? session.note : undefined}
              placement="bottomRight"
              mouseEnterDelay={0.2}
              overlayClassName="session-note-tip"
              overlayStyle={noteTip.maxWidth ? { maxWidth: noteTip.maxWidth } : undefined}
              getPopupContainer={(triggerNode) =>
                triggerNode.closest<HTMLElement>('.session-panel') ?? triggerNode.parentElement!
              }
            >
              <span ref={noteRef} className="session-note" onMouseEnter={measureNoteTruncated}>
                {session.note}
              </span>
            </Tooltip>
          ) : (
            <span className="session-note">{t('sessions.sessionRow.noteEmpty')}</span>
          )}
          <span className={`session-status ${cloning ? 'loading' : session.status}`}>
            {cloning ? t('sessions.sessionRow.status.cloning') : statusText[session.status]}
          </span>
          {!batchMode && (
            <Dropdown
              open={!batchMode && dotsOpen}
              onOpenChange={setDotsOpen}
              menu={{
                items: menuItems,
                onClick: (info) => {
                  setDotsOpen(false)
                  onMenuClick(info)
                }
              }}
              trigger={['click']}
              placement="bottomRight"
            >
              <button
                type="button"
                className="session-menu"
                aria-label={t('sessions.sessionRow.menuAria')}
                // ⋮ 在右键菜单的触发域（整行）内：其按下不构成「外部点击」，rc-trigger
                // 不会收右键菜单——显式关闭防两菜单并存（2026-09-21 反馈轮）
                onMouseDown={() => setCtxOpen(false)}
                onClick={(e) => e.stopPropagation()}
              >
                <MoreOutlined />
              </button>
            </Dropdown>
          )}
        </div>
      </li>
    </Dropdown>
  )
}

export default SessionRow
