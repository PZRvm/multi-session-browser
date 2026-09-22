import { useEffect, useRef, useState } from 'react'
import {
  PICKER_LIST_PAD_TOP,
  PICKER_MAX_VISIBLE_ROWS,
  PICKER_ROW_GAP,
  PICKER_ROW_HEIGHT,
  type WorkspacePickerContext
} from '../../../shared/dialog'
import { WORKSPACE_NAME_MAX } from '../../../shared/sessions'
import { useT } from '../i18n'

/**
 * 工作区模态框渲染端（第五角色 ?role=workspace-picker，原生 sheet；PRD 4.11）：
 * 纯受控零自治——展示上下文由主进程从权威快照现取（WorkspacePickerContext），
 * 挂载即经 payload 通道拉取，按 kind 分支渲染。选择场景（workspace-move-single /
 * batch）：点选行经 pick 通道回传 workspaceId（null = 移出未分组），当前归属行呈
 * 「当前所在」禁用态，键盘焦点 = veil 底（与切换框键盘高亮同族，取代被滚动容器
 * 裁剪的全局琥珀 focus ring）。重命名场景（workspace-rename，2026-09-21 增量）：
 * Input 预填现名挂载即聚焦全选，Enter/保存提交（trim 空不提交、保存钮禁用——
 * UI 面；主进程守卫 trim 非空 + 长度上限是契约面），取消钮/Esc 关窗由主进程
 * closed 钩子按取消收敛（取消 ≠ 提交两条路径严格分离）。文案消费既有字典键
 * （选择 sessions.moveModal.*、重命名 sessions.workspaceSwitcher.renameModalTitle
 * 等，i18n 零新增）；列表封顶高度由 shared 度量常量合成（与主进程建窗高度同源
 * 配对）；亮暗随 CSS 媒体查询
 */
export default function WorkspacePickerWindow(): React.JSX.Element {
  const t = useT()
  const [context, setContext] = useState<WorkspacePickerContext | null>(null)
  // payload 拉取失败（无在途请求/来源不被信任/通道异常）：不伪造选项，仅呈现空态
  const [loadFailed, setLoadFailed] = useState(false)
  // 重命名草稿（预填现名，上下文到位时初始化；纯 sheet 本地瞬态）
  const [draft, setDraft] = useState('')
  const firstOptionRef = useRef<HTMLButtonElement | null>(null)
  const renameInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    let disposed = false
    window.api.dialog
      .workspacePickerPayload()
      .then((payload) => {
        if (disposed) return
        // 上下文与重命名草稿（预填现名）同点初始化——草稿是纯 sheet 本地瞬态，
        // 随载荷一次性落定，不经 effect 同步（react-hooks/set-state-in-effect 禁区）
        if (payload) {
          setContext(payload)
          if (payload.currentName !== undefined) setDraft(payload.currentName)
        } else {
          setLoadFailed(true)
        }
      })
      .catch(() => {
        if (!disposed) setLoadFailed(true)
      })
    return () => {
      disposed = true
    }
  }, [])

  const isRename = context?.kind === 'workspace-rename'

  // 聚焦分流：重命名聚焦输入框并全选（改一个字即整词替换的最低成本路径）；
  // 选择场景聚焦首个可选项（当前归属行禁用不参与；全禁用时聚焦移出行，再无则不聚焦）
  const firstEnabledIdx = context?.options.findIndex((o) => !o.current) ?? -1
  useEffect(() => {
    if (isRename) {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    } else {
      firstOptionRef.current?.focus()
    }
  }, [context, isRename])

  // 重命名提交：UI 面 trim 空禁提交；主进程命中即关窗，连点窗口期的二次提交被
  // requestId/pending 守卫静默忽略
  const submitRename = (): void => {
    if (!context) return
    const name = draft.trim()
    if (!name) return
    void window.api.dialog
      .workspacePickerPick({ requestId: context.requestId, name })
      .catch(() => undefined)
  }

  const pick = (workspaceId: string | null): void => {
    if (!context) return
    // 主进程命中即关窗；连点窗口期的二次提交被 requestId/pending 守卫静默忽略
    void window.api.dialog
      .workspacePickerPick({ requestId: context.requestId, workspaceId })
      .catch(() => undefined)
  }

  // Esc = 取消（关窗，主进程 closed 兜底收敛 cancelled）；输入框聚焦态同样取消
  useEffect(() => {
    const onKeydown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        window.close()
      }
    }
    window.addEventListener('keydown', onKeydown)
    return () => window.removeEventListener('keydown', onKeydown)
  }, [])

  // payload 拉取失败（无在途请求/来源不被信任/通道异常，正常路径不可达）：无法
  // 区分场景语义，渲染最小兜底——不展示可能误导的选择类标题与空态文案，仅保留
  // 「取消」钮供鼠标关闭（Esc 同效），防御面
  if (loadFailed) {
    // 兜底不标 role="dialog"——场景语义不可知、无中性可读名称可配（读屏播报无名
    // 对话框不友好），取消钮自具名即可达（审查修复轮复审低 1）
    return (
      <div className="picker-body">
        <div className="picker-foot">
          <button type="button" className="picker-btn" onClick={() => window.close()}>
            {t('common.cancel')}
          </button>
        </div>
      </div>
    )
  }

  const title = context
    ? isRename
      ? t('sessions.workspaceSwitcher.renameModalTitle')
      : context.kind === 'workspace-move-single'
        ? t('sessions.moveModal.title', { name: context.sessionName ?? '' })
        : t('sessions.moveModal.batchTitle', { n: context.count ?? 0 })
    : t('sessions.moveModal.titleFallback')

  // 重命名形态：头部 + 输入行 + 按钮行（度量常量与 app.css picker-form 段同源配对）
  if (isRename) {
    const trimmed = draft.trim()
    return (
      <div className="picker-body" role="dialog" aria-label={title}>
        <header className="picker-head">
          <h1 className="picker-title">{title}</h1>
        </header>
        <div className="picker-form">
          <input
            ref={renameInputRef}
            className="picker-input"
            value={draft}
            maxLength={WORKSPACE_NAME_MAX}
            aria-label={t('sessions.workspaceSwitcher.nameAria')}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                submitRename()
              }
            }}
          />
          <div className="picker-foot">
            <button type="button" className="picker-btn" onClick={() => window.close()}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="picker-btn picker-btn-primary"
              disabled={!trimmed}
              onClick={submitRename}
            >
              {t('sessions.workspaceSwitcher.saveText')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  const hasAnyRow = (context?.options.length ?? 0) > 0 || (context?.showMoveOut ?? false)
  return (
    <div className="picker-body" role="dialog" aria-label={title}>
      <header className="picker-head">
        <h1 className="picker-title">{title}</h1>
        {context?.kind === 'workspace-move-batch' && (
          <p className="picker-sub">{t('sessions.moveModal.batchSub')}</p>
        )}
      </header>
      <div
        className="picker-list"
        style={{
          maxHeight:
            PICKER_LIST_PAD_TOP +
            PICKER_MAX_VISIBLE_ROWS * PICKER_ROW_HEIGHT +
            (PICKER_MAX_VISIBLE_ROWS - 1) * PICKER_ROW_GAP
        }}
      >
        {context?.options.map((option, i) => (
          <button
            key={option.id}
            ref={i === firstEnabledIdx ? firstOptionRef : undefined}
            type="button"
            className={`picker-option${option.current ? ' current' : ''}`}
            disabled={option.current}
            aria-current={option.current || undefined}
            onClick={() => pick(option.id)}
          >
            <span className="picker-option-name">{option.name}</span>
            {option.current && (
              <span className="picker-option-tag">{t('sessions.moveModal.currentTag')}</span>
            )}
            {option.hereCount !== undefined && (
              <span className="picker-option-count">
                {t('sessions.moveModal.inTargetCount', {
                  here: option.hereCount,
                  total: context.count ?? 0
                })}
              </span>
            )}
          </button>
        ))}
        {context?.showMoveOut && (
          <button
            ref={firstEnabledIdx === -1 ? firstOptionRef : undefined}
            type="button"
            className="picker-option"
            onClick={() => pick(null)}
          >
            <span className="picker-option-name">{t('sessions.moveModal.moveOut')}</span>
          </button>
        )}
        {/* 单条场景当前归属行已并入列表（current 标记），options 为空即完全无工作区
            ——空态统一用 emptyNone（审查低 5：emptyOther 的「其他」是旧排除语义残留） */}
        {context && !hasAnyRow && (
          <p className="picker-empty">{t('sessions.moveModal.emptyNone')}</p>
        )}
      </div>
    </div>
  )
}
