import { ipcMain } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { t } from './i18n'

let preparing = false
let installing = false
let frozen = false
let restoring = 0
export const canCompleteUpdateRestore = (): boolean => preparing && !frozen && restoring > 0
/** 仅同步内部恢复使用，不向事件回调或异步任务传递许可。 */
export function completeUpdateRestore(restore: () => void): void {
  if (preparing && frozen) throw new Error(t('updates.preparing'))
  restoring += 1
  try {
    restore()
  } finally {
    restoring -= 1
  }
}
const pending = new Set<Promise<unknown>>()
export const isUpdatePreparing = (): boolean => preparing
export const isUpdateInstalling = (): boolean => installing
export function setUpdateInstalling(value: boolean): void {
  installing = value
}
export function assertUpdateWritable(): void {
  if (preparing) throw new Error(t('updates.preparing'))
}
export async function beginUpdatePreparation(): Promise<void> {
  if (preparing) throw new Error(t('updates.preparing'))
  preparing = true
  while (pending.size) await Promise.allSettled([...pending])
  frozen = true
}
export function resumeAfterUpdate(): void {
  preparing = false
  frozen = false
  installing = false
}

/** 登记命令中启动的异步激活/销毁链，使更新等待其真正落定。 */
export function trackUpdateWork<T>(work: Promise<T>): Promise<T> {
  pending.add(work)
  void work.finally(() => pending.delete(work)).catch(() => undefined)
  return work
}

/** 只包裹影响恢复集或与安装冲突的命令；查询和采集器数据链不经过此处。 */
export function handleUpdateMutation<Args extends unknown[], R>(
  channel: string,
  listener: (event: IpcMainInvokeEvent, ...args: Args) => R
): void {
  ipcMain.handle(channel, (event, ...args: Args) => {
    assertUpdateWritable()
    const result = Promise.resolve().then(() => listener(event, ...args))
    return trackUpdateWork(result)
  })
}
