// 会话 IPC handlers：十六条 invoke 通道（阶段 4 六条 + 阶段 5 clone / delete-batch /
// batch-open-url 三条 + 排序专项 reorder 一条 + 工作区专项六条 create/rename/delete/
// move-session/move-sessions-batch/set-active）的业务实现，读写一律经 store.ts 的快照接口；status-changed
// 推送不经本文件（index.ts 直连 registry）。通道名一律取自 shared/sessions 的
// SESSIONS_CHANNELS，禁止手写字符串。快照读-改-写一律经 mutateSnapshot 串行执行；
// 入参先过运行时守卫（shared 中的 payload 类型只是编译期约定，跨 IPC 边界不可信任）。
// 浏览器编排（切换/销毁联动、状态数据源）经 deps 注入回调触达，本文件不 import registry
// （装配在 index.ts，契约见开发计划第 3 节契约点 3/4）。工作区六通道纯元数据：唯一
// 编排触点是 workspaceSetActive 的激活位级联（复用 onActiveChanged），其余零回调。

import { ipcMain } from 'electron'
import { isRecord } from '../shared/guards'
import {
  PAGE_TITLE_MAX,
  SESSION_ID_RE,
  SESSIONS_CHANNELS,
  WORKSPACE_ID_RE,
  WORKSPACE_NAME_MAX,
  WORKSPACE_VIEW_ALL,
  cloneTabs,
  type MoveSessionsBatchResult,
  type OkResult,
  type SessionStatusesPayload,
  type SessionsSnapshot,
  type StoredSession,
  type StoredTab,
  type StoredWorkspace
} from '../shared/sessions'
import { normalizeInput } from './browser/url'
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
 * - onBatchOpenUrl：batchOpenUrl 整单校验通过后通知编排层逐会话新建 Tab 加载
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
  onBatchOpenUrl(ids: string[], url: string): void
}

/** id 自增序列（模块级，跨多次 create 递增） */
let seq = 0

/** IPC 入口字段长度上限（超出直接截断，不报错，防止 MB 级字符串写穿落盘）；pageTitle 上限取 shared 单源 */
const NAME_MAX = 50
const NOTE_MAX = 200

/** 守卫失败统一抛出的业务错误（文案经字典 errors 命名空间，报错语言 = 取词时语言） */
function invalidParams(): Error {
  return new Error(t('errors.invalidSessionParams'))
}

/**
 * 从 IPC payload 中解析 ids：必须为非空数组且逐项 string，否则判为非法入参。
 * batch-delete、batch-open-url 与 reorder 三条通道共用同一校验（规则演进只改此处；
 * 上层各自决定重复 id 的处置——批量通道去重容忍，reorder 整单拒绝）
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
 * batch-open-url 与 reorder 三条通道共用（与 parseNonEmptyStringIds 同为共用
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
            note: clampString(inputNote, NOTE_MAX),
            // 创建时标题为构造期本地化占位文案（i18n 种子语义：语言切换前的存量值
            // 不追溯），仍过一道截断以维持入口上限不变式
            pageTitle: clampString(t('sessions.defaults.noPageTitle'), PAGE_TITLE_MAX),
            // 阶段 4 契约（步骤 2 冻结）：新建会话无上次打开页，恒空串
            lastUrl: '',
            // 阶段 6 契约：新建会话无恢复集，懒创建时回退单空白 Tab
            tabs: [],
            activeTabIndex: 0,
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
              )
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
  // 落盘成功后经 onBatchDeleted 一次切换到级联 activeId + 逐会话异步销毁
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

  // batch-open-url：对全部选中会话各新建一个 Tab 加载指定测试地址；整单校验拒绝制——
  // payload 不合法 / ids 任一不存在 / URL 规范化失败，任一不满足整单拒绝，无部分成功
  ipcMain.handle(
    SESSIONS_CHANNELS.batchOpenUrl,
    async (_event, payload: unknown): Promise<OkResult> =>
      logFailure(SESSIONS_CHANNELS.batchOpenUrl, payload, async () => {
        // payload 必须为 record；ids 经共用校验，url 必须为 string
        if (!isRecord(payload)) throw invalidParams()
        const ids = parseNonEmptyStringIds(payload)
        if (typeof payload.url !== 'string') throw invalidParams()
        // id 格式预校验（共用守卫）：被篡改的落盘 id 能通过存在性检查（isStoredSession
        // 只查非空 string），若放行到 registry 的逐会话开 Tab，会在中途抛错前已对
        // 前序合法会话产生副作用——违背整单拒绝契约。格式校验前置，非法即整单拒绝
        assertSessionIdFormat(ids)
        // 逐 id 存在性校验（读盘）；校验通过后立即触发编排——校验与执行间的毫秒级
        // 竞态窗口（窗口内被并发删除的会话）按已通过处理，不在此二次设防
        const snapshot = await loadSnapshot()
        const known = new Set(snapshot.sessions.map((s) => s.id))
        if (!ids.every((id) => known.has(id))) throw new Error(t('errors.sessionNotFound'))
        // 地址栏输入规范化（scheme 白名单 + 缺省补 https://），失败整单拒绝
        const normalized = normalizeInput(payload.url)
        if (!normalized) throw new Error(t('errors.invalidUrl'))
        deps.onBatchOpenUrl(ids, normalized)
        return { ok: true }
      })
  )

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

  // workspaces:move-sessions-batch：批量移动选中会话（2026-09-17 增量，批量模式板脚
  // 入口）。语义二分：已在目标的会话幂等 no-op 计入 skipped（合法——批量勾选可含
  // 混合归属，demo 裁决静默跳过）；ids 格式非法或任一会话/目标工作区不存在则整单
  // 拒绝（零部分成功、磁盘不变，对齐 batch 家族先例；重复 id 去重容忍）。单
  // mutateSnapshot 临界区逐会话赋值 + 源工作区记忆清理、一次落盘；moved/skipped
  // 为真实计数返回（renderer 反馈条不自算口径）；不动 activeId、零编排回调
  ipcMain.handle(
    SESSIONS_CHANNELS.workspaceMoveSessionsBatch,
    async (_event, payload: unknown): Promise<MoveSessionsBatchResult> =>
      logFailure(SESSIONS_CHANNELS.workspaceMoveSessionsBatch, payload, async () => {
        if (!isRecord(payload)) throw invalidParams()
        if (payload.workspaceId !== null && typeof payload.workspaceId !== 'string') {
          throw invalidParams()
        }
        const target = payload.workspaceId
        if (target !== null) assertWorkspaceIdFormat(target)
        const ids = [...new Set(parseNonEmptyStringIds(payload))]
        assertSessionIdFormat(ids)
        let moved = 0
        let skipped = 0
        await mutateSnapshot((snapshot) => {
          if (target !== null && !snapshot.workspaces.some((w) => w.id === target)) {
            throw new Error(t('errors.workspaceNotFound'))
          }
          for (const id of ids) {
            const session = snapshot.sessions.find((item) => item.id === id)
            if (!session) throw new Error(t('errors.sessionNotFound'))
            if (session.workspaceId === target) {
              skipped++
              continue
            }
            const prevWorkspaceId = session.workspaceId
            session.workspaceId = target
            moved++
            if (prevWorkspaceId !== null) {
              const source = snapshot.workspaces.find((w) => w.id === prevWorkspaceId)
              if (source && source.lastActiveSessionId === id) {
                source.lastActiveSessionId = null
              }
            }
          }
          return { ok: true }
        })
        return { moved, skipped }
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
        if (viewId !== WORKSPACE_VIEW_ALL) assertWorkspaceIdFormat(viewId)
        const outcome = await mutateSnapshot((snapshot) => {
          const prevActive = snapshot.activeId
          if (viewId === WORKSPACE_VIEW_ALL) {
            // 全部视野：纯视野切换，activeId 不动，零编排
            snapshot.activeWorkspaceId = WORKSPACE_VIEW_ALL
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

  // 本文件注册 16 条 invoke 通道；status-changed 推送通道由 index.ts 接线（registry → renderer），合计 17 条
  console.log(`[sessions] IPC handlers 已注册（${Object.keys(SESSIONS_CHANNELS).length} 条通道）`)
}
