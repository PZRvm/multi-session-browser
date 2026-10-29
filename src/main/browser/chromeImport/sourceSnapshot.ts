// Chrome 导入源快照层（站点数据导入专项步骤 6，计划 20261028112040 第 5 节第 6.1 条）：
// dry-run 开始时把勾选 scope 所需的源数据从用户 Chrome profile 复制为主进程持有的固定
// 副本（tmp 下当前用户权限目录），探测与执行消费同一份数据——「源快照在 dry-run 后固定，
// 执行只消费主进程暂存的同一份数据」（计划 2.3）。
//
// 布局契约：副本镜像 Chrome profile 目录形态——<root>/<profileDir>/{History*, Cookies* 或
// Network/Cookies*, Local Storage/, IndexedDB/}；historySource/siteData 消费
// join(root, profileDir) 作 profileDir（其内部按相对路径取子项，零改动）；cookies 引擎
// 同口径；indexedDb 引擎消费 join(snapshotRoot, profileDir)/IndexedDB（其既有契约）。
//
// 一致性与安全：
// - Cookie / IndexedDB 两类要求可靠一致快照（计划 2.3：源 Chrome 已退出或存在可靠一致
//   快照证据）：mac 上先用 lsof 探测源 profile 是否仍被任何进程打开（真进程证据，不以
//   LOCK 文件存在当运行证据——计划 6.4 红线），打开中整单 source-busy；复制后做结构校验
//   （Cookies 副本 SQLite quick_check、IndexedDB 副本逐站点 CURRENT→MANIFEST 可解析），
//   校验不过按 source-busy 拒绝——不做「边运行边抢拷」的乐观路径。history/localStorage
//   维持既有两类语义（复制容错、锁错误→chromeLocked 文案），不无故新增退出要求。
// - 只读源：绝不写用户 Chrome 目录；副本目录 0700；dispose 幂等整树删除；取消/TTL/失败/
//   退出清理统一走 dispose。不主动结束用户 Chrome 进程。
// - 不依赖 electron（纯 Node，可独立测试）。
import { execFile } from 'node:child_process'
import {
  chmod,
  copyFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  rm,
  stat
} from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import type { ChromeImportScope } from '../../../shared/chromeImport'
import type { ImportEngineError } from './types'
import { ImportEngineError as ImportEngineErrorClass } from './types'

const execFileP = promisify(execFile)

/** 固定源快照句柄：编排层以 planId 持有，dispose 是清理唯一出口 */
export interface ChromeSourceSnapshot {
  /** 副本根（内部 tmp 目录）；引擎上下文的 snapshotRoot */
  root: string
  /** profile 目录名（白名单成员，如 'Default'） */
  profileDir: string
  /** join(root, profileDir)——history/localStorage/cookies 的 profileDir 实参 */
  profilePath: string
  /** 快照覆盖的 scope 集（执行只允许消费这些） */
  scopes: ChromeImportScope[]
  /** 整树清理（幂等；取消/过期/失败/退出共用） */
  dispose: () => Promise<void>
}

/** 源快照错误即 ImportEngineError（reason 驱动结果文案与闭集原因码） */
export type { ImportEngineError }

export function createChromeSourceSnapshot(deps: {
  /** 副本根目录工厂（siteData/historySource 同款注入；测试可替换） */
  makeTempDir?: () => Promise<string>
  /** lsof 可执行文件（测试注入空实现跳过探测）；缺省 /usr/sbin/lsof */
  lsofBin?: string
  /** 平台（测试注入非 darwin 跳过 lsof） */
  platform?: NodeJS.Platform
}): {
  capture: (
    sourceProfilePath: string,
    profileDir: string,
    scopes: ChromeImportScope[]
  ) => Promise<ChromeSourceSnapshot>
} {
  const makeTempDir = deps.makeTempDir ?? (() => mkdtemp(join(tmpdir(), 'msb-chrome-import-')))
  const lsofBin = deps.lsofBin ?? '/usr/sbin/lsof'
  const platform = deps.platform ?? process.platform

  /** macOS：探测源 profile 是否仍被任意进程打开（进程级证据）。失败/非 mac 视为未知放行
   *  （后续结构校验兜底）；lsof 有输出即 source-busy——不主动结束进程，如实要求用户退出 */
  async function assertChromeExited(sourceProfilePath: string, needed: boolean): Promise<void> {
    if (!needed || platform !== 'darwin') return
    try {
      const { stdout } = await execFileP(lsofBin, ['-w', '-F', 'p', sourceProfilePath], {
        timeout: 10_000
      })
      if (stdout.trim() !== '') {
        throw new ImportEngineErrorClass(
          'source-busy',
          'Google Chrome 仍在占用源数据，请完全退出后重试'
        )
      }
    } catch (error) {
      if (error instanceof ImportEngineErrorClass) throw error
      // lsof 自身失败（未安装/超时）：不据以放行也不据以拒绝，交由复制后结构校验裁决
    }
  }

  /** SQLite 副本一致性证据：quick_check(ok) 可开可读（撕裂副本/半截 WAL 会失败） */
  async function verifySqliteCopy(dbPath: string, label: string): Promise<void> {
    let db: DatabaseSync | undefined
    try {
      db = new DatabaseSync(dbPath, { readOnly: true })
      const row = db.prepare('PRAGMA quick_check').get() as { quick_check?: string } | undefined
      if (!row || row.quick_check !== 'ok') {
        throw new ImportEngineErrorClass(
          'source-busy',
          `${label} 源数据快照不一致（Chrome 可能仍在运行）`
        )
      }
    } catch (error) {
      if (error instanceof ImportEngineErrorClass) throw error
      throw new ImportEngineErrorClass(
        'source-busy',
        `${label} 源数据快照校验失败（Chrome 可能仍在运行）`
      )
    } finally {
      db?.close()
    }
  }

  /** IndexedDB 副本死站点剔除（2026-10-28 真实 profile 实测修正）：真实用户 profile 的
   *  IndexedDB/ 常存多年陈旧孤儿站点（仅剩 LOCK/LOG 等 0 字节残留、无 CURRENT/MANIFEST/
   *  数据文件——本轮 bilibili 站点实测）。死站点不构成「Chrome 仍在运行」的一致性证据，
   *  不应阻塞整单导入：从快照副本剔除（引擎按站点级如实呈现）；「Chrome 仍在运行」由
   *  capture 前置的 lsof 进程探测承担；仍有数据文件但缺 CURRENT 的异常形态交由引擎
   *  prepare 按站点级拒绝 */
  async function pruneDeadSites(idbRoot: string): Promise<void> {
    let entries: string[]
    try {
      entries = await readdir(idbRoot)
    } catch {
      return // 空/缺目录＝无站点，非错误
    }
    for (const name of entries) {
      if (!name.endsWith('.indexeddb.leveldb')) continue
      const siteDir = join(idbRoot, name)
      try {
        const current = await open(join(siteDir, 'CURRENT'), 'r')
        await current.close()
      } catch {
        // 无 CURRENT：核对是否有任何实质数据文件——全无即死站点剔除
        let hasDataFile = false
        for (const f of await readdir(siteDir)) {
          if (f.startsWith('MANIFEST-') || f.endsWith('.log') || f.endsWith('.ldb')) {
            hasDataFile = true
            break
          }
        }
        if (!hasDataFile) {
          await rm(siteDir, { recursive: true, force: true }).catch(() => {})
          // 配对 .blob 目录同步剔除（审查 20261029181900 低-3）：引擎对孤立 .blob
          // 跳过不计故无行为影响，但同步清理保持快照「成对目录」单位口径对称、不留
          // 可能含站点 Blob 数据的孤儿目录
          const blobDir = siteDir.replace(/\.indexeddb\.leveldb$/, '.indexeddb.blob')
          if (blobDir !== siteDir) {
            await rm(blobDir, { recursive: true, force: true }).catch(() => {})
          }
        }
      }
    }
  }

  return {
    async capture(sourceProfilePath, profileDir, scopes): Promise<ChromeSourceSnapshot> {
      const needConsistency = scopes.includes('cookies') || scopes.includes('indexedDB')
      await assertChromeExited(sourceProfilePath, needConsistency)
      const root = await makeTempDir()
      const profilePath = join(root, profileDir)
      await mkdir(dirname(profilePath), { recursive: true })
      // 0700：副本含 Cookie 密文等，限当前用户访问（计划 2.3）
      await chmod(root, 0o700).catch(() => {})
      let disposed = false
      const snapshot: ChromeSourceSnapshot = {
        root,
        profileDir,
        profilePath,
        scopes,
        dispose: async () => {
          if (disposed) return
          disposed = true
          await rm(root, { recursive: true, force: true }).catch(() => {})
        }
      }
      try {
        if (scopes.includes('history')) {
          // History 与 journal/wal/shm（historySource 自身复制容错逻辑同款：可选项缺失跳过）
          await copyOne(join(sourceProfilePath, 'History'), join(profilePath, 'History'), true)
          for (const suffix of ['-journal', '-wal', '-shm']) {
            await copyOne(
              join(sourceProfilePath, `History${suffix}`),
              join(profilePath, `History${suffix}`),
              true
            )
          }
        }
        if (scopes.includes('localStorage')) {
          await copyTree(
            join(sourceProfilePath, 'Local Storage'),
            join(profilePath, 'Local Storage'),
            true
          )
        }
        if (scopes.includes('cookies')) {
          // 两种布局都试（Chrome 版本差异）：命中哪个复制哪个 + 伴生 journal 文件
          const layouts = ['Cookies', 'Network/Cookies']
          let copied: string | null = null
          for (const rel of layouts) {
            const src = join(sourceProfilePath, rel)
            if (await existsAsFile(src)) {
              const dst = join(profilePath, rel)
              await mkdir(dirname(dst), { recursive: true })
              await copyOne(src, dst, false)
              for (const suffix of ['-journal', '-wal', '-shm']) {
                await copyOne(`${src}${suffix}`, `${dst}${suffix}`, true)
              }
              copied = dst
              break
            }
          }
          if (copied !== null) await verifySqliteCopy(copied, 'Cookie')
        }
        if (scopes.includes('indexedDB')) {
          await copyTree(
            join(sourceProfilePath, 'IndexedDB'),
            join(profilePath, 'IndexedDB'),
            false
          )
          await pruneDeadSites(join(profilePath, 'IndexedDB'))
        }
        return snapshot
      } catch (error) {
        // 快照不完整即整单失败：清理半截副本后上抛（错误原样透传，source-busy 语义在
        // 编排层经 ImportEngineError.reason 呈现；非引擎错误包一层 io-error 供留痕）
        await snapshot.dispose()
        if (error instanceof ImportEngineErrorClass) throw error
        throw new ImportEngineErrorClass(
          'io-error',
          `源数据快照复制失败: ${error instanceof Error ? error.message.slice(0, 160) : String(error)}`
        )
      }
    }
  }
}

/** 锁占用错误码（Windows 下 Chrome 运行中占用源文件的典型形态；EBUSY/ETXTBSY 为
 *  Unix 家族对应码）——统一映射 source-busy，用户得到「关闭 Chrome 后重试」指引而
 *  非裸 io-error（审查 20261028170000 中-2，cookieSource copyWithLockGuard 同口径） */
const LOCK_ERRNOS = new Set(['EBUSY', 'EPERM', 'ETXTBSY', 'EACCES'])

function rethrowLockAsBusy(error: unknown): void {
  const code = (error as NodeJS.ErrnoException | null)?.code
  if (code !== undefined && LOCK_ERRNOS.has(code)) {
    throw new ImportEngineErrorClass(
      'source-busy',
      'Chrome 源数据文件被占用，请关闭 Google Chrome 后重试'
    )
  }
}

/** 单文件复制（optional=true 时源缺失静默跳过）；目录源按不支持错误上抛 */
async function copyOne(src: string, dst: string, optional: boolean): Promise<void> {
  const s = await statOrNull(src)
  if (s === null) {
    if (optional) return
    throw new Error(`源文件不存在: ${src}`)
  }
  if (!s.isFile()) throw new Error(`源不是文件: ${src}`)
  await mkdir(dirname(dst), { recursive: true })
  await copyFile(src, dst).catch((error: unknown) => {
    rethrowLockAsBusy(error)
    throw error
  })
}

/** 目录树复制（optional=true 时源缺失跳过） */
async function copyTree(src: string, dst: string, optional: boolean): Promise<void> {
  const s = await statOrNull(src)
  if (s === null) {
    if (optional) return
    throw new Error(`源目录不存在: ${src}`)
  }
  if (!s.isDirectory()) throw new Error(`源不是目录: ${src}`)
  await cp(src, dst, { recursive: true, force: true }).catch((error: unknown) => {
    rethrowLockAsBusy(error)
    throw error
  })
}

async function statOrNull(p: string): Promise<Awaited<ReturnType<typeof stat>> | null> {
  try {
    const l = await lstat(p)
    // 符号链接一律拒绝（引擎层同款防线；快照层先挡一层）
    if (l.isSymbolicLink()) throw new Error(`源路径是符号链接，拒绝: ${p}`)
    return await stat(p)
  } catch (error) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

async function existsAsFile(p: string): Promise<boolean> {
  const s = await statOrNull(p)
  return s !== null && s.isFile()
}
