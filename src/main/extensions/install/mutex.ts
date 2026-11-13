/**
 * 在途互斥单源（审查清单 20261113124504 低项）：manifest-store 的 locked()（全局
 * 单锁）与 partition-copy 的 ensureInflight（按 dir 键控）原本同款模式各写一份，
 * 经用户「全部修复」裁决提前抽单源（原判定「第三处出现时抽」）。
 */
/** 全局互斥：所有调用按序串行（后写胜出），失败不阻断队列。 */
export function createLock(): <T>(job: () => Promise<T>) => Promise<T> {
  let chain: Promise<unknown> = Promise.resolve()
  return (job) => {
    const run = chain.then(job, job)
    chain = run.catch(() => undefined)
    return run
  }
}

/**
 * 按键互斥：同 key 并发调用共享同一在途 Promise（首个任务的结果即全员结果），
 * 异 key 并行；任务落定即清除（下次调用重新执行），语义与原 ensureInflight 一致。
 */
export function createKeyedLock(): <T>(key: string, job: () => Promise<T>) => Promise<T> {
  const inflight = new Map<string, Promise<unknown>>()
  return async <T>(key: string, job: () => Promise<T>): Promise<T> => {
    const existing = inflight.get(key)
    if (existing) return existing as Promise<T>
    const task = job().finally(() => {
      inflight.delete(key)
    })
    inflight.set(key, task)
    return task
  }
}
