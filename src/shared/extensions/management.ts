/**
 * 插件管理共享通道与类型（设置窗插件页 ↔ 主进程 management.ts）。
 * 安装结果统一信封：ok=false 时 error 为主进程可读短码或截断消息。
 */
export const EXTENSIONS_CHANNELS = {
  list: 'extensions:list',
  installStore: 'extensions:install-store',
  importCrx: 'extensions:import-crx',
  uninstall: 'extensions:uninstall',
  openPopup: 'extensions:open-popup',
  manage: 'extensions:manage'
} as const

export interface ExtensionListItem {
  id: string
  name: string
  version: string
  /** 来源：crx / store / unpacked */
  source: string
  /** 图标 dataURL（解包目录读取，缺省 undefined 用占位） */
  icon?: string
  /** 有 action（可从工具栏弹窗打开）；无 action 插件点击仅派发 onClicked */
  hasAction?: boolean
  /** 已加载分区数 / 已记录分区数（协议v1 分区结果） */
  loadedPartitions: number
  totalPartitions: number
}

export interface InstallResult {
  ok: boolean
  error?: string
  duplicate?: boolean
}

export interface UninstallResult {
  ok: boolean
  error?: string
}
