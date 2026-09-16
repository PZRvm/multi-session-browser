// 设置域共享契约（设置专项阶段一冻结，需求见 docs/PRD.md 3.8）：承载设置窗口
// （独立子窗，renderer 第四角色 ?role=settings）与偏好存储（userData/settings.json，
// 与外观域 preferences.json 分域并行——PRD 4.9 与 sessions.json、分区数据分别存储
// 独立读写，两域各自串行队列互不耦合）。
// 阶段一仅一条命令通道：主窗 shell 请求主进程打开/聚焦单例设置窗（入口=板头齿轮；
// 应用菜单「设置… ⌘,」在主进程内直连，不经 IPC）。阶段二起随首个真实设置键扩展
// get/changed/set 通道与载荷类型（计划：notes/plans/
// 20260916213351-设置阶段一入口与设置窗口骨架开发计划.md 契约核对第 1、2 条）。

/** renderer 第四角色标识：主进程建窗 query 与 main.tsx 求值期分流共用的单源 */
export const SETTINGS_WINDOW_ROLE = 'settings'

export const SETTINGS_CHANNELS = {
  /** 主窗 shell → 主进程：打开（已打开则聚焦）单例设置窗口 */
  open: 'settings:open'
} as const

export interface OkResult {
  ok: true
}
