// 会话 IPC handlers：九条 invoke 通道（阶段 4 六条 + 阶段 5 clone / delete-all /
// batch-open-url 三条）的业务实现，读写一律经 store.ts 的快照接口；status-changed 推送
// 不经本文件（index.ts 直连 registry）。通道名一律取自 shared/sessions 的
// SESSIONS_CHANNELS，禁止手写字符串。
// 快照读-改-写一律经 mutateSnapshot 串行执行；入参先过运行时守卫
// （shared 中的 payload 类型只是编译期约定，跨 IPC 边界不可信任）。
// 浏览器编排（切换/销毁联动、状态数据源）经 deps 注入回调触达，本文件不 import registry
// （装配在 index.ts，契约见开发计划第 3 节契约点 3/4）。

import { ipcMain } from 'electron'
import { isRecord } from '../shared/guards'
import {
  PAGE_TITLE_MAX,
  SESSION_ID_RE,
  SESSIONS_CHANNELS,
  cloneTabs,
  type OkResult,
  type SessionStatusesPayload,
  type SessionsSnapshot,
  type StoredSession
} from '../shared/sessions'
import { normalizeInput } from './browser/url'
import { loadSnapshot, mutateSnapshot, summarize } from './store'

/**
 * 编排依赖（冻结签名，见开发计划第 3 节契约点 3/4），由 index.ts 注入：
 * - onActiveChanged：setActive 落盘成功后通知编排层切换浏览器
 * - onDeleted：delete 落盘成功后通知编排层销毁该会话并跟随级联后的 activeId
 * - getStatuses：get-statuses 拉取通道的数据源（registry 状态聚合）
 * - clonePartition：clone 的分区数据复制（close-then-copy），失败上抛即不落元数据
 * - onAllDeleted：deleteAll 落盘成功后通知编排层一次切空态 + 逐会话销毁清分区
 * - onBatchOpenUrl：batchOpenUrl 整单校验通过后通知编排层逐会话新建 Tab 加载
 */
interface SessionIpcDeps {
  onActiveChanged(id: string | null): void
  onDeleted(id: string, nextActiveId: string | null): void
  getStatuses(): SessionStatusesPayload
  clonePartition(srcId: string, dstId: string): Promise<void>
  onAllDeleted(ids: string[]): void
  onBatchOpenUrl(ids: string[], url: string): void
}

/** id 自增序列（模块级，跨多次 create 递增） */
let seq = 0

/** IPC 入口字段长度上限（超出直接截断，不报错，防止 MB 级字符串写穿落盘）；pageTitle 上限取 shared 单源 */
const NAME_MAX = 50
const NOTE_MAX = 200

/** 守卫失败统一抛出的业务错误 */
function invalidParams(): Error {
  return new Error('无效的会话参数')
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
        // payload 缺省视为 {}；name/note 若存在必须是 string
        const raw = isRecord(payload) ? payload : {}
        const inputName = optionalString(raw.name)?.trim() ?? ''
        const inputNote = optionalString(raw.note) ?? ''
        return mutateSnapshot((snapshot) => {
          const id = generateSessionId(new Set(snapshot.sessions.map((s) => s.id)))
          const session: StoredSession = {
            id,
            name: clampString(inputName || `会话 ${seq}`, NAME_MAX),
            note: clampString(inputNote, NOTE_MAX),
            // 创建时标题为固定占位文案，仍过一道截断以维持入口上限不变式
            pageTitle: clampString('未打开页面', PAGE_TITLE_MAX),
            // 阶段 4 契约（步骤 2 冻结）：新建会话无上次打开页，恒空串
            lastUrl: '',
            // 阶段 6 契约：新建会话无恢复集，懒创建时回退单空白 Tab
            tabs: [],
            activeTabIndex: 0
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
        if (!name) throw new Error('会话名称不能为空')
        return mutateSnapshot((snapshot) => {
          const target = snapshot.sessions.find((s) => s.id === id)
          if (!target) throw new Error('会话不存在')
          target.name = clampString(name, NAME_MAX)
          return target
        })
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
        if (index === -1) throw new Error('会话不存在')
        const [removed] = snapshot.sessions.splice(index, 1)
        if (snapshot.activeId === removed.id) {
          snapshot.activeId = snapshot.sessions[0]?.id ?? null
        }
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
          throw new Error('会话不存在')
        }
        snapshot.activeId = nextId
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
        // payload 必须含 string 类型的 id
        if (!isRecord(payload) || typeof payload.id !== 'string') throw invalidParams()
        const srcId = payload.id
        // 源会话存在性校验（读盘）；同一份快照兼作生成新 id 的撞车判据
        const snapshot = await loadSnapshot()
        const src = snapshot.sessions.find((s) => s.id === srcId)
        if (!src) throw new Error('会话不存在')
        const newId = generateSessionId(new Set(snapshot.sessions.map((s) => s.id)))
        // 先复制分区（close-then-copy，含关闭源会话 webContents），成功才落元数据。
        // 生成的 id 此后无需复核：本运行期落盘新增的 id 同样出自单调 seq，必不与之相同；
        // 既往旧 id 已在生成时避开，mutateSnapshot 串行队列内无并发改写落盘的旁路
        await deps.clonePartition(srcId, newId)
        try {
          return await mutateSnapshot((data) => {
            // 取最新落盘的源条目复制元数据（closeSession 冲刷的上报可能刚更新 pageTitle/
            // lastUrl）；源在复制期间被并发删除时退回校验时点的快照值（分区已复制完成）
            const source = data.sessions.find((item) => item.id === srcId) ?? src
            const cloned: StoredSession = {
              id: newId,
              name: clampString(`${source.name} 副本`, NAME_MAX),
              note: source.note,
              pageTitle: source.pageTitle,
              lastUrl: source.lastUrl,
              // 阶段 6：恢复集随元数据复制（克隆产物同款页面集，URL 级）
              tabs: cloneTabs(source.tabs),
              activeTabIndex: source.activeTabIndex
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

  // delete-all：批量关闭全部会话（= 彻底删除全部，与单条删除同一标准：销毁 webContents +
  // 清分区数据 + 删分区目录）；原子清空快照（sessions=[]、activeId=null）后经 onAllDeleted
  // 一次切空态 + 逐会话异步销毁；空列表 no-op 直接成功，不触发编排
  ipcMain.handle(SESSIONS_CHANNELS.deleteAll, async (): Promise<OkResult> =>
    logFailure(SESSIONS_CHANNELS.deleteAll, undefined, async () => {
      const ids = (await loadSnapshot()).sessions.map((s) => s.id)
      if (ids.length === 0) return { ok: true }
      await mutateSnapshot((snapshot) => {
        snapshot.sessions = []
        snapshot.activeId = null
        return { ok: true }
      })
      // 落盘成功后联动（写盘失败时抛错，不联动）
      deps.onAllDeleted(ids)
      return { ok: true }
    })
  )

  // batch-open-url：对全部选中会话各新建一个 Tab 加载指定测试地址；整单校验拒绝制——
  // payload 不合法 / ids 任一不存在 / URL 规范化失败，任一不满足整单拒绝，无部分成功
  ipcMain.handle(
    SESSIONS_CHANNELS.batchOpenUrl,
    async (_event, payload: unknown): Promise<OkResult> =>
      logFailure(SESSIONS_CHANNELS.batchOpenUrl, payload, async () => {
        // ids 必须为非空数组且逐项 string；url 必须为 string
        if (!isRecord(payload)) throw invalidParams()
        if (
          !Array.isArray(payload.ids) ||
          payload.ids.length === 0 ||
          !payload.ids.every((item): item is string => typeof item === 'string') ||
          typeof payload.url !== 'string'
        ) {
          throw invalidParams()
        }
        const ids = payload.ids
        // id 格式预校验（R4 定案）：被篡改的落盘 id 能通过存在性检查（isStoredSession
        // 只查非空 string），若放行到 registry 的逐会话开 Tab，会在中途抛错前已对
        // 前序合法会话产生副作用——违背整单拒绝契约。格式校验前置，非法即整单拒绝
        if (!ids.every((id) => SESSION_ID_RE.test(id))) {
          throw new Error('会话 id 非法（疑似数据被篡改）')
        }
        // 逐 id 存在性校验（读盘）；校验通过后立即触发编排——校验与执行间的毫秒级
        // 竞态窗口（窗口内被并发删除的会话）按已通过处理，不在此二次设防
        const snapshot = await loadSnapshot()
        const known = new Set(snapshot.sessions.map((s) => s.id))
        if (!ids.every((id) => known.has(id))) throw new Error('会话不存在')
        // 地址栏输入规范化（scheme 白名单 + 缺省补 https://），失败整单拒绝
        const normalized = normalizeInput(payload.url)
        if (!normalized) throw new Error('无效的网址')
        deps.onBatchOpenUrl(ids, normalized)
        return { ok: true }
      })
  )

  // 本文件注册 9 条 invoke 通道；status-changed 推送通道由 index.ts 接线（registry → renderer），合计 10 条
  console.log('[sessions] IPC handlers 已注册（10 条通道）')
}
