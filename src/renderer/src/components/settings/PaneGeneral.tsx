import { Segmented } from 'antd'
import type { SegmentedProps } from 'antd'
import { Tooltip } from 'antd'
import { DownOutlined } from '@ant-design/icons'
import { useAppearanceStore, appearanceText } from '../../stores/appearance'
import { appearanceIcons } from '../appearanceIcons'
import { APPEARANCE_MODES } from '../../../../shared/appearance'
import { SettingsPane, SettingsRow } from './SettingsParts'

// 通用版面：外观（图标三段，与首页板头同款形态）+ 语言（展示态选择框）——全部
// 受控只读/无行为（功能点亮归阶段三起）。图标三段：label 槽位必须留空（antd 会
// 生成带 marginInlineStart 的裸 span 兄弟包装把图标挤出瓣心——板头先例），中文
// 模式名藏于 icon 节点内供读屏；悬停经 Tooltip 出 popover 提示瓣的模式名
// （2026-09-17 用户裁决；区别于板头的原生 title——设置行空间充裕，popover 更醒目）
const appearanceOptions: SegmentedProps['options'] = APPEARANCE_MODES.map((mode) => ({
  value: mode,
  icon: (
    <Tooltip title={appearanceText[mode]} mouseEnterDelay={0.2}>
      <span className="settings-appearance-seg-item">
        <span aria-hidden="true">{appearanceIcons[mode]}</span>
        <span className="visually-hidden">{appearanceText[mode]}</span>
      </span>
    </Tooltip>
  )
}))

export function PaneGeneral(): React.JSX.Element {
  const appearanceMode = useAppearanceStore((s) => s.mode)

  return (
    <SettingsPane id="general" title="通用" desc="外观与语言">
      <SettingsRow
        label="外观"
        desc="应用壳、原生界面与 DevTools 的亮暗模式"
        control={
          // 受控只读：value 绑 appearance 只读镜像、不传 onChange——板头切换实时
          // 同步显示，设置内点选静默不生效（阶段三点亮）
          <Segmented
            className="settings-appearance-segmented"
            size="small"
            name="appearance-mode"
            aria-label="外观模式"
            value={appearanceMode}
            options={appearanceOptions}
          />
        }
      />
      <SettingsRow
        label="语言"
        desc="界面文案语言，切换即时生效"
        control={
          // 展示态选择框（WorkspaceSwitcher 收起态同构）：非交互元素，
          // 点击无行为（语言切换归阶段六）
          <span className="settings-select-ghost">
            <span className="settings-select-ghost-text">中文（简体）</span>
            <DownOutlined className="settings-select-ghost-caret" />
          </span>
        }
      />
    </SettingsPane>
  )
}
