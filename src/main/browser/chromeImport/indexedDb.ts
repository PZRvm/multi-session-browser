// IndexedDB 站点快照导入引擎（站点数据导入专项步骤 5，计划
// notes/plans/20261028112040-地址栏交互与Chrome站点数据导入开发计划.md 第 5 节；
// 引擎契约见本目录 types.ts；字节级格式事实与正反例证据见步骤 1 技术验证记录
// notes/accept/20261028112040-…/20261028123936-步骤1技术验证记录.md §3）。
//
// 裁决单位（PRD 3.9 / 计划 3.7）：一个站点 = <origin>.indexeddb.leveldb 与
// <origin>.indexeddb.blob 成对目录（blob 文件走嵌套编号路径如 1/00/2，只复制 .leveldb
// 不完整；源侧 blob 目录不存在 = 该站点无 Blob，可容忍；只有 .blob 没有 .leveldb 的
// 孤立目录不是完整站点，跳过不计）。快照整体替换或整体保留，绝不在一个 LevelDB 内
// 混合两侧记录。
//
// 版本门禁（本模块最重要的安全线，步骤 1 §3.2 字节级负结论）：schema version 过新的
// 库拷入后目标引擎打开时会**静默重置**（6124B WAL 被重写为 218B 空库日志、数据蒸发、
// 无任何错误上浮），因此拷入前必须手读源 WAL 解出全局元数据键 00 00 00 00 02 的
// schema version 并比对 IDB_SUPPORTED_SCHEMA_VERSION——classic-level 打不开 IDB 库
// （MANIFEST 声明比较器 idb_cmp1），校验只能自实现 WAL 解码。WAL 为 LevelDB 记录
// 格式：32KB 块、记录头 7B = crc32c(4) + len(2LE) + type(1)，type 0/len 0 为块尾
// trailer、type 5-8 为带 1B log number 的可回收记录；payload 为 WriteBatch（8B seq
// + 4B count + 变长条目，put 条目 = 1 + klen/vlen varint + key + value）。版本键
// value 形如 [varint 0x15][int32 大端 version]（Chromium 142 写 15、Chrome 156 写
// 16）。已知边界：库若已压实（版本键只存于 .ldb SST 而非任一 WAL），版本读不到按
// source-layout-unknown 拒绝该站点——宁拒勿拷。
//
// 【前置契约——调用方必须保证，本模块不自检】apply 在编排层静默窗口内被调用（目标
// 会话全部 webContents 已关闭、分区后台句柄已收尾）；确认窗口期的目标漂移复核由
// 编排层负责（types.ts 生命周期注释）。本模块对 rm 遇 EBUSY 短等重试一次，仍失败
// 按 io-error 如实报告，不做强制句柄收尾。
//
// 写入与还原：逐文件复制成对目录（源侧符号链接/非常规文件一律拒绝），.leveldb 侧
// 跳过 LOCK（目标引擎自行重建）与 LOG/LOG.old（引擎运行日志），保留 CURRENT /
// MANIFEST-* / *.log（WAL 数据日志）。冲突替换：目标成对目录改名入临时备份 → rm
// → 复制源 → 校验（CURRENT 引用的 MANIFEST 在位 + 目标侧重读 schema version 与源
// 一致 + blob 目录在位）；任一步失败恢复备份（跨设备退化为复制+删除），后续站点
// 跳过，结果标 partial/failed + rolledBack；还原失败 = rollback-failed 独立语义：
// 保留临时区唯一恢复副本（中文告警带路径交人工核查），绝不自动删除——dispose 亦
// 不碰它。每站点校验通过即视为原子提交并即时清理该站点备份（后续站点失败不回卷
// 已提交站点，partial 语义与计划 2.3「类型内失败可还原」一致）。
//
// 本模块不 import electron，纯 Node fs 操作（临时目录经 deps 注入——照 siteData.ts
// 先例）；错误经 ImportEngineError 携带闭集原因码，error 文案仅调试留痕（用户可见
// 反馈由编排层按 reason 组装，不走本模块的中文串）。

import { copyFile, lstat, mkdir, readdir, readFile, rename, rm } from 'fs/promises'
// 已知边界（审查 20261028170000 中-4，如实注记）：冲突替换的事务序列（rename 备份 →
// 复制 → 校验 → 清备份）在进程硬崩溃（断电/被杀）窗口内中断时，目标站点可能停留在
// 半迁移态且唯一恢复备份滞留临时区（msb-chrome-import-* 目录）——本模块不做启动期
// 自动回卷（临时区路径含随机段且崩溃点不可知，自动恢复有误删风险），人工恢复路径：
// 检查系统临时目录下 msb-chrome-import-* 残留（备份目录内为目标原快照），对照回滚
// 失败告警中的站点路径手工恢复；正常失败路径（进程存活）的还原与备份保留不受影响。
import type { Stats } from 'fs'
import { join } from 'path'
import type {
  ChromeImportPolicy,
  ChromeImportReason,
  ChromeImportScopeResult
} from '../../../shared/chromeImport'
import {
  ImportEngineError,
  type ImportEngine,
  type ImportEngineContext,
  type ImportEnginePrepare
} from './types'

/**
 * 目标引擎支持的 IndexedDB schema version 上限（Electron 39 / Chromium 142.0.7444
 * 本机实测，步骤 1 §3.2：142 写 15、Chrome 156 写 16）。版本判定按字节而非 Chrome
 * 版本号映射；应用升级 Electron 后须随支持矩阵同步更新此值
 */
export const IDB_SUPPORTED_SCHEMA_VERSION = 15

/**
 * 站点 .leveldb 目录名白名单：origin 的 Chromium 序列化形态（scheme/host/port 的
 * 文件系统安全编码）只含字母数字与 . _ -，首字符限字母数字即排除 "." / ".." 逃逸
 * 形态；白名单内不可能出现路径分隔符。不匹配者按 source-layout-unknown 拒绝
 */
const SITE_LEVELDB_NAME_RE = /^([A-Za-z0-9][A-Za-z0-9._-]*)\.indexeddb\.leveldb$/
const SITE_LEVELDB_SUFFIX = '.indexeddb.leveldb'
const SITE_BLOB_SUFFIX = '.indexeddb.blob'

/** 全局元数据键：4 字节 0 前缀（global metadata 域）+ 0x02（schema version），步骤 1 字节级验证 */
const SCHEMA_VERSION_KEY = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x02])
/** 版本键 value 已验证形态：首字节 varint 0x15 + int32 大端 version */
const SCHEMA_VERSION_VALUE_TAG = 0x15
const SCHEMA_VERSION_VALUE_MIN_BYTES = 5

/** LevelDB WAL 记录格式常量（32KB 块 + 7B 记录头；type 0/len 0 = 块尾 trailer） */
const WAL_BLOCK_SIZE = 32768
const WAL_RECORD_HEADER_SIZE = 7

/** .leveldb 目录内不参与复制的引擎运行文件：LOCK 目标引擎自行重建、LOG/LOG.old 为运行日志 */
const ENGINE_RUNTIME_FILE_NAMES = new Set(['LOCK', 'LOG', 'LOG.old'])

/** WAL 数据日志文件名形态（编号.log；LOG 运行日志无扩展名不匹配） */
const WAL_FILE_NAME_RE = /^(\d+)\.log$/

/** rm 遇 EBUSY 的单次重试等待（编排层已静默，残留句柄的短暂收尾窗口） */
const EBUSY_RETRY_WAIT_MS = 500

/** 站点清单条目：prepare 冻结的受控路径对——apply/dispose 只消费此清单，不重拼路径 */
export interface IdbSiteEntry {
  /** 站点 origin 的 Chromium 序列化形态（目录名前缀，如 http_127.0.0.1_48191） */
  origin: string
  /** 源侧校验出的 schema version（apply 后目标侧复核须一致） */
  schemaVersion: number
  /** 源 .leveldb 目录绝对路径 */
  sourceLevelDbDir: string
  /** 源 .blob 目录绝对路径；null = 源无 Blob（成对单位中 blob 侧可缺） */
  sourceBlobDir: string | null
  /** 目标 .leveldb 目录绝对路径（prepare 经 context.partitionDir 单源拼装） */
  targetLevelDbDir: string
  /** 目标 .blob 目录绝对路径（无论源侧有无，替换/还原均按成对单位处置目标侧） */
  targetBlobDir: string
  /** prepare 时的目标现状分类：added = 目标无同名站点 / conflict = 目标已有同名快照 */
  kind: 'added' | 'conflict'
}

/** indexedDB 引擎执行工件：兼容站点受控清单 + unsupported 站点计数（结果行恒携带） */
export interface IdbImportArtifacts {
  sites: IdbSiteEntry[]
  /** 版本过新 / 布局不可识别站点数（不进 apply 清单，计数原样进结果行） */
  unsupportedCount: number
}

/** 站点操作失败（已含还原结论）：rollbackFailed=true 时唯一恢复副本已保留在临时区 */
class SiteFailure extends Error {
  constructor(
    message: string,
    public readonly reason: ChromeImportReason,
    public readonly rollbackFailed: boolean
  ) {
    super(message)
    this.name = 'SiteFailure'
  }
}

export function createIndexedDbEngine(deps: {
  makeTempDir: () => Promise<string>
}): ImportEngine<IdbImportArtifacts> {
  return {
    // ---- prepare：源侧只读探测 -------------------------------------------------
    async prepare(context: ImportEngineContext): Promise<ImportEnginePrepare<IdbImportArtifacts>> {
      assertSafeProfileDir(context.profileDir)
      const profileDir = join(context.snapshotRoot, context.profileDir)
      const sourceIdbRoot = join(profileDir, 'IndexedDB')
      // 根链符号链接检查（快照根 → profile → IndexedDB）：任一级违规整单拒绝——
      // 快照以上层不可信则所有站点路径皆不可信，不降级为逐站点 unsupported
      await assertRealDir(context.snapshotRoot, '根目录')
      await assertRealDir(profileDir, 'profile 目录')
      const idbRootExists = await entryExists(sourceIdbRoot)
      if (idbRootExists) await assertRealDir(sourceIdbRoot, 'IndexedDB 目录')

      const sites: IdbSiteEntry[] = []
      let unsupported = 0
      if (idbRootExists) {
        const entries = await readdir(sourceIdbRoot, { withFileTypes: true })
        // 只枚举 .leveldb 后缀目录名为站点候选（孤立 .blob 目录不是完整站点，跳过不计）；
        // 同名符号链接不计入 isDirectory，按候选捕获后在白名单/lstat 处拒绝
        const candidates = entries
          .filter(
            (entry) =>
              (entry.isDirectory() || entry.isSymbolicLink()) &&
              entry.name.endsWith(SITE_LEVELDB_SUFFIX)
          )
          .sort((a, b) => (a.name < b.name ? -1 : 1))
        for (const candidate of candidates) {
          const match = SITE_LEVELDB_NAME_RE.exec(candidate.name)
          if (!match) {
            unsupported += 1
            console.warn(`[chromeImport] IndexedDB 站点目录名不合规（拒绝）: ${candidate.name}`)
            continue
          }
          const origin = match[1]
          const sourceLevelDbDir = join(sourceIdbRoot, candidate.name)
          const stat = await lstat(sourceLevelDbDir).catch(() => null)
          if (!stat || !stat.isDirectory()) {
            // 含符号链接/已消失条目：结构不可信，按布局不可识别拒绝该站点
            unsupported += 1
            console.warn(`[chromeImport] IndexedDB 站点目录不是真实目录（拒绝）: ${candidate.name}`)
            continue
          }
          const sourceBlobDir = join(sourceIdbRoot, `${origin}${SITE_BLOB_SUFFIX}`)
          const hasBlob = await entryExists(sourceBlobDir)
          if (hasBlob && !(await isRealDir(sourceBlobDir))) {
            unsupported += 1
            console.warn(`[chromeImport] IndexedDB 站点 blob 目录不是真实目录（拒绝）: ${origin}`)
            continue
          }
          // 布局识别：CURRENT 在位且其引用的 MANIFEST 文件存在（不只是目录存在）
          const manifest = await readManifestName(sourceLevelDbDir)
          if (manifest === null || !(await entryExists(join(sourceLevelDbDir, manifest)))) {
            unsupported += 1
            console.warn(
              `[chromeImport] IndexedDB 站点布局不可识别（CURRENT/MANIFEST 缺失）: ${origin}`
            )
            continue
          }
          // 版本门禁：手读 WAL 解 schema version，读不到拒绝、过新拒绝（宁拒勿拷）
          const version = await readSiteSchemaVersion(sourceLevelDbDir)
          if (version === null) {
            unsupported += 1
            console.warn(
              `[chromeImport] IndexedDB 站点 schema version 读不到（拒绝导入）: ${origin}`
            )
            continue
          }
          if (version > IDB_SUPPORTED_SCHEMA_VERSION) {
            unsupported += 1
            console.warn(
              `[chromeImport] IndexedDB 站点 schema version ${version} 新于目标支持的 ` +
                `${IDB_SUPPORTED_SCHEMA_VERSION}（拒绝导入）: ${origin}`
            )
            continue
          }
          const targetIdbRoot = join(context.partitionDir, 'IndexedDB')
          sites.push({
            origin,
            schemaVersion: version,
            sourceLevelDbDir,
            sourceBlobDir: hasBlob ? sourceBlobDir : null,
            targetLevelDbDir: join(targetIdbRoot, candidate.name),
            targetBlobDir: join(targetIdbRoot, `${origin}${SITE_BLOB_SUFFIX}`),
            // 判据（计划步骤 5）：目标分区 IndexedDB/ 下同名 leveldb 目录存在即视为
            // 已有快照，不做库内判同
            kind: (await entryExists(join(targetIdbRoot, candidate.name))) ? 'conflict' : 'added'
          })
        }
      }
      const added = sites.filter((site) => site.kind === 'added').length
      const conflicts = sites.length - added
      return {
        plan: {
          scope: 'indexedDB',
          unit: 'sites',
          total: sites.length,
          added,
          merged: 0,
          conflicts,
          // 站点即冲突单位：conflictSites 与 conflicts 同值
          conflictSites: conflicts,
          unsupported,
          notes: []
        },
        artifacts: { sites, unsupportedCount: unsupported }
      }
    },

    // ---- apply：静默窗口内写入（前置契约见模块头注） ---------------------------
    async apply(
      _context: ImportEngineContext,
      artifacts: IdbImportArtifacts,
      policy: ChromeImportPolicy
    ): Promise<ChromeImportScopeResult> {
      const unsupported = artifacts.unsupportedCount
      if (artifacts.sites.length === 0) {
        // 空 apply：源无兼容站点时整类 unsupported / 空源 done，均零写入
        return {
          scope: 'indexedDB',
          unit: 'sites',
          status: unsupported > 0 ? 'unsupported' : 'done',
          added: 0,
          merged: 0,
          conflictsResolved: 0,
          unsupported,
          skipped: 0
        }
      }
      const tempRoot = await deps.makeTempDir()
      let addedCount = 0
      let conflictsResolved = 0
      let skipped = 0
      let failureReason: ChromeImportReason | null = null
      let failureError: string | null = null
      let rolledBack = false
      let rollbackFailed = false
      for (let i = 0; i < artifacts.sites.length; i++) {
        const site = artifacts.sites[i]
        try {
          if (site.kind === 'conflict') {
            if (policy === 'session') {
              // 完整保留目标（零动作），冲突已按所选裁决处置
              conflictsResolved += 1
              continue
            }
            await replaceConflictSite(tempRoot, i, site)
            conflictsResolved += 1
          } else {
            // added 站点：prepare 后目标出现同名目录 = 漂移。编排层复核为主，此处兜底
            // 不扩大写入：跳过该站点如实计数，绝不向已有目录混拷
            if (await entryExists(site.targetLevelDbDir)) {
              skipped += 1
              console.warn(
                `[chromeImport] IndexedDB 站点目标已漂移为已存在（跳过）: ${site.origin}`
              )
              continue
            }
            try {
              await copySitePair(site)
              await verifySite(site)
              addedCount += 1
            } catch (err) {
              // 还原 = 目标回到「不存在」原状（added 站点原本无目录，无备份可恢复）
              throw await restoreAddedSite(site, err)
            }
          }
        } catch (err) {
          if (err instanceof SiteFailure) {
            rollbackFailed = err.rollbackFailed
            rolledBack = !err.rollbackFailed
            failureReason = err.rollbackFailed ? 'rollback-failed' : err.reason
            failureError = err.message
          } else {
            // 理论不可达（站点操作已全包裹）；防御口径：按 io-error 且尽力清理后视为已还原
            rollbackFailed = false
            rolledBack = true
            failureReason = err instanceof ImportEngineError ? err.reason : 'io-error'
            failureError = err instanceof Error ? err.message : String(err)
          }
          // 该站点失败即止：失败站点（已还原、未导入）与后续未处理站点都计入 skipped
          // ——统计只反映真正结果（计划 total = added + conflictsResolved + skipped 对得上）
          skipped += artifacts.sites.length - i
          break
        }
      }
      let status: ChromeImportScopeResult['status']
      if (rollbackFailed) {
        status = 'failed'
        // 唯一恢复副本（站点备份）在 tempRoot 内保留，绝不清理——中文告警已由还原
        // 路径带路径输出，此处不删 tempRoot
      } else {
        if (failureReason !== null) {
          status = addedCount > 0 || conflictsResolved > 0 ? 'partial' : 'failed'
        } else if (skipped > 0) {
          // 无写入失败、仅漂移跳过：部分完成，原因如实（编排层应转为重探测）
          status = 'partial'
          failureReason = 'target-changed'
        } else {
          status = 'done'
        }
        await rmTemp(tempRoot)
      }
      const result: ChromeImportScopeResult = {
        scope: 'indexedDB',
        unit: 'sites',
        status,
        added: addedCount,
        merged: 0,
        conflictsResolved,
        unsupported,
        skipped
      }
      if (failureReason !== null) result.reason = failureReason
      if (rolledBack) result.rolledBack = true
      if (failureError !== null) result.error = failureError
      return result
    },

    // ---- dispose：清理工件（幂等） ---------------------------------------------
    async dispose(artifacts: IdbImportArtifacts): Promise<void> {
      // prepare 纯读不落盘；apply 的临时区在成功/还原路径自清。唯一例外是
      // rollback-failed 时保留的备份目录——那是唯一恢复副本，dispose 同样不碰
      // （模块头注裁决）。此处只清空内存工件引用，重复调用幂等
      artifacts.sites.length = 0
    }
  }
}

// ---- 源布局与版本校验（纯读） -------------------------------------------------

/** profileDir 防御守卫：编排层已过白名单，此处兜底拒绝路径分隔符与逃逸形态 */
function assertSafeProfileDir(profileDir: string): void {
  if (
    profileDir === '' ||
    profileDir === '.' ||
    profileDir === '..' ||
    profileDir.includes('/') ||
    profileDir.includes('\\')
  ) {
    throw new ImportEngineError('source-layout-unknown', `源 profile 目录名不合规: ${profileDir}`)
  }
}

/** lstat 目录存在性（ENOENT=false；其余错误如实上抛——EACCES 等按 io-error 口径） */
async function entryExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw err
  }
}

/** lstat 为真实目录（拒绝符号链接与文件形态） */
async function isRealDir(path: string): Promise<boolean> {
  const stat = await lstat(path).catch(() => null)
  return stat !== null && stat.isDirectory()
}

/** 真实目录断言（源快照根链逐级检查用）：不可读/符号链接/非目录整单拒绝 */
async function assertRealDir(path: string, label: string): Promise<void> {
  let stat: Stats
  try {
    stat = await lstat(path)
  } catch (err) {
    throw new ImportEngineError(
      'source-layout-unknown',
      `源快照${label}不可读（拒绝导入）: ${path}（${err instanceof Error ? err.message : String(err)}）`
    )
  }
  if (!stat.isDirectory()) {
    throw new ImportEngineError(
      'source-layout-unknown',
      `源快照${label}不是真实目录（拒绝符号链接）: ${path}`
    )
  }
}

/** 读 CURRENT → MANIFEST 文件名（首个非空行，形如 MANIFEST-000001）；缺失/不合规返回 null */
async function readManifestName(levelDbDir: string): Promise<string | null> {
  let content: string
  try {
    content = await readFile(join(levelDbDir, 'CURRENT'), 'utf-8')
  } catch {
    return null
  }
  const first = content.split('\n')[0]?.trim() ?? ''
  return /^MANIFEST-\d+$/.test(first) ? first : null
}

/**
 * 手读站点 WAL 解 schema version：按编号升序回放全部数据日志（后写覆盖前写）。
 * 返回 null = 任一 WAL 不可读或全部读完后版本键未命中（宁拒勿拷）。
 * 已知边界：已压实的库版本键只存于 .ldb SST，本函数读不到 → 调用方按
 * source-layout-unknown 拒绝该站点。
 */
async function readSiteSchemaVersion(levelDbDir: string): Promise<number | null> {
  const entries = await readdir(levelDbDir, { withFileTypes: true })
  const walFiles = entries
    .filter((entry) => entry.isFile() && WAL_FILE_NAME_RE.test(entry.name))
    // 回放序按编号排序（后写覆盖前写）；保留原文件名读取（编号去前导零会拼错路径）
    .map((entry) => ({ name: entry.name, number: Number(WAL_FILE_NAME_RE.exec(entry.name)?.[1]) }))
    .sort((a, b) => a.number - b.number)
  let version: number | null = null
  for (const walFile of walFiles) {
    let data: Buffer
    try {
      data = await readFile(join(levelDbDir, walFile.name))
    } catch {
      // WAL 存在却读不到：版本可能恰在不可读文件中被升级过，整站点按读不到拒绝
      return null
    }
    for (const payload of parseWalRecordPayloads(data)) {
      const found = scanWriteBatchForSchemaVersion(payload)
      if (found !== null) version = found
    }
  }
  return version
}

/**
 * 解析单个 WAL 文件的全部完整逻辑记录（LevelDB 记录格式，步骤 1 字节级验证）：
 * 32KB 块、7B 记录头（crc32c(4) + len(2LE) + type(1)）；type 0/len 0 为块尾
 * trailer 跳到下一块；type 5-8 为可回收记录（头部后多 1B log number）；跨块分片
 * （FIRST/MIDDLE/LAST）拼装。截断尾部/孤儿分片/未知类型即停，已解出部分保留——
 * 上层按「最终读不到版本键即拒绝」消费，不校验 CRC32C（结构性解析失败自然拒绝）。
 */
function parseWalRecordPayloads(data: Buffer): Buffer[] {
  const payloads: Buffer[] = []
  let fragments: Buffer[] = []
  let pos = 0
  while (pos + WAL_RECORD_HEADER_SIZE <= data.length) {
    const recordType = data[pos + 6]
    const length = data.readUInt16LE(pos + 4)
    if (recordType === 0 || length === 0) {
      pos = (Math.floor(pos / WAL_BLOCK_SIZE) + 1) * WAL_BLOCK_SIZE
      continue
    }
    const recyclable = recordType >= 5 && recordType <= 8
    const payloadStart = pos + WAL_RECORD_HEADER_SIZE + (recyclable ? 1 : 0)
    const recordEnd = pos + WAL_RECORD_HEADER_SIZE + length
    if (recordEnd > data.length || payloadStart > recordEnd) break
    const payload = data.subarray(payloadStart, recordEnd)
    // 可回收记录 5-8 与常规 1-4 语义一一对应（多出的 log number 已跳过）
    const kind = recyclable ? recordType - 4 : recordType
    if (kind === 1) {
      fragments = []
      payloads.push(payload)
    } else if (kind === 2) {
      fragments = [payload]
    } else if (kind === 3 || kind === 4) {
      if (fragments.length === 0) break
      fragments.push(payload)
      if (kind === 4) {
        payloads.push(fragments.length === 1 ? fragments[0] : Buffer.concat(fragments))
        fragments = []
      }
    } else {
      break
    }
    pos = recordEnd
  }
  return payloads
}

/** LEB128 varint32（LevelDB 批条目长度编码）；越界/超 5 字节返回 null */
function readVarint32(data: Buffer, pos: number): { value: number; next: number } | null {
  let result = 0
  let shift = 0
  for (let i = 0; i < 5; i++) {
    if (pos + i >= data.length) return null
    const byte = data[pos + i]
    result |= (byte & 0x7f) << shift
    if ((byte & 0x80) === 0) return { value: result >>> 0, next: pos + i + 1 }
    shift += 7
  }
  return null
}

/**
 * 扫描单条 WriteBatch（payload = 8B seq + 4B count + 变长条目）中的版本键写入：
 * 命中全局元数据键 00 00 00 00 02 时解码其 value（[varint 0x15][int32 大端]），
 * 同批后写覆盖前写。结构中途不可信即停，保留已读到的值。未命中返回 null。
 */
function scanWriteBatchForSchemaVersion(payload: Buffer): number | null {
  if (payload.length < 12) return null
  let pos = 12
  let version: number | null = null
  while (pos < payload.length) {
    const tag = payload[pos]
    pos += 1
    if (tag === 0) {
      // delete 条目：varint klen + key
      const keyLen = readVarint32(payload, pos)
      if (keyLen === null || keyLen.next + keyLen.value > payload.length) return version
      pos = keyLen.next + keyLen.value
    } else if (tag === 1) {
      // put 条目：varint klen + key + varint vlen + value
      const keyLen = readVarint32(payload, pos)
      if (keyLen === null) return version
      const keyStart = keyLen.next
      const keyEnd = keyStart + keyLen.value
      if (keyEnd > payload.length) return version
      const valueLen = readVarint32(payload, keyEnd)
      if (valueLen === null) return version
      const valueEnd = valueLen.next + valueLen.value
      if (valueEnd > payload.length) return version
      if (
        keyLen.value === SCHEMA_VERSION_KEY.length &&
        payload.subarray(keyStart, keyEnd).equals(SCHEMA_VERSION_KEY)
      ) {
        const decoded = decodeSchemaVersionValue(payload.subarray(valueLen.next, valueEnd))
        if (decoded !== null) version = decoded
      }
      pos = valueEnd
    } else {
      // 未知条目类型：其后不可信，保留已读到的
      return version
    }
  }
  return version
}

/** 版本键 value 解码：[varint 0x15][int32 大端 version]（步骤 1 验证形态）；不符按不可读拒绝 */
function decodeSchemaVersionValue(value: Buffer): number | null {
  if (value.length < SCHEMA_VERSION_VALUE_MIN_BYTES || value[0] !== SCHEMA_VERSION_VALUE_TAG) {
    return null
  }
  const version = value.readUInt32BE(1)
  // schema version 为小整数；0 或异常大值按不可读拒绝（宁拒勿猜）
  if (version <= 0 || version > 0xffff) return null
  return version
}

// ---- 复制 / 校验 / 还原（apply 内部） ------------------------------------------

/** 复制站点成对目录（源 blob 缺失只复制 leveldb 侧）；逐文件走，跳过引擎运行文件 */
async function copySitePair(site: IdbSiteEntry): Promise<void> {
  await copyTree(site.sourceLevelDbDir, site.targetLevelDbDir, true)
  if (site.sourceBlobDir !== null) {
    await copyTree(site.sourceBlobDir, site.targetBlobDir, false)
  }
}

/** 递归逐文件复制（保留空目录；源侧符号链接与非常规文件一律按布局不可识别拒绝） */
async function copyTree(
  srcDir: string,
  dstDir: string,
  skipEngineRuntimeFiles: boolean
): Promise<void> {
  const entries = await readdir(srcDir, { withFileTypes: true })
  await mkdir(dstDir, { recursive: true })
  for (const entry of entries) {
    if (skipEngineRuntimeFiles && ENGINE_RUNTIME_FILE_NAMES.has(entry.name)) continue
    if (entry.isSymbolicLink()) {
      throw new ImportEngineError(
        'source-layout-unknown',
        `源目录含符号链接，拒绝复制: ${join(srcDir, entry.name)}`
      )
    }
    const src = join(srcDir, entry.name)
    const dst = join(dstDir, entry.name)
    if (entry.isDirectory()) {
      await copyTree(src, dst, skipEngineRuntimeFiles)
    } else if (entry.isFile()) {
      await copyFile(src, dst)
    } else {
      throw new ImportEngineError('source-layout-unknown', `源目录含非常规文件，拒绝复制: ${src}`)
    }
  }
}

/** 站点导入后校验：CURRENT 引用的 MANIFEST 在位 + 目标侧重读 schema version 与源一致 + blob 目录在位 */
async function verifySite(site: IdbSiteEntry): Promise<void> {
  const manifest = await readManifestName(site.targetLevelDbDir)
  if (manifest === null || !(await entryExists(join(site.targetLevelDbDir, manifest)))) {
    throw new ImportEngineError(
      'io-error',
      `目标校验失败（CURRENT/MANIFEST 缺失）: ${site.targetLevelDbDir}`
    )
  }
  const version = await readSiteSchemaVersion(site.targetLevelDbDir)
  if (version !== site.schemaVersion) {
    throw new ImportEngineError(
      'io-error',
      `目标校验失败（schema version 不一致：源 ${site.schemaVersion} / 目标 ${version}）: ${site.origin}`
    )
  }
  if (site.sourceBlobDir !== null && !(await entryExists(site.targetBlobDir))) {
    throw new ImportEngineError('io-error', `目标校验失败（blob 目录缺失）: ${site.targetBlobDir}`)
  }
}

/**
 * 冲突站点整体替换（policy='chrome'）：目标成对目录改名入临时备份 → 复制源 → 校验；
 * 站点校验通过即视为原子提交并清理该站点备份。任一步失败：清目标半成品 → 备份移回
 * 原位（还原失败 = SiteFailure(rollback-failed)，备份保留交人工核查）。
 */
async function replaceConflictSite(
  tempRoot: string,
  index: number,
  site: IdbSiteEntry
): Promise<void> {
  const backupDir = join(tempRoot, `site-${index}`)
  const backupLevelDb = join(backupDir, 'leveldb')
  const backupBlob = join(backupDir, 'blob')
  let committed = false
  try {
    await mkdir(backupDir, { recursive: true })
    // 备份在位才允许动目标：rename 整目录（同设备零拷贝，跨设备退化为复制+删除）
    if (await entryExists(site.targetLevelDbDir)) {
      await moveDir(site.targetLevelDbDir, backupLevelDb)
    }
    if (await entryExists(site.targetBlobDir)) {
      await moveDir(site.targetBlobDir, backupBlob)
    }
    await copySitePair(site)
    await verifySite(site)
    committed = true
    // 已提交：该站点备份随之清理（后续站点失败不回卷已提交站点，partial 语义）
    await rm(backupDir, { recursive: true, force: true })
  } catch (err) {
    if (committed) {
      // 提交后仅备份清理失败：站点数据已完整就位，不还原；备份残留交人工/系统清理
      console.warn(`[chromeImport] IndexedDB 站点备份清理失败（数据已导入）: ${backupDir}`, err)
      return
    }
    const failure = await restoreSitePair(site, backupLevelDb, backupBlob, err)
    throw failure
  }
}

/**
 * added 站点失败还原：清除目标半成品（复制与校验两阶段失败都走此口），目标回到
 * 「不存在」原状。清除失败 = rollback-failed（无备份可保留，如实上浮——目标可能
 * 残留半份文件，绝不伪装成功）。
 */
async function restoreAddedSite(site: IdbSiteEntry, cause: unknown): Promise<SiteFailure> {
  try {
    await rmDirWithRetry(site.targetLevelDbDir)
    await rmDirWithRetry(site.targetBlobDir)
    const reason = cause instanceof ImportEngineError ? cause.reason : 'io-error'
    return new SiteFailure(
      `站点导入失败已还原（目标回到不存在原状）: ${site.origin}（${
        cause instanceof Error ? cause.message : String(cause)
      }）`,
      reason,
      false
    )
  } catch (restoreErr) {
    console.warn(
      `[chromeImport] IndexedDB 新增站点还原失败，目标可能残留半份文件，请人工核查: ` +
        `${site.targetLevelDbDir}`,
      restoreErr
    )
    return new SiteFailure(
      `站点导入失败且还原失败（目标可能残留半份文件）: ${site.origin}（还原错误: ${
        restoreErr instanceof Error ? restoreErr.message : String(restoreErr)
      }）`,
      'rollback-failed',
      true
    )
  }
}

/**
 * 失败还原：清目标半成品（EBUSY 单次重试）→ 备份成员移回原位。还原判定按备份在位
 * 性而非记账（备份在 ⟺ 目标被移走过，可能含半成品；备份不在 ⟺ 目标原样未动）。
 * 还原成功返回原始失败（包成 SiteFailure）；还原失败返回 rollback-failed 的
 * SiteFailure（唯一恢复副本已在临时区保留，绝不删除）。
 */
async function restoreSitePair(
  site: IdbSiteEntry,
  backupLevelDb: string,
  backupBlob: string,
  cause: unknown
): Promise<SiteFailure> {
  try {
    if (await entryExists(backupLevelDb)) {
      await rmDirWithRetry(site.targetLevelDbDir)
      await moveDir(backupLevelDb, site.targetLevelDbDir)
    }
    if (await entryExists(backupBlob)) {
      await rmDirWithRetry(site.targetBlobDir)
      await moveDir(backupBlob, site.targetBlobDir)
    }
    const reason = cause instanceof ImportEngineError ? cause.reason : 'io-error'
    return new SiteFailure(
      `站点导入失败已还原: ${site.origin}（${cause instanceof Error ? cause.message : String(cause)}）`,
      reason,
      false
    )
  } catch (restoreErr) {
    console.warn(
      `[chromeImport] IndexedDB 站点还原失败，已保留唯一恢复备份交人工核查: ` +
        `备份=${backupLevelDb.replace(/leveldb$/, '')} 目标=${site.targetLevelDbDir}`,
      restoreErr
    )
    return new SiteFailure(
      `站点导入失败且还原失败（备份已保留）: ${site.origin}（还原错误: ${
        restoreErr instanceof Error ? restoreErr.message : String(restoreErr)
      }）`,
      'rollback-failed',
      true
    )
  }
}

/** rm 目录（force）：EBUSY 短等后单次重试，仍失败如实上抛由调用方按 io-error 上报 */
async function rmDirWithRetry(path: string): Promise<void> {
  try {
    await rm(path, { recursive: true, force: true })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EBUSY') throw err
    await new Promise((resolve) => setTimeout(resolve, EBUSY_RETRY_WAIT_MS))
    await rm(path, { recursive: true, force: true })
  }
}

/** 目录整体移动：优先 rename（同设备零拷贝），跨设备 EXDEV 退化为复制+删除 */
async function moveDir(src: string, dest: string): Promise<void> {
  try {
    await rename(src, dest)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
    await copyTree(src, dest, false)
    await rm(src, { recursive: true, force: true })
  }
}

/** 临时区清理（失败不阻断主流程，中文告警带路径交人工核查） */
async function rmTemp(tempRoot: string): Promise<void> {
  try {
    await rm(tempRoot, { recursive: true, force: true })
  } catch (err) {
    console.warn(`[chromeImport] 清理临时目录失败，请人工核查: ${tempRoot}`, err)
  }
}
