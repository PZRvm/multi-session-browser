import { useCallback, useEffect, useState } from 'react'
import { ConfigProvider, theme } from 'antd'
import {
  GlobalOutlined,
  InfoCircleOutlined,
  OrderedListOutlined,
  SettingOutlined,
  WarningOutlined
} from '@ant-design/icons'
import { useAppearanceStore } from '../stores/appearance'
import { useI18nStore } from '../stores/i18n'
import { ANTD_LOCALES, useT } from '../i18n'
import { applyThemeTokens } from '../theme'
import type { DictKey } from '../../../shared/i18n'
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
// 主题色行已随阶段五入窗（PaneGeneral 色板行，形态契约见 DESIGN「设置窗口」条目）。

// 五分类导航词汇（侧栏双栏契约）：快捷键分类取列表语义图标（图标库无键盘图标，
// 库存认见开发计划）；恢复出厂为 danger 分类（沉底恒红、选中 danger 实底白字）。
// 分类名归 settings.categories 字典键（随界面语言取词），图标常量留模块级
type SettingsPaneId = 'general' | 'browsing' | 'shortcuts' | 'about' | 'danger'

const SETTINGS_CATEGORIES: ReadonlyArray<{
  id: SettingsPaneId
  labelKey: DictKey
  icon: React.ReactNode
  danger?: boolean
}> = [
  { id: 'general', labelKey: 'settings.categories.general', icon: <SettingOutlined /> },
  { id: 'browsing', labelKey: 'settings.categories.browsing', icon: <GlobalOutlined /> },
  { id: 'shortcuts', labelKey: 'settings.categories.shortcuts', icon: <OrderedListOutlined /> },
  { id: 'about', labelKey: 'settings.categories.about', icon: <InfoCircleOutlined /> },
  {
    id: 'danger',
    labelKey: 'settings.categories.danger',
    icon: <WarningOutlined />,
    danger: true
  }
]

export default function SettingsWindow(): React.JSX.Element {
  const resolvedTheme = useAppearanceStore((s) => s.resolvedTheme)
  const themeColor = useAppearanceStore((s) => s.themeColor)
  const appearanceInitialized = useAppearanceStore((s) => s.initialized)
  // 界面语言（阶段六 i18n）：语言镜像按选择器订阅，语言行切换即时翻转 antd 内置文案
  const language = useI18nStore((s) => s.language)
  // 壳层取词（侧栏分类名随语言；版面内文案归各版面组件自取）
  const t = useT()

  // 主题 token 重注：设置窗不经 App 包裹（main.tsx 分支独立渲染），需独立挂接——
  // 首帧与 OS 翻转归 theme.ts bootstrap；以 init 真值回填为门控（审查修复轮中 1，
  // 与 App.tsx 同款），未初始化期间占位初值不得覆盖 bootstrap 按 sys 的首帧注入
  useEffect(() => {
    if (!appearanceInitialized) return
    applyThemeTokens(themeColor, resolvedTheme)
  }, [appearanceInitialized, themeColor, resolvedTheme])

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
      locale={ANTD_LOCALES[language]}
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
          },
          // 语言行受控下拉（阶段六 i18n，DESIGN「设置窗口」语言段定稿）：Select 板面化
          // 组件 token——几何（26px 高 / 4px 圆角 / 13px 字）与描边色态全部走信息板语义
          // token（antd 6 outlined 变体的 border/hover/active/outline 直通消费，零硬编码
          // 色值）；描边 hover/激活转次墨、激活 outline 透明（压掉 antd 聚焦蓝描边与
          // 光晕——蓝不进板面）；触发器透明底融入板面（.settings-input 同惯例）、选项
          // 选中底透明（对勾即选中，色样同语言）、悬停走板面蒙版。其余细节（定宽、
          // 触发器字重、下箭头、弹层描边）在 app.css 的 .settings-language-select /
          // .settings-language-dropdown 类内实现
          Select: {
            controlHeight: 26,
            borderRadius: 4,
            fontSize: 13,
            colorText: 'var(--board-ink)',
            colorBorder: 'var(--board-control-line)',
            hoverBorderColor: 'var(--board-ink-dim)',
            activeBorderColor: 'var(--board-ink-dim)',
            activeOutlineColor: 'transparent',
            selectorBg: 'transparent',
            optionSelectedBg: 'transparent',
            optionActiveBg: 'var(--board-hover-veil)'
          }
        }
      }}
    >
      <div className="settings-window" data-role="settings">
        {/* 侧栏五分类导航：nav 语义；选中经 aria-current 驱动（视觉态与无障碍态单源）；
            恢复出厂沉底恒 danger 色 */}
        <nav className="settings-sidebar" aria-label={t('settings.sidebar.navLabel')}>
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
              <span>{t(cat.labelKey)}</span>
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
