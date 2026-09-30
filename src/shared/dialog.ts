// 原生弹层辅通道共享契约（主进程 / preload / renderer 三方共用）。
import type { ChromeImportPolicy, ChromeImportScope, ChromeProfileInfo } from './chromeImport'
// 设计依据 PRD 4.10 / 4.11：破坏性确认走 showMessageBox（2026-09-18 增量，计划
// notes/plans/20260918182549-删除会话原生确认框开发计划.md 第 2.4 节）；选择类
// 「移动到工作区」走主进程模态子窗口（2026-09-21 增量，计划 notes/plans/
// 20260921135305-工作区体验双升级开发计划.md 第 2.4 节）；输入类「工作区重命名」
// 同机制承载（2026-09-21 二次增量，计划 notes/plans/20260921155828-工作区菜单
// 右对齐与重命名原生化开发计划.md 第 2.4 节）——弹层存续期间页面视图
// 保持可见且内容原样，不经 overlay 悬挂登记收起右区（弹框期间浏览器区变白即事故）。
// 2026-09-30 导入专项反馈轮：「导入 Chrome 数据」选择/冲突裁决迁同一原生 sheet
// 机制（渲染层 antd Modal 版退役），导入结果/错误反馈改主进程 information 型
// showMessageBox（chromeImport/index.ts 完成点内联，渲染层 antd message 退役）。
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
// 契约要点（confirmWorkspaceDelete，2026-09-24 增量，计划
// notes/plans/20260924222050-删除工作区会话处置弹窗开发计划.md 第 2.4 节）：
// - 删除工作区确认由两键升级为会话处置三选（PRD 4.10 / 验收 34）：含会话工作区
//   呈「取消 / 保留会话 / 删除全部会话」三键、结论按 WorkspaceDeleteChoice 三态
//   返回；空工作区维持两键、确认亦返回 delete-all（无会话可删，与既有行为等价）
// - 载荷只带数据参数（name + count），文案由主进程经 main/i18n 语言态组装；
//   「取消」安全默认沿用用户裁决 2026-09-18；delete-all 由 renderer 编排既有
//   sessions:delete-batch → workspaces:delete 闭环、keep-sessions 由
//   workspaces:delete 闭环（确认与执行两段解耦）；同日 ConfirmKind 的
//   workspace-delete 值退役迁本通道（消费面唯一 = WorkspaceSwitcher）
//
// 契约要点（workspacePicker 三通道，模态子窗口承载「移动到工作区」目标选择与
// 「工作区重命名」输入（2026-09-21 二次增量，计划 notes/plans/20260921155828-
// 工作区菜单右对齐与重命名原生化开发计划.md 第 2.4 节））：
// - show（主窗 shell 触发）→ payload（sheet 页面拉取展示上下文）→ pick（sheet 页面
//   提交选择）三段；主进程持单请求 pending 态（sheet 为窗口模态，主窗输入被阻塞
//   天然单飞，防御性拒绝二次请求）；requestId 由 show 生成、经 payload 下发、pick
//   回传校验（陈旧 sheet 窗的迟到提交不命中即拒绝）
// - 展示数据（工作区列表/当前归属/计数徽标/预填现名）由主进程从权威快照现取组装进
//   WorkspacePickerContext，不经 IPC 传展示字符串；文案由 sheet 页面经 useT
//   消费既有字典键（选择场景 sessions.moveModal.*、重命名场景
//   sessions.workspaceSwitcher.renameModalTitle 等，i18n 零新增）
// - 结果按 kind 分流：选择场景 picked（workspaceId 为目标工作区 id，null = 移出
//   未分组）；重命名场景 submitted（name 为过守卫的新名）；cancelled 覆盖 Esc /
//   关闭弹框 / 父窗缺失 / 建窗失败 / 二次请求被拒等全部未提交路径；移动与重命名
//   执行仍由既有 workspaces:move-session / move-sessions-batch / rename 通道闭环
// - 导入场景（2026-09-30 导入专项反馈轮原生化，用户反馈「模态框用原生框」）：两 kind
//   复用同一 sheet 机制——select（profile 选择 + 内容勾选，上下文 profiles 由主进程
//   探测现取）与 conflict（localStorage 冲突裁决，计数经 show 载荷数据参数回传）；
//   pick 结论（chrome-import-picked / chrome-import-policy）由 renderer 编排
//   chromeImport 域 dry-run/execute 通道闭环（确认与执行两段解耦同先例）；导入的
//   结果/错误反馈改主进程 information 型 showMessageBox（chromeImport/index.ts 完成
//   点内联弹出，渲染层 antd message 退役）
// - 模态子窗口度量常量（与 WorkspacePickerWindow 组件、app.css、主进程建窗
//   高度计算同源配对，omniboxSuggest 度量常量先例）

export const DIALOG_CHANNELS = {
  confirmDestructive: 'dialog:confirm-destructive',
  confirmWorkspaceDelete: 'dialog:confirm-workspace-delete',
  showWorkspacePicker: 'dialog:show-workspace-picker',
  workspacePickerPayload: 'dialog:workspace-picker-payload',
  workspacePickerPick: 'dialog:workspace-picker-pick'
} as const

/**
 * 破坏性确认的场景白名单（kind，主进程 switch 分支组文案）；workspace-delete 已于
 * 2026-09-24 退役迁 confirmWorkspaceDelete 三态通道（其结论非二值，不复用本类型）
 */
export type ConfirmKind = 'session-delete' | 'sessions-batch-close'

export interface ConfirmDestructivePayload {
  /** 确认场景；白名单外的 kind 守卫整单拒绝 */
  kind: ConfirmKind
  /** 会话名：session-delete 必填（正文 {name} 插值），仅展示用不落盘 */
  name?: string
  /** 会话计数：sessions-batch-close 必填（正文 {n} 插值）；session-delete 忽略 */
  count?: number
}

/**
 * 删除工作区会话处置选择载荷（2026-09-24 增量）：单场景无 kind 白名单——name
 * 非空供正文 {name} 插值、count 决定三键（>0）/两键（=0）形态；显示面由主进程
 * 按显示上限 clamp 兜底（跨 IPC 载荷不可信任口径，与 confirmDestructive 同惯例）
 */
export interface ConfirmWorkspaceDeletePayload {
  /** 工作区名：正文 {name} 插值，仅展示用不落盘 */
  name: string
  /** 工作区内会话数：>0 呈三键处置选择；=0 呈两键删除确认 */
  count: number
}

/**
 * 删除工作区会话处置结论（三态）：delete-all = 用户按下「删除全部会话」（空工作区
 * 两键框按下「删除」亦返回此值，此时无会话可删与既有行为等价）；keep-sessions =
 * 用户按下「保留会话」（会话移入未分组）；cancel 覆盖 取消钮/Esc/关框/宿主窗缺失/
 * 入参守卫失败/invoke 异常（renderer 薄封装吞错）等全部未确认路径
 */
export type WorkspaceDeleteChoice = 'delete-all' | 'keep-sessions' | 'cancel'

/** 建窗 query role 值与 main.tsx 角色分流单源（SETTINGS_WINDOW_ROLE 同款先例） */
export const WORKSPACE_PICKER_WINDOW_ROLE = 'workspace-picker'

/**
 * 模态框场景白名单（kind，主进程 switch 分支组装上下文；2026-09-21 二次增量扩
 * workspace-rename——重命名输入复用同一 sheet 机制，类型/通道/角色命名保持 Picker
 * 家族不改，语义扩围以头注与本注为准；2026-09-30 导入专项反馈轮扩 chrome-import-select /
 * chrome-import-conflict——「导入 Chrome 数据」选择与冲突裁决由同一原生 sheet 承载，
 * 替代渲染层 antd Modal 版 ImportChromeDialog（用户反馈：模态框用原生框））
 */
export type WorkspacePickerKind =
  | 'workspace-move-single'
  | 'workspace-move-batch'
  | 'workspace-rename'
  | 'chrome-import-select'
  | 'chrome-import-conflict'

/** show 通道载荷：只带数据参数——single 必填 sessionId、batch 必填非空 ids、rename 必填 workspaceId（守卫强制；各 kind 禁传彼此的数据参数） */
export interface ShowWorkspacePickerPayload {
  kind: WorkspacePickerKind
  /** 单条移动的目标会话 id（workspace-move-single 必填，须过 SESSION_ID_RE） */
  sessionId?: string
  /** 批量移动的勾选会话 id 集（workspace-move-batch 必填非空，格式非法整单拒绝） */
  ids?: string[]
  /** 重命名的目标工作区 id（workspace-rename 必填，须过 WORKSPACE_ID_RE；现名由主进程从快照现取，渲染层不传名） */
  workspaceId?: string
  /**
   * chrome-import-conflict 必填（须为 ≥0 整数，渲染层不传整单拒绝）：localStorage
   * 冲突键数与涉及站点数（dry-run 实测值经 renderer 原样回传，sheet 副行插值展示）；
   * chrome-import-select 禁传
   */
  keys?: number
  origins?: number
}

/**
 * show 通道返回值（亦即模态框的最终结论）：picked 携带用户点选的目标工作区 id
 * （null = 移出未分组，仅选择场景）；submitted 携带过主进程守卫的新名（仅重命名
 * 场景）；chrome-import-picked 携带所选 profile 目录与内容勾选（仅导入选择场景，
 * scopes 经主进程闭集守卫重排）；chrome-import-policy 携带冲突裁决结论（仅导入
 * 冲突场景）；cancelled 覆盖 Esc / 关闭弹框 / 父窗缺失 / 建窗失败 / 目标已消失 /
 * 二次请求被拒等全部未提交路径
 */
export type WorkspacePickerResult =
  | { status: 'picked'; workspaceId: string | null }
  | { status: 'submitted'; name: string }
  | { status: 'chrome-import-picked'; profileDir: string; scopes: ChromeImportScope[] }
  | { status: 'chrome-import-policy'; policy: ChromeImportPolicy }
  | { status: 'cancelled' }

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
   * 当前行不再隐藏，sheet 呈「当前所在」禁用态作位置指示）；batch：全部工作区 +
   * hereCount 计数徽标；rename：不使用（无选项行）
   */
  options: WorkspacePickerOption[]
  /** 是否显示「移出（未分组）」行：single = 当前已分组；batch = 勾选中存在非未分组归属；rename 不使用 */
  showMoveOut: boolean
  /** 重命名场景：预填的当前名称（主进程从权威快照现取）；选择场景缺省 */
  currentName?: string
  /**
   * chrome-import-select：profile 枚举（dir + Local State 显示名，主进程现取）与
   * 探测结论（false = 未检测到 Chrome，sheet 呈提示 + 仅取消钮）；其余 kind 不使用
   */
  chromeDetected?: boolean
  chromeProfiles?: ChromeProfileInfo[]
  /**
   * chrome-import-conflict：冲突摘要（dry-run 实测值，主进程经 show 载荷守卫后
   * 原样组装，sheet 副行插值展示）；其余 kind 不使用
   */
  chromeConflictKeys?: number
  chromeConflictOrigins?: number
}

/**
 * pick 通道载荷（sheet 页面 → 主进程）：requestId 须与 pending 请求一致（陈旧
 * 窗口的迟到提交不命中即拒绝）；选择场景 workspaceId 为点选的目标工作区 id
 * （null = 移出未分组）；重命名场景 name 为新名（sheet 页面已 trim，主进程守卫
 * trim 非空 + ≤WORKSPACE_NAME_MAX 后才作结论返回）；取消路径不走本通道（直接
 * 关窗，主进程 closed 钩子兜底 resolve cancelled）
 */
export interface WorkspacePickerPickPayload {
  requestId: string
  /** 选择场景必填：点选的目标工作区 id（null = 移出未分组）；重命名场景禁传（目标已由 pending 上下文持有） */
  workspaceId?: string | null
  /** 重命名场景必填：新名称；选择场景禁传（主进程按 pending kind 分流校验） */
  name?: string
  /** chrome-import-select 必填：所选 profile 目录（须出自 pending 上下文枚举）；其余 kind 禁传 */
  profileDir?: string
  /** chrome-import-select 必填非空：内容勾选（scopes 字符串经主进程闭集守卫重排）；其余 kind 禁传 */
  scopes?: string[]
  /** chrome-import-conflict 必填：冲突裁决结论；其余 kind 禁传 */
  policy?: string
}

/**
 * 模态框窗口度量（DIP，与 WorkspacePickerWindow.tsx / app.css / 主进程建窗高度
 * 计算同源配对；改值多处对账；2026-09-21 用户反馈放大疏朗定稿：360 宽 / 40 行高
 * / 行间 4px / 列表上内距 4px）：宽度恒定；选择场景高度 = 头部（单条/批量两档，
 * 按页面 CSS 实测推导：body 上内距 16 + 标题行 22 + 标题下距 12 +（批量副行 20）
 * + 列表分隔线 1 + 底部内距 16 折算）+ 列表上内距 + 可见行数 × 行高 +（可见行数
 * − 1）× 行间距（行数超 MAX_VISIBLE_ROWS 封顶内滚；零行 = 列表上内距 + 空态句
 * 定高）——主进程建窗 useContentSize 精确按此合成，sheet 随内容定高、不滚动窗口
 * 本体；列表区除上内距与行间距外禁任何纵向增量，否则与公式失配。
 * 重命名场景高度 = 头部（与单条同解剖，复用 SINGLE 档）+ 表单间距 + 输入行高 +
 * 表单间距 + 按钮行高（2026-09-21 重命名增量，输入行/按钮行样式见 app.css
 * picker-form 段）。
 * 导入场景（2026-09-30 导入专项反馈轮原生化）：select = 头部 + label 行 + 表单间距
 * + profile 下拉行（RENAME_INPUT_HEIGHT 同款）+ 表单间距 + 勾选行×2（SCOPES_GAP
 * 间距）+ 表单间距 + 按钮行；notDetected = 头部 + 空态句；conflict = 头部 + 冲突
 * 标题 + 副行间距 + 描述（两行封顶）+ 表单间距 + 单选×2 + 表单间距 + 按钮行——
 * 页面样式 .picker-label/.picker-check/.picker-conflict 系与此公式同源配对
 */
export const PICKER_WINDOW_WIDTH = 360
export const PICKER_ROW_HEIGHT = 40
export const PICKER_ROW_GAP = 4
export const PICKER_LIST_PAD_TOP = 4
export const PICKER_MAX_VISIBLE_ROWS = 6
export const PICKER_HEADER_HEIGHT_SINGLE = 68
export const PICKER_HEADER_HEIGHT_BATCH = 88
export const PICKER_EMPTY_HEIGHT = 48
export const RENAME_FORM_GAP = 12
export const RENAME_INPUT_HEIGHT = 36
export const RENAME_FOOT_HEIGHT = 32
export const CHROME_IMPORT_LABEL_HEIGHT = 20
export const CHROME_IMPORT_TITLE_HEIGHT = 20
export const CHROME_IMPORT_DESC_HEIGHT = 40
export const CHROME_IMPORT_RADIO_HEIGHT = 28
export const CHROME_IMPORT_SCOPE_HEIGHT = 28
export const CHROME_IMPORT_SCOPES_GAP = 8

/** 由上下文合成窗口内容高度（主进程建窗用；与上述常量同源，公式变更只改此处） */
export function pickerWindowHeight(context: WorkspacePickerContext): number {
  if (context.kind === 'workspace-rename') {
    return (
      PICKER_HEADER_HEIGHT_SINGLE +
      RENAME_FORM_GAP +
      RENAME_INPUT_HEIGHT +
      RENAME_FORM_GAP +
      RENAME_FOOT_HEIGHT
    )
  }
  if (context.kind === 'chrome-import-select') {
    if (!context.chromeDetected) return PICKER_HEADER_HEIGHT_SINGLE + PICKER_EMPTY_HEIGHT
    return (
      PICKER_HEADER_HEIGHT_SINGLE +
      CHROME_IMPORT_LABEL_HEIGHT +
      RENAME_FORM_GAP +
      RENAME_INPUT_HEIGHT +
      RENAME_FORM_GAP +
      CHROME_IMPORT_SCOPE_HEIGHT +
      CHROME_IMPORT_SCOPES_GAP +
      CHROME_IMPORT_SCOPE_HEIGHT +
      RENAME_FORM_GAP +
      RENAME_FOOT_HEIGHT
    )
  }
  if (context.kind === 'chrome-import-conflict') {
    return (
      PICKER_HEADER_HEIGHT_SINGLE +
      CHROME_IMPORT_TITLE_HEIGHT +
      CHROME_IMPORT_SCOPES_GAP +
      CHROME_IMPORT_DESC_HEIGHT +
      RENAME_FORM_GAP +
      CHROME_IMPORT_RADIO_HEIGHT +
      CHROME_IMPORT_SCOPES_GAP +
      CHROME_IMPORT_RADIO_HEIGHT +
      RENAME_FORM_GAP +
      RENAME_FOOT_HEIGHT
    )
  }
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
