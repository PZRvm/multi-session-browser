import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'

/**
 * 插件安装全局清单（协议v1 安装记录 schema 的生产实现）。
 * 文件：userData/extensions/installed.json；schema 对齐前置 schema-v1.mjs checkInstallRecord。
 * 损坏清单拒绝加载并如实报错；读写经进程内串行锁，落盘走临时文件原子替换。
 */

export type InstallSourceKind = 'crx' | 'store' | 'unpacked'

export interface InstallPartitionResult {
  partition: string
  ok: boolean
  /** 与安装记录 generation 一致（协议v1：分区结果随安装代次） */
  generation: number
}

export interface InstallRecord {
  id: string
  version: string
  /** 展示名（manifest.name，协议v1 附加可选字段，缺省回退 id） */
  name?: string
  sha256: string
  source: { kind: InstallSourceKind; origin?: string }
  generation: number
  partitions: InstallPartitionResult[]
}

export interface GlobalManifest {
  version: 1
  generation: number
  installs: InstallRecord[]
  /**
   * 已固定到工具栏的扩展 ID 全序（顺序即工具栏显示顺序；2026-11-13 增量可选字段，
   * 旧清单缺省视为空数组，向后兼容不升协议版本）。与 installs 同文件同锁同原子写，
   * 卸载时随 removeInstall 一并清理
   */
  pins?: string[]
}

export type InstallState = 'ready' | 'partial' | 'failed' | 'not-loaded'

export const EMPTY_MANIFEST: GlobalManifest = { version: 1, generation: 1, installs: [] }

/** 扩展 ID 形态校验（与安装记录同规：32 位小写字母表 [a-p]） */
export function isValidExtensionId(id: unknown): id is string {
  return typeof id === 'string' && /^[a-p]{32}$/.test(id)
}

function demand(value: unknown, reason: string): asserts value {
  if (!value) throw new Error(`INVALID_MANIFEST: ${reason}`)
}

/** ready/partial/failed/not-loaded 分类（协议v1 contracts.classifyInstall 同源） */
export function classifyInstall(results: InstallPartitionResult[]): InstallState {
  if (!Array.isArray(results) || results.length === 0) return 'not-loaded'
  const ok = results.filter((v) => v.ok === true).length
  return ok === results.length ? 'ready' : ok === 0 ? 'failed' : 'partial'
}

/** 安装记录校验（协议v1 checkInstallRecord 生产镜像，损坏即抛错） */
export function validateInstallRecord(record: unknown): InstallRecord {
  demand(record && typeof record === 'object', '安装记录非对象')
  const r = record as Record<string, unknown>
  demand(typeof r.id === 'string' && /^[a-p]{32}$/.test(r.id), '扩展ID非法')
  demand(typeof r.version === 'string' && /^\d+(\.\d+){0,3}$/.test(r.version), '版本非法')
  demand(
    r.name === undefined ||
      (typeof r.name === 'string' && r.name.length > 0 && r.name.length <= 100),
    '展示名非法'
  )
  demand(typeof r.sha256 === 'string' && /^[a-f0-9]{64}$/.test(r.sha256), '摘要非法')
  const src = (r.source ?? {}) as { kind?: unknown; origin?: unknown }
  demand(
    typeof src.kind === 'string' &&
      (['crx', 'store', 'unpacked'] as const).includes(src.kind as InstallSourceKind),
    '来源非法'
  )
  demand(Number.isSafeInteger(r.generation) && (r.generation as number) > 0, '代次非法')
  demand(Array.isArray(r.partitions) && r.partitions.length <= 1024, '分区结果非法')
  const seen = new Set<string>()
  const partitions: InstallPartitionResult[] = []
  for (const row of r.partitions as unknown[]) {
    demand(row && typeof row === 'object', '分区结果非对象')
    const p = row as Record<string, unknown>
    demand(
      typeof p.partition === 'string' && p.partition.length > 0 && p.partition.length <= 256,
      '分区名非法'
    )
    demand(!seen.has(p.partition), '分区结果重复')
    seen.add(p.partition as string)
    demand(typeof p.ok === 'boolean', '分区ok非法')
    demand(p.generation === r.generation, '分区代次不一致')
    partitions.push({
      partition: p.partition as string,
      ok: p.ok as boolean,
      generation: p.generation as number
    })
  }
  return {
    id: r.id as string,
    version: r.version as string,
    ...(typeof r.name === 'string' && r.name.length > 0 ? { name: r.name as string } : {}),
    sha256: r.sha256 as string,
    source: {
      kind: src.kind as InstallSourceKind,
      ...(typeof src.origin === 'string' ? { origin: src.origin } : {})
    },
    generation: r.generation as number,
    partitions
  }
}

/** 清单整体校验：version/generation/记录去重/pins 增量字段 */
export function validateManifest(value: unknown): GlobalManifest {
  demand(value && typeof value === 'object', '清单非对象')
  const m = value as Record<string, unknown>
  demand(m.version === 1, '清单版本非法')
  demand(Number.isSafeInteger(m.generation) && (m.generation as number) > 0, '清单代次非法')
  demand(Array.isArray(m.installs), '清单安装列表非法')
  const ids = new Set<string>()
  const installs = (m.installs as unknown[]).map((v) => {
    const record = validateInstallRecord(v)
    demand(!ids.has(record.id), `安装记录重复：${record.id}`)
    ids.add(record.id)
    return record
  })
  // pins 增量字段（2026-11-13）：缺省视为无 pins 键（返回对象不给 pins，下次写入
  // 自然落为 []）；逐项 ID 形态校验 + 去重
  let pins: string[] | undefined
  if (m.pins !== undefined) {
    demand(Array.isArray(m.pins), 'pins 非法：必须为数组')
    const seen = new Set<string>()
    pins = (m.pins as unknown[]).map((id) => {
      demand(isValidExtensionId(id), `pins 项非法：${String(id)}`)
      demand(!seen.has(id), `pins 重复：${id}`)
      seen.add(id)
      return id
    })
  }
  return { version: 1, generation: m.generation as number, installs, ...(pins ? { pins } : {}) }
}

async function readRaw(file: string): Promise<GlobalManifest> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { ...EMPTY_MANIFEST, installs: [] }
    throw error
  }
  try {
    return validateManifest(JSON.parse(text))
  } catch (error) {
    // 自愈：损坏形态常为两实例写入拼接（Unexpected non-whitespace after }）——
    // 逐段扫描首个语法完整对象，能过 schema 即恢复并原子落盘
    const recovered = recoverManifest(text)
    if (recovered) {
      await backupCorrupt(file, text)
      await persistAtomic(file, recovered)
      return recovered
    }
    // 不可救：备份坏文件供排查，再如实拒绝
    await backupCorrupt(file, text).catch(() => undefined)
    throw new Error(`插件清单损坏，拒绝加载：${file}（${String(error)}）`)
  }
}

/** 字符串感知的平衡花括号扫描，逐段尝试解析并过 schema（两实例拼接损坏的恢复路径） */
function recoverManifest(text: string): GlobalManifest | null {
  let depth = 0
  let inString = false
  let escape = false
  let start = -1
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escape) escape = false
      else if (ch === '\\') escape = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') {
      if (depth === 0) start = i
      depth += 1
    } else if (ch === '}') {
      depth -= 1
      if (depth === 0 && start >= 0) {
        try {
          return validateManifest(JSON.parse(text.slice(start, i + 1)))
        } catch {
          start = -1
        }
      }
    }
  }
  return null
}

/** 损坏文件留档（installed.json.corrupt-<时间戳>），供排查与人工恢复 */
async function backupCorrupt(file: string, text: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  await writeFile(`${file}.corrupt-${Date.now()}`, text)
}

async function persistAtomic(file: string, manifest: GlobalManifest): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const tmp = join(dirname(file), `.installed-${Date.now()}-${randomUUID().slice(0, 8)}.json`)
  await writeFile(tmp, JSON.stringify(manifest, null, 2))
  await rename(tmp, file)
}

export interface ManifestStore {
  /** 读取并校验清单（损坏抛错） */
  read(): Promise<GlobalManifest>
  /** 串行读改写：mutate 返回新清单，落盘前全量再校验 */
  update(
    mutate: (current: GlobalManifest) => GlobalManifest | Promise<GlobalManifest>
  ): Promise<GlobalManifest>
  /** 按 ID 查找安装记录 */
  get(id: string): Promise<InstallRecord | undefined>
  /** 插入或更新安装记录：分配新代次，分区结果随之标记（协议v1 generation 语义） */
  upsertInstall(input: {
    id: string
    version: string
    name?: string
    sha256: string
    source: { kind: InstallSourceKind; origin?: string }
    partitions: Array<{ partition: string; ok: boolean }>
  }): Promise<InstallRecord>
  /** 记录一次分区加载结果：新增或覆盖该分区条目，generation 沿用安装记录代次（幂等） */
  recordPartition(id: string, partition: string, ok: boolean): Promise<InstallRecord | undefined>
  /** 移除安装记录（清单层面）；存在返回 true，不存在返回 false */
  removeInstall(id: string): Promise<boolean>
  /** 覆盖 pins 全序（固定切换/拖拽重排共用底层；入参去重幂等） */
  setPins(ids: string[]): Promise<string[]>
}

export function createManifestStore(file: string): ManifestStore {
  let chain: Promise<unknown> = Promise.resolve()
  function locked<T>(job: () => Promise<T>): Promise<T> {
    const run = chain.then(job, job)
    chain = run.catch(() => undefined)
    return run
  }
  return {
    read: () => locked(() => readRaw(file)),
    update: (mutate) =>
      locked(async () => {
        const next = await mutate(await readRaw(file))
        validateManifest(next)
        await persistAtomic(file, next)
        return next
      }),
    get: (id) => locked(() => readRaw(file)).then((m) => m.installs.find((v) => v.id === id)),
    upsertInstall: (input) =>
      locked(async () => {
        const current = await readRaw(file)
        const generation = current.generation + 1
        const record: InstallRecord = {
          id: input.id,
          version: input.version,
          ...(input.name ? { name: input.name } : {}),
          sha256: input.sha256,
          source: input.source,
          generation,
          partitions: input.partitions.map((v) => ({ ...v, generation }))
        }
        validateInstallRecord(record)
        const installs = current.installs.filter((v) => v.id !== record.id)
        // pins 保留（2026-11-13 修复：重建清单时丢 pins 会让导入/升级后置顶全丢）
        const next: GlobalManifest = {
          version: 1,
          generation,
          installs: [...installs, record],
          ...(current.pins ? { pins: current.pins } : {})
        }
        await persistAtomic(file, next)
        return record
      }),
    recordPartition: (id, partition, ok) =>
      locked(async () => {
        const current = await readRaw(file)
        let updated: InstallRecord | undefined
        const installs = current.installs.map((v) => {
          if (v.id !== id) return v
          const others = v.partitions.filter((p) => p.partition !== partition)
          updated = {
            ...v,
            partitions: [...others, { partition, ok, generation: v.generation }]
          }
          return updated
        })
        if (!updated) return undefined
        const next: GlobalManifest = { ...current, installs }
        validateManifest(next)
        await persistAtomic(file, next)
        return updated
      }),
    removeInstall: (id) =>
      locked(async () => {
        const current = await readRaw(file)
        // 存在性判断：清单里没有「这个 ID」才返回 false（卸载对象不存在）。
        // 注意比较对象是 v.id === id——曾误改为 v.id !== id（存在任一不同 ID 即
        // false），安装数 ≥2 时卸载任何插件都误报 NOT_FOUND（审查清单高危条目）
        if (!current.installs.some((v) => v.id === id)) return false
        const next: GlobalManifest = {
          ...current,
          installs: current.installs.filter((v) => v.id !== id),
          pins: (current.pins ?? []).filter((v) => v !== id)
        }
        validateManifest(next)
        await persistAtomic(file, next)
        return true
      }),
    setPins: (ids) =>
      locked(async () => {
        const current = await readRaw(file)
        // 入参去重幂等；不在此校验 ID 形态（validateManifest 兜底），未安装 ID 由上层过滤
        const pins = ids.filter((v, i) => ids.indexOf(v) === i)
        const next: GlobalManifest = { ...current, pins }
        validateManifest(next)
        await persistAtomic(file, next)
        return pins
      })
  }
}
