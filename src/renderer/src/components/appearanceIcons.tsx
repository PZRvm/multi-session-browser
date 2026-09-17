import { DesktopOutlined, MoonOutlined, SunOutlined } from '@ant-design/icons'
import type { DictKey } from '../../../shared/i18n'
import type { AppearanceMode } from '../../../shared/appearance'

// 外观三态图标词汇单源（跟随系统=显示器、白天=太阳、黑夜=月亮）：板头 AppearanceEntry
// 与设置窗外观行共用同一词汇（2026-09-17 设置窗外观行改图标形态时收敛）。三态名称的
// 文案自阶段六 i18n 起迁入字典（sessions.appearanceGroup.modes.*，zh/en 单源在此以
// 键携带——模块级结构不得持有具体语言文案，渲染期经 t() 取词，见 appearanceModeDictKeys）；
// 本文件仅导出常量、无组件导出，不触发 react-refresh/only-export-components（先例见
// stores/appearance.ts）
export const appearanceIcons: Record<AppearanceMode, React.ReactNode> = {
  system: <DesktopOutlined />,
  light: <SunOutlined />,
  dark: <MoonOutlined />
}

/** 外观三态 → 字典键（AppearanceEntry 与设置窗外观行渲染期取词共用，跨簇契约：
 * 键路径 sessions.appearanceGroup.modes.{system|light|dark}） */
export const appearanceModeDictKeys: Record<AppearanceMode, DictKey> = {
  system: 'sessions.appearanceGroup.modes.system',
  light: 'sessions.appearanceGroup.modes.light',
  dark: 'sessions.appearanceGroup.modes.dark'
}
