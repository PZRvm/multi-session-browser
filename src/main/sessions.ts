// 会话 IPC handlers：五条通道的业务实现，读写一律经 store.ts 的快照接口。
// 通道名一律取自 shared/sessions 的 SESSIONS_CHANNELS，禁止手写字符串。
// 快照读-改-写一律经 mutateSnapshot 串行执行；入参先过运行时守卫
// （shared 中的 payload 类型只是编译期约定，跨 IPC 边界不可信任）。

import { ipcMain } from 'electron'
import {
  SESSIONS_CHANNELS,
  type OkResult,
  type SessionsSnapshot,
  type StoredSession
} from '../shared/sessions'
import { loadSnapshot, mutateSnapshot, summarize } from './store'

/** id 自增序列（模块级，跨多次 create 递增） */
let seq = 0

/** IPC 入口字段长度上限（超出直接截断，不报错，防止 MB 级字符串写穿落盘） */
const NAME_MAX = 50
const NOTE_MAX = 200
const PAGE_TITLE_MAX = 200

/** 守卫失败统一抛出的业务错误 */
function invalidParams(): Error {
  return new Error('无效的会话参数')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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

/** handler 统一包裹：失败路径主进程留 warn 日志（通道名 + payload 摘要）后原样 rethrow */
function logFailure<T>(channel: string, payload: unknown, run: () => Promise<T>): Promise<T> {
  return run().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    console.warn(`[sessions] ${channel} 失败: ${message} payload=${summarize(payload)}`)
    throw err
  })
}

export function registerSessionIpc(): void {
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
          const existingIds = new Set(snapshot.sessions.map((s) => s.id))
          let id: string
          do {
            seq += 1
            id = `sess-${Date.now().toString(36)}-${seq}`
          } while (existingIds.has(id))
          const session: StoredSession = {
            id,
            name: clampString(inputName || `会话 ${seq}`, NAME_MAX),
            note: clampString(inputNote, NOTE_MAX),
            // 创建时标题为固定占位文案，仍过一道截断以维持入口上限不变式
            pageTitle: clampString('未打开页面', PAGE_TITLE_MAX)
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
      return mutateSnapshot((snapshot) => {
        const index = snapshot.sessions.findIndex((s) => s.id === id)
        if (index === -1) throw new Error('会话不存在')
        const [removed] = snapshot.sessions.splice(index, 1)
        if (snapshot.activeId === removed.id) {
          snapshot.activeId = snapshot.sessions[0]?.id ?? null
        }
        return { ok: true }
      })
    })
  )

  // setActive：null 合法（清空选中）；非 null 时 id 必须存在
  ipcMain.handle(SESSIONS_CHANNELS.setActive, async (_event, payload: unknown): Promise<OkResult> =>
    logFailure(SESSIONS_CHANNELS.setActive, payload, async () => {
      // id 必须为 string 或 null；undefined 等其他类型显式拒绝，不误报「会话不存在」
      if (!isRecord(payload)) throw invalidParams()
      if (payload.id !== null && typeof payload.id !== 'string') throw invalidParams()
      const nextId = payload.id
      return mutateSnapshot((snapshot) => {
        if (nextId !== null && !snapshot.sessions.some((s) => s.id === nextId)) {
          throw new Error('会话不存在')
        }
        snapshot.activeId = nextId
        return { ok: true }
      })
    })
  )

  console.log('[sessions] IPC handlers 已注册（5 条通道）')
}
