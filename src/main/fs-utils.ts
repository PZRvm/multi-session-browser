// 主进程落盘通用件：JSON 原子写（唯一事实源，store.ts 的 sessions.json 与
// browser/history.ts 的会话历史文件共用）。先写唯一临时文件再原子改名——防半截
// 写入或并发写交错损坏落盘数据；临时文件名带时间戳 + 随机后缀，并发写各用各的
// tmp，也不会与崩溃残留的旧 tmp 交错覆盖；写失败尽力清理本次临时文件后原样上抛，
// 由调用方决定告警/回退口径。

import { mkdir, rename, unlink, writeFile } from 'fs/promises'
import { dirname } from 'path'

/** 原子写 JSON：serialize(null, 2) 缩进格式；父目录不存在则递归创建 */
export async function atomicWriteJson(target: string, value: unknown): Promise<void> {
  const tmp = `${target}.${Date.now()}-${Math.random().toString(36).slice(2, 8)}.tmp`
  try {
    await mkdir(dirname(target), { recursive: true })
    await writeFile(tmp, JSON.stringify(value, null, 2), 'utf-8')
    await rename(tmp, target)
  } catch (err) {
    await unlink(tmp).catch(() => undefined)
    throw err
  }
}
