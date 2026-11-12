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
  manage: 'extensions:manage',
  /** 固定/取消固定单个插件（面板钉子与设置页开关共用），持久化后广播 changed */
  setPinned: 'extensions:set-pinned',
  /** 固定图标拖拽重排：ids 为全序覆盖（顺序即工具栏显示顺序），持久化后广播 changed */
  orderPinned: 'extensions:order-pinned',
  /** 主进程 → 全窗广播（零载荷）：pins/安装集变更，消费者重取 list（list 恒唯一数据源） */
  changed: 'extensions:changed'
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
  /** 已固定到工具栏（全局单份 pin 状态，主窗/独立窗同规） */
  pinned?: boolean
  /** 已加载分区数 / 已记录分区数（协议v1 分区结果） */
  loadedPartitions: number
  totalPartitions: number
}

/** setPinned 载荷：显式目标态（面板钉子按 item.pinned 取反后传入） */
export interface SetPinnedPayload {
  id: string
  pinned: boolean
}

/** orderPinned 载荷：拖拽重排提交的固定全序（顺序即工具栏显示顺序） */
export interface OrderPinnedPayload {
  ids: string[]
}

export interface PinResult {
  ok: boolean
  error?: string
}

/** list 通道返回值：items 为安装清单序（设置窗/面板展示序），pins 为固定全序（工具栏显示序） */
export interface ExtensionListResult {
  items: ExtensionListItem[]
  pins: string[]
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
