// 跨进程共享的运行时类型守卫：主进程持久化与 IPC 入参校验共用的最小集合。
// shared 中的 payload 类型只是编译期约定，跨 IPC / 落盘边界不可信任（约定见 sessions.ts 头注）。

/** 非空普通对象判定（不含数组）；store/sessions/appearance 三域校验共用单一实现 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
