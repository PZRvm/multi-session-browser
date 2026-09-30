// Chrome 历史读取侧（导入专项步骤 2，契约见计划第 3 节 / src/shared/chromeImport.ts）：
// 把 profile 目录下的 History（明文 SQLite）拷贝到临时区，node:sqlite 只读打开读
// urls 表，映射为共享契约的 HistoryEntry[]。
//
// 为什么拷贝后读：Chrome 运行中 History 处于打开态，直连会撞文件锁（Windows 上
// EBUSY/EPERM 常态），且边读边变更会造成撕裂——拷贝出独立副本再读，SQLite 靠日志
// 回放保证副本崩溃一致，读到的即一个完整快照。拷贝遇文件锁按用户可见口径抛
// chromeImport.errors.chromeLocked（经主进程 t() 取词，与 sessions 域报错同款）。
//
// 本模块不 import electron（纯 Node 可测，临时目录经 deps 注入——照 history.ts
// 先例；装配点传 mkdtemp(join(tmpdir(), …)) 的包装，用后由本模块负责清理）。
// faviconUrl 恒 null：Chrome 的图标存于独立 Favicon 库，本期导入范围不含。

import { copyFile, rm } from 'fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'path'
import { HISTORY_URL_MAX, type HistoryEntry } from '../../../shared/history'
import { t } from '../../i18n'

export interface ChromeHistorySource {
  /**
   * 只读读取指定 Chrome profile 目录的历史：按 last_visit_time 倒序取前 limit 条，
   * 过滤（仅 http/https、HISTORY_URL_MAX 内）后映射为 HistoryEntry
   */
  read(profileDir: string, limit: number): Promise<HistoryEntry[]>
}

export function createChromeHistorySource(deps: {
  makeTempDir: () => Promise<string>
}): ChromeHistorySource {
  return {
    async read(profileDir, limit) {
      const tempDir = await deps.makeTempDir()
      try {
        const dbPath = join(tempDir, 'History')
        // 主库必拷；伴随文件（回滚日志 / WAL）存在才拷——缺位只影响「拷贝瞬间恰有
        // 未提交事务」的少数场景，SQLite 校验和会自动忽略残帧，不影响只读快照
        try {
          await copyWithLockGuard(join(profileDir, 'History'), dbPath, false)
        } catch (err) {
          // 主 History 缺失 = 该 profile 无历史（Guest Profile 等衍生目录形态）：
          // 按空集口径如实返回，不拦同 profile 其他 scope 的导入（审查中-4）
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
          throw err
        }
        for (const suffix of ['-journal', '-wal', '-shm']) {
          await copyWithLockGuard(
            join(profileDir, `History${suffix}`),
            join(tempDir, `History${suffix}`),
            true
          )
        }
        const db = new DatabaseSync(dbPath, { readOnly: true, readBigInts: true })
        let rows: Record<string, unknown>[]
        try {
          rows = db
            .prepare(
              'SELECT url, title, visit_count, last_visit_time FROM urls ORDER BY last_visit_time DESC LIMIT ?'
            )
            .all(limit) as Record<string, unknown>[]
        } finally {
          db.close()
        }
        const entries: HistoryEntry[] = []
        for (const row of rows) {
          const entry = toEntry(row)
          if (entry !== null) entries.push(entry)
        }
        return entries
      } finally {
        // 临时区用后即清（副本同样含浏览记录，不留痕）
        await rm(tempDir, { recursive: true, force: true })
      }
    }
  }
}

/** 拷贝 Chrome 侧单文件：EBUSY/EPERM（文件锁常态）按用户可见口径抛 chromeLocked */
async function copyWithLockGuard(src: string, dst: string, optional: boolean): Promise<void> {
  try {
    await copyFile(src, dst)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (optional && code === 'ENOENT') return // 伴随文件不存在，属正常
    if (code === 'EBUSY' || code === 'EPERM') {
      throw new Error(t('chromeImport.errors.chromeLocked'))
    }
    throw err
  }
}

/** 单行 urls → HistoryEntry；非 http(s)、空 url、超长 url 丢弃（坏行不拦整体导入） */
function toEntry(row: Record<string, unknown>): HistoryEntry | null {
  const url = row.url
  if (typeof url !== 'string' || url === '') return null
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  if (url.length > HISTORY_URL_MAX) {
    console.warn(`[chromeImport] 历史 URL 长度 ${url.length} 超上限 ${HISTORY_URL_MAX}，丢弃`)
    return null
  }
  const lastVisitedAt = webkitToUnixMs(row.last_visit_time)
  // 1601 纪元原始 0 / 损坏行换算为负 Unix 值：异常行整体丢弃（审查低-5——不伪造时间，
  // 也不让「史上最旧」脏条目入库挤占 2000 条额度）
  if (lastVisitedAt < 0) return null
  return {
    url,
    title: typeof row.title === 'string' ? row.title : '',
    faviconUrl: null,
    visitCount: normalizeCount(row.visit_count),
    lastVisitedAt
  }
}

/**
 * WebKit 纪元（µs since 1601-01-01）→ Unix 毫秒；异常值如实回退 0，不伪造时间。
 * 读BigInts 打开后整列为 bigint：必须先 BigInt 整除到 ms 再转 Number——µs 量级
 * （2017 年后 ≈1.3e16）超出 2^53，直转 Number 即丢精度（node:sqlite 默认 number
 * 模式遇超安全整数更是直接抛 ERR_OUT_OF_RANGE，故本模块恒以 readBigInts 打开）
 */
function webkitToUnixMs(raw: unknown): number {
  if (typeof raw === 'bigint') return Number(raw / 1000n) - 11644473600000
  const us = Number(raw)
  if (!Number.isFinite(us)) return 0
  return Math.floor(us / 1000) - 11644473600000
}

/** 访问数防御归一：负数/非数值回退 0，小数向下取整（列声明 NOT NULL，此处只兜底） */
function normalizeCount(raw: unknown): number {
  const count = Number(raw)
  if (!Number.isFinite(count) || count < 0) return 0
  return Math.floor(count)
}
