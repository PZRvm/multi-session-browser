import { Segmented } from 'antd'
import type { SegmentedProps } from 'antd'
import { Tooltip } from 'antd'
import { DownOutlined } from '@ant-design/icons'
import { useAppearanceStore, appearanceText } from '../../stores/appearance'
import { appearanceIcons } from '../appearanceIcons'
import { APPEARANCE_MODES, type AppearanceMode } from '../../../../shared/appearance'
import { SettingsPane, SettingsRow } from './SettingsParts'

// 通用版面：外观（图标三段，与首页板头同款形态）+ 语言（展示态选择框）。外观行
// 阶段三点亮——受控交互（onChange 经 appearance.setMode，板头 ↔ 设置窗经主进程
// changed 广播双向即时同步）；语言行归阶段六 i18n，维持展示态。图标三段：label 槽位
// 必须留空（antd 会生成带 marginInlineStart 的裸 span 兄弟包装把图标挤出瓣心——
// 板头先例），中文模式名藏于 icon 节点内供读屏；悬停经 Tooltip 出 popover 提示瓣的
// 模式名（2026-09-17 用户裁决；区别于板头的原生 title——设置行空间充裕，popover
// 更醒目）
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
          // 受控交互（阶段三点亮）：value 绑 appearance 镜像，onChange 经 setMode——
          // 与板头为同一设置双入口，任一侧切换经主进程广播即时同步；连点保护由
          // store 既有串行队列承担
          <Segmented
            className="settings-appearance-segmented"
            size="small"
            name="appearance-mode"
            aria-label="外观模式"
            value={appearanceMode}
            options={appearanceOptions}
            onChange={(value) =>
              void useAppearanceStore.getState().setMode(value as AppearanceMode)
            }
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
