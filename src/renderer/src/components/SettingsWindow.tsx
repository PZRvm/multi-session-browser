import { useCallback, useState } from 'react'
import { ConfigProvider, theme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import {
  GlobalOutlined,
  InfoCircleOutlined,
  OrderedListOutlined,
  SettingOutlined,
  WarningOutlined
} from '@ant-design/icons'
import { useAppearanceStore } from '../stores/appearance'
import { PaneGeneral } from './settings/PaneGeneral'
import { PaneBrowsing } from './settings/PaneBrowsing'
import { PaneShortcuts } from './settings/PaneShortcuts'
import { PaneAbout } from './settings/PaneAbout'
import { PaneDanger } from './settings/PaneDanger'
import { ConfirmResetOverlay } from './settings/ConfirmResetOverlay'
import type { ConfirmResetStep } from './settings/ConfirmResetOverlay'

// 设置窗侧栏双栏全量骨架（侧栏双栏重构定稿，契约见 DESIGN.md「设置窗口」条目）：
// 本组件是导航壳——侧栏五分类 + 版面切换 + 两步确认弹层编排；五版面内容在
// ./settings/ 各版面组件（纯 UI 零功能，控件一律受控只读或纯本地瞬态，不写
// settings.json、不接真实版本号、不执行任何清理）。主题：壳体板面 token 经 CSS
// 媒体查询随 nativeTheme 翻转；antd 组件包 ConfigProvider（algorithm 随 appearance
// 只读镜像的 resolvedTheme，组件 token 走 CSS 变量融入板面）。窗口标题「设置」
// 由主进程管理。
//
// 主题色行本阶段不渲染（三色已定稿琥珀/雾蓝/苔绿，行随阶段五颜色系统专项入窗）。

// 五分类导航词汇（侧栏双栏契约）：快捷键分类取列表语义图标（图标库无键盘图标，
// 库存认见开发计划）；恢复出厂为 danger 分类（沉底恒红、选中 danger 实底白字）
type SettingsPaneId = 'general' | 'browsing' | 'shortcuts' | 'about' | 'danger'

const SETTINGS_CATEGORIES: ReadonlyArray<{
  id: SettingsPaneId
  label: string
  icon: React.ReactNode
  danger?: boolean
}> = [
  { id: 'general', label: '通用', icon: <SettingOutlined /> },
  { id: 'browsing', label: '浏览', icon: <GlobalOutlined /> },
  { id: 'shortcuts', label: '快捷键', icon: <OrderedListOutlined /> },
  { id: 'about', label: '关于', icon: <InfoCircleOutlined /> },
  { id: 'danger', label: '恢复出厂', icon: <WarningOutlined />, danger: true }
]

export default function SettingsWindow(): React.JSX.Element {
  const resolvedTheme = useAppearanceStore((s) => s.resolvedTheme)
  // 当前版面 id：组件本地瞬态（不落盘不进 IPC），默认「通用」，切换瞬切无动效
  const [pane, setPane] = useState<SettingsPaneId>('general')
  // 两步确认弹层：0=关闭 / 1=第一步（后果清单）/ 2=第二步（输入「重置」点亮确认）
  const [confirmStep, setConfirmStep] = useState<ConfirmResetStep | 0>(0)
  const closeConfirm = useCallback((): void => {
    setConfirmStep(0)
  }, [])
  const openConfirm = useCallback((): void => {
    setConfirmStep(1)
  }, [])
  const nextConfirm = useCallback((): void => {
    setConfirmStep(2)
  }, [])

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: resolvedTheme === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
        // token 对齐 App.tsx 写法（borderRadius 6 + 系统栈字体），但不设 colorPrimary：
        // 设置窗内容区零琥珀，antd 默认蓝也不进板面——组件配色全部经下方组件 token
        // 走 CSS 变量融入板面（Segmented 配方同板头 AppearanceEntry 先例；导航选中位
        // 琥珀反白是 DESIGN 双栏契约的显式例外，由自著 CSS 承担不经 antd）
        token: {
          borderRadius: 6,
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif'
        },
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
      <div className="settings-window" data-role="settings">
        {/* 侧栏五分类导航：nav 语义；选中经 aria-current 驱动（视觉态与无障碍态单源）；
            恢复出厂沉底恒 danger 色 */}
        <nav className="settings-sidebar" aria-label="设置分类">
          {SETTINGS_CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              type="button"
              className={
                cat.danger ? 'settings-side-cat settings-side-cat-danger' : 'settings-side-cat'
              }
              aria-current={pane === cat.id ? 'page' : undefined}
              onClick={() => setPane(cat.id)}
            >
              <span className="settings-side-cat-icon" aria-hidden="true">
                {cat.icon}
              </span>
              <span>{cat.label}</span>
            </button>
          ))}
        </nav>
        {/* 详情区：滚动职责独占（侧栏不滚动），版面切换瞬切无动效 */}
        <div className="settings-detail">
          {pane === 'general' && <PaneGeneral />}
          {pane === 'browsing' && <PaneBrowsing />}
          {pane === 'shortcuts' && <PaneShortcuts />}
          {pane === 'about' && <PaneAbout />}
          {pane === 'danger' && <PaneDanger onRequestReset={openConfirm} />}
        </div>
        {confirmStep !== 0 && (
          <ConfirmResetOverlay step={confirmStep} onNext={nextConfirm} onClose={closeConfirm} />
        )}
      </div>
    </ConfigProvider>
  )
}
