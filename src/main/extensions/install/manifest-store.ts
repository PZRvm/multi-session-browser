import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
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
}

export type InstallState = 'ready' | 'partial' | 'failed' | 'not-loaded'

export const EMPTY_MANIFEST: GlobalManifest = { version: 1, generation: 1, installs: [] }

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
    sha256: r.sha256 as string,
    source: {
      kind: src.kind as InstallSourceKind,
      ...(typeof src.origin === 'string' ? { origin: src.origin } : {})
    },
    generation: r.generation as number,
    partitions
  }
}

/** 清单整体校验：version/generation/记录去重 */
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
  return { version: 1, generation: m.generation as number, installs }
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
    throw new Error(`插件清单损坏，拒绝加载：${file}（${String(error)}）`)
  }
}

async function persistAtomic(file: string, manifest: GlobalManifest): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const tmp = join(dirname(file), `.installed-${Date.now()}.json`)
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
        const next: GlobalManifest = {
          version: 1,
          generation,
          installs: [...installs, record]
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
        if (!current.installs.some((v) => v.id === id)) return false
        const next: GlobalManifest = {
          ...current,
          installs: current.installs.filter((v) => v.id !== id)
        }
        validateManifest(next)
        await persistAtomic(file, next)
        return true
      })
  }
}
