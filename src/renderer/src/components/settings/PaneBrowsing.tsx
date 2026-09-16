import { Input } from 'antd'
import { SettingsPane, SettingsRow } from './SettingsParts'

// 浏览版面：主页 URL——非受控纯本地输入，无持久化无行为（阶段四接入主页 URL）
export function PaneBrowsing(): React.JSX.Element {
  return (
    <SettingsPane id="browsing" title="浏览">
      <SettingsRow
        label="主页"
        desc="工具栏『主页』按钮的跳转地址"
        control={
          <Input className="settings-input" aria-label="主页" placeholder="留空使用默认起始页" />
        }
      />
    </SettingsPane>
  )
}
