// localStorage 记录级合并引擎（Chrome profile → 本应用会话分区）：按 Chromium
// localStorage LevelDB 的记录键格式逐条移植（格式事实与改写先例见
// notes/think-report/20260930130104-导入Chrome浏览数据.md 单元 C，键三类：
// `META:<origin>` / `METAACCESS:<origin>` / `_<origin>\x00\x01<key>`）。
//
// 【前置契约——调用方必须保证，本模块不自检】目标分区全程静默：无任何指向该分区的
// webContents / 活动库写入（装配层经 registry.runImportQuiesced 进入：先收尾活库并
// 拦截切换/克隆/批量/销毁）。Chrome 侧不直接打开原库——`Local Storage` 整目录拷贝到
// 临时区后打开副本（LevelDB 日志回放保证崩溃一致，Chrome 运行中亦可读）；目标侧直接
// 打开分区真实目录。
//
// 值安全策略（把格式风险压到最低的关键）：所有值 Buffer 原样持有/拷贝，绝不解码或
// 重编码（值首字节 0x00/0x01 是 Latin1/UTF-8 编码前缀，随字节保留）；记录键的切分与
// 比较一律按 Buffer 字节操作。仅作 Map 索引时用 latin1 转字符串（字节↔码元一一对应
// 的无损映射），绝不用于展示或语义判断。
//
// 合并语义（按 origin 分支）：目标侧没有该 origin → META/METAACCESS/数据键整体移植；
// 已有该 origin → 保留目标侧 META/METAACCESS，仅逐数据键处理（无此键=新增，值字节
// 相同=不动，值不同=冲突键）。dryRun 只读不写（classic-level 无原生只读开关，以
// createIfMissing:false 杜绝建库 + 全程零写入表达只读；目标目录不存在按空库口径：
// 全新增零冲突）。VERSION 等其余记录非本模块业务，两侧均原样不碰。
//
// 失败还原契约：execute 先整体备份分区 `Local Storage` 目录到临时区再写入；任一步
// 失败尽力关闭句柄后还原（rm 现目录 + 备份移回原位，跨设备 EXDEV 退化为复制+删除）；
// 还原自身失败仅 console.warn 中文（路径带上，保留临时区备份交人工核查）后上抛原始
// 错误。文件锁类错误（EBUSY/EPERM 等）统一转为 i18n 的 chromeImport.errors.chromeLocked。
//
// 本模块不 import electron，纯 Node 可测（临时目录经 deps 注入，照 history.ts 先例）。

import { cp, mkdir, rename, rm, stat } from 'fs/promises'
import { join } from 'path'
import { ClassicLevel } from 'classic-level'
import type { ChromeImportPolicy } from '../../../shared/chromeImport'
import { t } from '../../i18n'

/** dry-run 统计（口径与 execute 一致；execute 时 policy='session' 的冲突键计入 merged） */
export interface ChromeSiteDataStats {
  /** Chrome 侧数据键总数（不含 META/METAACCESS） */
  total: number
  /** 目标侧原无、将被/已被新增的键数 */
  added: number
  /** 目标侧已有且不因冲突改变的键数（值相同，或 policy='session' 的冲突键保留现值） */
  merged: number
  /** 两侧都有且值不同的键数 */
  conflictKeys: number
  /** 上述冲突键涉及的 origin 数 */
  conflictOrigins: number
}

/** execute 结果：conflictsResolved = 被覆盖（chrome）/ 保留现值（session）的冲突键数 */
export interface ChromeSiteDataApplyResult {
  added: number
  merged: number
  conflictsResolved: number
}

/** 单条 LS 记录（键值均按 Buffer 原样持有） */
interface LsRecord {
  key: Buffer
  value: Buffer
}

/** 按 origin 归组的记录（meta/metaAccess 簿记 + 数据键） */
interface OriginRecords {
  origin: Buffer
  meta: LsRecord | null
  metaAccess: LsRecord | null
  /** 数据键部分（`\x00\x01` 之后的字节）latin1 索引 → 完整原始记录 */
  data: Map<string, LsRecord>
}

type LsDb = ClassicLevel<Buffer, Buffer>

/** 键前缀常量（一律按原始字节比较，与 METAACCESS 无前缀包含关系——第 5 字节 ':' vs 'A'） */
const META_PREFIX = Buffer.from('META:', 'latin1')
const METAACCESS_PREFIX = Buffer.from('METAACCESS:', 'latin1')
/** 数据键首字节 '_'；origin 与 key 之间是 \x00\x01 两个原始字节（不可打印，勿转字符串操作） */
const DATA_KEY_HEAD = 0x5f
const ORIGIN_KEY_SEPARATOR = Buffer.from([0x00, 0x01])

/** batch 分批上限（防单批过大占内存；批次间无事务语义要求——任一步失败即整体还原） */
const BATCH_CHUNK = 500

/** 文件锁类 errno / classic-level 库锁状态码（按「Chrome 文件被占用」口径上浮） */
const LOCK_ERRNO = new Set(['EBUSY', 'EPERM', 'EACCES', 'LEVEL_LOCKED'])

/** 记录键分类结果（纯字节操作产物；origin/dataKey 均为原键 Buffer 的子序列视图） */
interface ClassifiedKey {
  kind: 'meta' | 'metaAccess' | 'data'
  origin: Buffer
  dataKey: Buffer | null
}

/**
 * 记录键分类：返回 null = 非本模块业务的记录（如 VERSION 簿记），原样不碰。
 * 首字节即可区分大类（'M'=簿记 / '_'=数据），前缀命中后再切 origin。
 */
function classifyKey(key: Buffer): ClassifiedKey | null {
  if (
    key.length > METAACCESS_PREFIX.length &&
    key.subarray(0, METAACCESS_PREFIX.length).equals(METAACCESS_PREFIX)
  ) {
    return { kind: 'metaAccess', origin: key.subarray(METAACCESS_PREFIX.length), dataKey: null }
  }
  if (key.length > META_PREFIX.length && key.subarray(0, META_PREFIX.length).equals(META_PREFIX)) {
    return { kind: 'meta', origin: key.subarray(META_PREFIX.length), dataKey: null }
  }
  if (key.length > 1 && key[0] === DATA_KEY_HEAD) {
    // 首个 \x00\x01 即分隔符（origin 不含 \x00）；key 部分允许为空，按字节保真移植
    const sep = key.indexOf(ORIGIN_KEY_SEPARATOR, 1)
    if (sep > 1) {
      return {
        kind: 'data',
        origin: key.subarray(1, sep),
        dataKey: key.subarray(sep + ORIGIN_KEY_SEPARATOR.length)
      }
    }
  }
  return null
}

/**
 * 以 buffer 编码打开 LS LevelDB（createIfMissing=false 时目录不存在将如实抛错，绝不
 * 建库）。显式 await open 让打开期错误（文件锁/库损坏）在此处如实上抛——classic-level
 * 是惰性 open，若拖到迭代期才爆，原错误会被迭代器关闭噪音顶掉，锁类口径识别即失真。
 */
async function openLsDb(path: string, createIfMissing: boolean): Promise<LsDb> {
  const db = new ClassicLevel<Buffer, Buffer>(path, {
    keyEncoding: 'buffer',
    valueEncoding: 'buffer',
    createIfMissing
  })
  try {
    await db.open()
  } catch (err) {
    await closeQuiet(db)
    throw err
  }
  return db
}

/**
 * 全量迭代归组（迭代必须在 close 前跑完——for await 正常结束即满足）；逐条 Buffer
 * 拷贝防迭代器缓冲复用。origin/数据键以 latin1 作 Map 索引（无损字节映射）。
 */
async function readOriginRecords(db: LsDb): Promise<Map<string, OriginRecords>> {
  const origins = new Map<string, OriginRecords>()
  for await (const [key, value] of db.iterator()) {
    const classified = classifyKey(key)
    if (!classified) continue
    const originId = classified.origin.toString('latin1')
    let group = origins.get(originId)
    if (!group) {
      group = {
        origin: Buffer.from(classified.origin),
        meta: null,
        metaAccess: null,
        data: new Map()
      }
      origins.set(originId, group)
    }
    if (classified.kind === 'meta') {
      group.meta = { key: Buffer.from(key), value: Buffer.from(value) }
    } else if (classified.kind === 'metaAccess') {
      group.metaAccess = { key: Buffer.from(key), value: Buffer.from(value) }
    } else if (classified.dataKey) {
      group.data.set(classified.dataKey.toString('latin1'), {
        key: Buffer.from(key),
        value: Buffer.from(value)
      })
    }
  }
  return origins
}

/** 合并计划：非冲突必写记录 + 冲突记录（由调用方按 policy 决定是否写入）+ 统计 */
interface MergePlan {
  /** 必写记录：缺失 origin 的整体移植（META/METAACCESS/数据键）+ 已有 origin 的新增数据键 */
  puts: LsRecord[]
  /** 冲突记录（两侧都有且值不同，键为完整原始键字节） */
  conflicts: LsRecord[]
  /** Chrome 侧数据键总数（不含 META/METAACCESS） */
  total: number
  added: number
  /** 值字节相同的键数（两侧都有且不改写） */
  mergedSame: number
  conflictOrigins: number
}

/**
 * 计算写入集与统计（dryRun 与 execute 共用同一口径）：缺失 origin 整体移植；已有
 * origin 保留目标侧 META/METAACCESS（不入 puts），仅逐数据键比对（字节 equals）。
 */
function computeMergePlan(
  chrome: Map<string, OriginRecords>,
  target: Map<string, OriginRecords>
): MergePlan {
  const puts: LsRecord[] = []
  const conflicts: LsRecord[] = []
  let total = 0
  let added = 0
  let mergedSame = 0
  const conflictOriginIds = new Set<string>()
  for (const [originId, group] of chrome) {
    total += group.data.size
    const existing = target.get(originId)
    if (!existing) {
      // 缺失 origin：META + METAACCESS + 全部数据键整体移植
      if (group.meta) puts.push(group.meta)
      if (group.metaAccess) puts.push(group.metaAccess)
      for (const record of group.data.values()) {
        puts.push(record)
        added += 1
      }
      continue
    }
    // 已有 origin：逐数据键处理（无此键=新增 / 值相同=不动 / 值不同=冲突）
    for (const [dataKey, record] of group.data) {
      const current = existing.data.get(dataKey)
      if (!current) {
        puts.push(record)
        added += 1
      } else if (current.value.equals(record.value)) {
        mergedSame += 1
      } else {
        conflicts.push(record)
        conflictOriginIds.add(originId)
      }
    }
  }
  return { puts, conflicts, total, added, mergedSame, conflictOrigins: conflictOriginIds.size }
}

/** 路径存在性（仅 ENOENT 视为不存在，其余错误如实上抛——EACCES 等按锁类口径处理） */
async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw err
  }
}

/**
 * 文件锁类错误判定：沿 cause 链逐层下探（classic-level 的库锁报错在顶层是
 * LEVEL_DATABASE_NOT_OPEN 的 "Database failed to open"，真正的 LEVEL_LOCKED /
 * "IO error: lock …" 藏在 cause 里；fs 侧则是 EBUSY/EPERM 等 errno）。
 */
function isLockError(err: unknown, depth = 0): boolean {
  if (!err || depth > 4) return false
  const code = (err as NodeJS.ErrnoException).code
  if (typeof code === 'string' && LOCK_ERRNO.has(code)) return true
  const message = err instanceof Error ? err.message : String(err)
  if (/EBUSY|EPERM|EACCES|resource temporarily unavailable|lock/i.test(message)) return true
  return isLockError((err as { cause?: unknown }).cause, depth + 1)
}

/** 文件锁类错误转 i18n 口径（原错误挂 cause 供日志排查），其余原样透传 */
function wrapLock(err: unknown): unknown {
  if (isLockError(err)) {
    return new Error(t('chromeImport.errors.chromeLocked'), { cause: err })
  }
  return err
}

/** 尽力关闭句柄（失败路径防句柄占用还原目标；失败仅告警不阻断还原） */
async function closeQuiet(db: LsDb | undefined): Promise<void> {
  if (!db) return
  try {
    await db.close()
  } catch (err) {
    console.warn('[chromeImport] 关闭 LevelDB 句柄失败（继续后续步骤）:', err)
  }
}

/** 严格关闭（close 即落盘语义；失败上抛走还原路径） */
async function closeStrict(db: LsDb): Promise<void> {
  await db.close()
}

/** 清理临时区（失败不阻断主流程，中文告警带路径交人工核查） */
async function rmTemp(tempRoot: string): Promise<void> {
  try {
    await rm(tempRoot, { recursive: true, force: true })
  } catch (err) {
    console.warn(`[chromeImport] 清理临时目录失败，请人工核查: ${tempRoot}`, err)
  }
}

/** 目录整体移回：优先 rename（同设备零拷贝），跨设备 EXDEV 退化为复制+删除 */
async function moveDir(src: string, dest: string): Promise<void> {
  try {
    await rename(src, dest)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
      await cp(src, dest, { recursive: true })
      await rm(src, { recursive: true, force: true })
    } else {
      throw err
    }
  }
}

/**
 * 失败还原：rm 分区 LS 现目录 + 备份整体移回原位。还原自身失败返回 false（仅中文
 * 告警，保留临时区备份交人工核查——此刻绝不能清临时区）。
 */
async function restorePartition(
  lsDir: string,
  backupDir: string,
  backupReady: boolean,
  hadLsDir: boolean
): Promise<boolean> {
  try {
    if (backupReady) {
      await rm(lsDir, { recursive: true, force: true })
      await moveDir(backupDir, lsDir)
    } else if (!hadLsDir) {
      // 执行前本无 LS 目录（本次新建的库）：移除新建目录恢复「不存在」原状
      await rm(lsDir, { recursive: true, force: true })
    }
    return true
  } catch (err) {
    console.warn(
      `[chromeImport] 分区 Local Storage 还原失败，请人工核查: 目录=${lsDir} 备份=${backupDir}`,
      err
    )
    return false
  }
}

export function createChromeSiteDataMerge(deps: { makeTempDir: () => Promise<string> }): {
  dryRun(chromeProfileDir: string, partitionDir: string): Promise<ChromeSiteDataStats>
  execute(
    chromeProfileDir: string,
    partitionDir: string,
    policy: ChromeImportPolicy
  ): Promise<ChromeSiteDataApplyResult>
} {
  /** 读侧共用：拷贝源库整目录到临时区并打开副本；源缺失（无 Local Storage/leveldb）返回 null=空源 */
  async function copyAndOpenChromeDb(
    tempRoot: string,
    chromeProfileDir: string
  ): Promise<LsDb | null> {
    const chromeLsDir = join(chromeProfileDir, 'Local Storage')
    if (!(await pathExists(join(chromeLsDir, 'leveldb')))) return null
    const chromeCopy = join(tempRoot, 'chrome-ls')
    try {
      await cp(chromeLsDir, chromeCopy, { recursive: true })
      return await openLsDb(join(chromeCopy, 'leveldb'), false)
    } catch (err) {
      throw wrapLock(err)
    }
  }

  return {
    /** 冲突检测（只读不写）：拷贝源读内存 + 目标库只读比对，返回冲突摘要与新增/合并计数 */
    async dryRun(chromeProfileDir, partitionDir) {
      const tempRoot = await deps.makeTempDir()
      let chromeDb: LsDb | undefined
      try {
        chromeDb = (await copyAndOpenChromeDb(tempRoot, chromeProfileDir)) ?? undefined
        if (!chromeDb) {
          return { total: 0, added: 0, merged: 0, conflictKeys: 0, conflictOrigins: 0 }
        }
        const chromeOrigins = await readOriginRecords(chromeDb)
        // 目标侧只读：目录不存在 = 空库口径（全新增零冲突）；存在才打开（绝不创建）。
        // 打开/读取失败过一道锁类口径（分区静默契约下不该发生，发生即如实给中文文案）
        const targetLeveldb = join(partitionDir, 'Local Storage', 'leveldb')
        let targetOrigins = new Map<string, OriginRecords>()
        if (await pathExists(targetLeveldb)) {
          try {
            const targetDb = await openLsDb(targetLeveldb, false)
            try {
              targetOrigins = await readOriginRecords(targetDb)
            } finally {
              await closeStrict(targetDb)
            }
          } catch (err) {
            throw wrapLock(err)
          }
        }
        const plan = computeMergePlan(chromeOrigins, targetOrigins)
        return {
          total: plan.total,
          added: plan.added,
          merged: plan.mergedSame, // dry-run 无 policy 输入：merged 仅计值相同键
          conflictKeys: plan.conflicts.length,
          conflictOrigins: plan.conflictOrigins
        }
      } finally {
        await closeQuiet(chromeDb)
        await rmTemp(tempRoot)
      }
    },

    /**
     * 合并执行：备份分区 LS 目录 → 非冲突移植 + 冲突按 policy（chrome=put / session=
     * skip）→ close 落盘；任一步失败尽力关句柄并还原备份后上抛。前置契约（分区静默）
     * 见模块头注释。
     */
    async execute(chromeProfileDir, partitionDir, policy) {
      const tempRoot = await deps.makeTempDir()
      const lsDir = join(partitionDir, 'Local Storage')
      const targetLeveldb = join(lsDir, 'leveldb')
      const backupDir = join(tempRoot, 'ls-backup')
      /** 执行前分区 LS 目录是否已存在（决定还原口径：回滚备份 / 移除本次新建） */
      const hadLsDir = await pathExists(lsDir)
      let chromeDb: LsDb | undefined
      let targetDb: LsDb | undefined
      /** 备份是否已就位（就位后失败才允许 rm 现目录回滚，防误删无备份的目录） */
      let backupReady = false
      /** 还原失败时保留临时区（内含备份）交人工核查，绝不清理 */
      let restoreFailed = false
      try {
        // 1) 源侧：整目录拷贝 → 打开副本 → 读入内存 → 立即关闭（写侧不再需要源库）
        chromeDb = (await copyAndOpenChromeDb(tempRoot, chromeProfileDir)) ?? undefined
        if (!chromeDb) return { added: 0, merged: 0, conflictsResolved: 0 }
        const chromeOrigins = await readOriginRecords(chromeDb)
        await closeStrict(chromeDb)
        chromeDb = undefined

        // 2) 目标侧：直接打开真实分区库（可能不存在——createIfMissing 建库；分区已静默）
        await mkdir(lsDir, { recursive: true })
        targetDb = await openLsDb(targetLeveldb, true)
        const targetOrigins = await readOriginRecords(targetDb)

        // 3) 计算写入集：非冲突必写 + 冲突键按 policy（chrome=覆盖写入 / session=跳过保留现值）
        const plan = computeMergePlan(chromeOrigins, targetOrigins)
        const writes = policy === 'chrome' ? [...plan.puts, ...plan.conflicts] : plan.puts

        // 4) 先整体备份分区 LS 目录（此刻必然已存在——上一步 mkdir 过），校验快照就位后才动库
        await cp(lsDir, backupDir, { recursive: true })
        if (!(await stat(backupDir)).isDirectory()) {
          throw new Error(`备份快照缺失: ${backupDir}`)
        }
        backupReady = true

        // 5) 分批 batch put（值字节原样，不解码不重编码）
        for (let i = 0; i < writes.length; i += BATCH_CHUNK) {
          const ops = writes.slice(i, i + BATCH_CHUNK).map((record) => ({
            type: 'put' as const,
            key: record.key,
            value: record.value
          }))
          await targetDb.batch(ops)
        }

        // 6) close 落盘（失败同样走还原）
        await closeStrict(targetDb)
        targetDb = undefined

        // 7) 成功：清理备份与临时区
        await rmTemp(tempRoot)
        return {
          added: plan.added,
          merged: policy === 'session' ? plan.mergedSame + plan.conflicts.length : plan.mergedSame,
          conflictsResolved: plan.conflicts.length
        }
      } catch (err) {
        // 尽力关闭句柄 → 还原 → 上抛（文件锁类错误转 i18n 口径，其余原样）
        await closeQuiet(chromeDb)
        await closeQuiet(targetDb)
        chromeDb = undefined
        targetDb = undefined
        restoreFailed = !(await restorePartition(lsDir, backupDir, backupReady, hadLsDir))
        throw wrapLock(err)
      } finally {
        if (!restoreFailed) await rmTemp(tempRoot)
      }
    }
  }
}
