// 破坏性确认框共享契约（主进程 / preload / renderer 三方共用）。
// 设计依据 PRD 4.10（2026-09-18 增量，计划 notes/plans/20260918182549-删除会话
// 原生确认框开发计划.md 第 2.4 节）：删除类不可逆操作（删除会话、批量关闭选中、
// 删除工作区）的二次确认改走主进程 dialog.showMessageBox 原生对话框，不再用
// 渲染层 Modal——弹框存续期间页面视图保持可见且内容原样，不经 overlay 悬挂
// 登记收起右区（弹框期间浏览器区变白即事故）。
//
// 契约要点：
// - 载荷只带数据参数（kind + 插值用 name/count），标题/正文/按钮文案由主进程
//   经 main/i18n.ts 语言态复用既有字典键组装（sessions.* 命名空间原位复用，
//   i18n 零新增），与 main/browser/permissions.ts 摄像头对话框先例同构——
//   触发源在 renderer 时经 invoke 通道，permissions 是主进程内部直调无通道
// - 返回 boolean：true 仅当用户按下确认按钮；取消按钮/Esc/关闭弹框/宿主窗
//   缺失一律 false；入参守卫失败抛 errors.invalidSessionParams（ipc-utils 惯例）
// - 「取消」为 cancelId 兼安全默认按钮（用户裁决 2026-09-18：Enter/Esc 均等同
//   取消，防误触不可逆删除——与原渲染层版 Enter=删除的行为差异）
// - 本域是纯 UI 辅通道：主进程只弹框返回选择结果，不落盘、不触碰会话快照与
//   分区；删除执行仍由 sessions:delete / sessions:delete-batch / workspaces:delete
//   既有通道闭环，确认与执行两段解耦

export const DIALOG_CHANNELS = {
  confirmDestructive: 'dialog:confirm-destructive'
} as const

/** 破坏性确认的三种场景（kind 白名单，主进程 switch 分支组文案） */
export type ConfirmKind = 'session-delete' | 'sessions-batch-close' | 'workspace-delete'

export interface ConfirmDestructivePayload {
  /** 确认场景；白名单外的 kind 守卫整单拒绝 */
  kind: ConfirmKind
  /** 会话名/工作区名：session-delete、workspace-delete 必填（正文 {name} 插值），仅展示用不落盘 */
  name?: string
  /**
   * 会话计数：sessions-batch-close 必填（正文 {n} 插值）；workspace-delete 必填
   * （其内会话数，>0 走 withSessions 分支否则 empty）；session-delete 忽略
   */
  count?: number
}
