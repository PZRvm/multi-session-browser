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
// 立即可被建议），落盘走 500ms trailing 去抖 + fs-utils 原子写（与 store.ts 共用
// 单一实现），退出链 flushAll 冲刷全部待写并封笔（照 persistence.ts sealed 模式）。

import { copyFile, readFile, rm } from 'fs/promises'
import { join } from 'path'
import { isRecord } from '../../shared/guards'
import {
  HISTORY_MAX_ENTRIES,
  HISTORY_SCHEMA_VERSION,
  HISTORY_URL_MAX,
  type HistoryChangedPayload,
  type HistoryEntry
} from '../../shared/history'
import { SESSION_ID_RE } from '../../shared/sessions'
import { atomicWriteJson } from '../fs-utils'
import { t } from '../i18n'

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
  /**
   * 批量导入（Chrome 历史导入专用）：合并规则与 parseStored 同源（同 url 计数取大、
   * 时间取新、title/favicon 保留非空新值），入参先过 HISTORY_URL_MAX 过滤，超上限
   * 淘汰最旧后去抖落盘；不逐条推送（导入完成后由 renderer 重拉镜像，防推送风暴）。
   * 返回 added = 目标侧原无该 url 的条数、merged = 已存在并走合并的条数
   */
  importEntries(
    sessionId: string,
    entries: HistoryEntry[]
  ): Promise<{ added: number; merged: number }>
  /** 该会话全量历史（数组元素为浅拷贝，防调用方污染内存条目）；首触懒加载落盘文件 */
  getEntries(sessionId: string): Promise<HistoryEntry[]>
  /** 克隆会话携带历史：先冲刷源会话待写，再复制落盘文件与内存条目到目标 */
  cloneHistory(srcId: string, dstId: string): Promise<void>
  /** 删除会话清史：删落盘文件 + 清内存/去抖定时器（deleteBatch 级联经 destroySession 覆盖） */
  dropHistory(sessionId: string): Promise<void>
  /** 退出前冲刷全部待写并封笔（此后 recordVisit no-op）；返回在途写盘的汇合 promise */
  flushAll(): Promise<void>
  /** 订阅条目变化（内存合并后即触发，供 ipc.ts 定向推送）；返回退订函数 */
  onEntryChanged(cb: HistoryEntryListener): () => void
}

/** 落盘去抖（trailing）：导航与标题事件密集，写盘前先静默一段时间（与 persistence 同值） */
const WRITE_DEBOUNCE_MS = 500

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
    // 文件名安全与会话 id 字符集同源（L2 定案）：SESSION_ID_RE 单源保证 id 只含
    // [a-z0-9-]（无 '.' 与 '/'，封死 '..' 路径逃逸）；registry 侧 partitionFor 用
    // 同一正则把守，非法 id 到不了本模块
    if (!SESSION_ID_RE.test(sessionId)) {
      throw new Error(t('errors.historyPathBlocked', { id: sessionId }))
    }
    return join(deps.historyDir(), `${sessionId}.json`)
  }

  /**
   * 单会话读盘（坏数据容错口径对齐 store.ts：根节点坏 → 回退空史并告警；元素坏 →
   * 剔除并告警）。返回内存条目与「读盘收敛」标志，由 ensureLoaded 在回填判据通过后
   * 落位——不在本函数内直接写 sessions，防 dropHistory 并发清场后被陈旧读盘结果复活
   */
  async function loadSession(
    sessionId: string
  ): Promise<{ map: Map<string, HistoryEntry>; converged: boolean }> {
    let raw: string
    const target = fileFor(sessionId)
    try {
      raw = await readFile(target, 'utf-8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { map: new Map(), converged: false } // 首触尚无落盘文件，属正常
      }
      console.warn(`[history] 读取会话 ${sessionId} 的历史文件失败，已回退空史:`, err)
      return { map: new Map(), converged: false }
    }
    const { entries, dropped } = parseStored(sessionId, raw)
    const map = new Map<string, HistoryEntry>()
    for (const entry of entries) map.set(entry.url, entry)
    return { map, converged: dropped }
  }

  /**
   * 解析落盘内容。dropped = 读盘侧发生过剔除（坏元素/重复 url/超上限裁剪，操作只减
   * 不增，条数变少即成立）——内存已是收敛结果而磁盘仍滞后（L6）：由调用方安排一次
   * 收敛写盘，不等到下次自然采集
   */
  function parseStored(
    sessionId: string,
    raw: string
  ): { entries: HistoryEntry[]; dropped: boolean } {
    let data: unknown
    try {
      data = JSON.parse(raw)
    } catch {
      console.warn(`[history] 会话 ${sessionId} 的历史不是合法 JSON，已回退空史`)
      return { entries: [], dropped: false } // 坏 JSON 回退空史不视为「剔除」（磁盘无有效内容可收敛）
    }
    if (
      !isRecord(data) ||
      data.version !== HISTORY_SCHEMA_VERSION ||
      !Array.isArray(data.entries)
    ) {
      console.warn(`[history] 会话 ${sessionId} 的历史文件结构不符（version/entries），已回退空史`)
      return { entries: [], dropped: false }
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
    const entries = trimToLimit([...byUrl.values()])
    return { entries, dropped: entries.length < data.entries.length }
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
      const promise = loadSession(sessionId).then(({ map, converged }) => {
        // 回填判据（L4 复活窗口修复）：读盘期间会话已被 dropHistory 清场（loads 键
        // 不再指向本次 promise）即弃置读盘结果，防陈旧条目复活已删会话的内存态
        if (loads.get(sessionId) !== promise) return
        sessions.set(sessionId, map)
        // 落盘滞后收敛（L6）：读盘剔除过坏元素/重复/超限条目时安排一次写盘，
        // 把磁盘拉平到内存口径，不等下次自然采集
        if (converged) scheduleWrite(sessionId)
      })
      pending = promise
      loads.set(sessionId, pending)
    }
    return pending
  }

  /** 取内存条目快照写盘（原子写经 fs-utils 单源；失败如实告警，dirty 保留待重试） */
  function writeSession(sessionId: string): Promise<void> {
    const map = sessions.get(sessionId)
    if (!map) return Promise.resolve() // 会话已清（dropHistory 竞态），静默跳过
    return atomicWriteJson(fileFor(sessionId), {
      version: HISTORY_SCHEMA_VERSION,
      entries: [...map.values()]
    })
      .then(() => {
        dirty.delete(sessionId)
      })
      .catch((error: unknown) => {
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
      const pending = ensureLoaded(sessionId)
      void pending.then(() => {
        if (sealed) return
        // 与回填同判据：读盘/合并链期间会话已被 dropHistory 清场即弃置本次在途事实
        if (loads.get(sessionId) !== pending) return
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

    async importEntries(sessionId, entries) {
      // 超长 URL 先行丢弃（与 recordVisit 同口径：不截断——截断后的 URL 无法再导航，
      // 入史即坏数据）；其余坏形不在此处校验（入参来自 dry-run 暂存的已清洗条目）
      const filtered = entries.filter((entry) => {
        if (entry.url.length <= HISTORY_URL_MAX) return true
        console.warn(
          `[history] 导入会话 ${sessionId} 的 URL 长度 ${entry.url.length} 超上限 ${HISTORY_URL_MAX}，丢弃`
        )
        return false
      })
      // 沿 ensureLoaded 链排队（防读盘竞态，照 recordVisit 先例），批内一次性合并只安排一次写盘
      const pending = ensureLoaded(sessionId)
      return pending.then(() => {
        if (sealed) return { added: 0, merged: 0 }
        // 与回填同判据：读盘/合并链期间会话已被 dropHistory 清场即弃置本次导入（结果如实为 0）
        if (loads.get(sessionId) !== pending) return { added: 0, merged: 0 }
        let map = sessions.get(sessionId)
        if (!map) {
          map = new Map()
          sessions.set(sessionId, map)
        }
        let added = 0
        let merged = 0
        let changed = false
        const addedUrls = new Set<string>()
        const mergedUrls = new Set<string>()
        for (const entry of filtered) {
          const prev = map.get(entry.url)
          if (prev === undefined) {
            map.set(entry.url, { ...entry })
            added += 1
            addedUrls.add(entry.url)
            changed = true
          } else {
            // 合并规则与 parseStored 同源：计数取大、时间取新、title/favicon 保留非空新值
            if (entry.visitCount > prev.visitCount) {
              prev.visitCount = entry.visitCount
              changed = true
            }
            if (entry.lastVisitedAt > prev.lastVisitedAt) {
              prev.lastVisitedAt = entry.lastVisitedAt
              changed = true
            }
            if (entry.title !== '' && entry.title !== prev.title) {
              prev.title = entry.title
              changed = true
            }
            if (entry.faviconUrl !== null && entry.faviconUrl !== prev.faviconUrl) {
              prev.faviconUrl = entry.faviconUrl
              changed = true
            }
            merged += 1
            mergedUrls.add(entry.url)
          }
        }
        // 超上限淘汰 lastVisitedAt 最旧（复用既有淘汰口径；仅新增才可能超限）。
        // 淘汰后再计数（审查低-6）：added/merged 只报实际留存的条目，与地址栏可见性一致
        if (map.size > HISTORY_MAX_ENTRIES) {
          const kept = new Map<string, HistoryEntry>()
          for (const entry of trimToLimit([...map.values()])) kept.set(entry.url, entry)
          sessions.set(sessionId, kept)
          added = 0
          merged = 0
          for (const url of addedUrls) if (kept.has(url)) added += 1
          for (const url of mergedUrls) if (kept.has(url)) merged += 1
        }
        // 无实际变化（如重复导入同一份 Chrome 数据）不安排写盘，避免无谓落盘
        if (changed) scheduleWrite(sessionId)
        // 不逐条推送 onEntryChanged（防 ≤2000 条推送风暴）：导入完成后由 renderer 重拉镜像
        return { added, merged }
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
