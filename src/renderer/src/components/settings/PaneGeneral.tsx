import { useRef } from 'react'
import { Segmented, Select } from 'antd'
import type { SegmentedProps } from 'antd'
import { Tooltip } from 'antd'
import { CheckOutlined } from '@ant-design/icons'
import { useAppearanceStore, appearanceText } from '../../stores/appearance'
import { useI18nStore } from '../../stores/i18n'
import { useT } from '../../i18n'
import { appearanceIcons } from '../appearanceIcons'
import { APPEARANCE_MODES, type AppearanceMode } from '../../../../shared/appearance'
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from '../../../../shared/i18n'
import { THEME_SYSTEMS, THEME_SYSTEM_IDS } from '../../../../shared/themeSystems'
import { SettingsPane, SettingsRow } from './SettingsParts'

// 通用版面：外观（图标三段，与首页板头同款形态）+ 主题色（三枚色样单选，阶段五
// 点亮）+ 语言（受控下拉，阶段六点亮）。外观行受控交互（onChange 经 appearance.setMode，
// 板头 ↔ 设置窗经主进程 changed 广播双向即时同步）；主题色行受控经 setThemeColor
//（同广播链）；语言行受控经 i18n store setLanguage（DESIGN「设置窗口」语言段定稿）。
// 图标三段：label 槽位必须留空（antd 会生成带 marginInlineStart 的裸 span 兄弟包装
// 把图标挤出瓣心——板头先例），模式名藏于 icon 节点内供读屏；悬停经 Tooltip 出
// popover 提示瓣的模式名（2026-09-17 用户裁决；区别于板头的原生 title——设置行
// 空间充裕，popover 更醒目）。三态模式名经 appearanceText 随界面语言取词（跨簇共享
// 键 sessions.appearanceGroup.modes），故选项数组从模块级常量迁入组件体——语言切换
// 经 useT 订阅触发重渲染后按新语言重建

// 语言选项（阶段六 i18n）：自 SUPPORTED_LANGUAGES 注册表单源派生（新增语言零组件
// 改动）；label 为语言自名、不随界面语言翻译——英文界面下仍显示「中文（简体）」
//（macOS 语言选择惯例）
const languageOptions: Array<{ value: SupportedLanguage; label: string }> = SUPPORTED_LANGUAGES.map(
  (entry) => ({
    value: entry.code,
    label: entry.label
  })
)

// 主题色色板（阶段五）：三枚砖形色样单选，形态契约见 DESIGN.md「设置窗口」条目。
// 色底与对勾色都取自配置单源各系统自己的字段——色样是内容色（不违内容区零琥珀），
// 对勾色不随当前主题漂移（雾蓝主题下琥珀色样的对勾仍是琥珀墨）。radiogroup 语义
// + roving tabindex：Tab 只达选中项，↑↓←→ 循环移动并即时应用（radio 惯例——
// 方向键即选择），workspace 下拉 combobox 的键盘语言先例
function ThemeSwatches(): React.JSX.Element {
  const themeColor = useAppearanceStore((s) => s.themeColor)
  const t = useT()
  const swatchRefs = useRef<Array<HTMLButtonElement | null>>([])

  const focusAndApply = (index: number): void => {
    const nextIndex = (index + THEME_SYSTEM_IDS.length) % THEME_SYSTEM_IDS.length
    swatchRefs.current[nextIndex]?.focus()
    void useAppearanceStore.getState().setThemeColor(THEME_SYSTEM_IDS[nextIndex])
  }

  return (
    <div
      className="settings-theme-swatches"
      role="radiogroup"
      aria-label={t('settings.themeColorRow.groupAria')}
    >
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
  const language = useI18nStore((s) => s.language)
  const t = useT()

  // 外观三段选项（原模块级常量迁入组件体）：模式名经 appearanceText 按当前语言取词，
  // 语言切换时本组件经 useT/language 订阅重渲染，选项随重建即得新词
  const appearanceOptions: SegmentedProps['options'] = APPEARANCE_MODES.map((mode) => ({
    value: mode,
    icon: (
      <Tooltip title={appearanceText(mode)} mouseEnterDelay={0.2}>
        <span className="settings-appearance-seg-item">
          <span aria-hidden="true">{appearanceIcons[mode]}</span>
          <span className="visually-hidden">{appearanceText(mode)}</span>
        </span>
      </Tooltip>
    )
  }))

  return (
    <SettingsPane
      id="general"
      title={t('settings.panes.general.title')}
      desc={t('settings.panes.general.desc')}
    >
      <SettingsRow
        label={t('settings.appearanceRow.label')}
        desc={t('settings.appearanceRow.desc')}
        control={
          // 受控交互（阶段三点亮）：value 绑 appearance 镜像，onChange 经 setMode——
          // 与板头为同一设置双入口，任一侧切换经主进程广播即时同步；连点保护由
          // store 既有串行队列承担
          <Segmented
            className="settings-appearance-segmented"
            size="small"
            name="appearance-mode"
            aria-label={t('settings.appearanceRow.modeAria')}
            value={appearanceMode}
            options={appearanceOptions}
            onChange={(value) =>
              void useAppearanceStore.getState().setMode(value as AppearanceMode)
            }
          />
        }
      />
      <SettingsRow
        label={t('settings.themeColorRow.label')}
        desc={t('settings.themeColorRow.desc')}
        control={<ThemeSwatches />}
      />
      <SettingsRow
        label={t('settings.languageRow.label')}
        desc={t('settings.languageRow.desc')}
        control={
          // 受控下拉（阶段六点亮，DESIGN「设置窗口」语言段定稿）：value 绑 i18n 镜像，
          // onChange 经 store.setLanguage——同值短路零 IPC，成功以主进程返回快照权威
          // 回填（changed 全窗推送同步其余壳层），失败保持旧语言；选中项 CheckOutlined
          // 11px 次墨（optionRender 自定义，内容区零强调色，对齐主题色样对勾语言）；
          // 触发器与弹层板面化样式见 app.css 的 .settings-language-* 类与
          // SettingsWindow 的 Select 组件 token
          <Select
            className="settings-language-select"
            aria-label={t('settings.languageRow.label')}
            value={language}
            options={languageOptions}
            onChange={(value) => void useI18nStore.getState().setLanguage(value)}
            optionRender={(option) => (
              <span className="settings-language-option">
                {option.data.label}
                {option.data.value === language ? (
                  <CheckOutlined className="settings-language-option-check" aria-hidden="true" />
                ) : null}
              </span>
            )}
            classNames={{ popup: { root: 'settings-language-dropdown' } }}
          />
        }
      />
    </SettingsPane>
  )
}
