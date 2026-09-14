// 会话浏览历史（地址栏补全的数据层）：主进程持有、每会话独立落盘
// （userData/history/<sessionId>.json）的唯一事实源。本模块不含任何 IPC（命令与
// 推送由 ipc.ts 装配）；目录经 deps 注入（index.ts 传 app.getPath('userData') 派生，
// /tmp 断言脚本注入临时目录——模块自身不 import electron，纯 Node 可测）。
//
// 时序语义（manager 导航事件的先后事实）：did-navigate 先于新页面的
// page-title-updated / page-favicon-updated 到达，且此刻 TabEntry 的 title/favicon
// 还是上一页的旧值——采集事件必须只携带自身确定的信息，故 VisitFact 带 kind 判别：
// 'visit' 只计数（title/favicon 视为无信息），'title'/'favicon' 只补写元数据不动
// 计数。同 URL 重复访问 upsert 合并（visitCount/lastVisitedAt），标题空串与图标
// null 表示「本事件无信息」，不覆盖已有值。
//
// 推送与落盘解耦：onEntryChanged 在内存合并后即触发（镜像即时——刚访问的网址
// 立即可被建议），落盘走 500ms trailing 去抖 + tmp+rename 原子写（照 store.ts
// 模式），退出链 flushAll 冲刷全部待写并封笔（照 persistence.ts sealed 模式）。

import { copyFile, mkdir, readFile, rename, rm, unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import { isRecord } from '../../shared/guards'
import {
  HISTORY_MAX_ENTRIES,
  HISTORY_SCHEMA_VERSION,
  HISTORY_URL_MAX,
  type HistoryChangedPayload,
  type HistoryEntry
} from '../../shared/history'

/** 页面侧导航事实（manager 上抛） */
export interface VisitFact {
  /**
   * 事件类别：'visit' = 导航计数（title/favicon 字段为无信息占位）；
   * 'title' = 页面标题补写；'favicon' = 图标补写（二者不动计数）
   */
  kind: 'visit' | 'title' | 'favicon'
  url: string
  title: string
  faviconUrl: string | null
}

export type HistoryEntryListener = (payload: HistoryChangedPayload) => void

export interface BrowserHistory {
  /** 采集入口（manager 的 onVisit 回调转发）：入史过滤 + upsert 合并 + 推送 + 去抖落盘 */
  recordVisit(sessionId: string, fact: VisitFact): void
  /** 该会话全量历史（数组元素为浅拷贝，防调用方污染内存条目）；首触懒加载落盘文件 */
  getEntries(sessionId: string): Promise<HistoryEntry[]>
  /** 克隆会话携带历史：先冲刷源会话待写，再复制落盘文件与内存条目到目标 */
  cloneHistory(srcId: string, dstId: string): Promise<void>
  /** 删除会话清史：删落盘文件 + 清内存/去抖定时器（deleteAll 级联经 destroySession 覆盖） */
  dropHistory(sessionId: string): Promise<void>
  /** 退出前冲刷全部待写并封笔（此后 recordVisit no-op）；返回在途写盘的汇合 promise */
  flushAll(): Promise<void>
  /** 订阅条目变化（内存合并后即触发，供 ipc.ts 定向推送）；返回退订函数 */
  onEntryChanged(cb: HistoryEntryListener): () => void
}

/** 落盘去抖（trailing）：导航与标题事件密集，写盘前先静默一段时间（与 persistence 同值） */
const WRITE_DEBOUNCE_MS = 500

/** 文件名安全：会话 id 只允许字母数字与连字符/下划线（拒绝 '.'，即封死 '..' 逃逸） */
const SESSION_ID_FILE_RE = /^[A-Za-z0-9_-]+$/

/** 单条落盘条目的元素级校验（落盘是跨信任边界输入） */
function isStoredEntry(value: unknown): value is HistoryEntry {
  if (!isRecord(value)) return false
  return (
    typeof value.url === 'string' &&
    value.url.length > 0 &&
    typeof value.title === 'string' &&
    (value.faviconUrl === null || typeof value.faviconUrl === 'string') &&
    typeof value.visitCount === 'number' &&
    Number.isInteger(value.visitCount) &&
    value.visitCount >= 0 &&
    typeof value.lastVisitedAt === 'number' &&
    Number.isFinite(value.lastVisitedAt)
  )
}

export function createBrowserHistory(deps: { historyDir: () => string }): BrowserHistory {
  /** 各会话内存条目（url → entry；Map 迭代序即插入序） */
  const sessions = new Map<string, Map<string, HistoryEntry>>()
  /** 各会话懒加载 promise（读盘一次；之后 recordVisit 沿此链串行合并，防读盘竞态丢条目） */
  const loads = new Map<string, Promise<void>>()
  /** 各会话待写标志与去抖定时器 */
  const dirty = new Set<string>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const listeners = new Set<HistoryEntryListener>()
  /** 封笔标志（flushAll 后 recordVisit/getEntries 写路径 no-op） */
  let sealed = false

  function fileFor(sessionId: string): string {
    if (!SESSION_ID_FILE_RE.test(sessionId)) {
      throw new Error(`会话 id "${sessionId}" 含非法字符，拒绝拼接历史文件路径`)
    }
    return join(deps.historyDir(), `${sessionId}.json`)
  }

  /** 单会话读盘（坏数据容错口径对齐 store.ts：根节点坏 → 回退空史并告警；元素坏 → 剔除并告警） */
  async function loadSession(sessionId: string): Promise<void> {
    let raw: string
    const target = fileFor(sessionId)
    try {
      raw = await readFile(target, 'utf-8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        sessions.set(sessionId, new Map()) // 首触尚无落盘文件，属正常
        return
      }
      console.warn(`[history] 读取会话 ${sessionId} 的历史文件失败，已回退空史:`, err)
      sessions.set(sessionId, new Map())
      return
    }
    const entries = parseStored(sessionId, raw)
    const map = new Map<string, HistoryEntry>()
    for (const entry of entries) map.set(entry.url, entry)
    sessions.set(sessionId, map)
  }

  function parseStored(sessionId: string, raw: string): HistoryEntry[] {
    let data: unknown
    try {
      data = JSON.parse(raw)
    } catch {
      console.warn(`[history] 会话 ${sessionId} 的历史不是合法 JSON，已回退空史`)
      return []
    }
    if (
      !isRecord(data) ||
      data.version !== HISTORY_SCHEMA_VERSION ||
      !Array.isArray(data.entries)
    ) {
      console.warn(`[history] 会话 ${sessionId} 的历史文件结构不符（version/entries），已回退空史`)
      return []
    }
    const valid = data.entries.filter(isStoredEntry)
    if (valid.length !== data.entries.length) {
      console.warn(
        `[history] 会话 ${sessionId} 的历史存在 ${data.entries.length - valid.length} 条坏元素，已剔除`
      )
    }
    // 手工编辑可能引入重复 url：保留 lastVisitedAt 较新的一条；随后按上限淘汰最旧
    const byUrl = new Map<string, HistoryEntry>()
    for (const entry of valid) {
      const prev = byUrl.get(entry.url)
      if (!prev || entry.lastVisitedAt > prev.lastVisitedAt) byUrl.set(entry.url, entry)
    }
    return trimToLimit([...byUrl.values()])
  }

  /** 超上限淘汰 lastVisitedAt 最旧（并存态稳定：按 lastVisitedAt 升序排序后截尾） */
  function trimToLimit(entries: HistoryEntry[]): HistoryEntry[] {
    if (entries.length <= HISTORY_MAX_ENTRIES) return entries
    const sorted = [...entries].sort((a, b) => a.lastVisitedAt - b.lastVisitedAt)
    return sorted.slice(entries.length - HISTORY_MAX_ENTRIES)
  }

  /** 懒加载入口：读盘 promise 单飞行，之后立即 resolve（内存已就位） */
  function ensureLoaded(sessionId: string): Promise<void> {
    let pending = loads.get(sessionId)
    if (!pending) {
      pending = loadSession(sessionId)
      loads.set(sessionId, pending)
    }
    return pending
  }

  /** 取内存条目快照写盘（tmp+rename 原子写，照 store.ts；失败如实告警，dirty 保留待重试） */
  function writeSession(sessionId: string): Promise<void> {
    const map = sessions.get(sessionId)
    if (!map) return Promise.resolve() // 会话已清（dropHistory 竞态），静默跳过
    const target = fileFor(sessionId)
    const tmp = `${target}.${Date.now()}-${Math.random().toString(36).slice(2, 8)}.tmp`
    const payload = JSON.stringify(
      { version: HISTORY_SCHEMA_VERSION, entries: [...map.values()] },
      null,
      2
    )
    return mkdir(deps.historyDir(), { recursive: true })
      .then(() => writeFile(tmp, payload, 'utf-8'))
      .then(() => rename(tmp, target))
      .then(() => {
        dirty.delete(sessionId)
      })
      .catch((error: unknown) => {
        // 写失败清本次临时文件（唯一文件名不会被覆盖，不清理会残留堆积）
        void unlink(tmp).catch(() => undefined)
        console.warn(`[history] 写会话 ${sessionId} 的历史文件失败:`, error)
      })
  }

  function scheduleWrite(sessionId: string): void {
    const pending = timers.get(sessionId)
    if (pending) clearTimeout(pending)
    dirty.add(sessionId)
    timers.set(
      sessionId,
      setTimeout(() => {
        timers.delete(sessionId)
        void writeSession(sessionId)
      }, WRITE_DEBOUNCE_MS)
    )
  }

  function clearTimer(sessionId: string): void {
    const pending = timers.get(sessionId)
    if (pending) {
      clearTimeout(pending)
      timers.delete(sessionId)
    }
  }

  /** 事实合并（单一出口）：kind 语义见 VisitFact 注释 */
  function mergeFact(entry: HistoryEntry, fact: VisitFact): void {
    if (fact.kind === 'title') {
      if (fact.title !== '') entry.title = fact.title
    } else if (fact.kind === 'favicon') {
      if (fact.faviconUrl !== null) entry.faviconUrl = fact.faviconUrl
    } else {
      entry.visitCount += 1
      entry.lastVisitedAt = Date.now()
    }
  }

  return {
    recordVisit(sessionId, fact) {
      if (sealed) return
      // about:blank（新标签页）不入史；超长 URL 不入史（截断后无法再导航，入史即坏数据）
      if (fact.url === 'about:blank') return
      if (fact.url.length > HISTORY_URL_MAX) {
        console.warn(
          `[history] 会话 ${sessionId} 的 URL 长度 ${fact.url.length} 超上限 ${HISTORY_URL_MAX}，不入史`
        )
        return
      }
      // 读盘未完成的毫秒窗口：沿 ensureLoaded 链排队，防内存空态覆盖磁盘既有条目
      void ensureLoaded(sessionId).then(() => {
        if (sealed) return
        let map = sessions.get(sessionId)
        if (!map) {
          map = new Map()
          sessions.set(sessionId, map)
        }
        let entry = map.get(fact.url)
        if (entry === undefined) {
          entry = { url: fact.url, title: '', faviconUrl: null, visitCount: 0, lastVisitedAt: 0 }
          map.set(fact.url, entry)
        }
        mergeFact(entry, fact)
        // 超上限淘汰最旧（新条目刚访问不会被淘汰；淘汰的是 lastVisitedAt 最旧者）
        if (map.size > HISTORY_MAX_ENTRIES) {
          let oldest: string | null = null
          let oldestAt = Infinity
          for (const [url, item] of map) {
            if (item.lastVisitedAt < oldestAt) {
              oldestAt = item.lastVisitedAt
              oldest = url
            }
          }
          if (oldest !== null) map.delete(oldest)
        }
        scheduleWrite(sessionId)
        // 镜像即时：内存合并后即推送（不等去抖落盘——刚访问的网址立即可被建议）
        const payload: HistoryChangedPayload = {
          sessionId,
          entry: { ...entry }
        }
        for (const cb of listeners) cb(payload)
      })
    },

    async getEntries(sessionId) {
      await ensureLoaded(sessionId)
      const map = sessions.get(sessionId)
      if (!map) return []
      return [...map.values()].map((entry) => ({ ...entry }))
    },

    async cloneHistory(srcId, dstId) {
      // 先冲刷源会话待写（克隆语义 = settle 时点快照，与分区复制同口径）
      clearTimer(srcId)
      if (dirty.has(srcId)) {
        await writeSession(srcId)
      }
      // 内存未加载的会话（从未激活过）：文件可能也不存在，复制属可选路径
      const srcLoaded = sessions.has(srcId)
      if (srcLoaded) {
        // 内存已就位：深拷贝条目到目标内存（克隆会话激活后无需读盘即有历史）
        const copy = new Map<string, HistoryEntry>()
        for (const [url, entry] of sessions.get(srcId) ?? []) {
          copy.set(url, { ...entry })
        }
        sessions.set(dstId, copy)
        loads.set(dstId, Promise.resolve())
      }
      try {
        await copyFile(fileFor(srcId), fileFor(dstId))
        // 复制即一致：目标无待写
        dirty.delete(dstId)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return // 源无落盘文件（从未写盘），零异常
        throw err
      }
    },

    async dropHistory(sessionId) {
      clearTimer(sessionId)
      dirty.delete(sessionId)
      sessions.delete(sessionId)
      loads.delete(sessionId)
      try {
        await rm(fileFor(sessionId), { force: true })
      } catch (error) {
        console.warn(`[history] 删除会话 ${sessionId} 的历史文件失败:`, error)
      }
    },

    async flushAll() {
      const writes: Promise<void>[] = []
      for (const [sessionId] of timers) {
        clearTimer(sessionId)
        writes.push(writeSession(sessionId))
      }
      // 冲刷后封笔：此后 recordVisit 不再合并/安排任何写盘（退出链语义，照 persistence）
      sealed = true
      await Promise.all(writes)
    },

    onEntryChanged(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    }
  }
}
