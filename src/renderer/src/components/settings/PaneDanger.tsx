import { SettingsPane } from './SettingsParts'
import { useT } from '../../i18n'

// 恢复出厂版面（独立危险区，2026-09-17 用户裁决常驻导航）：danger 描边钮触发两步
// 确认弹层（弹层由窗口壳承载，覆盖整窗内容区）；真实执行归恢复出厂功能阶段
export function PaneDanger({ onRequestReset }: { onRequestReset: () => void }): React.JSX.Element {
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
        <p className="settings-danger-note">{t('settings.dangerZone.note')}</p>
      </div>
    </SettingsPane>
  )
}
