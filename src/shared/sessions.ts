// 会话持久化共享契约（主进程 / preload / renderer 三方共用）。
// 修改本文件的类型或通道名前，必须先修订
// notes/plans/20260912201534-阶段6会话Tab列表落盘与恢复开发计划.md 第 2.4 节
// （阶段 5 增量契约的历史修订记录见同目录阶段 5 计划第 3 节）。
//
// 契约要点：
// - 落盘 schema version 4（v3 增 tabs/activeTabIndex；v4 增工作区三件——快照
//   workspaces/activeWorkspaceId 与会话 workspaceId；v1—v3 文件读取时按默认值
//   迁移（空工作区、全会话未分组、视野 'all'），写盘恒出 v4，见 src/main/store.ts）
// - status 是运行时状态不落盘，由"该会话任一 Tab loading"聚合而来，经
//   statusChanged 全量 map 推送；renderer 先订阅后拉取（getStatuses）防启动竞态
// - setActive 通道在主进程内附带副作用：触发浏览器切换到目标会话（编排见 registry）
// - 阶段 5 增量：clone（分区数据+元数据复制）、deleteBatch（批量关闭=彻底删除
//   选中会话，替代早期 delete-all）、batchOpenUrl（选中会话统一开测试地址）；
//   通道整单校验拒绝制，无部分成功
// - 阶段 6 增量：tabs（恢复用 URL 列表，顺序即创建序）+ activeTabIndex（激活位）；
//   恢复是 URL 级——页面运行态与 DevTools 开关态不持久化（PRD 3.6.4）
// - 会话列表排序增量（2026-09-18 专项）：reorder（全序 ids 整单校验拒绝制——格式
//   非法/重复/缺项/多项/未知 id 任一不满足整单拒绝）；纯元数据重排，不动 activeId、
//   不触发浏览器编排回调；sessions 数组顺序即唯一持久化顺序
// - 工作区增量（2026-09-15 专项，计划 notes/plans/20260915150336-工作区下拉切换
//   开发计划.md）：新增 workspaces 五通道（create/rename/delete/move-session/
//   set-active，全 invoke 零推送——工作区仅主窗左栏操作，无跨窗并发源），会话域
//   通道 11 → 16；workspaceSetActive 主进程内原子完成「视野落盘 + 激活位级联」
//   （激活位变化才回调 onActiveChanged，纯视野切换零编排）；create/clone 增可选
//   workspaceId（undefined = create 落未分组 / clone 落源会话归属）；归属独占制，
//   会话 workspaceId 为 string | null（null = 未分组）；删除工作区必留会话（降级
//   未分组）；视野与激活正交——除 workspaceSetActive 级联外 activeId 不因视野变化
// - 批量移动增量（2026-09-17，计划 notes/plans/20260917154344-批量移动会话到
//   工作区开发计划.md 第 2.4 节）：workspaces:move-sessions-batch（16 → 17）——
//   批量模式将选中会话移动到指定工作区或移出未分组；已在目标的会话幂等 no-op
//   计入 skipped（合法语义非拒绝），sessionIds/workspaceId 非法或不存在则整单
//   拒绝（零部分成功、磁盘不变）；单 mutateSnapshot 临界区一次落盘，返回真实
//   moved/skipped 计数（renderer 反馈条不自算口径）；不动 activeId
// - 恢复出厂增量（2026-09-18，计划 notes/plans/20260918010928-设置阶段七恢复
//   出厂设置开发计划.md 第 2.4 节）：changed（17 → 18，推送通道）——跨窗口发起
//   的会话事实变更通知：payload = 完整 SessionsSnapshot，主进程定向推送主窗口
//   （会话面板只在主窗，接线对齐 statusChanged 先例），收方以快照权威接管
//   （adoptSnapshot）；现触发源仅恢复出厂完成时，其他跨窗 mutation 未来复用
// - 会话备注编辑增量（2026-09-18，计划 notes/plans/20260918155214-会话备注编辑
//   开发计划.md 第 2.4 节）：set-note（18 → 19，invoke）——会话行菜单编辑账号
//   备注（PRD 3.1.2）；trim 后空串 = 清除备注（合法提交非拒绝），语义与 rename
//   拒空相反；纯元数据无编排回调（备注不联动窗口标题）；note 字段 v1 起在
//   StoredSession，零 schema 变更
// - 工作区排序增量（2026-09-21，计划 notes/plans/20260921135305-工作区体验双升级
//   开发计划.md 第 2.4 节）：workspaceReorder（19 → 20，invoke）——下拉面板内拖动
//   提交完整工作区 id 全序，整单校验拒绝制与 sessions:reorder 同口径（WORKSPACE_ID_RE
//   格式非法/重复/缺项/多项/未知 id 任一整单拒绝、磁盘顺序不变）；纯重排 workspaces
//   数组（元素对象原样引用），不动 activeWorkspaceId/activeId/lastActiveSessionId
//   与会话归属，零编排回调；schema v4 零变更（数组顺序即唯一持久化顺序）

export const SESSIONS_CHANNELS = {
  list: 'sessions:list',
  create: 'sessions:create',
  rename: 'sessions:rename',
  setNote: 'sessions:set-note',
  delete: 'sessions:delete',
  setActive: 'sessions:set-active',
  getStatuses: 'sessions:get-statuses',
  statusChanged: 'sessions:status-changed',
  /** 会话事实变更推送（恢复出厂增量）：payload = 完整快照，定向主窗，收方权威接管 */
  changed: 'sessions:changed',
  clone: 'sessions:clone',
  deleteBatch: 'sessions:delete-batch',
  batchOpenUrl: 'sessions:batch-open-url',
  reorder: 'sessions:reorder',
  workspaceCreate: 'workspaces:create',
  workspaceRename: 'workspaces:rename',
  workspaceDelete: 'workspaces:delete',
  workspaceMoveSession: 'workspaces:move-session',
  workspaceMoveSessionsBatch: 'workspaces:move-sessions-batch',
  workspaceReorder: 'workspaces:reorder',
  workspaceSetActive: 'workspaces:set-active'
} as const

/**
 * 会话 id 的格式契约：sess-<base36 时间戳>-<自增 seq>。
 * 单一事实源——生成端（main/sessions.ts 的 generateSessionId）与校验端
 * （main/browser/registry.ts 的分区拼装/目录解析）共同引用本常量，规则变更只改此处，
 * 防两模块靠注释互相同步的漂移（纵深防御：被篡改的落盘 id 在拼分区串前即被拒绝）
 */
export const SESSION_ID_RE = /^sess-[a-z0-9-]+$/

/**
 * 工作区 id 的格式契约：ws-<base36 时间戳>-<自增 seq>（生成端与校验端同源，防
 * 篡改落盘 id 经 IPC 写穿——照 SESSION_ID_RE 的纵深防御先例）。恒 ws- 前缀，
 * 与视野哨兵值 WORKSPACE_VIEW_ALL（'all'）无碰撞
 */
export const WORKSPACE_ID_RE = /^ws-[a-z0-9-]+$/

/** 工作区名长度上限（IPC 入口 clamp，按 UTF-16 码元切） */
export const WORKSPACE_NAME_MAX = 20

/**
 * 视野哨兵值：activeWorkspaceId 为 'all'（全部会话视野）或某工作区 id。
 * 单一事实源——主进程校验与 renderer 派生共用，禁止手写字面量 'all'
 */
export const WORKSPACE_VIEW_ALL = 'all'

/**
 * pageTitle / tab title 的截断上限（按 UTF-16 码元切，中文不受影响）。
 * 单一事实源：sessions IPC 入口 clamp、manager 的 tab title、registry 的落盘上报
 * 三处消费同一值，禁止各持字面量（防改一处漏两处）。
 */
export const PAGE_TITLE_MAX = 200

/**
 * 会话备注的截断上限（按 UTF-16 码元切，中文不受影响）。
 * 单一事实源：sessions IPC 入口 clamp 与 renderer 编辑框 maxLength 两处消费
 * 同一值（renderer 限长防主进程静默截断，2026-09-18 备注编辑增量）
 */
export const SESSION_NOTE_MAX = 200

/** 落盘的单个恢复用 Tab（仅 URL；页面运行态不持久化） */
export interface StoredTab {
  url: string
}

/**
 * StoredTab[] 浅克隆（新建元素对象，防与落盘/缓存对象共享可变引用）。
 * 单一事实源：store 重建、registry 恢复集缓存、clone 元数据复制三处消费同一实现，
 * tabs 结构演进（如阶段 7 增字段）时只改此处
 */
export function cloneTabs(tabs: readonly StoredTab[]): StoredTab[] {
  return tabs.map((tab) => ({ url: tab.url }))
}

/**
 * 落盘的会话元数据（status 为运行时状态，不落盘）。
 * lastUrl：该会话上次打开页（激活 Tab 的 URL），空串 = 无记录；
 * 重启后首次激活该会话时自动重载（PRD 3.1.4"上次打开页面"）。
 * tabs/activeTabIndex（阶段 6）：恢复用 Tab URL 列表与激活位，lastUrl 与
 * tabs[activeTabIndex] 由写侧同源计算保持一致；tabs 空表示无恢复集
 * （懒创建时回退单空白 Tab，v1/v2 老文件迁移为由 lastUrl 派生的单元素）
 */
export interface StoredSession {
  id: string
  name: string
  note: string
  pageTitle: string
  lastUrl: string
  tabs: StoredTab[]
  activeTabIndex: number
  /** 所属工作区 id；null = 未分组（归属独占制，PRD 4.8） */
  workspaceId: string | null
}

/**
 * 落盘的工作区元数据。workspaces 数组顺序即下拉展示序（唯一持久化顺序，可经
 * workspaceReorder 全序重排——拖动排序专项 2026-09-21，整单校验拒绝制）；
 * lastActiveSessionId 为该工作区内上次激活的会话（恢复「视野 + 激活位」用，
 * 只随真实激活更新；null = 无记忆），不参与任何编排
 */
export interface StoredWorkspace {
  id: string
  name: string
  lastActiveSessionId: string | null
}

/** renderer 运行时会话 = 落盘数据 + 状态 */
export type SessionStatus = 'idle' | 'loading'

/** 全量会话运行状态 map（key 为会话 id）；推送与拉取同构，整体替换不合并 */
export interface SessionStatusesPayload {
  statuses: Record<string, SessionStatus>
}

export interface SessionsSnapshot {
  version: number
  sessions: StoredSession[]
  activeId: string | null
  /** 工作区列表（v4；v1—v3 迁移为空数组） */
  workspaces: StoredWorkspace[]
  /** 当前视野：WORKSPACE_VIEW_ALL（'all'）或工作区 id（v4；v1—v3 迁移为 'all'） */
  activeWorkspaceId: string
}

export interface CreateSessionPayload {
  name?: string
  note?: string
  /** 落入的工作区：undefined = 未分组；显式传值须格式合法且存在，否则整单拒绝 */
  workspaceId?: string | null
}

export interface RenameSessionPayload {
  id: string
  name: string
}

/**
 * 编辑会话备注（PRD 3.1.2）：与 RenameSessionPayload 同构但 trim 后空串合法，
 * = 清除备注（行内恢复「未填写备注」占位），语义与 rename 拒空相反
 */
export interface SetNotePayload {
  id: string
  note: string
}

export interface DeleteSessionPayload {
  id: string
}

export interface SetActiveSessionPayload {
  id: string | null
}

/**
 * 克隆会话：复制源会话的分区数据（登录态等持久环境）与元数据，生成同款新环境。
 * workspaceId 缺省落源会话归属；显式传值（含 null = 未分组）须格式合法且存在
 */
export interface CloneSessionPayload {
  id: string
  workspaceId?: string | null
}

/**
 * 批量打开测试地址：全部选中会话各新建一个 Tab 加载该 URL。
 * 整单校验拒绝制——ids 任一不存在或 URL 不合法时整单拒绝，无部分成功
 */
export interface BatchOpenUrlPayload {
  ids: string[]
  url: string
}

/**
 * 批量关闭选中会话：彻底删除勾选会话（与单条删除同一标准：销毁 webContents +
 * 清分区数据 + 删分区目录）。
 * 整单校验拒绝制——ids 任一不存在时整单拒绝，无部分成功
 */
export interface BatchDeleteSessionsPayload {
  ids: string[]
}

/**
 * 会话列表排序：提交当前全部会话 id 的完整排列（全序，非 from/to 增量）。
 * 整单校验拒绝制——重复、缺项、多项、未知 id 或格式非法任一不满足整单拒绝，
 * 磁盘顺序不变；合法时纯重排 sessions 数组，activeId 与各会话字段不变
 */
export interface ReorderSessionsPayload {
  ids: string[]
}

/**
 * 工作区列表排序（拖动排序专项 2026-09-21）：提交当前全部工作区 id 的完整排列
 * （全序，非 from/to 增量）。整单校验拒绝制与 ReorderSessionsPayload 同口径——
 * WORKSPACE_ID_RE 格式非法、重复、缺项、多项、未知 id 任一不满足整单拒绝，
 * 磁盘顺序不变；合法时纯重排 workspaces 数组，activeWorkspaceId、activeId 与
 * lastActiveSessionId 均不变（「全部会话」哨兵项不属于排序集合，天然不在 ids 内）
 */
export interface ReorderWorkspacesPayload {
  ids: string[]
}

/** 新建工作区：name trim 非空、≤WORKSPACE_NAME_MAX、与现存重名拒绝 */
export interface CreateWorkspacePayload {
  name: string
}

export interface RenameWorkspacePayload {
  id: string
  name: string
}

/**
 * 删除工作区：其中会话全部移入未分组（会话与其数据不受影响，PRD 4.8）；
 * activeWorkspaceId 指向它时回落 'all'，activeId 不动、零编排回调
 */
export interface DeleteWorkspacePayload {
  id: string
}

/**
 * 移动会话到工作区（独占归属）：workspaceId 传 null = 移出到未分组；
 * 目标须格式合法且存在；移动到当前归属为 no-op ok（幂等）；不动 activeId
 */
export interface MoveSessionToWorkspacePayload {
  sessionId: string
  workspaceId: string | null
}

/**
 * 批量移动选中会话到工作区（独占归属；批量模式板脚入口）：workspaceId 传
 * null = 全部移出到未分组。
 * 语义二分（通道头注同步）：已在目标的会话幂等 no-op 计入 skipped（合法）；
 * sessionIds 非法（格式/重复）或任一会话/目标工作区不存在则整单拒绝（零部分
 * 成功、磁盘不变）。单临界区一次落盘，moved/skipped 为真实计数，不动 activeId
 */
export interface MoveSessionsToWorkspacePayload {
  /** 勾选会话 id 集（batch 家族载荷同款字段名；重复 id 去重容忍——对齐 delete-batch/batch-open-url） */
  ids: string[]
  workspaceId: string | null
}

/** 批量移动结果：moved = 归属发生变化的会话数；skipped = 已在目标被跳过的会话数 */
export interface MoveSessionsBatchResult {
  moved: number
  skipped: number
}

/**
 * 切换工作区视野：id 为 WORKSPACE_VIEW_ALL（'all'）或工作区 id。
 * 主进程同一临界区内原子完成：落 activeWorkspaceId + 必要时级联 activeId
 * （该工作区 lastActiveSessionId → 无记忆取全序首个 → 空工作区 null），
 * 仅激活位变化时回调 onActiveChanged 触发浏览器切换；'all' 与纯视野切换零编排
 */
export interface SetActiveWorkspacePayload {
  id: string
}

export interface OkResult {
  ok: true
}
