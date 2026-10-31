import { SettingsPane } from './SettingsParts'
import { useT } from '../../i18n'

// 恢复出厂版面（独立危险区，2026-09-17 用户裁决常驻导航）：danger 描边钮触发
// 主进程原生警告确认框（2026-10-31 用户裁决原生化——渲染层两步弹层与输入确认词
// 退役，PRD 3.8.3 / 4.9 / 验收 26 同日修订）；确认后执行归恢复出厂功能阶段链路
// （settings:factory-reset）。失败文案经 error 内联呈现（role="alert"，11px danger
// ——原弹层错误行语言的板面化承接，随下一次触发清零）；成功零呈现，各版面默认态
// 经既有广播自动回显
export function PaneDanger({
  onRequestReset,
  error
}: {
  onRequestReset: () => void
  error: string | null
}): React.JSX.Element {
  const t = useT()
  return (
    <SettingsPane
      id="danger"
      title={t('settings.panes.danger.title')}
      desc={t('settings.panes.danger.desc')}
    >
      <div className="settings-danger-zone">
        <button type="button" className="settings-danger-btn" onClick={onRequestReset}>
          {t('settings.dangerZone.action')}
        </button>
        {error !== null && (
          <p className="settings-danger-error" role="alert">
            {error}
          </p>
        )}
        <p className="settings-danger-note">{t('settings.dangerZone.note')}</p>
      </div>
    </SettingsPane>
  )
}
