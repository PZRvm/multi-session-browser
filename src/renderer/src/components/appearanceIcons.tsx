import { DesktopOutlined, MoonOutlined, SunOutlined } from '@ant-design/icons'
import type { AppearanceMode } from '../../../shared/appearance'

// 外观三态图标词汇单源（跟随系统=显示器、白天=太阳、黑夜=月亮）：板头 AppearanceEntry
// 与设置窗外观行共用同一词汇（2026-09-17 设置窗外观行改图标形态时收敛）。本文件仅
// 导出常量、无组件导出，不触发 react-refresh/only-export-components（先例见
// stores/appearance.ts 的 appearanceText）；阶段六 i18n 字典接管时随文案一并迁移
export const appearanceIcons: Record<AppearanceMode, React.ReactNode> = {
  system: <DesktopOutlined />,
  light: <SunOutlined />,
  dark: <MoonOutlined />
}
