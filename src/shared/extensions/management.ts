/**
 * 插件管理共享通道与类型（设置窗插件页 ↔ 主进程 management.ts）。
 * 安装结果统一信封：ok=false 时 error 为主进程可读短码或截断消息。
 */
export const EXTENSIONS_CHANNELS = {
  list: 'extensions:list',
  installStore: 'extensions:install-store',
  importCrx: 'extensions:import-crx',
  uninstall: 'extensions:uninstall'
} as const

export interface ExtensionListItem {
  id: string
  name: string
  version: string
  /** 来源：crx / store / unpacked */
  source: string
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
