import { cp, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ClassicLevel } from 'classic-level'
import { webContents } from 'electron'
import type {
  ChromeImportPolicy,
  ChromeImportProgress,
  ChromeImportScopeResult,
  ChromeImportStoragePhase
} from '../../../shared/chromeImport'
import { t } from '../../i18n'
import { visitLocalStorageSites } from './localStorageRuntime'
import { ImportEngineError, type ImportEngine, type ImportEngineContext } from './types'

interface PreparedRecord {
  key: string
  incoming: string
  previous: string | null
}

export interface ChromeSiteDataArtifacts {
  sites: Map<string, PreparedRecord[]>
  unsupported: number
}

interface StorageRecords {
  sites: Map<string, Map<string, string>>
  unsupported: number
}

// Chromium Blink LocalStorage 编码带一个字节的标签，后跟原始 UTF-16LE 或 Latin1。
function decode(value: Buffer): string | null {
  if (value[0] === 1) return value.subarray(1).toString('latin1')
  if (value[0] === 0 && value.length % 2 === 1) return value.subarray(1).toString('utf16le')
  return null
}

function siteOrigin(storageKey: string): string | null {
  const url = URL.parse(storageKey)
  // 副本可能包含扩展、文件或带顶层站点的 storage key。不可降级成普通第一方记录。
  return url && (url.protocol === 'https:' || url.protocol === 'http:') && url.origin === storageKey
    ? url.origin
    : null
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/** 只打开临时副本，活跃目标库不交给 classic-level。 */
async function readRecords(path: string): Promise<StorageRecords> {
  const sites: StorageRecords['sites'] = new Map()
  let unsupported = 0
  const db = new ClassicLevel<Buffer, Buffer>(path, {
    createIfMissing: false,
    keyEncoding: 'buffer',
    valueEncoding: 'buffer'
  })
  try {
    const version = await db.get(Buffer.from('VERSION'))
    if (version !== undefined && version.toString() !== '1') {
      throw new ImportEngineError(
        'source-layout-unknown',
        t('chromeImport.result.reasonUnsupported')
      )
    }
    for await (const [rawKey, rawValue] of db.iterator({
      gte: Buffer.from('_'),
      lt: Buffer.from('`')
    })) {
      const sep = rawKey.indexOf(0, 1)
      const origin = sep > 1 ? siteOrigin(rawKey.subarray(1, sep).toString('utf8')) : null
      const key = sep > 1 ? decode(rawKey.subarray(sep + 1)) : null
      const value = decode(rawValue)
      if (origin === null || key === null || value === null) {
        unsupported++
        continue
      }
      let records = sites.get(origin)
      if (!records) sites.set(origin, (records = new Map()))
      // 同一字符串有两种编码时，LevelDB 顺序使 Latin1 覆盖 UTF-16，沿用 Chromium 选择。
      records.set(key, value)
    }
    return { sites, unsupported }
  } finally {
    await db.close()
  }
}

async function removeTemp(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true }).catch((error: unknown) => {
    console.warn(`[chromeImport] 清理 localStorage 临时目录失败: ${dir}`, error)
  })
}

export function createChromeSiteDataMerge(deps: { makeTempDir: () => Promise<string> }): {
  prepare: ImportEngine<ChromeSiteDataArtifacts>['prepare']
  apply(
    context: ImportEngineContext,
    artifacts: ChromeSiteDataArtifacts,
    policy: ChromeImportPolicy,
    report?: (progress: ChromeImportProgress) => void
  ): Promise<ChromeImportScopeResult>
} {
  return {
    async prepare(context) {
      const sourcePath = join(context.snapshotRoot, context.profileDir, 'Local Storage', 'leveldb')
      const source = (await directoryExists(sourcePath))
        ? await readRecords(sourcePath)
        : { sites: new Map<string, Map<string, string>>(), unsupported: 0 }
      let target: StorageRecords['sites'] = new Map()
      const targetPath = join(context.partitionDir, 'Local Storage', 'leveldb')
      if (source.sites.size > 0 && (await directoryExists(targetPath))) {
        const temp = await deps.makeTempDir()
        try {
          const copy = join(temp, 'target')
          await cp(targetPath, copy, { recursive: true })
          target = (await readRecords(copy)).sites
        } finally {
          await removeTemp(temp)
        }
      }

      const sites: ChromeSiteDataArtifacts['sites'] = new Map()
      let added = 0
      let merged = 0
      let conflicts = 0
      let conflictSites = 0
      for (const [origin, records] of source.sites) {
        const prepared: PreparedRecord[] = []
        const existing = target.get(origin)
        const priorConflicts = conflicts
        for (const [key, incoming] of records) {
          const previous = existing?.get(key) ?? null
          prepared.push({ key, incoming, previous })
          if (previous === null) added++
          else if (previous === incoming) merged++
          else conflicts++
        }
        if (conflicts > priorConflicts) conflictSites++
        sites.set(origin, prepared)
      }
      return {
        plan: {
          scope: 'localStorage',
          unit: 'records',
          total: added + merged + conflicts + source.unsupported,
          added,
          merged,
          conflicts,
          conflictSites,
          unsupported: source.unsupported,
          notes: source.unsupported > 0 ? ['source-layout-unknown'] : []
        },
        artifacts: { sites, unsupported: source.unsupported }
      }
    },

    async apply({ session }, { sites, unsupported }, policy, report) {
      const result: ChromeImportScopeResult = {
        scope: 'localStorage',
        unit: 'records',
        status: sites.size === 0 && unsupported > 0 ? 'unsupported' : 'done',
        added: 0,
        merged: 0,
        conflictsResolved: 0,
        unsupported,
        skipped: 0
      }
      if (sites.size === 0) return result
      if (
        webContents.getAllWebContents().some((wc) => !wc.isDestroyed() && wc.session === session)
      ) {
        throw new ImportEngineError('target-locked', t('errors.sessionBusy'), true)
      }

      const pending = new Map<string, PreparedRecord[]>()
      const touched = new Map<string, [string, string | null][]>()
      let backupDir: string | undefined
      let retainBackup = false
      const progressFor = (stage: ChromeImportStoragePhase) => (done: number, total: number) =>
        report?.({ stage, done, total })
      const checkingStart = performance.now()
      try {
        session.flushStorageData()
        await visitLocalStorageSites(
          session,
          sites,
          async (origin, records, area) => {
            const actual = await area.read(records.map(({ key }) => key))
            const writes: PreparedRecord[] = []
            for (const record of records) {
              const { key, incoming, previous } = record
              if ((actual.get(key) ?? null) !== previous) {
                throw new ImportEngineError(
                  'target-changed',
                  t('chromeImport.result.reasonTargetChanged'),
                  true
                )
              }
              if (previous === incoming) {
                result.merged++
              } else if (previous === null) {
                result.added++
                writes.push(record)
              } else {
                result.conflictsResolved++
                if (policy === 'chrome') writes.push(record)
                else result.merged++
              }
            }
            if (writes.length > 0) pending.set(origin, writes)
          },
          progressFor('checkingStorage')
        )
        const checkingMs = Math.round(performance.now() - checkingStart)
        if (pending.size > 0) {
          // 全部站点核对后，先持久化原值，再允许任何一个写入任务开始。
          backupDir = await deps.makeTempDir()
          const backup = Array.from(pending, ([origin, writes]) => ({
            origin,
            entries: writes.map(({ key, previous }) => [key, previous])
          }))
          await writeFile(join(backupDir, 'local-storage-backup.json'), JSON.stringify(backup), {
            mode: 0o600,
            flush: true
          })
        }

        const writingStart = performance.now()
        await visitLocalStorageSites(
          session,
          pending,
          async (origin, writes, area) => {
            touched.set(
              origin,
              writes.map(({ key, previous }) => [key, previous])
            )
            await area.write(writes.map(({ key, incoming }) => [key, incoming]))
          },
          progressFor('writingStorage')
        )
        if (touched.size > 0) session.flushStorageData()
        const writingMs = Math.round(performance.now() - writingStart)
        console.info(
          `[chromeImport] localStorage 核对 ${sites.size} 个站点（${checkingMs} ms），写入 ${pending.size} 个站点（${writingMs} ms）`
        )
        return result
      } catch (error) {
        if (touched.size > 0) {
          try {
            await visitLocalStorageSites(
              session,
              touched,
              async (_origin, entries, area) => area.restore(entries),
              progressFor('rollingBackStorage'),
              true
            )
          } catch {
            retainBackup = true
          }
          try {
            session.flushStorageData()
          } catch {
            retainBackup = true
          }
          if (retainBackup) {
            console.warn(`[chromeImport] 无法还原 localStorage，备份保留在 ${backupDir}`)
            throw new ImportEngineError('rollback-failed', t('chromeImport.result.reasonRollback'))
          }
        }
        if (error instanceof ImportEngineError) throw error
        throw new ImportEngineError('io-error', t('chromeImport.result.reasonLocalStorageIo'))
      } finally {
        if (backupDir && !retainBackup) await removeTemp(backupDir)
      }
    }
  }
}
