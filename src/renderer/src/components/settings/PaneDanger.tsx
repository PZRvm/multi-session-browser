import { SettingsPane } from './SettingsParts'

// 恢复出厂版面（独立危险区，2026-09-17 用户裁决常驻导航）：danger 描边钮触发两步
// 确认弹层（弹层由窗口壳承载，覆盖整窗内容区）；真实执行归恢复出厂功能阶段
export function PaneDanger({ onRequestReset }: { onRequestReset: () => void }): React.JSX.Element {
  return (
    <SettingsPane id="danger" title="恢复出厂设置" desc="高危操作：删除全部数据并重置设置">
      <div className="settings-danger-zone">
        <button type="button" className="settings-danger-btn" onClick={onRequestReset}>
          恢复出厂设置…
        </button>
        <p className="settings-danger-note">
          删除全部会话、工作区与浏览数据，恢复默认设置，不可撤销
        </p>
      </div>
    </SettingsPane>
  )
}
