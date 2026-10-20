import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { App, Checkbox, Input, Tooltip } from 'antd'
import { MoreOutlined } from '@ant-design/icons'
import { useT } from '../i18n'
import { confirmDestructive } from '../dialogs'
import { SESSION_NOTE_MAX } from '../../../shared/sessions'
import { useSessionsStore } from '../stores/sessions'
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
  /** 打开该会话的代理设置原生 sheet（编排与失败反馈在 SessionPanel，onMove 同构） */
  onProxySettings: (session: SessionItem) => void
  /** 打开「导入 Chrome 数据」对话框（导入专项 2026-09-30）：提升到面板持目标态 */
  onImportChrome: (session: SessionItem) => void
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
  onMove,
  onProxySettings,
  onImportChrome
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
  // 状态字渲染期取词（i18n：模块级常量不得持有语言文案，原 statusText 常量随之入字典）
  const statusText: Record<SessionItem['status'], string> = {
    idle: t('sessions.sessionRow.status.idle'),
    loading: t('sessions.sessionRow.status.loading')
  }

  // 行菜单 = 主进程系统原生菜单（2026-10-15 反馈轮四，antd Dropdown 退役）：DOM
  // 菜单在壳层文档内，永远画在页面 WebContentsView 之下——锁进面板则被面板宽度
  // 挤压换行、探出左栏则被原生层裁切，两版均被否。原生菜单 OS 级绘制可盖在页面
  // 上方（用户裁决允许），且点任意位置（含页面区）关闭，找回全区域外点关闭能力。
  // 2026-10-20 统一裁决：右键与 ⋮ 弹同一全量菜单；触发口径逐字保留——批量态不弹，
  // 行右键编辑态不弹（旧 trigger 置空口径，编辑态 gate 在调用点）、⋮ 编辑态可弹
  //（审查低-4：静默无响应不可接受）。坐标 = 视口坐标（窗口内容坐标，Menu.popup
  // 直接消费）；⋮ 用按钮矩形左下角（键盘触发时点击坐标为 0）
  const requestRowMenu = (pos: { x: number; y: number }): void => {
    if (batchMode) return
    window.api.sessions.popupRowMenu({ id: session.id, x: pos.x, y: pos.y })
  }

  // 菜单项动作订阅：主进程推回 { id, key }（菜单关闭后到达——原生菜单无关闭动画，
  // 无需 2026-09-21 的延迟挂弹层机制），id 命中本行才分派到既有编排
  const dispatchRowMenuAction = (key: string): void => {
    if (key === 'rename') {
      startNameEdit()
    } else if (key === 'editNote') {
      startNoteEdit()
    } else if (key === 'clone') {
      void onClone(session.id)
    } else if (key === 'move') {
      onMove(session)
    } else if (key === 'importChrome') {
      onImportChrome(session)
    } else if (key === 'proxy') {
      // 代理设置 sheet（独立代理专项 2026-10-15）：sheet 编排与失败反馈归属
      // SessionPanel（板面反馈条先例，行内组件无反馈承载面）
      onProxySettings(session)
    } else if (key === 'delete') {
      // 破坏性确认走主进程原生对话框（PRD 4.10）：只确认不执行，确认后经既有
      // sessions:delete 链路删除；取消/Esc/关闭/调用失败零副作用
      void confirmDestructive({ kind: 'session-delete', name: session.name }).then((confirmed) => {
        if (confirmed) void removeSession(session.id)
      })
    }
  }
  const dispatchRef = useRef(dispatchRowMenuAction)
  useEffect(() => {
    dispatchRef.current = dispatchRowMenuAction
  })
  useEffect(() => {
    const off = window.api.sessions.onRowMenuAction((payload) => {
      if (payload.id === session.id) dispatchRef.current(payload.key)
    })
    return off
  }, [session.id])

  // 批量态行：勾选行背景常驻 raised；激活反白（selected）不渲染——反白语义专属
  // 单选激活，批量态不激活，当前激活会话由右侧浏览器表明
  const rowClass = batchMode
    ? `session-row${checked ? ' batch-checked' : ''}`
    : `session-row${selected ? ' selected' : ''}${isDragSource ? ' drag-source' : ''}`

  return (
    <>
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
          if (batchMode) onToggleCheck(session.id)
          else selectSession(session.id)
        }}
        onContextMenu={(e) => {
          // 行右键 → 主进程系统原生菜单（2026-10-15 反馈轮四）：OS 级绘制盖过页面
          // 原生层，可盖在浏览器区上方且点任意位置关闭；批量态/编辑态不弹（旧
          // trigger 置空口径，preventDefault 恒生效压制系统默认菜单）
          e.preventDefault()
          if (mode !== 'none') return
          requestRowMenu({ x: e.clientX, y: e.clientY })
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
          {session.proxy !== null && (
            // 代理徽标（独立代理专项 2026-10-15）：已配置时渲染，对齐 ws-tag
            // 「仅有值时渲染」零噪音先例——直接复用 .ws-tag 发丝线小标签（全灰阶
            // 零琥珀，反白随既有 .session-row.selected 覆写，零 CSS 增量）。Tooltip
            // 显「协议 · host:port」随界面语言（协议显 HTTP/SOCKS5 大写字面量）；
            // 下方弹出对齐备注悬停裁决（上缘不盖会话名与上方行），弹层锁挂面板
            // 防被右区 WebContentsView 原生层遮挡（note Tooltip 先例），0.2s 延迟
            // 防鼠标扫行频闪
            <Tooltip
              title={t('sessions.sessionProxy.badgeTip', {
                protocol: session.proxy.protocol.toUpperCase(),
                host: session.proxy.host,
                port: String(session.proxy.port)
              })}
              placement="bottomLeft"
              mouseEnterDelay={0.2}
              getPopupContainer={(triggerNode) =>
                triggerNode.closest<HTMLElement>('.session-panel') ?? triggerNode.parentElement!
              }
            >
              <span className="ws-tag">{t('sessions.sessionProxy.badge')}</span>
            </Tooltip>
          )}
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
            <button
              type="button"
              className="session-menu"
              aria-label={t('sessions.sessionRow.menuAria')}
              onClick={(e) => {
                // ⋮ 全量菜单（2026-10-20 与右键统一）：锚在按钮左下角（键盘激活时
                // 点击坐标为 0，退回按钮矩形）；stopPropagation 防行级再切会话
                e.stopPropagation()
                const rect = e.currentTarget.getBoundingClientRect()
                requestRowMenu({ x: rect.left, y: rect.bottom })
              }}
            >
              <MoreOutlined />
            </button>
          )}
        </div>
      </li>
    </>
  )
}

export default SessionRow
