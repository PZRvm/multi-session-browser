import { SettingsPane, SettingsRow } from './SettingsParts'
import appIcon from '../../../../../resources/icon.png'

// 关于版面：居中签名（应用图标 64px 居中于产品名上方——2026-09-17 用户裁决补入，
// 圆角已在图标资产内烘焙）+ 数据目录静态行（阶段三点亮为可点行为）。版本「—」为
// 占位，真实值随阶段三接入，不伪造
export function PaneAbout(): React.JSX.Element {
  return (
    <SettingsPane id="about" title="关于">
      <div className="settings-about-hero">
        <img className="settings-about-icon" src={appIcon} alt="" aria-hidden="true" />
        <div className="settings-about-name">多会话测试浏览器</div>
        <div className="settings-about-version">版本 —</div>
      </div>
      <SettingsRow
        label="数据目录"
        desc="会话、分区数据与偏好的落盘位置"
        control={<span className="settings-static-value">打开</span>}
      />
    </SettingsPane>
  )
}
