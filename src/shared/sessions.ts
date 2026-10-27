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
//   选中会话，替代早期 delete-all）；通道整单校验拒绝制，无部分成功。
//   2026-10-23 用户裁决批量多选功能整体退役：batch-open-url 通道随功能删除；
//   delete-batch 保留——工作区删除「删除全部会话」处置复用（WorkspaceSwitcher 编排）
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
// - 批量移动增量（2026-09-17）已于 2026-10-23 随批量多选退役整体删除
//   （move-sessions-batch 通道与 MoveSessionsBatch 载荷/结果类型同撤）
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
// - 独立代理增量（2026-10-15，计划 notes/plans/20261015025109-独立代理开发计划.md
//   第 3 节）：setProxy / checkProxy（20 → 22，invoke 18 → 20）——单会话独立配置
//   代理（PRD 3.5 / 4.14）；proxy 字段随 StoredSession 落盘（schema v5，见
//   src/main/store.ts），null = 未配置（直连）；setProxy 传 null = 清除（合法语义，
//   对齐 set-note 空串清除先例）；checkProxy 按草稿值经该会话分区探测出口 IP，
//   三态失败如实分类（unreachable / auth / fetch），不落盘不动当前生效配置；
//   载荷校验与 proxyRules 映射单源 = normalizeProxyConfig / toProxyRules（主进程
//   handler 守卫与探测请求共用，禁止各持字面量）
// - 行原生菜单增量（2026-10-15 反馈轮四）：popup-row-menu（send）+ row-menu-action
//   （推送，22 → 24）——会话行右键/⋮ 菜单从渲染层 antd Dropdown 迁主进程原生
//   Menu.popup：OS 级绘制盖过页面 WebContentsView（DOM 菜单要么被面板宽度挤压、
//   要么探出左栏被原生层裁切，两版均被否），且点任意位置（含页面区）关闭，找回
//   2026-09-21 收起方案换掉的「全区域外点关闭」能力；菜单文案主进程经 main/i18n
//   取既有键零新增字典，点击结论定向推回发起窗口由 renderer 既有编排闭环；
//   2026-10-20 用户裁决：右键与 ⋮ 统一弹同一全量菜单，dots 短菜单变体退役
// - 工作区原生菜单增量（2026-10-27，计划 notes/plans/20261027150209-工作区右键
//   菜单原生化开发计划.md）：workspacePopupMenu（send）+ workspaceMenuAction
//   （推送，22 → 24）——工作区行右键菜单「重命名/删除工作区」同款迁主进程原生
//   Menu.popup（复刻行菜单先例，渲染层 antd Dropdown 与其 workaround 链退役：
//   portal 锁挂/overlay 登记/.ant-dropdown 豁免/延迟挂弹层——原生菜单无关闭
//   动画，useDeferredMenuAction 末位消费者消失随之退役）；i18n 零新增
//   （rowRename/rowDelete 既有键）

import { isRecord } from './guards'

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
  /** 批量关闭选中（2026-10-23 批量模式退役后仅工作区删除「删除全部会话」处置消费） */
  deleteBatch: 'sessions:delete-batch',
  reorder: 'sessions:reorder',
  workspaceCreate: 'workspaces:create',
  workspaceRename: 'workspaces:rename',
  workspaceDelete: 'workspaces:delete',
  workspaceMoveSession: 'workspaces:move-session',
  workspaceReorder: 'workspaces:reorder',
  workspaceSetActive: 'workspaces:set-active',
  /** 独立代理增量（2026-10-15）：保存（proxy 非空）/ 清除（proxy = null）会话代理 */
  setProxy: 'sessions:set-proxy',
  /** 独立代理增量（2026-10-15）：按草稿值探测该会话出口 IP（不落盘不动生效配置） */
  checkProxy: 'sessions:check-proxy',
  /** 行原生菜单增量（2026-10-15 反馈轮四）：renderer 请求主进程弹出系统原生菜单 */
  popupRowMenu: 'sessions:popup-row-menu',
  /** 行原生菜单增量（2026-10-15 反馈轮四）：菜单项点击结论定向推回发起窗口 */
  rowMenuAction: 'sessions:row-menu-action',
  /** 工作区原生菜单增量（2026-10-27）：renderer 请求主进程弹出工作区右键系统原生菜单 */
  workspacePopupMenu: 'workspaces:popup-menu',
  /** 工作区原生菜单增量（2026-10-27）：菜单项点击结论定向推回发起窗口 */
  workspaceMenuAction: 'workspaces:menu-action'
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
 * 视野哨兵值：activeWorkspaceId 为 'all'（全部会话视野）、'ungrouped'（未分组
 * 视野，2026-09-21 用户反馈增量——下拉固定末位行，仅存留未分组会话）或某工作区
 * id。单一事实源——主进程校验与 renderer 派生共用，禁止手写字面量
 */
export const WORKSPACE_VIEW_ALL = 'all'
export const WORKSPACE_VIEW_UNGROUPED = 'ungrouped'

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

/**
 * 会话独立代理的协议闭集（PRD 4.14）。Chromium proxyRules 前缀映射见
 * toProxyRules；PAC / auto_detect / system 模式明确不在二期范围（PRD 3.5）
 */
export type ProxyProtocol = 'http' | 'socks5'

/**
 * 会话独立代理配置（PRD 3.5 / 4.14）。username / password 空串 = 无认证；
 * 凭据明文随会话元数据落盘 sessions.json（与该文件承载的登录态数据同机同权，
 * PRD 4.14 如实声明，不做伪加密——界面不得宣称安全隔离）
 */
export interface SessionProxyConfig {
  protocol: ProxyProtocol
  /** 域名 / IPv4 字面量，或方括号 IPv6 字面量（如 [::1]）；trim 后非空 */
  host: string
  port: number
  username: string
  password: string
}

/** host / 凭据的长度与语法上限（IPC 入口与落盘重建共用；host 上限 = 域名 RFC 上限） */
export const PROXY_HOST_MAX = 253
export const PROXY_PORT_MIN = 1
export const PROXY_PORT_MAX = 65535
export const PROXY_CRED_MAX = 128

/** host 语法白名单：域名 / IPv4（字母数字连字符点）；IPv6 走方括号字面量支线 */
const PROXY_HOST_RE = /^[A-Za-z0-9.-]+$/
const PROXY_IPV6_RE = /^\[[0-9A-Fa-f:.]+\]$/
const PROXY_PROTOCOLS: readonly ProxyProtocol[] = ['http', 'socks5']

/**
 * 未知值 → 合法配置的归一化校验（IPC 守卫与 store 落盘重建共用的单一出口）。
 * 任一项不过即整体判废返回 null：协议非闭集、host 空/超长/非法字符、端口非整数
 * 或越界、凭据超长。username trim（惯例输入），password 不 trim（代理凭据可能
 * 含空白，trim 会让「密码本有空格」的合法配置静默失效）
 */
export function normalizeProxyConfig(raw: unknown): SessionProxyConfig | null {
  if (!isRecord(raw)) return null
  if (!PROXY_PROTOCOLS.includes(raw.protocol as ProxyProtocol)) return null
  const host = typeof raw.host === 'string' ? raw.host.trim() : ''
  if (host.length === 0 || host.length > PROXY_HOST_MAX) return null
  if (!PROXY_HOST_RE.test(host) && !PROXY_IPV6_RE.test(host)) return null
  const port = raw.port
  if (typeof port !== 'number' || !Number.isInteger(port)) return null
  if (port < PROXY_PORT_MIN || port > PROXY_PORT_MAX) return null
  const username = typeof raw.username === 'string' ? raw.username.trim() : ''
  const password = typeof raw.password === 'string' ? raw.password : ''
  if (username.length > PROXY_CRED_MAX || password.length > PROXY_CRED_MAX) return null
  return { protocol: raw.protocol as ProxyProtocol, host, port, username, password }
}

/**
 * 配置 → Chromium proxyRules 串（session.setProxy 消费）：http 无前缀（Chromium
 * 缺省 scheme 为 http），socks5 带 socks5:// 前缀；IPv6 方括号字面量原样保留
 * （`[::1]:8080` / `socks5://[::1]:1080` 均为合法 rules 语法）
 */
export function toProxyRules(config: SessionProxyConfig): string {
  return config.protocol === 'socks5'
    ? `socks5://${config.host}:${config.port}`
    : `${config.host}:${config.port}`
}

/**
 * 出口 IP 探测地址与超时（check-proxy 主进程 net.request 定向该会话分区发起）。
 * 单一事实源，禁止散落字面量；探测地址以国内网络实测可达为准（候选 ip.3322.net /
 * api.ip.sb/ip，冒烟定稿记录见计划步骤 2），响应体须为 IP 形态纯文本
 */
export const PROXY_PROBE_URL = 'https://ip.3322.net'
export const PROXY_PROBE_TIMEOUT_MS = 8000

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
  /**
   * 独立代理配置（v5 增量，PRD 4.14）；null = 未配置（直连）。
   * 克隆随元数据复制；修改/清除由 set-proxy 通道闭环（清除传 null）
   */
  proxy: SessionProxyConfig | null
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

/**
 * 设置会话代理（PRD 4.14）：proxy 为 null = 清除该会话代理（合法提交回直连，
 * 对齐 set-note 空串清除先例）；非空值经 normalizeProxyConfig 守卫，非法整单拒绝。
 * 保存/清除成功后主进程内联动应用代理到该会话分区（编排见 registry/proxy.ts）
 */
export interface SetProxyPayload {
  id: string
  proxy: SessionProxyConfig | null
}

/**
 * 按草稿值探测出口 IP：以 proxy 为探测配置、经 id 会话的分区发起（探测必须锚定
 * 真实分区——凭据经该分区的认证链路供给）。不落盘、不改变该会话当前生效配置；
 * id 不存在整单拒绝
 */
export interface CheckProxyPayload {
  id: string
  proxy: SessionProxyConfig
}

/**
 * 探测结论（三态失败如实分类，不伪造生效）：ok = 代理可用且拿到出口 IP；
 * unreachable = 连不上代理（地址错/端口无监听/本机网络不通——第①跳失败）；
 * auth = 代理认证失败（账号密码错，407 链路）；fetch = 代理已连通但探测请求
 * 本身失败（探测地址不可达/超时/响应非 IP——第②跳或探测面问题）
 */
export type ProxyCheckResult =
  { ok: true; ip: string } | { ok: false; reason: 'unreachable' | 'auth' | 'fetch' }

/**
 * 会话行原生菜单（2026-10-15 反馈轮四 DOM 菜单退役；2026-10-20 用户裁决统一）：
 * 行右键与 ⋮ 按钮两触发器弹出同一全量菜单（重命名/编辑备注/克隆/移动/导入
 * Chrome 数据/代理设置/删除），dots 短菜单变体退役。菜单由主进程 Menu.popup
 * 绘制（OS 级，盖过页面原生层、点任意位置关闭），文案主进程经 main/i18n 取既有键，
 * 点击结论经 row-menu-action 推回 renderer 既有编排闭环
 */

/** renderer → 主进程：在 (x, y)（视口坐标 = 窗口内容坐标）弹出该会话的原生菜单 */
export interface PopupRowMenuPayload {
  id: string
  x: number
  y: number
}

/** 菜单项动作键（与 renderer 既有编排一一对应） */
export type RowMenuActionKey =
  'rename' | 'editNote' | 'clone' | 'move' | 'importChrome' | 'proxy' | 'delete'

/** 主进程 → renderer：菜单项点击结论，定向推回发起 popup 的 webContents */
export interface RowMenuActionPayload {
  id: string
  key: RowMenuActionKey
}

/**
 * 工作区原生菜单（2026-10-27，渲染层 antd Dropdown 退役）：工作区行右键弹
 * 主进程 Menu.popup 绘制的系统原生菜单（重命名/删除工作区两项，机制与载荷
 * 形态复刻会话行菜单先例——OS 级绘制盖过页面原生层、点任意位置关闭），文案
 * 主进程经 main/i18n 取既有键，点击结论经 workspaceMenuAction 推回 renderer
 * 既有编排闭环（原生 sheet 重命名 / 原生确认框删除）
 */

/** renderer → 主进程：在 (x, y)（视口坐标 = 窗口内容坐标）弹出该工作区的原生菜单 */
export interface PopupWorkspaceMenuPayload {
  id: string
  x: number
  y: number
}

/** 菜单项动作键（与 renderer 既有编排一一对应） */
export type WorkspaceMenuActionKey = 'rename' | 'delete'

/** 主进程 → renderer：菜单项点击结论，定向推回发起 popup 的 webContents */
export interface WorkspaceMenuActionPayload {
  id: string
  key: WorkspaceMenuActionKey
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
 * 批量关闭选中会话：彻底删除勾选会话（与单条删除同一标准：销毁 webContents +
 * 清分区数据 + 删分区目录）。
 * 整单校验拒绝制——ids 任一不存在时整单拒绝，无部分成功。
 * 2026-10-23 批量模式退役后由工作区删除「删除全部会话」处置编排消费
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
 * 切换工作区视野：id 为 WORKSPACE_VIEW_ALL（'all'）、WORKSPACE_VIEW_UNGROUPED
 * （'ungrouped'，未分组视野——仅存留未分组会话，无激活记忆、级联取全序首个未
 * 分组）或工作区 id。
 * 主进程同一临界区内原子完成：落 activeWorkspaceId + 必要时级联 activeId
 * （工作区视野：该工作区 lastActiveSessionId → 无记忆取全序首个 → 空工作区 null；
 * 未分组视野：全序首个未分组 → 空则 null），
 * 仅激活位变化时回调 onActiveChanged 触发浏览器切换；'all' 与纯视野切换零编排
 */
export interface SetActiveWorkspacePayload {
  id: string
}

export interface OkResult {
  ok: true
}
