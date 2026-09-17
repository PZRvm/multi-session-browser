// 主进程 IPC 入参运行时守卫与失败日志的公共收口：shared 中的 payload 类型只是
// 编译期约定，跨 IPC 边界不可信任，所有 handler 入参先过这里的守卫再进业务。
// sessions.ts 仍持有一份旧实现——该文件属阶段 1 冻结契约，待后续阶段统一迁移。

export interface IpcGuards {
  /** 守卫失败统一抛出的业务错误（消息按域注入；阶段六起消息由调用点构造期经主进程
   * t() 取词——errors 命名空间，报错语言 = 工厂装配时语言） */
  invalidParams(): Error
  isRecord(value: unknown): value is Record<string, unknown>
  /** 读取可选 string 字段：缺省返回 undefined，存在但非 string 判为非法入参 */
  optionalString(value: unknown): string | undefined
  /** 读取必填有限 number 字段：缺省或非有限数字判为非法入参 */
  requiredNumber(value: unknown): number
  /**
   * 四字段矩形：全部必填有限数且非负（零合法——renderer 以零矩形作原生层收起信号）；
   * 非 record 或任一字段非法时抛业务错误
   */
  parseRect(payload: unknown): { x: number; y: number; width: number; height: number }
}

export function createIpcGuards(message: string): IpcGuards {
  const invalidParams = (): Error => new Error(message)
  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
  const optionalString = (value: unknown): string | undefined => {
    if (value === undefined) return undefined
    if (typeof value !== 'string') throw invalidParams()
    return value
  }
  const requiredNumber = (value: unknown): number => {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw invalidParams()
    return value
  }
  const parseRect = (payload: unknown): { x: number; y: number; width: number; height: number } => {
    if (!isRecord(payload)) throw invalidParams()
    const rect = {
      x: requiredNumber(payload.x),
      y: requiredNumber(payload.y),
      width: requiredNumber(payload.width),
      height: requiredNumber(payload.height)
    }
    if (rect.x < 0 || rect.y < 0 || rect.width < 0 || rect.height < 0) throw invalidParams()
    return rect
  }
  return { invalidParams, isRecord, optionalString, requiredNumber, parseRect }
}

/** 入参内容摘要（截断，避免垃圾入参刷屏控制台） */
export function summarize(data: unknown): string {
  let text: string
  try {
    text = JSON.stringify(data) ?? String(data)
  } catch {
    text = String(data)
  }
  const MAX = 200
  return text.length > MAX ? `${text.slice(0, MAX)}...(截断，总长 ${text.length})` : text
}

/** handler 统一包裹：失败路径主进程留 warn 日志（通道名 + 入参摘要）后原样 rethrow */
export function logFailure<T>(channel: string, payload: unknown, run: () => T, tag = 'browser'): T {
  try {
    return run()
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn(`[${tag}] ${channel} 失败: ${message} payload=${summarize(payload)}`)
    throw err
  }
}

/** 异步 handler 版（L5 定案并入）：Promise reject 同样走 warn 日志后原样 rethrow——
 * 同步版 try/catch 捕不到返回 Promise 的 run 的异步失败，异步命令（如 tear-off 读盘
 * 取会话名）必须走本包裹 */
export async function logFailureAsync<T>(
  channel: string,
  payload: unknown,
  run: () => Promise<T>,
  tag = 'browser'
): Promise<T> {
  try {
    return await run()
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn(`[${tag}] ${channel} 失败: ${message} payload=${summarize(payload)}`)
    throw err
  }
}
