// 原生弹层辅通道共享契约（主进程 / preload / renderer 三方共用）。
// 设计依据 PRD 4.10 / 4.11：破坏性确认走 showMessageBox（2026-09-18 增量，计划
// notes/plans/20260918182549-删除会话原生确认框开发计划.md 第 2.4 节）；选择类
// 「移动到工作区」走主进程模态子窗口（2026-09-21 增量，计划 notes/plans/
// 20260921135305-工作区体验双升级开发计划.md 第 2.4 节）——弹层存续期间页面视图
// 保持可见且内容原样，不经 overlay 悬挂登记收起右区（弹框期间浏览器区变白即事故）。
//
// 契约要点（confirmDestructive）：
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
//
// 契约要点（workspacePicker 三通道，模态子窗口承载「移动到工作区」目标选择）：
// - show（主窗 shell 触发）→ payload（sheet 页面拉取展示上下文）→ pick（sheet 页面
//   提交选择）三段；主进程持单请求 pending 态（sheet 为窗口模态，主窗输入被阻塞
//   天然单飞，防御性拒绝二次请求）；requestId 由 show 生成、经 payload 下发、pick
//   回传校验（陈旧 sheet 窗的迟到提交不命中即拒绝）
// - 展示数据（工作区列表/当前归属/计数徽标）由主进程从权威快照现取组装进
//   WorkspacePickerContext，不经 IPC 传展示字符串；文案由 sheet 页面经 useT
//   消费 sessions.moveModal.* 既有键（i18n 零新增）
// - 结果二值：picked（workspaceId 为目标工作区 id，null = 移出未分组）或
//   cancelled（Esc/关闭弹框/父窗缺失/建窗失败）；移动执行仍由既有
//   workspaces:move-session / workspaces:move-sessions-batch 通道闭环
// - 模态子窗口度量常量（与 WorkspacePickerWindow 组件、app.css、主进程建窗
//   高度计算同源配对，omniboxSuggest 度量常量先例）

export const DIALOG_CHANNELS = {
  confirmDestructive: 'dialog:confirm-destructive',
  showWorkspacePicker: 'dialog:show-workspace-picker',
  workspacePickerPayload: 'dialog:workspace-picker-payload',
  workspacePickerPick: 'dialog:workspace-picker-pick'
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

/** 建窗 query role 值与 main.tsx 角色分流单源（SETTINGS_WINDOW_ROLE 同款先例） */
export const WORKSPACE_PICKER_WINDOW_ROLE = 'workspace-picker'

/** 选择类模态框的两种场景（kind 白名单，主进程按场景组装上下文） */
export type WorkspacePickerKind = 'workspace-move-single' | 'workspace-move-batch'

/** show 通道载荷：只带数据参数——single 必填 sessionId、batch 必填非空 ids（守卫强制） */
export interface ShowWorkspacePickerPayload {
  kind: WorkspacePickerKind
  /** 单条移动的目标会话 id（workspace-move-single 必填，须过 SESSION_ID_RE） */
  sessionId?: string
  /** 批量移动的勾选会话 id 集（workspace-move-batch 必填非空，格式非法整单拒绝） */
  ids?: string[]
}

/**
 * show 通道返回值（亦即模态框的最终结论）：picked 携带用户点选的目标工作区 id
 * （null = 移出未分组）；cancelled 覆盖 Esc / 关闭弹框 / 父窗缺失 / 建窗失败 /
 * 二次请求被拒等全部未选择路径
 */
export type WorkspacePickerResult =
  { status: 'picked'; workspaceId: string | null } | { status: 'cancelled' }

/** 选项行数据：single 场景含当前归属行（current 标记，sheet 侧禁点）；batch 场景含全部工作区 */
export interface WorkspacePickerOption {
  id: string
  name: string
  /** batch 场景：「勾选中已在该工作区数」（{here} 插值），主进程从快照现取 */
  hereCount?: number
  /** single 场景：该行是会话当前归属（目标不可再选，sheet 呈「当前所在」禁用态） */
  current?: boolean
}

/** payload 通道返回的展示上下文：全部由主进程从权威快照现取组装，sheet 页面零事实 */
export interface WorkspacePickerContext {
  /** show 时刻生成的请求 id，pick 回传须一致（陈旧窗口迟到提交不命中即拒绝） */
  requestId: string
  kind: WorkspacePickerKind
  /** 单条场景：目标会话名（title {name} 插值）；批量场景缺省 */
  sessionName?: string
  /** 批量场景：勾选总数（title {n} 插值与徽标分母 {total}）；单条场景缺省 */
  count?: number
  /**
   * single：全部工作区（会话当前归属行带 current 标记——用户反馈 2026-09-21：
   * 当前行不再隐藏，呈现「当前所在」禁用态作为位置指示）；batch：全部工作区 +
   * hereCount 计数徽标
   */
  options: WorkspacePickerOption[]
  /** 是否显示「移出（未分组）」行：single = 当前已分组；batch = 勾选中存在非未分组归属 */
  showMoveOut: boolean
}

/**
 * pick 通道载荷（sheet 页面 → 主进程）：requestId 须与 pending 请求一致（陈旧
 * 窗口的迟到提交不命中即拒绝）；workspaceId 为点选的目标工作区 id，null = 移出
 * 未分组，取消路径不走本通道（直接关窗，主进程 closed 钩子兜底 resolve cancelled）
 */
export interface WorkspacePickerPickPayload {
  requestId: string
  workspaceId: string | null
}

/**
 * 模态框窗口度量（DIP，与 WorkspacePickerWindow.tsx / app.css / 主进程建窗高度
 * 计算同源配对；改值多处对账；2026-09-21 用户反馈放大疏朗定稿：360 宽 / 40 行高
 * / 行间 4px / 列表上内距 4px）：宽度恒定；高度 = 头部（单条/批量两档，按页面
 * CSS 实测推导：body 上内距 16 + 标题行 22 + 标题下距 12 +（批量副行 20）+ 列表
 * 分隔线 1 + body 下内距 16）+ 列表上内距 + 可见行数 × 行高 +（可见行数 − 1）×
 * 行间距（行数超 MAX_VISIBLE_ROWS 封顶内滚；零行 = 列表上内距 + 空态句定高）——
 * 主进程建窗 useContentSize 精确按此合成，sheet 随内容定高、不滚动窗口本体；
 * 列表区除上内距与行间距外禁任何纵向增量，否则与公式失配
 */
export const PICKER_WINDOW_WIDTH = 360
export const PICKER_ROW_HEIGHT = 40
export const PICKER_ROW_GAP = 4
export const PICKER_LIST_PAD_TOP = 4
export const PICKER_MAX_VISIBLE_ROWS = 6
export const PICKER_HEADER_HEIGHT_SINGLE = 68
export const PICKER_HEADER_HEIGHT_BATCH = 88
export const PICKER_EMPTY_HEIGHT = 48

/** 由上下文合成窗口内容高度（主进程建窗用；与上述常量同源，公式变更只改此处） */
export function pickerWindowHeight(context: {
  kind: WorkspacePickerKind
  options: WorkspacePickerOption[]
  showMoveOut: boolean
}): number {
  const headerHeight =
    context.kind === 'workspace-move-batch'
      ? PICKER_HEADER_HEIGHT_BATCH
      : PICKER_HEADER_HEIGHT_SINGLE
  const rows = context.options.length + (context.showMoveOut ? 1 : 0)
  let listHeight = PICKER_EMPTY_HEIGHT
  if (rows > 0) {
    const visible = Math.min(rows, PICKER_MAX_VISIBLE_ROWS)
    listHeight = visible * PICKER_ROW_HEIGHT + (visible - 1) * PICKER_ROW_GAP
  }
  return headerHeight + PICKER_LIST_PAD_TOP + listHeight
}
