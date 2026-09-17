import { useEffect, useState } from 'react'
import { Input } from 'antd'
import type { InputProps } from 'antd'
import { useT } from '../../i18n'

// 恢复出厂两步确认弹层（自绘 overlay，形态裁决见 DESIGN「两步确认弹层」：antd
// Modal 默认投影违反板面无阴影规则）。第一步后果清单，第二步输入确认词精确匹配才
// 点亮确认钮——确认词随界面语言（PRD 26 本地化确认词口径：中文「重置」/英文
// reset，settings.confirmReset.confirmWord 单键供标题插值/输入框 aria/匹配比对
// 三处同词消费）；取消/确认/关闭均零清理执行（真实执行归恢复出厂功能阶段）。
// 弹层随关闭整体卸载：输入态自动清零，重开从禁用态起步（2026-09-17 拆分时的
// 行为收口——旧实现 resetText 存在窗口级 state，重开弹层会带着上次的输入）
export type ConfirmResetStep = 1 | 2

export function ConfirmResetOverlay({
  step,
  onNext,
  onClose
}: {
  step: ConfirmResetStep
  onNext: () => void
  onClose: () => void
}): React.JSX.Element {
  // 第二步受控输入：纯本地瞬态（不落盘、不进 IPC）
  const [resetText, setResetText] = useState('')
  const t = useT()
  const onResetTextChange: InputProps['onChange'] = (e) => {
    setResetText(e.target.value)
  }

  // Esc 关闭：弹层挂载期监听并拦截（独立 OS 窗内无浏览器快捷键冲突，拦截只为防
  // Esc 冒泡引发其他默认行为），卸载即摘除
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="settings-confirm">
      <div
        className="settings-confirm-card"
        role="dialog"
        aria-modal="true"
        aria-label={t('settings.confirmReset.dialogAria')}
      >
        {step === 1 ? (
          <>
            <div className="settings-confirm-title">{t('settings.confirmReset.step1Title')}</div>
            <ul className="settings-confirm-list">
              <li>{t('settings.confirmReset.consequenceSessions')}</li>
              <li>{t('settings.confirmReset.consequencePartitionData')}</li>
              <li>{t('settings.confirmReset.consequenceSettings')}</li>
            </ul>
            <div className="settings-confirm-actions">
              <button type="button" className="settings-plain-btn" onClick={onClose}>
                {t('common.cancel')}
              </button>
              <button type="button" className="settings-danger-btn" onClick={onNext}>
                {t('settings.confirmReset.next')}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="settings-confirm-title">
              {t('settings.confirmReset.step2Title', {
                word: t('settings.confirmReset.confirmWord')
              })}
            </div>
            <Input
              className="settings-input settings-confirm-input"
              aria-label={t('settings.confirmReset.confirmWord')}
              value={resetText}
              onChange={onResetTextChange}
            />
            <div className="settings-confirm-actions">
              <button type="button" className="settings-plain-btn" onClick={onClose}>
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="settings-danger-solid-btn"
                disabled={resetText !== t('settings.confirmReset.confirmWord')}
                onClick={onClose}
              >
                {t('settings.confirmReset.confirmButton')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
