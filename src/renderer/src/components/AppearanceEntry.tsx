import { ConfigProvider, Dropdown, Segmented } from 'antd'
import type { MenuProps, SegmentedProps } from 'antd'
import { useAppearanceStore, appearanceText } from '../stores/appearance'
import { appearanceIcons } from './appearanceIcons'
import { APPEARANCE_MODES, isAppearanceMode } from '../../../shared/appearance'

// 外观三态共用一套图标词汇：跟随系统=显示器、白天=太阳、黑夜=月亮（单源在
// appearanceIcons.tsx，设置窗外观行同词汇）；
// 窄态按钮显示当前态，宽态分段控件三态并置，下拉菜单保持同名同图标
const appearanceMenuItems: MenuProps['items'] = APPEARANCE_MODES.map((mode) => ({
  key: mode,
  icon: appearanceIcons[mode],
  label: appearanceText[mode]
}))

const appearanceSegmentedOptions: SegmentedProps['options'] = APPEARANCE_MODES.map((mode) => ({
  value: mode,
  title: appearanceText[mode],
  // 中文名放进 icon 节点内部供读屏：label 一旦存在（哪怕纯隐藏文字），antd 会
  // 生成带 marginInlineStart 的裸 span 兄弟包装，把图标挤出瓣内中心
  icon: (
    <>
      <span aria-hidden="true">{appearanceIcons[mode]}</span>
      <span className="visually-hidden">{appearanceText[mode]}</span>
    </>
  )
}))

// 左栏拖拽 ≥ 该宽度时外观入口升级为三段分段控件；更窄时维持图标+下拉单选。
// 390 为设置专项阶段一由 360 上调的定稿值（DESIGN.md「应用外观扩展契约」）：
// 板头入列设置齿轮使右侧控件带增宽约 28px（20px 钮 + 8px 间隙），原 360px 档
// 转三段形态时板头过挤；390 保证可拖区间 [390, 420] 内宽态仍可达（< 420 上限）
const APPEARANCE_SEGMENTED_MIN_WIDTH = 390

interface AppearanceEntryProps {
  panelWidth: number
}

function AppearanceEntry({ panelWidth }: AppearanceEntryProps): React.JSX.Element {
  const appearanceMode = useAppearanceStore((s) => s.mode)
  const settingAppearance = useAppearanceStore((s) => s.setting)
  const setAppearanceMode = useAppearanceStore((s) => s.setMode)

  const onAppearanceMenuClick: MenuProps['onClick'] = ({ key }) => {
    if (isAppearanceMode(key)) {
      void setAppearanceMode(key)
    }
  }

  // 分段控件与下拉菜单走同一 store 动作；value 未经守卫前不落库
  const onAppearanceSegmentChange: SegmentedProps['onChange'] = (value) => {
    if (isAppearanceMode(value)) {
      void setAppearanceMode(value)
    }
  }

  return (
    // 分段控件融入信息板色阶：轨道=抬升层，选中瓣=白面抬升，字形随翻牌砖的昼夜墨色
    // （白天深琥珀 / 黑夜航显琥珀，即砖上数字 token），取值走 CSS 变量以随主题媒体查询同步翻转；
    // algorithm 自上层 ConfigProvider 继承
    <ConfigProvider
      theme={{
        components: {
          Segmented: {
            trackBg: 'var(--board-bg-raised)',
            itemColor: 'var(--board-ink-dim)',
            itemHoverColor: 'var(--board-ink)',
            itemHoverBg: 'var(--board-hover-veil)',
            itemSelectedBg: 'var(--board-segment-selected-bg)',
            itemSelectedColor: 'var(--board-tile-ink)',
            borderRadius: 4
          }
        }
      }}
    >
      {panelWidth >= APPEARANCE_SEGMENTED_MIN_WIDTH ? (
        <Segmented
          className="appearance-segmented"
          size="small"
          name="appearance-mode"
          aria-label="外观模式"
          value={appearanceMode}
          disabled={settingAppearance}
          options={appearanceSegmentedOptions}
          onChange={onAppearanceSegmentChange}
        />
      ) : (
        <Dropdown
          menu={{
            items: appearanceMenuItems,
            onClick: onAppearanceMenuClick,
            selectable: true,
            selectedKeys: [appearanceMode]
          }}
          trigger={['click']}
          placement="bottomRight"
          getPopupContainer={(triggerNode) =>
            triggerNode.closest<HTMLElement>('.session-panel') ?? triggerNode.parentElement!
          }
          styles={{ root: { minWidth: 132 } }}
        >
          <button
            type="button"
            className="appearance-toggle"
            title={`外观模式：${appearanceText[appearanceMode]}`}
            aria-label={`外观模式：${appearanceText[appearanceMode]}`}
            disabled={settingAppearance}
          >
            {appearanceIcons[appearanceMode]}
          </button>
        </Dropdown>
      )}
    </ConfigProvider>
  )
}

export default AppearanceEntry
