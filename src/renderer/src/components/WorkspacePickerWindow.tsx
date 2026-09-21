import { useEffect, useRef, useState } from 'react'
import {
  PICKER_MAX_VISIBLE_ROWS,
  PICKER_ROW_HEIGHT,
  type WorkspacePickerContext
} from '../../../shared/dialog'
import { useT } from '../i18n'

/**
 * 工作区选择模态框渲染端（PRD 4.11，第五角色 ?role=workspace-picker，原生 sheet
 * 专项 2026-09-21；同日用户反馈轮放大疏朗 + 当前行指示 + 焦点语言修正）：纯受控
 * 零自治——展示上下文（工作区列表/计数徽标/当前归属标记/移出行条件）由主进程从
 * 权威快照现取（WorkspacePickerContext），挂载即经 payload 通道拉取；点选行经
 * pick 通道回传 workspaceId（null = 移出未分组），Esc / 系统关闭钮直接关窗、由
 * 主进程 closed 钩子按取消收敛（取消 ≠ 点选「移出」，两条路径严格分离）。当前
 * 归属行呈「当前所在」禁用态（tile-ink 徽标，不参与点选与聚焦——选择目标语义下
 * 它是不可再选的位置指示）；键盘焦点语言 = veil 底（与切换框键盘高亮同族，取代
 * 全局琥珀 focus ring——后者被列表滚动容器裁剪后呈「底部一条线」，用户裁决弃用）。
 * 文案消费 sessions.moveModal.* 键（currentTag 为反馈轮唯一新增）；亮暗随 CSS
 * 媒体查询；列表封顶高度由 shared 度量常量合成（与主进程建窗高度同源配对）
 */
export default function WorkspacePickerWindow(): React.JSX.Element {
  const t = useT()
  const [context, setContext] = useState<WorkspacePickerContext | null>(null)
  // payload 拉取失败（无在途请求/来源不被信任/通道异常）：不伪造选项，仅呈现空态
  const [loadFailed, setLoadFailed] = useState(false)
  const firstOptionRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    let disposed = false
    window.api.dialog
      .workspacePickerPayload()
      .then((payload) => {
        if (disposed) return
        if (payload) setContext(payload)
        else setLoadFailed(true)
      })
      .catch(() => {
        if (!disposed) setLoadFailed(true)
      })
    return () => {
      disposed = true
    }
  }, [])

  const pick = (workspaceId: string | null): void => {
    if (!context) return
    // 主进程命中即关窗；连点窗口期的二次提交被 requestId/pending 守卫静默忽略
    void window.api.dialog
      .workspacePickerPick({ requestId: context.requestId, workspaceId })
      .catch(() => undefined)
  }

  // Esc = 取消（关窗，主进程 closed 兜底收敛 cancelled）
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

  const title = context
    ? context.kind === 'workspace-move-single'
      ? t('sessions.moveModal.title', { name: context.sessionName ?? '' })
      : t('sessions.moveModal.batchTitle', { n: context.count ?? 0 })
    : t('sessions.moveModal.titleFallback')
  const hasAnyRow = (context?.options.length ?? 0) > 0 || (context?.showMoveOut ?? false)
  // 聚焦首个可选项（当前归属行禁用不参与；全禁用时聚焦移出行，再无则不聚焦）
  const firstEnabledIdx = context?.options.findIndex((o) => !o.current) ?? -1
  useEffect(() => {
    firstOptionRef.current?.focus()
  }, [context])

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
        style={{ maxHeight: PICKER_MAX_VISIBLE_ROWS * PICKER_ROW_HEIGHT }}
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
        {context && !hasAnyRow && (
          <p className="picker-empty">
            {context.kind === 'workspace-move-single'
              ? t('sessions.moveModal.emptyOther')
              : t('sessions.moveModal.emptyNone')}
          </p>
        )}
        {!context && loadFailed && (
          <p className="picker-empty">{t('sessions.moveModal.emptyNone')}</p>
        )}
      </div>
    </div>
  )
}
