import { useRef } from 'react'
import { Segmented } from 'antd'
import type { SegmentedProps } from 'antd'
import { Tooltip } from 'antd'
import { CheckOutlined, DownOutlined } from '@ant-design/icons'
import { useAppearanceStore, appearanceText } from '../../stores/appearance'
import { appearanceIcons } from '../appearanceIcons'
import { APPEARANCE_MODES, type AppearanceMode } from '../../../../shared/appearance'
import { THEME_SYSTEMS, THEME_SYSTEM_IDS } from '../../../../shared/themeSystems'
import { SettingsPane, SettingsRow } from './SettingsParts'

// 通用版面：外观（图标三段，与首页板头同款形态）+ 主题色（三枚色样单选，阶段五
// 点亮）+ 语言（展示态选择框）。外观行受控交互（onChange 经 appearance.setMode，
// 板头 ↔ 设置窗经主进程 changed 广播双向即时同步）；主题色行受控经 setThemeColor
// （同广播链）；语言行归阶段六 i18n，维持展示态。图标三段：label 槽位必须留空
// （antd 会生成带 marginInlineStart 的裸 span 兄弟包装把图标挤出瓣心——板头先例），
// 中文模式名藏于 icon 节点内供读屏；悬停经 Tooltip 出 popover 提示瓣的模式名
//（2026-09-17 用户裁决；区别于板头的原生 title——设置行空间充裕，popover 更醒目）
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

// 主题色色板（阶段五）：三枚砖形色样单选，形态契约见 DESIGN.md「设置窗口」条目。
// 色底与对勾色都取自配置单源各系统自己的字段——色样是内容色（不违内容区零琥珀），
// 对勾色不随当前主题漂移（雾蓝主题下琥珀色样的对勾仍是琥珀墨）。radiogroup 语义
// + roving tabindex：Tab 只达选中项，↑↓←→ 循环移动并即时应用（radio 惯例——
// 方向键即选择），workspace 下拉 combobox 的键盘语言先例
function ThemeSwatches(): React.JSX.Element {
  const themeColor = useAppearanceStore((s) => s.themeColor)
  const swatchRefs = useRef<Array<HTMLButtonElement | null>>([])

  const focusAndApply = (index: number): void => {
    const nextIndex = (index + THEME_SYSTEM_IDS.length) % THEME_SYSTEM_IDS.length
    swatchRefs.current[nextIndex]?.focus()
    void useAppearanceStore.getState().setThemeColor(THEME_SYSTEM_IDS[nextIndex])
  }

  return (
    <div className="settings-theme-swatches" role="radiogroup" aria-label="主题色">
      {THEME_SYSTEM_IDS.map((id, index) => {
        const system = THEME_SYSTEMS[id]
        const selected = themeColor === id
        return (
          <button
            key={id}
            ref={(node) => {
              swatchRefs.current[index] = node
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={system.label}
            title={system.label}
            tabIndex={selected ? 0 : -1}
            className="settings-theme-swatch"
            style={{ backgroundColor: system.swatch, color: system.light.accentInk }}
            onClick={() => void useAppearanceStore.getState().setThemeColor(id)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                e.preventDefault()
                focusAndApply(index + 1)
              } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                e.preventDefault()
                focusAndApply(index - 1)
              }
            }}
          >
            {selected ? <CheckOutlined aria-hidden="true" /> : null}
          </button>
        )
      })}
    </div>
  )
}

export function PaneGeneral(): React.JSX.Element {
  const appearanceMode = useAppearanceStore((s) => s.mode)

  return (
    <SettingsPane id="general" title="通用" desc="外观、主题色与语言">
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
        label="主题色"
        desc="左侧信息板的强调色与底色系统，右侧浏览区不受影响"
        control={<ThemeSwatches />}
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
