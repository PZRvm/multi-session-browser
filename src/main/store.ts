// 会话快照持久化（主进程唯一写入口）。
// 采用退路 A 实现：electron-store@11 为纯 ESM 包，与主进程 CJS 输出不兼容
// （冒烟结论见 notes/process.md「执行决策记录」），故手写 fs/promises JSON 读写，
// 落盘文件为 userData/sessions.json。对外接口保持与 electron-store 方案一致，
// 后续步骤（IPC handlers）不感知实现差异。

import { app } from 'electron'
import { mkdir, readFile, rename, unlink, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import type { SessionsSnapshot, StoredSession } from '../shared/sessions'

/** 当前落盘 schema 版本；读到不认识的版本一律按坏数据回退 */
const SNAPSHOT_VERSION = 1

/** 回退用的空快照（每次新建，避免共享可变数组） */
function emptySnapshot(): SessionsSnapshot {
  return { version: SNAPSHOT_VERSION, sessions: [], activeId: null }
}

/** 落盘文件路径：userData/sessions.json */
function getStorePath(): string {
  return join(app.getPath('userData'), 'sessions.json')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 元素级校验：四个字段齐全且类型正确（多余字段容忍，读取时剔除） */
function isStoredSession(value: unknown): value is StoredSession {
  if (!isRecord(value)) return false
  return (
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.name === 'string' &&
    typeof value.note === 'string' &&
    typeof value.pageTitle === 'string'
  )
}

/** 坏数据内容摘要（截断，避免控制台刷屏）；sessions.ts 的 handler 失败日志也复用 */
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

/**
 * 加载会话快照。任何形式的坏数据（非法 JSON、缺字段、类型错、version 不认识、
 * sessions 非数组、元素缺字段、activeId 类型错）一律回退空快照并 console.warn
 * 原始坏数据摘要；activeId 指向不存在的会话时仅置 null，不整包丢弃。
 */
export async function loadSnapshot(): Promise<SessionsSnapshot> {
  let raw: string
  try {
    raw = await readFile(getStorePath(), 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      // 首次启动尚无落盘文件，属正常情况，不告警
      return emptySnapshot()
    }
    console.warn(`[store] 读取会话快照失败，已回退空快照:`, err)
    return emptySnapshot()
  }
  return parseSnapshot(raw)
}

/** 写入会话快照（先写唯一临时文件再原子改名，避免半截写入或并发写交错损坏落盘数据） */
export async function saveSnapshot(snapshot: SessionsSnapshot): Promise<void> {
  const target = getStorePath()
  // 临时文件名带时间戳 + 随机后缀：并发写各用各的 tmp，也不会与崩溃残留的旧 tmp 交错覆盖
  const tmp = `${target}.${Date.now()}-${Math.random().toString(36).slice(2, 8)}.tmp`
  await mkdir(dirname(target), { recursive: true })
  try {
    await writeFile(tmp, JSON.stringify(snapshot, null, 2), 'utf-8')
    await rename(tmp, target)
  } catch (err) {
    // 写失败时尽力清理本次临时文件（唯一文件名不会被下次保存覆盖，不清理会残留堆积）
    await unlink(tmp).catch(() => undefined)
    throw err
  }
}

// 读-改-写串行队列：同一时刻只允许一个 mutate 执行（读盘、改内存、写盘全程互斥），
// 消除「两个 handler 各自 load 到旧快照、再各自 save」导致的后写覆盖先写。
let mutateQueue: Promise<unknown> = Promise.resolve()

/**
 * 串行执行一次「loadSnapshot → fn 修改 → saveSnapshot」临界区。
 * 会话快照的一切读-改-写必须经此入口，禁止在入口之外自行组合
 * loadSnapshot + saveSnapshot，否则互斥失效。fn 内对快照的就地修改
 * 会在互斥期间写穿落盘；fn 的返回值原样透传给调用方。
 */
export function mutateSnapshot<T>(fn: (snapshot: SessionsSnapshot) => T | Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    const snapshot = await loadSnapshot()
    const result = await fn(snapshot)
    await saveSnapshot(snapshot)
    return result
  }
  // 前序任务无论成败本任务都要入队执行；队列自身吞掉错误以免产生
  // 未处理的 promise 拒绝，真实错误经 result 原样传给调用方
  const result = mutateQueue.then(run, run)
  mutateQueue = result.catch(() => undefined)
  return result
}

/**
 * 解析并校验快照。对抗性坏数据矩阵（步骤 7 已逐项核对，2026-09-10）：
 * - 非法 JSON（截断 / BOM / 二进制垃圾 / 空串）：JSON.parse 抛错 → 回退空快照并告警
 * - 根节点为数组 / 字符串 / null 等非普通对象：回退空快照（深嵌套数组即使解析成功也在此被拒）
 * - version 缺失或非 1（含 0、2、字符串 "1"）：回退空快照
 * - sessions 为对象 / 字符串等非数组，或元素为 null / 嵌套数组 / 缺字段 / 字段类型错：回退空快照
 * - 元素含多余字段：容忍，但重建时只保留四个契约字段（注入的未知字段不会被回存落盘）
 * - sessions 内重复 id：保留首个、剔除后续重复项并告警
 * - activeId 为数字等非 string/null：回退空快照；为空串或悬空 id：按悬空处理，置 null 保留列表
 */
function parseSnapshot(raw: string): SessionsSnapshot {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    console.warn(`[store] 会话快照不是合法 JSON，已回退空快照。原始内容摘要: ${summarize(raw)}`)
    return emptySnapshot()
  }

  // 关键字段任一损坏 → 整体回退空快照
  const fallback = (reason: string): void => {
    console.warn(
      `[store] 会话快照校验失败（${reason}），已回退空快照。原始内容摘要: ${summarize(data)}`
    )
  }

  if (!isRecord(data)) {
    fallback('根节点不是对象')
    return emptySnapshot()
  }
  if (data.version !== SNAPSHOT_VERSION) {
    fallback(`version 不认识: ${JSON.stringify(data.version)}`)
    return emptySnapshot()
  }
  if (!Array.isArray(data.sessions)) {
    fallback('sessions 不是数组')
    return emptySnapshot()
  }
  if (!data.sessions.every(isStoredSession)) {
    fallback('sessions 中存在缺字段或类型错的元素')
    return emptySnapshot()
  }
  if (data.activeId !== null && typeof data.activeId !== 'string') {
    fallback('activeId 类型错（应为 string 或 null）')
    return emptySnapshot()
  }

  // 只保留契约字段，剔除可能被注入的多余字段，防止落盘文件原样保留未知字段。
  // lastUrl 容忍读取（v1 落盘无此字段，运行时为 undefined 补 ''）——
  // 阶段 4 步骤 5 落地正式的 v1→v2 迁移与校验，此前本行为编译占位
  const sessions: StoredSession[] = data.sessions.map((item) => ({
    id: item.id,
    name: item.name,
    note: item.note,
    pageTitle: item.pageTitle,
    lastUrl: typeof item.lastUrl === 'string' ? item.lastUrl : ''
  }))

  // 重复 id 去重：保留首个、剔除后续重复项，防止重复条目进入列表与 id 索引
  const seenIds = new Set<string>()
  const duplicateIds = new Set<string>()
  const uniqueSessions: StoredSession[] = []
  for (const item of sessions) {
    if (seenIds.has(item.id)) {
      duplicateIds.add(item.id)
      continue
    }
    seenIds.add(item.id)
    uniqueSessions.push(item)
  }
  if (duplicateIds.size > 0) {
    const removed = sessions.length - uniqueSessions.length
    const dupList = summarize([...duplicateIds])
    console.warn(`[store] sessions 存在重复 id（已保留首个，剔除 ${removed} 个）: ${dupList}`)
  }

  // activeId 悬空（含空串，id 均非空串故空串必不匹配）：仅置 null 并告警，会话列表本身保留
  let activeId: string | null = data.activeId
  if (activeId !== null && !uniqueSessions.some((s) => s.id === activeId)) {
    console.warn(
      `[store] activeId "${activeId}" 不指向任何会话，已重置为 null。原始内容摘要: ${summarize(data)}`
    )
    activeId = null
  }

  return { version: SNAPSHOT_VERSION, sessions: uniqueSessions, activeId }
}
