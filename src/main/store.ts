// 会话快照持久化（主进程唯一写入口）。
// 采用退路 A 实现：electron-store@11 为纯 ESM 包，与主进程 CJS 输出不兼容
// （冒烟结论见 notes/process.md「执行决策记录」），故手写 fs/promises JSON 读写，
// 落盘文件为 userData/sessions.json。对外接口保持与 electron-store 方案一致，
// 后续步骤（IPC handlers）不感知实现差异。

import { app } from 'electron'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { isRecord } from '../shared/guards'
import type {
  SessionsSnapshot,
  StoredSession,
  StoredTab,
  StoredWorkspace
} from '../shared/sessions'
import { cloneTabs, WORKSPACE_VIEW_ALL } from '../shared/sessions'
import { atomicWriteJson } from './fs-utils'

/** 当前落盘 schema 版本（v3 增 tabs/activeTabIndex；v4 增工作区三件）；读到不认识的版本一律按坏数据回退，v1—v3 读取时迁移 */
const SNAPSHOT_VERSION = 4

/** 回退用的空快照（每次新建，避免共享可变数组） */
function emptySnapshot(): SessionsSnapshot {
  return {
    version: SNAPSHOT_VERSION,
    sessions: [],
    activeId: null,
    workspaces: [],
    activeWorkspaceId: WORKSPACE_VIEW_ALL
  }
}

/** 落盘文件路径：userData/sessions.json */
function getStorePath(): string {
  return join(app.getPath('userData'), 'sessions.json')
}

/**
 * 元素级校验：id/name/note/pageTitle 四字段齐全且类型正确（多余字段容忍，读取时剔除）。
 * lastUrl/tabs/activeTabIndex 不参与此校验：老版本落盘元素可能缺这些字段，缺失或类型错
 * 一律在重建处按迁移/回退规则处理（lastUrl 补空串、tabs 由 lastUrl 派生、激活位钳制 0），
 * 不作坏数据回退（写入端恒出合法值，类型错只可能来自外力篡改，宽容处理）
 */
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

/** 单个落盘 tab 的元素级校验：普通对象且 url 为 string */
function isStoredTab(value: unknown): value is { url: string } {
  return isRecord(value) && typeof value.url === 'string'
}

/**
 * 从元素重建 v3 的 tabs/activeTabIndex（迁移与容错的单一出口）。
 * 形参类型是收窄后的 StoredSession，但 v1/v2 落盘元素运行时没有 tabs/activeTabIndex
 * 字段——一切读取都先过 Array.isArray / typeof 守卫，不信任类型声明
 * - v1/v2 元素（无 tabs 字段）：按 lastUrl 派生单元素列表、激活位 0（schema 迁移，不告警）
 * - v3 元素 tabs 类型错（非数组/元素非对象/url 非 string）：回退 lastUrl 派生并告警
 * - 激活位非整数/负数：钳制 0 并告警；越上界（含 tabs 回退后越界）：钳到有效末位并告警
 */
function restoreTabs(
  item: StoredSession,
  version: number
): { tabs: StoredTab[]; activeTabIndex: number } {
  const warn = (reason: string): void => {
    console.warn(`[store] 会话 ${item.id} 的 ${reason}，已按容错规则重建`)
  }
  const derivedFromLastUrl = (): StoredTab[] => {
    const lastUrl = item.lastUrl || ''
    return lastUrl ? [{ url: lastUrl }] : []
  }
  let tabs: StoredTab[] | null = null
  if (version >= 3 && Array.isArray(item.tabs)) {
    if (item.tabs.every(isStoredTab)) {
      tabs = cloneTabs(item.tabs)
    } else {
      warn('tabs 存在类型错元素（非对象或 url 非 string）')
    }
  } else if (version >= 3) {
    warn('tabs 不是数组')
  }
  // L5：tabs 为合法空数组但 lastUrl 非空，是应用写侧不可能产出的不一致组合
  // （激活会话恒 ≥1 Tab，lastUrl 与 tabs[activeTabIndex] 同源），只可能来自手工
  // 编辑/损坏——按 v2 同口径回退 lastUrl 派生并告警，不让恢复集静默丢失
  if (tabs !== null && tabs.length === 0 && item.lastUrl) {
    warn('tabs 为空但 lastUrl 非空（不一致组合）')
    tabs = null
  }
  if (tabs === null) tabs = derivedFromLastUrl()
  let activeTabIndex = 0
  if (typeof item.activeTabIndex === 'number' && Number.isInteger(item.activeTabIndex)) {
    activeTabIndex = item.activeTabIndex
  } else if (item.activeTabIndex !== undefined) {
    warn('activeTabIndex 非整数')
  }
  if (activeTabIndex < 0) {
    warn('activeTabIndex 为负数')
    activeTabIndex = 0
  }
  if (activeTabIndex >= tabs.length) {
    if (tabs.length > 0) {
      warn(`activeTabIndex ${activeTabIndex} 越上界（tabs 共 ${tabs.length} 项）`)
      activeTabIndex = tabs.length - 1
    } else {
      activeTabIndex = 0
    }
  }
  return { tabs, activeTabIndex }
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
 * v1 落盘文件兼容读取：元素缺 lastUrl 时按 '' 迁移，其余字段照常校验。
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

/**
 * 写入会话快照（原子写经 fs-utils 单源——唯一临时文件 + 改名，失败清理临时文件后
 * 原样上抛；机制细节见 fs-utils 头注释）
 */
export async function saveSnapshot(snapshot: SessionsSnapshot): Promise<void> {
  await atomicWriteJson(getStorePath(), snapshot)
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
 * 解析并校验快照。对抗性坏数据矩阵（阶段 1 步骤 7 逐项核对 + 阶段 6 扩写，2026-09-12；
 * v4 工作区三件扩写，2026-09-15）：
 * - 非法 JSON（截断 / BOM / 二进制垃圾 / 空串）：JSON.parse 抛错 → 回退空快照并告警
 * - 根节点为数组 / 字符串 / null 等非普通对象：回退空快照（深嵌套数组即使解析成功也在此被拒）
 * - version 缺失或非 1/2/3/4（含 0、5、字符串 "1"）：回退空快照
 *   （v1/v2 按 lastUrl 派生单元素 tabs、v1—v3 按默认值迁工作区，写盘恒出 v4）
 * - sessions 为对象 / 字符串等非数组，或元素为 null / 嵌套数组 / 缺四硬字段 / 硬字段类型错：
 *   回退空快照（lastUrl/tabs/activeTabIndex/workspaceId 例外：缺失或类型错按各自迁移/回退
 *   规则处理，不回退）
 * - 元素含多余字段：容忍，但重建时只保留契约字段（注入的未知字段不会被回存落盘）
 * - v3+ 元素 tabs 非数组 / 元素非对象 / url 非 string：回退 lastUrl 派生列表并告警；
 *   activeTabIndex 非整数 / 负数 / 越上界：钳制到有效范围（空列表恒 0）并告警
 * - v4 元素 workspaceId 非法（非 string/null）或悬空（不指向任何工作区）：置 null 并告警，
 *   会话保留（v1—v3 元素无此字段，静默迁移 null）
 * - sessions 内重复 id：保留首个、剔除后续重复项并告警
 * - workspaces 缺失/非数组/元素缺 id 或 name 硬字段：回退空工作区并告警（**不回退会话**——
 *   工作区数据损坏不得丢会话列表，PRD 4.8）；元素 lastActiveSessionId 非法或悬空（不指向
 *   任何会话/不属于该工作区）：置 null 并告警；重复 id：保留首个并告警
 * - activeWorkspaceId 非字符串、悬空（既非 'all' 也不指向任何工作区）：回退 'all' 并告警
 *   （v1—v3 无此字段，静默迁移 'all'）
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
  // v1（无 lastUrl）/v2（无 tabs）/v3（无工作区三件）与当前 v4 均接受，其余版本按坏数据回退
  if (
    data.version !== 1 &&
    data.version !== 2 &&
    data.version !== 3 &&
    data.version !== SNAPSHOT_VERSION
  ) {
    fallback(`version 不认识: ${JSON.stringify(data.version)}`)
    return emptySnapshot()
  }
  const version = data.version
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
  // lastUrl 迁移（v1 → v2+）：老落盘元素无此字段，缺失或类型错一律补空串；
  // tabs/activeTabIndex 重建（v1/v2 迁移 + v3 容错）统一走 restoreTabs 单一出口；
  // workspaceId 原始值先并行带出，悬空净化在 workspaces 解析后统一处理（下方）
  const rawWorkspaceIds: unknown[] = []
  const sessions: StoredSession[] = data.sessions.map((item) => {
    rawWorkspaceIds.push(item.workspaceId)
    return {
      id: item.id,
      name: item.name,
      note: item.note,
      pageTitle: item.pageTitle,
      lastUrl: typeof item.lastUrl === 'string' ? item.lastUrl : '',
      workspaceId: null,
      ...restoreTabs(item, version)
    }
  })

  // 工作区解析（v4 新增）：整体容错——缺失（v1—v3 迁移静默 / v4 缺失告警）、非数组、
  // 元素缺 id/name 硬字段，一律回退空工作区并告警，**绝不回退会话列表**（工作区
  // 数据损坏不得丢会话，PRD 4.8「删除工作区必留会话」的同族原则）；元素多余字段
  // 剔除，lastActiveSessionId 宽容（类型错 → null 告警，悬空净化在后）
  const isStoredWorkspace = (
    value: unknown
  ): value is { id: string; name: string; lastActiveSessionId: unknown } =>
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.name === 'string'

  let workspaces: StoredWorkspace[] = []
  if (Array.isArray(data.workspaces)) {
    if (data.workspaces.every(isStoredWorkspace)) {
      workspaces = data.workspaces.map((w) => {
        if (
          w.lastActiveSessionId !== undefined &&
          w.lastActiveSessionId !== null &&
          typeof w.lastActiveSessionId !== 'string'
        ) {
          console.warn(
            `[store] 工作区 ${w.id} 的 lastActiveSessionId 类型错，已按无记忆处理: ${summarize(w.lastActiveSessionId)}`
          )
        }
        return {
          id: w.id,
          name: w.name,
          lastActiveSessionId:
            typeof w.lastActiveSessionId === 'string' ? w.lastActiveSessionId : null
        }
      })
    } else {
      console.warn(
        `[store] workspaces 存在缺字段或类型错的元素，已回退空工作区（会话列表保留）。原始内容摘要: ${summarize(data.workspaces)}`
      )
    }
  } else if (data.workspaces !== undefined || version >= 4) {
    console.warn(
      `[store] workspaces 不是数组，已回退空工作区（会话列表保留）。原始内容摘要: ${summarize(data.workspaces)}`
    )
  }

  // 工作区重复 id 去重：保留首个、剔除后续（镜像 sessions 去重规则）
  const seenWsIds = new Set<string>()
  const uniqueWorkspaces: StoredWorkspace[] = []
  for (const ws of workspaces) {
    if (seenWsIds.has(ws.id)) {
      console.warn(`[store] workspaces 存在重复 id "${ws.id}"（已保留首个，剔除后续）`)
      continue
    }
    seenWsIds.add(ws.id)
    uniqueWorkspaces.push(ws)
  }

  // 会话 workspaceId 净化：类型错或悬空（不指向任何工作区）→ 置 null 并告警，会话保留；
  // v1—v3 元素无此字段（rawWorkspaceIds 全 undefined）按迁移静默处理，v4 缺字段告警
  const sessionCount = sessions.length
  for (let i = 0; i < sessionCount; i++) {
    const raw = rawWorkspaceIds[i]
    if (raw === undefined) {
      if (version >= 4) {
        console.warn(`[store] 会话 ${sessions[i].id} 缺 workspaceId，已按未分组处理`)
      }
      continue
    }
    if (raw === null) continue
    if (typeof raw !== 'string' || !seenWsIds.has(raw)) {
      console.warn(
        `[store] 会话 ${sessions[i].id} 的 workspaceId 非法或悬空（${summarize(raw)}），已按未分组处理`
      )
      continue
    }
    sessions[i].workspaceId = raw
  }

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

  // lastActiveSessionId 净化：悬空（不指向任何会话，或不属于该工作区）→ 置 null 并告警
  // （记忆只随真实激活更新，坏记忆不阻断恢复）
  const sessionById = new Map(uniqueSessions.map((s) => [s.id, s]))
  for (const ws of uniqueWorkspaces) {
    const ref = ws.lastActiveSessionId
    if (ref === null) continue
    const target = sessionById.get(ref)
    if (!target || target.workspaceId !== ws.id) {
      console.warn(
        `[store] 工作区 ${ws.id} 的 lastActiveSessionId "${ref}" 悬空或不属于该工作区，已按无记忆处理`
      )
      ws.lastActiveSessionId = null
    }
  }

  // activeWorkspaceId 解析：'all' 或指向已知工作区；非法/悬空回退 'all' 并告警
  // （v1—v3 无此字段，静默迁移 'all'；v4 缺字段告警）
  let activeWorkspaceId = WORKSPACE_VIEW_ALL
  if (data.activeWorkspaceId !== undefined) {
    const rawView = data.activeWorkspaceId
    if (typeof rawView === 'string' && (rawView === WORKSPACE_VIEW_ALL || seenWsIds.has(rawView))) {
      activeWorkspaceId = rawView
    } else {
      console.warn(`[store] activeWorkspaceId 非法或悬空（${summarize(rawView)}），已回退全部视野`)
    }
  } else if (version >= 4) {
    console.warn('[store] 快照缺 activeWorkspaceId，已回退全部视野')
  }

  return {
    version: SNAPSHOT_VERSION,
    sessions: uniqueSessions,
    activeId,
    workspaces: uniqueWorkspaces,
    activeWorkspaceId
  }
}
