// 会话 IPC handlers：十八条 invoke 通道（阶段 4 六条 + 阶段 5 clone / delete-batch
// 两条 + 排序专项 reorder 一条 + 工作区专项六条 create/rename/delete/move-session/
// reorder/set-active + 备注编辑 set-note 一条 + 独立代理 set-proxy / check-proxy
// 两条，2026-10-15 增量）的业务实现，读写一律经 store.ts
// 的快照接口；status-changed 推送不经本文件（index.ts 直连 registry）。通道名一律取自
// shared/sessions 的
// SESSIONS_CHANNELS，禁止手写字符串。快照读-改-写一律经 mutateSnapshot 串行执行；
// 入参先过运行时守卫（shared 中的 payload 类型只是编译期约定，跨 IPC 边界不可信任）。
// 浏览器编排（切换/销毁联动、状态数据源）经 deps 注入回调触达，本文件不 import registry
// （装配在 index.ts，契约见开发计划第 3 节契约点 3/4）。工作区六通道纯元数据：唯一
// 编排触点是 workspaceSetActive 的激活位级联（复用 onActiveChanged），其余零回调。
// 2026-10-23 批量多选退役：batch-open-url 与 move-sessions-batch 两通道删除；
// delete-batch 保留（工作区删除「删除全部会话」处置复用）。
// 另注册两条 on 单向通道：popup-row-menu（行原生菜单，2026-10-15）与
// workspace-popup-menu（工作区行原生菜单，2026-10-27，渲染层 antd Dropdown 退役），
// 点击结论分别经 row-menu-action / workspace-menu-action 定向回推发起窗口

import { BrowserWindow, dialog, ipcMain, Menu, MenuItem } from 'electron'
import { isRecord } from '../shared/guards'
import {
  PAGE_TITLE_MAX,
  SESSION_ID_RE,
  type RowMenuActionKey,
  type WorkspaceMenuActionKey,
  SESSION_NOTE_MAX,
  SESSIONS_CHANNELS,
  WORKSPACE_ID_RE,
  WORKSPACE_NAME_MAX,
  WORKSPACE_VIEW_ALL,
  WORKSPACE_VIEW_UNGROUPED,
  cloneTabs,
  normalizeProxyConfig,
  type OkResult,
  type ProxyCheckResult,
  type SessionProxyConfig,
  type SessionStatusesPayload,
  type SessionsSnapshot,
  type StoredSession,
  type StoredTab,
  type StoredWorkspace
} from '../shared/sessions'
import { dialogIconForDarwin } from './dialogs'
import { t } from './i18n'
import { loadSnapshot, mutateSnapshot, summarize } from './store'

/**
 * 编排依赖（冻结签名，见开发计划第 3 节契约点 3/4），由 index.ts 注入：
 * - onActiveChanged：setActive 落盘成功后通知编排层切换浏览器
 * - onDeleted：delete 落盘成功后通知编排层销毁该会话并跟随级联后的 activeId
 * - onRenamed：rename 落盘成功后通知编排层同步该会话全部独立窗口标题（阶段 7—8）
 * - getStatuses：get-statuses 拉取通道的数据源（registry 状态聚合）
 * - clonePartition：clone 的分区数据复制（close-then-copy），失败上抛即不落元数据
 * - getRestoreSet：源会话恢复集缓存（阶段 10）——clone 的 tabs/activeTabIndex 取
 *   closeSession 冲刷（settle 时点）后的归并集缓存值，不重读盘；缓存未命中（源从未
 *   激活过）返回 undefined，调用方回退落盘值
 * - onBatchDeleted：deleteBatch 落盘成功后通知编排层一次切换到级联 activeId + 逐会话销毁清分区
 *   （delete-batch 由工作区删除「删除全部会话」处置触发）
 * - onProxyChanged：set-proxy 落盘成功后把（清除后的）代理配置应用到该会话分区（独立
 *   代理增量，引擎幂等；本文件不 import registry/proxy，装配在 index.ts）
 * - checkProxyExitIp：check-proxy 按草稿值经该会话分区探测出口 IP（不落盘不动生效配置）
 */
interface SessionIpcDeps {
  onActiveChanged(id: string | null): void
  onDeleted(id: string, nextActiveId: string | null): void
  /** rename 落盘成功后回调（clamp 后的实际落盘名）：独立窗口标题与会话名严格同源的同步入口 */
  onRenamed(id: string, name: string): void
  getStatuses(): SessionStatusesPayload
  clonePartition(srcId: string, dstId: string): Promise<void>
  getRestoreSet(srcId: string): { tabs: StoredTab[]; activeTabIndex: number } | undefined
  onBatchDeleted(ids: string[], nextActiveId: string | null): void
  /** set-proxy 落盘成功后的分区应用入口（proxy 传 null = 清除回直连） */
  onProxyChanged(id: string, proxy: SessionProxyConfig | null): Promise<void>
  /** check-proxy 的探测入口：按草稿值经该会话分区探测，返回三态结论 */
  checkProxyExitIp(id: string, proxy: SessionProxyConfig): Promise<ProxyCheckResult>
  /** 主窗解析（行原生菜单 sender 白名单判据；macOS 关窗期间为 null → 请求拒绝） */
  getMainWindow: () => BrowserWindow | null
}

/** id 自增序列（模块级，跨多次 create 递增） */
let seq = 0

/** IPC 入口字段长度上限（超出直接截断，不报错，防止 MB 级字符串写穿落盘）；pageTitle/note 上限取 shared 单源 */
const NAME_MAX = 50

/** 守卫失败统一抛出的业务错误（文案经字典 errors 命名空间，报错语言 = 取词时语言） */
function invalidParams(): Error {
  return new Error(t('errors.invalidSessionParams'))
}

/**
 * 从 IPC payload 中解析 ids：必须为非空数组且逐项 string，否则判为非法入参。
 * delete-batch 与 reorder 两条通道共用同一校验（规则演进只改此处；
 * 上层各自决定重复 id 的处置——delete-batch 去重容忍，reorder 整单拒绝）
 */
function parseNonEmptyStringIds(payload: Record<string, unknown>): string[] {
  const raw = payload.ids
  if (
    !Array.isArray(raw) ||
    raw.length === 0 ||
    !raw.every((item): item is string => typeof item === 'string')
  ) {
    throw invalidParams()
  }
  return raw
}

/**
 * id 格式预校验（整单拒绝）：任一 id 不满足 SESSION_ID_RE 即抛错——被篡改的
 * 落盘 id 须在存在性/集合校验前拒绝（阶段 5 R4 定案）。delete-batch、
 * move-session 与 reorder 等通道共用（与 parseNonEmptyStringIds 同为共用
 * 守卫，文案与规则演进只改此处）
 */
function assertSessionIdFormat(ids: string[]): void {
  if (!ids.every((id) => SESSION_ID_RE.test(id))) {
    throw new Error(t('errors.sessionIdTampered'))
  }
}

/** 读取可选 string 字段：缺省返回 undefined，存在但非 string 判为非法入参 */
function optionalString(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw invalidParams()
  return value
}

/** 超长截断（按 UTF-16 码元切，中文文案不受影响） */
function clampString(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value
}

/**
 * 生成新会话 id：sess-<base36 时间戳>-<自增 seq>，与现存 id 撞车则重新生成。
 * seq 模块级单调递增，同一运行期内两次生成必不相同（create 与 clone 共用，
 * 撞车只可能来自既往运行期落盘的旧 id——即入参 existingIds 的来源）
 */
function generateSessionId(existingIds: Set<string>): string {
  let id: string
  do {
    seq += 1
    id = `sess-${Date.now().toString(36)}-${seq}`
  } while (existingIds.has(id))
  return id
}
// 生成的 id 恒满足 shared/sessions.ts 的 SESSION_ID_RE（格式契约单源，registry 的
// 分区拼装/目录解析按该校验拦截被篡改 id）——本函数与其共同引用同一格式定义

/**
 * 生成新工作区 id：ws-<base36 时间戳>-<自增 seq>，与现存工作区 id 撞车则重新生成。
 * 与 generateSessionId 共用同一 seq 计数器（两命名空间前缀不同，跨命名空间天然不撞）
 */
function generateWorkspaceId(existingIds: Set<string>): string {
  let id: string
  do {
    seq += 1
    id = `ws-${Date.now().toString(36)}-${seq}`
  } while (existingIds.has(id))
  return id
}
// 生成的 id 恒满足 WORKSPACE_ID_RE（单源格式契约，workspaceSetActive 的视野哨兵
// WORKSPACE_VIEW_ALL 恒 'all' 与 ws- 前缀无碰撞）

/**
 * 工作区 id 格式预校验（单值）：不满足 WORKSPACE_ID_RE 即抛错——被篡改的落盘 id
 * 须在存在性校验前拒绝（照 assertSessionIdFormat 的纵深防御先例）
 */
function assertWorkspaceIdFormat(id: string): void {
  if (!WORKSPACE_ID_RE.test(id)) {
    throw new Error(t('errors.workspaceIdTampered'))
  }
}

/**
 * 解析可选归属入参（create/clone 的 workspaceId）为落盘归属：
 * - undefined → fallback（create 未分组 / clone 源会话归属）
 * - null → 未分组（显式移出）
 * - string → 格式合法且存在才通过（跨 IPC 边界不可信任，存在性以互斥期内快照为准）
 */
function resolveMembership(
  raw: unknown,
  fallback: string | null,
  workspaceIds: Set<string>
): string | null {
  if (raw === undefined) return fallback
  if (raw === null) return null
  if (typeof raw !== 'string') throw invalidParams()
  assertWorkspaceIdFormat(raw)
  if (!workspaceIds.has(raw)) throw new Error(t('errors.workspaceNotFound'))
  return raw
}

/**
 * 工作区激活记忆净化：全部指向被删会话的 lastActiveSessionId 置 null（悬空不落盘）。
 * delete 与 deleteBatch 在同一互斥临界区末尾调用
 */
function clearDanglingMemory(snapshot: SessionsSnapshot, removedIds: Set<string>): void {
  for (const ws of snapshot.workspaces) {
    if (ws.lastActiveSessionId !== null && removedIds.has(ws.lastActiveSessionId)) {
      ws.lastActiveSessionId = null
    }
  }
}

/** handler 统一包裹：失败路径主进程留 warn 日志（通道名 + payload 摘要）后原样 rethrow */
function logFailure<T>(channel: string, payload: unknown, run: () => Promise<T>): Promise<T> {
  return run().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    console.warn(`[sessions] ${channel} 失败: ${message} payload=${summarize(payload)}`)
    throw err
  })
}

export function registerSessionIpc(deps: SessionIpcDeps): void {
  // list：返回完整快照（含 version/sessions/activeId）。只读，不进入写临界区
  ipcMain.handle(SESSIONS_CHANNELS.list, async (): Promise<SessionsSnapshot> =>
    logFailure(SESSIONS_CHANNELS.list, undefined, async () => loadSnapshot())
  )

  // create：id 由主进程生成（与现存 id 撞车则重新生成），返回新建的 StoredSession
  ipcMain.handle(
    SESSIONS_CHANNELS.create,
    async (_event, payload: unknown): Promise<StoredSession> =>
      logFailure(SESSIONS_CHANNELS.create, payload, async () => {
        // payload 缺省视为 {}；name/note 若存在必须是 string；workspaceId 可选归属
        const raw = isRecord(payload) ? payload : {}
        const inputName = optionalString(raw.name)?.trim() ?? ''
        const inputNote = optionalString(raw.note) ?? ''
        const membership = raw.workspaceId
        return mutateSnapshot((snapshot) => {
          const id = generateSessionId(new Set(snapshot.sessions.map((s) => s.id)))
          const session: StoredSession = {
            id,
            name: clampString(inputName || t('sessions.defaults.name', { n: seq }), NAME_MAX),
            note: clampString(inputNote, SESSION_NOTE_MAX),
            // 创建时标题为构造期本地化占位文案（i18n 种子语义：语言切换前的存量值
            // 不追溯），仍过一道截断以维持入口上限不变式
            pageTitle: clampString(t('sessions.defaults.noPageTitle'), PAGE_TITLE_MAX),
            // 阶段 4 契约（步骤 2 冻结）：新建会话无上次打开页，恒空串
            lastUrl: '',
            // 阶段 6 契约：新建会话无恢复集，懒创建时回退单空白 Tab
            tabs: [],
            activeTabIndex: 0,
            // 独立代理增量（v5）：新建会话未配置代理（直连），后续经 set-proxy 配置
            proxy: null,
            // 工作区专项：可选归属（undefined 未分组 / null 未分组 / 须存在）
            workspaceId: resolveMembership(
              membership,
              null,
              new Set(snapshot.workspaces.map((w) => w.id))
            )
          }
          snapshot.sessions.push(session)
          return session
        })
      })
  )

  // rename：名称去 trim 后为空拒绝；id 不存在抛错
  ipcMain.handle(
    SESSIONS_CHANNELS.rename,
    async (_event, payload: unknown): Promise<StoredSession> =>
      logFailure(SESSIONS_CHANNELS.rename, payload, async () => {
        // payload 必须含 string 类型的 id 与 name
        if (!isRecord(payload)) throw invalidParams()
        if (typeof payload.id !== 'string' || typeof payload.name !== 'string') {
          throw invalidParams()
        }
        const id = payload.id
        const name = payload.name.trim()
        if (!name) throw new Error(t('errors.sessionNameEmpty'))
        const renamed = await mutateSnapshot((snapshot) => {
          const target = snapshot.sessions.find((s) => s.id === id)
          if (!target) throw new Error(t('errors.sessionNotFound'))
          target.name = clampString(name, NAME_MAX)
          return target
        })
        // 落盘成功后联动（守卫失败或写盘失败即抛错，不联动）：同步该会话全部独立窗口
        // 标题；取 clamp 后的实际落盘名——标题与会话名严格同源，不做乐观标题
        deps.onRenamed(id, renamed.name)
        return renamed
      })
  )

  // set-note：会话备注编辑（2026-09-18 增量，PRD 3.1.2）。与 rename 的两处刻意
  // 差异：① trim 后空串 = 清除备注，合法提交非拒绝（清空后行内恢复「未填写备注」
  // 占位）；② 无 deps 编排回调——备注不联动窗口标题/激活位等任何浏览器编排。
  // 其余对齐 rename：结构守卫 → id 存在性 → mutateSnapshot 临界区内 clamp 落盘，
  // 返回 clamp 后的实际落盘值供 renderer 非乐观 merge
  ipcMain.handle(
    SESSIONS_CHANNELS.setNote,
    async (_event, payload: unknown): Promise<StoredSession> =>
      logFailure(SESSIONS_CHANNELS.setNote, payload, async () => {
        // payload 必须含 string 类型的 id 与 note
        if (!isRecord(payload)) throw invalidParams()
        if (typeof payload.id !== 'string' || typeof payload.note !== 'string') {
          throw invalidParams()
        }
        const id = payload.id
        const note = payload.note.trim()
        return mutateSnapshot((snapshot) => {
          const target = snapshot.sessions.find((s) => s.id === id)
          if (!target) throw new Error(t('errors.sessionNotFound'))
          target.note = clampString(note, SESSION_NOTE_MAX)
          return target
        })
      })
  )

  // set-proxy：保存/清除会话独立代理（独立代理增量 2026-10-15，PRD 4.14）。proxy 传
  // null = 清除（合法语义回直连，对齐 set-note 空串清除先例）；非空值经
  // normalizeProxyConfig 单源守卫（协议闭集/host/端口/凭据任一不过整单拒绝，磁盘
  // 不变）。结构守卫 → id 存在性 → mutateSnapshot 临界区内写 target.proxy → 落盘
  // 成功后经 deps.onProxyChanged 应用到该会话分区 → 返回更新后的 StoredSession
  // （renderer 非乐观 merge，对齐 set-note 返回范式）。应用失败只告警不回滚：落盘是
  // 权威，切换/激活链会按落盘值幂等补应用
  ipcMain.handle(
    SESSIONS_CHANNELS.setProxy,
    async (event, payload: unknown): Promise<StoredSession> =>
      logFailure(SESSIONS_CHANNELS.setProxy, payload, async () => {
        // payload 必须含 string 类型的 id 与（null 或可归一化的）proxy
        if (!isRecord(payload)) throw invalidParams()
        if (typeof payload.id !== 'string') throw invalidParams()
        if (!SESSION_ID_RE.test(payload.id)) throw invalidParams()
        const id = payload.id
        let next: SessionProxyConfig | null = null
        try {
          next = payload.proxy === null ? null : normalizeProxyConfig(payload.proxy)
          if (payload.proxy !== null && next === null) throw invalidParams()
          const updated = await mutateSnapshot((snapshot) => {
            const target = snapshot.sessions.find((s) => s.id === id)
            if (!target) throw new Error(t('errors.sessionNotFound'))
            target.proxy = next
            return target
          })
          // 落盘成功后应用（守卫失败或写盘失败即抛错，不应用）：await 让 invoke 落定
          // 意味着代理已（尽力）生效；失败如实告警不回滚（见上方 handler 注释）
          try {
            await deps.onProxyChanged(id, next)
          } catch (error) {
            console.warn(
              `[sessions] 会话 ${id} 的代理配置落盘成功但应用失败（将由激活链补应用）:`,
              error
            )
          }
          return updated
        } catch (error) {
          // 失败反馈（审查中-1 修复）：主进程原生信息框（chromeImport 完成点先例，
          // AGENTS 结果反馈原生裁决）——发起窗口模态弹出后原样上抛，renderer invoke
          // 以 false 收敛不再重复承载（batchFeedback 在普通模式不可见的死路径已废）
          const win = BrowserWindow.fromWebContents(event.sender)
          if (win && !win.isDestroyed()) {
            void dialog
              .showMessageBox(win, {
                type: 'info',
                icon: dialogIconForDarwin(),
                message: t(
                  next === null
                    ? 'sessions.sessionProxy.clearFailed'
                    : 'sessions.sessionProxy.saveFailed'
                ),
                buttons: [t('common.confirm')],
                noLink: true,
                cancelId: 0
              })
              .catch(() => undefined)
          }
          throw error
        }
      })
  )

  // check-proxy：按草稿值探测该会话出口 IP（不落盘、不动当前生效配置；探测锚定该
  // 会话真实分区——凭据与连通性都以该分区为准，故 id 必须存在）。proxy 必填非 null
  // 且过 normalizeProxyConfig 单源守卫（非法整单拒绝）；探测期临时应用草稿值、结束
  // 恢复原状由引擎承担（browser/proxy.ts probeExitIpForId）。三态失败如实分类，不伪造生效
  ipcMain.handle(
    SESSIONS_CHANNELS.checkProxy,
    async (_event, payload: unknown): Promise<ProxyCheckResult> =>
      logFailure(SESSIONS_CHANNELS.checkProxy, payload, async () => {
        // payload 必须含 string 类型的 id 与非 null 的 proxy
        if (!isRecord(payload)) throw invalidParams()
        if (typeof payload.id !== 'string') throw invalidParams()
        if (!SESSION_ID_RE.test(payload.id)) throw invalidParams()
        if (payload.proxy === null || payload.proxy === undefined) throw invalidParams()
        const draft = normalizeProxyConfig(payload.proxy)
        if (draft === null) throw invalidParams()
        const id = payload.id
        // 会话存在性校验（读盘）：探测必须锚定真实分区，未知会话整单拒绝
        const snapshot = await loadSnapshot()
        if (!snapshot.sessions.some((s) => s.id === id)) {
          throw new Error(t('errors.sessionNotFound'))
        }
        return deps.checkProxyExitIp(id, draft)
      })
  )

  // delete：id 不存在抛错；删的是选中项时级联指向剩余首项（无剩余则 null）
  ipcMain.handle(SESSIONS_CHANNELS.delete, async (_event, payload: unknown): Promise<OkResult> =>
    logFailure(SESSIONS_CHANNELS.delete, payload, async () => {
      // id 必须为 string
      if (!isRecord(payload) || typeof payload.id !== 'string') throw invalidParams()
      const id = payload.id
      // 级联后的 activeId 须在闭包内捕获传出（快照互斥期间才可见），供编排层跟随切换
      const nextActiveId = await mutateSnapshot((snapshot) => {
        const index = snapshot.sessions.findIndex((s) => s.id === id)
        if (index === -1) throw new Error(t('errors.sessionNotFound'))
        const [removed] = snapshot.sessions.splice(index, 1)
        if (snapshot.activeId === removed.id) {
          snapshot.activeId = snapshot.sessions[0]?.id ?? null
        }
        // 工作区激活记忆净化：指向被删会话的记忆置 null（悬空不落盘）
        clearDanglingMemory(snapshot, new Set([removed.id]))
        return snapshot.activeId
      })
      // 落盘成功后联动（删除守卫或写盘失败时抛错，不联动）
      deps.onDeleted(id, nextActiveId)
      return { ok: true }
    })
  )

  // setActive：null 合法（清空选中）；非 null 时 id 必须存在；
  // 落盘成功后经 onActiveChanged 触发主进程内浏览器切换（副作用声明见 shared/sessions）
  ipcMain.handle(SESSIONS_CHANNELS.setActive, async (_event, payload: unknown): Promise<OkResult> =>
    logFailure(SESSIONS_CHANNELS.setActive, payload, async () => {
      // id 必须为 string 或 null；undefined 等其他类型显式拒绝，不误报「会话不存在」
      if (!isRecord(payload)) throw invalidParams()
      if (payload.id !== null && typeof payload.id !== 'string') throw invalidParams()
      const nextId = payload.id
      await mutateSnapshot((snapshot) => {
        if (nextId !== null && !snapshot.sessions.some((s) => s.id === nextId)) {
          throw new Error(t('errors.sessionNotFound'))
        }
        snapshot.activeId = nextId
        // 工作区专项：激活落盘同临界区顺带更新所属工作区激活记忆（只随真实激活更新；
        // 未分组会话不动 workspaces）
        if (nextId !== null) {
          const activated = snapshot.sessions.find((s) => s.id === nextId)
          if (activated && activated.workspaceId !== null) {
            const ws = snapshot.workspaces.find((w) => w.id === activated.workspaceId)
            if (ws) ws.lastActiveSessionId = nextId
          }
        }
        return { ok: true }
      })
      // 落盘成功后联动（id 守卫或写盘失败时抛错，不联动）
      deps.onActiveChanged(nextId)
      return { ok: true }
    })
  )

  // get-statuses：全量会话状态 map 拉取（renderer 启动竞态兜底），
  // 数据源经 deps 注入（registry 聚合「任一 Tab loading」），本文件不自持状态
  ipcMain.handle(SESSIONS_CHANNELS.getStatuses, async (): Promise<SessionStatusesPayload> =>
    logFailure(SESSIONS_CHANNELS.getStatuses, undefined, async () => deps.getStatuses())
  )

  // clone：复制源会话的分区数据（登录态等持久环境）与元数据，生成同款新环境；
  // 分区复制失败即抛错不落元数据（renderer 乐观态回滚）；name 加「副本」后缀后 clamp
  ipcMain.handle(
    SESSIONS_CHANNELS.clone,
    async (_event, payload: unknown): Promise<StoredSession> =>
      logFailure(SESSIONS_CHANNELS.clone, payload, async () => {
        // payload 必须含 string 类型的 id；workspaceId 可选归属（缺省随源会话）
        if (!isRecord(payload) || typeof payload.id !== 'string') throw invalidParams()
        const srcId = payload.id
        const membership = payload.workspaceId
        // 源会话存在性校验（读盘）；同一份快照兼作生成新 id 的撞车判据
        const snapshot = await loadSnapshot()
        const src = snapshot.sessions.find((s) => s.id === srcId)
        if (!src) throw new Error(t('errors.sessionNotFound'))
        // 归属预校验（显式传值时）：在 clonePartition 这个高成本副作用之前完成——
        // 可预期的整单拒绝不得先产生分区目录残留（审查中 1）。mutateSnapshot 内的
        // resolveMembership 仍以互斥期最新快照复验（预检与复制间的工作区并发删除
        // 走既有孤儿告警路径，与源会话并发删除同口径）
        if (membership !== undefined && membership !== null) {
          if (typeof membership !== 'string') throw invalidParams()
          assertWorkspaceIdFormat(membership)
          if (!snapshot.workspaces.some((w) => w.id === membership)) {
            throw new Error(t('errors.workspaceNotFound'))
          }
        }
        const newId = generateSessionId(new Set(snapshot.sessions.map((s) => s.id)))
        // 先复制分区（close-then-copy，含关闭源会话 webContents），成功才落元数据。
        // 生成的 id 此后无需复核：本运行期落盘新增的 id 同样出自单调 seq，必不与之相同；
        // 既往旧 id 已在生成时避开，mutateSnapshot 串行队列内无并发改写落盘的旁路
        await deps.clonePartition(srcId, newId)
        try {
          return await mutateSnapshot((data) => {
            // 取最新落盘的源条目复制元数据（closeSession 冲刷的上报可能刚更新 pageTitle/
            // lastUrl）；源在复制期间被并发删除时退回校验时点的快照值（分区已复制完成）。
            // 恢复集（tabs/activeTabIndex，阶段 10）取 settle 时点缓存值（getRestoreSet
            // 注入——closeSession 冲刷前置后缓存即完整归并集时点值），不重读盘，关窗级联
            // 窗口期的任何落盘重写都不影响克隆产物；缓存未命中（源从未激活过）回退落盘值
            const source = data.sessions.find((item) => item.id === srcId) ?? src
            const restore = deps.getRestoreSet(srcId)
            const cloned: StoredSession = {
              id: newId,
              name: clampString(`${source.name} ${t('sessions.defaults.copySuffix')}`, NAME_MAX),
              note: source.note,
              pageTitle: source.pageTitle,
              lastUrl: source.lastUrl,
              // 阶段 6：恢复集随元数据复制（克隆产物同款页面集，URL 级）
              tabs: cloneTabs(restore ? restore.tabs : source.tabs),
              activeTabIndex: restore ? restore.activeTabIndex : source.activeTabIndex,
              // 工作区专项：可选归属（undefined 随源 / null 未分组 / 须存在）
              workspaceId: resolveMembership(
                membership,
                source.workspaceId,
                new Set(data.workspaces.map((w) => w.id))
              ),
              // 独立代理增量（v5）：克隆携带源会话代理配置（环境同款复制语义）
              proxy: source.proxy
            }
            data.sessions.push(cloned)
            return cloned
          })
        } catch (error) {
          // 跨资源事务补偿告警（分区已复制、元数据写盘失败）：dst 分区目录成为无会话
          // 指向的孤儿残留——本文件分层不持 fs（registry 才 owns 分区路径），如实告知
          // 残留位置交人工核查（对齐 destroySession 的残留告警标准）
          console.warn(
            `[sessions] 克隆会话 ${srcId} 的元数据写盘失败，目标分区目录可能残留（userData/Partitions/sess-${newId}），请手动核查:`,
            error
          )
          throw error
        }
      })
  )

  // delete-batch：批量关闭选中会话（= 彻底删除选中项，与单条删除同一标准：销毁
  // webContents + 清分区数据 + 删分区目录）；整单校验拒绝制——ids 不合法或任一不存在
  // 整单拒绝，无部分成功。同一快照互斥期内完成存在性校验与原子移除（无校验/执行竞态
  // 窗口），级联规则与单条删除一致：选中集含激活会话时指向剩余首项（无剩余则 null）；
  // 落盘成功后经 onBatchDeleted 一次切换到级联 activeId + 逐会话异步销毁。
  // 2026-10-23 批量模式退役后由工作区删除「删除全部会话」处置编排消费（消费面唯一）
  ipcMain.handle(
    SESSIONS_CHANNELS.deleteBatch,
    async (_event, payload: unknown): Promise<OkResult> =>
      logFailure(SESSIONS_CHANNELS.deleteBatch, payload, async () => {
        // payload 必须为 record，ids 经共用校验（非空数组逐项 string）
        if (!isRecord(payload)) throw invalidParams()
        // 去重：重复 id 只删一次，防编排层重复销毁
        const ids = [...new Set(parseNonEmptyStringIds(payload))]
        assertSessionIdFormat(ids)
        const nextActiveId = await mutateSnapshot((snapshot) => {
          const idSet = new Set(ids)
          const known = new Set(snapshot.sessions.map((s) => s.id))
          if (!ids.every((id) => known.has(id))) throw new Error(t('errors.sessionNotFound'))
          snapshot.sessions = snapshot.sessions.filter((s) => !idSet.has(s.id))
          if (snapshot.activeId !== null && idSet.has(snapshot.activeId)) {
            snapshot.activeId = snapshot.sessions[0]?.id ?? null
          }
          clearDanglingMemory(snapshot, idSet)
          return snapshot.activeId
        })
        // 落盘成功后联动（校验守卫或写盘失败时抛错，不联动）
        deps.onBatchDeleted(ids, nextActiveId)
        return { ok: true }
      })
  )

  // batch-open-url 通道已于 2026-10-23 随批量多选功能退役删除

  // reorder：会话列表拖拽排序——只接受当前全部会话 id 的无重复全序（纯重排）；
  // 格式非法、重复、缺项、多项或未知 id 时整单拒绝且磁盘不变。集合相等校验与
  // 重排同在 mutateSnapshot 互斥期内完成（无校验/执行竞态窗口：窗口期内被并发
  // 增删的会话使集合不再相等，整单拒绝）。合法时仅按入参顺序重排 snapshot.sessions
  // （元素对象原样引用、内容零变更），activeId 不动，无任何编排回调——排序是
  // 纯元数据操作，浏览器视图、分区与状态推送均不受影响
  ipcMain.handle(SESSIONS_CHANNELS.reorder, async (_event, payload: unknown): Promise<OkResult> =>
    logFailure(SESSIONS_CHANNELS.reorder, payload, async () => {
      // payload 必须为 record，ids 经共用校验（非空数组逐项 string）
      if (!isRecord(payload)) throw invalidParams()
      const ids = parseNonEmptyStringIds(payload)
      // id 格式预校验（共用守卫）：被篡改的落盘 id 须在集合校验前拒绝
      assertSessionIdFormat(ids)
      // 重复 id 整单拒绝（与批量通道的去重容忍相反：全序里重复即非法排列）
      if (new Set(ids).size !== ids.length) {
        throw new Error(t('errors.reorderDuplicateIds'))
      }
      await mutateSnapshot((snapshot) => {
        // 长度相等 + ids 全部已知 ⇒ 集合相等（ids 无重复已前置保证），天然覆盖
        // 缺项 / 多项 / 未知三类不一致
        const known = new Set(snapshot.sessions.map((s) => s.id))
        if (known.size !== ids.length || !ids.every((id) => known.has(id))) {
          throw new Error(t('errors.reorderMismatch'))
        }
        const byId = new Map(snapshot.sessions.map((s) => [s.id, s]))
        snapshot.sessions = ids.map((id) => byId.get(id) as StoredSession)
        return { ok: true }
      })
      return { ok: true }
    })
  )

  // workspaces:create：新建工作区。name trim 非空、≤WORKSPACE_NAME_MAX、与现存重名
  // 拒绝；纯元数据（不动会话/视野/激活），零编排回调。返回新建的 StoredWorkspace
  ipcMain.handle(
    SESSIONS_CHANNELS.workspaceCreate,
    async (_event, payload: unknown): Promise<StoredWorkspace> =>
      logFailure(SESSIONS_CHANNELS.workspaceCreate, payload, async () => {
        if (!isRecord(payload) || typeof payload.name !== 'string') throw invalidParams()
        const name = clampString(payload.name.trim(), WORKSPACE_NAME_MAX)
        if (!name) throw new Error(t('errors.workspaceNameEmpty'))
        return mutateSnapshot((snapshot) => {
          if (snapshot.workspaces.some((w) => w.name === name)) {
            throw new Error(t('errors.workspaceNameExists'))
          }
          const workspace: StoredWorkspace = {
            id: generateWorkspaceId(new Set(snapshot.workspaces.map((w) => w.id))),
            name,
            lastActiveSessionId: null
          }
          snapshot.workspaces.push(workspace)
          return workspace
        })
      })
  )

  // workspaces:rename：id 格式 + 存在性校验，name 规则同 create（重名排除自身）；
  // 纯元数据（工作区名不出现在窗口标题/页面标题，无 onRenamed 类联动），零编排回调
  ipcMain.handle(
    SESSIONS_CHANNELS.workspaceRename,
    async (_event, payload: unknown): Promise<StoredWorkspace> =>
      logFailure(SESSIONS_CHANNELS.workspaceRename, payload, async () => {
        if (!isRecord(payload) || typeof payload.id !== 'string') throw invalidParams()
        if (typeof payload.name !== 'string') throw invalidParams()
        assertWorkspaceIdFormat(payload.id)
        const id = payload.id
        const name = clampString(payload.name.trim(), WORKSPACE_NAME_MAX)
        if (!name) throw new Error(t('errors.workspaceNameEmpty'))
        return mutateSnapshot((snapshot) => {
          const target = snapshot.workspaces.find((w) => w.id === id)
          if (!target) throw new Error(t('errors.workspaceNotFound'))
          if (snapshot.workspaces.some((w) => w.name === name && w.id !== id)) {
            throw new Error(t('errors.workspaceNameExists'))
          }
          target.name = name
          return target
        })
      })
  )

  // workspaces:delete：删除工作区——其中会话全部移入未分组（会话与其数据不受影响，
  // PRD 4.8）；activeWorkspaceId 指向它时回落 'all'；activeId 不动（视野与激活正交，
  // 会话仍在，右侧无需切换）；零编排回调
  ipcMain.handle(
    SESSIONS_CHANNELS.workspaceDelete,
    async (_event, payload: unknown): Promise<OkResult> =>
      logFailure(SESSIONS_CHANNELS.workspaceDelete, payload, async () => {
        if (!isRecord(payload) || typeof payload.id !== 'string') throw invalidParams()
        assertWorkspaceIdFormat(payload.id)
        const id = payload.id
        await mutateSnapshot((snapshot) => {
          if (!snapshot.workspaces.some((w) => w.id === id))
            throw new Error(t('errors.workspaceNotFound'))
          snapshot.workspaces = snapshot.workspaces.filter((w) => w.id !== id)
          for (const s of snapshot.sessions) {
            if (s.workspaceId === id) s.workspaceId = null
          }
          if (snapshot.activeWorkspaceId === id) {
            snapshot.activeWorkspaceId = WORKSPACE_VIEW_ALL
          }
          return { ok: true }
        })
        return { ok: true }
      })
  )

  // workspaces:move-session：移动会话归属（独占制）。workspaceId 传 null = 移出未分组；
  // 目标须格式合法且存在；移动到当前归属为 no-op ok（幂等）；不动 activeId 与激活记忆
  // （记忆只随真实激活更新），零编排回调
  ipcMain.handle(
    SESSIONS_CHANNELS.workspaceMoveSession,
    async (_event, payload: unknown): Promise<OkResult> =>
      logFailure(SESSIONS_CHANNELS.workspaceMoveSession, payload, async () => {
        if (!isRecord(payload)) throw invalidParams()
        if (typeof payload.sessionId !== 'string') throw invalidParams()
        if (payload.workspaceId !== null && typeof payload.workspaceId !== 'string') {
          throw invalidParams()
        }
        assertSessionIdFormat([payload.sessionId])
        const sessionId = payload.sessionId
        const target = payload.workspaceId
        if (target !== null) assertWorkspaceIdFormat(target)
        await mutateSnapshot((snapshot) => {
          const session = snapshot.sessions.find((s) => s.id === sessionId)
          if (!session) throw new Error(t('errors.sessionNotFound'))
          if (target !== null && !snapshot.workspaces.some((w) => w.id === target)) {
            throw new Error(t('errors.workspaceNotFound'))
          }
          // 源工作区记忆清理：记忆指向被移会话时置 null（记忆指向不存在的归属即脏
          // 数据——审查低 3；目标侧与未分组侧记忆不动，记忆只随真实激活更新）
          const prevWorkspaceId = session.workspaceId
          session.workspaceId = target
          if (prevWorkspaceId !== null && prevWorkspaceId !== target) {
            const source = snapshot.workspaces.find((w) => w.id === prevWorkspaceId)
            if (source && source.lastActiveSessionId === sessionId) {
              source.lastActiveSessionId = null
            }
          }
          return { ok: true }
        })
        return { ok: true }
      })
  )

  // move-sessions-batch 通道已于 2026-10-23 随批量多选功能退役删除

  // workspaces:reorder：工作区列表拖拽排序（拖动排序专项 2026-09-21）——只接受
  // 当前全部工作区 id 的无重复全序（纯重排），与 sessions:reorder 同口径：格式
  // 非法、重复、缺项、多项或未知 id 时整单拒绝且磁盘不变。集合相等校验与重排同在
  // mutateSnapshot 互斥期内完成（无校验/执行竞态窗口）。合法时仅按入参顺序重排
  // snapshot.workspaces（元素对象原样引用、内容零变更），activeWorkspaceId、
  // activeId 与 lastActiveSessionId 均不动，零编排回调——排序是纯元数据操作，
  // 「全部会话」哨兵项不属于排序集合，天然不在 ids 内
  ipcMain.handle(
    SESSIONS_CHANNELS.workspaceReorder,
    async (_event, payload: unknown): Promise<OkResult> =>
      logFailure(SESSIONS_CHANNELS.workspaceReorder, payload, async () => {
        // payload 必须为 record，ids 经共用校验（非空数组逐项 string）
        if (!isRecord(payload)) throw invalidParams()
        const ids = parseNonEmptyStringIds(payload)
        // 工作区 id 格式预校验（整单拒绝）：被篡改的落盘 id 须在集合校验前拒绝
        //（照 assertSessionIdFormat 的纵深防御先例，工作区命名空间同规）
        if (!ids.every((id) => WORKSPACE_ID_RE.test(id))) {
          throw new Error(t('errors.workspaceIdTampered'))
        }
        // 重复 id 整单拒绝（与批量通道的去重容忍相反：全序里重复即非法排列）
        if (new Set(ids).size !== ids.length) {
          throw new Error(t('errors.reorderDuplicateIds'))
        }
        await mutateSnapshot((snapshot) => {
          // 长度相等 + ids 全部已知 ⇒ 集合相等（ids 无重复已前置保证），天然覆盖
          // 缺项 / 多项 / 未知三类不一致
          const known = new Set(snapshot.workspaces.map((w) => w.id))
          if (known.size !== ids.length || !ids.every((id) => known.has(id))) {
            throw new Error(t('errors.reorderMismatch'))
          }
          const byId = new Map(snapshot.workspaces.map((w) => [w.id, w]))
          snapshot.workspaces = ids.map((id) => byId.get(id) as StoredWorkspace)
          return { ok: true }
        })
        return { ok: true }
      })
  )

  // workspaces:set-active：切换工作区视野（主进程内原子副作用，setActive 同模式）。
  // 同一 mutateSnapshot 临界区内完成：落 activeWorkspaceId + 必要时级联 activeId——
  // 当前激活会话不属于目标工作区时，级联到该工作区 lastActiveSessionId（记忆悬空
  // 则全序首个、空工作区 null），级联即真实激活故同步更新记忆；落盘成功后仅当
  // activeId 值变化时回调 onActiveChanged 触发浏览器切换。'all' 与纯视野切换零编排
  ipcMain.handle(
    SESSIONS_CHANNELS.workspaceSetActive,
    async (_event, payload: unknown): Promise<OkResult> =>
      logFailure(SESSIONS_CHANNELS.workspaceSetActive, payload, async () => {
        if (!isRecord(payload) || typeof payload.id !== 'string') throw invalidParams()
        const viewId = payload.id
        if (viewId !== WORKSPACE_VIEW_ALL && viewId !== WORKSPACE_VIEW_UNGROUPED) {
          assertWorkspaceIdFormat(viewId)
        }
        const outcome = await mutateSnapshot((snapshot) => {
          const prevActive = snapshot.activeId
          if (viewId === WORKSPACE_VIEW_ALL) {
            // 全部视野：纯视野切换，activeId 不动，零编排
            snapshot.activeWorkspaceId = WORKSPACE_VIEW_ALL
            return { prevActive, nextActive: snapshot.activeId }
          }
          if (viewId === WORKSPACE_VIEW_UNGROUPED) {
            // 未分组视野（2026-09-21 用户反馈增量）：纯元数据切换，无激活记忆
            //（记忆只存在于工作区）——级联取全序首个未分组，空则 null
            snapshot.activeWorkspaceId = WORKSPACE_VIEW_UNGROUPED
            const current = snapshot.sessions.find((s) => s.id === snapshot.activeId)
            if (!current || current.workspaceId !== null) {
              snapshot.activeId = snapshot.sessions.find((s) => s.workspaceId === null)?.id ?? null
            }
            return { prevActive, nextActive: snapshot.activeId }
          }
          const ws = snapshot.workspaces.find((w) => w.id === viewId)
          if (!ws) throw new Error(t('errors.workspaceNotFound'))
          snapshot.activeWorkspaceId = viewId
          const current = snapshot.sessions.find((s) => s.id === snapshot.activeId)
          if (!current || current.workspaceId !== viewId) {
            // 级联激活位：记忆优先（须仍属于该工作区）→ 全序首个 → 空工作区 null
            let nextActive: string | null = null
            if (ws.lastActiveSessionId !== null) {
              const remembered = snapshot.sessions.find(
                (s) => s.id === ws.lastActiveSessionId && s.workspaceId === viewId
              )
              if (remembered) nextActive = remembered.id
            }
            if (nextActive === null) {
              nextActive = snapshot.sessions.find((s) => s.workspaceId === viewId)?.id ?? null
            }
            snapshot.activeId = nextActive
            // 级联即真实激活：同步更新该工作区记忆（空工作区记 null，语义一致）
            ws.lastActiveSessionId = nextActive
          }
          return { prevActive, nextActive: snapshot.activeId }
        })
        // 落盘成功后联动（守卫或写盘失败即抛错，不联动）；仅激活位值变化才编排
        if (outcome.nextActive !== outcome.prevActive) {
          deps.onActiveChanged(outcome.nextActive)
        }
        return { ok: true }
      })
  )

  // popup-row-menu：会话行原生菜单（2026-10-15 反馈轮四，DOM 菜单退役）。renderer
  // 传会话 id + 视口坐标 + 变体；主进程经 main/i18n 取既有键组装 Menu 并 popup
  //（OS 级绘制盖过页面 WebContentsView，点任意位置关闭——含页面区，找回 2026-09-21
  // 收起方案换掉的「全区域外点关闭」）。菜单项点击经 row-menu-action 定向推回发起
  // webContents，由 renderer 既有编排闭环（重命名/备注行内编辑、克隆/移动/导入/
  // 代理 sheet、删除确认框）。ipcMain.on 单向通道：守卫失败 warn 后静默返回。
  // 行右键与 ⋮ 两触发器统一弹同一全量菜单（2026-10-20 用户裁决，dots 短菜单退役）
  ipcMain.on(SESSIONS_CHANNELS.popupRowMenu, (event, payload: unknown): void => {
    const fail = (reason: string): void => {
      console.warn(`[sessions] 行原生菜单请求被拒绝（${reason}）`)
    }
    // sender 白名单（审查低-2）：会话行只存在于主窗 shell，其余来源（独立窗/sheet
    // 子窗/被攻陷页面）一律拒绝——对齐 dialog:show 的主窗来源判据先例
    const mainWindow = deps.getMainWindow()
    if (!mainWindow || event.sender !== mainWindow.webContents) {
      return fail('非主窗来源')
    }
    if (!isRecord(payload)) return fail('载荷非法')
    const id = typeof payload.id === 'string' ? payload.id : ''
    if (!SESSION_ID_RE.test(id)) return fail('会话 id 非法')
    const x = payload.x
    const y = payload.y
    if (
      typeof x !== 'number' ||
      typeof y !== 'number' ||
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      x < 0 ||
      y < 0
    ) {
      return fail('坐标非法')
    }
    const sender = event.sender
    const win = BrowserWindow.fromWebContents(sender)
    if (!win || win.isDestroyed()) return fail('发起窗口缺失')
    // 会话存在性（审查低-2）：幻影 id 静默返回（菜单无数据面，防御对齐 dialog:show
    // 的 cancelled 语义；读盘频率 = 菜单弹出频率，可忽略）
    void (async () => {
      const known = (await loadSnapshot()).sessions.some((s) => s.id === id)
      if (!known) return fail('会话不存在')
      // 坐标 clamp（审查低-3）：越界锚点交给窗口内容尺寸收口，防原生菜单定位到
      // 屏幕外不可见
      const [contentW, contentH] = win.getContentSize()
      const cx = Math.min(Math.max(Math.round(x), 0), Math.max(contentW - 1, 0))
      const cy = Math.min(Math.max(Math.round(y), 0), Math.max(contentH - 1, 0))
      const dispatch = (key: RowMenuActionKey): void => {
        if (!sender.isDestroyed()) {
          sender.send(SESSIONS_CHANNELS.rowMenuAction, { id, key })
        }
      }
      const item = (key: 'rename' | 'editNote' | 'clone' | 'delete'): MenuItem =>
        new MenuItem({
          // 菜单标签经 main/i18n 取既有键（阶段六双语化覆盖 sessions/chromeImport 命名空间）
          label: t(`sessions.sessionRow.menu.${key}`),
          click: () => dispatch(key)
        })
      const menu = new Menu()
      menu.append(item('rename'))
      menu.append(item('editNote'))
      menu.append(new MenuItem({ type: 'separator' }))
      menu.append(item('clone'))
      menu.append(
        new MenuItem({
          label: t('sessions.sessionRow.menu.move'),
          click: () => dispatch('move')
        })
      )
      menu.append(
        new MenuItem({
          label: t('chromeImport.menu.importChromeData'),
          click: () => dispatch('importChrome')
        })
      )
      menu.append(
        new MenuItem({
          label: t('sessions.sessionProxy.menuEntry'),
          click: () => dispatch('proxy')
        })
      )
      menu.append(new MenuItem({ type: 'separator' }))
      menu.append(item('delete'))
      menu.popup({ window: win, x: cx, y: cy })
    })()
  })

  // workspaces:popup-menu：工作区行原生菜单（2026-10-27，渲染层 antd Dropdown 退役，
  // 复刻 popup-row-menu 先例）。renderer 传工作区 id + 视口坐标；主进程经 main/i18n
  // 取既有键组装两项 Menu（重命名/删除工作区）并 popup——OS 级绘制盖过页面
  // WebContentsView，点任意位置关闭（含页面区）。菜单项点击经 workspace-menu-action
  // 定向推回发起 webContents，由 renderer 既有编排闭环（重命名原生 sheet / 删除
  // 原生确认框三选）。ipcMain.on 单向通道：守卫失败 warn 后静默返回
  ipcMain.on(SESSIONS_CHANNELS.workspacePopupMenu, (event, payload: unknown): void => {
    const fail = (reason: string): void => {
      console.warn(`[sessions] 工作区原生菜单请求被拒绝（${reason}）`)
    }
    // sender 白名单：工作区切换框只存在于主窗左栏，其余来源（独立窗/sheet 子窗/
    // 被攻陷页面）一律拒绝——对齐 popup-row-menu 的主窗来源判据先例
    const mainWindow = deps.getMainWindow()
    if (!mainWindow || event.sender !== mainWindow.webContents) {
      return fail('非主窗来源')
    }
    if (!isRecord(payload)) return fail('载荷非法')
    const id = typeof payload.id === 'string' ? payload.id : ''
    if (!WORKSPACE_ID_RE.test(id)) return fail('工作区 id 非法')
    const x = payload.x
    const y = payload.y
    if (
      typeof x !== 'number' ||
      typeof y !== 'number' ||
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      x < 0 ||
      y < 0
    ) {
      return fail('坐标非法')
    }
    const sender = event.sender
    const win = BrowserWindow.fromWebContents(sender)
    if (!win || win.isDestroyed()) return fail('发起窗口缺失')
    // 工作区存在性：幻影 id 静默返回（对齐 popup-row-menu 的会话存在性守卫语义）
    void (async () => {
      const known = (await loadSnapshot()).workspaces.some((w) => w.id === id)
      if (!known) return fail('工作区不存在')
      // 坐标 clamp：越界锚点交给窗口内容尺寸收口，防原生菜单定位到屏幕外不可见
      const [contentW, contentH] = win.getContentSize()
      const cx = Math.min(Math.max(Math.round(x), 0), Math.max(contentW - 1, 0))
      const cy = Math.min(Math.max(Math.round(y), 0), Math.max(contentH - 1, 0))
      const dispatch = (key: WorkspaceMenuActionKey): void => {
        if (!sender.isDestroyed()) {
          sender.send(SESSIONS_CHANNELS.workspaceMenuAction, { id, key })
        }
      }
      const menu = new Menu()
      menu.append(
        new MenuItem({
          // 菜单标签经 main/i18n 取既有键（与渲染层 antd 菜单同键，i18n 零新增）
          label: t('sessions.workspaceSwitcher.rowRename'),
          click: () => dispatch('rename')
        })
      )
      menu.append(
        new MenuItem({
          label: t('sessions.workspaceSwitcher.rowDelete'),
          click: () => dispatch('delete')
        })
      )
      menu.popup({ window: win, x: cx, y: cy })
    })()
  })

  // 本文件注册 18 条 invoke 通道 + popup-row-menu / workspace-popup-menu 两条 on 通道；status-changed 与 changed（恢复出厂增量，2026-09-18）两条推送通道由 index.ts 接线（registry / factoryReset → renderer），row-menu-action / workspace-menu-action 推送由本文件两 popup handler 定向回推，合计 24 条
  console.log(`[sessions] IPC handlers 已注册（${Object.keys(SESSIONS_CHANNELS).length} 条通道）`)
}
