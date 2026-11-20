import { once } from 'node:events'
import { WebContentsView, type Session } from 'electron'
import { ImportEngineError } from './types'

const INTERNALS_URL = 'chrome://indexeddb-internals/'
const COMMAND_TIMEOUT_MS = 15_000

/** 只在目标 Session 内调用 Chromium 的非删除式关库入口。 */
export function createIndexedDbCloser(
  session: Session,
  partitionDir: string
): {
  closeBucket: (levelDbDir: string) => Promise<void>
  dispose: () => Promise<void>
} {
  let view: WebContentsView | undefined
  return {
    async closeBucket(levelDbDir) {
      let timer: ReturnType<typeof setTimeout> | undefined
      const limit = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('IndexedDB 关库超时')), COMMAND_TIMEOUT_MS)
      })
      try {
        if (!view) {
          view = new WebContentsView({
            webPreferences: {
              session,
              sandbox: true,
              contextIsolation: true,
              nodeIntegration: false
            }
          })
          const wc = view.webContents
          wc.setWindowOpenHandler(() => ({ action: 'deny' }))
          wc.on('will-frame-navigate', (event) => event.preventDefault())
          wc.on('will-redirect', (event) => event.preventDefault())
          await Promise.race([wc.loadURL(INTERNALS_URL), limit])
          if (wc.getURL() !== INTERNALS_URL) throw new Error('IndexedDB 内部页面地址不匹配')
          await Promise.race([
            wc.executeJavaScript(`(async () => {
              const { IdbInternalsHandler } = await import('chrome://indexeddb-internals/indexed_db_internals.mojom-webui.js');
              const remote = IdbInternalsHandler.getRemote();
              const { error, partitions } = await remote.getAllBucketsAcrossAllStorageKeys();
              if (error !== null) throw new Error(error);
              // Mojo FilePath 在 Windows 使用 UTF-16 数组，在其他平台使用字符串。
              const pathOf = ({ path }) => typeof path === 'string'
                ? path : Array.from(path, unit => String.fromCharCode(unit)).join('');
              const partition = partitions.find(value => pathOf(value.partitionPath) === ${JSON.stringify(partitionDir)});
              if (!partition) throw new Error('未找到目标 IndexedDB 分区');
              const bucketsOf = value => value.originList.flatMap(origin =>
                origin.storageKeys.flatMap(key => key.buckets));
              const otherIds = new Set(partitions.filter(value => value !== partition)
                .flatMap(bucketsOf).map(bucket => bucket.bucketLocator.id.value));
              const targets = new Map();
              for (const bucket of bucketsOf(partition)) {
                if (!bucket.bucketLocator.isDefault) continue;
                for (const path of bucket.paths) targets.set(pathOf(path), bucket.bucketLocator.id);
              }
              globalThis.closeImportBucket = async path => {
                const id = targets.get(path);
                if (!id || otherIds.has(id.value)) throw new Error('无法唯一确认目标默认 IndexedDB 存储桶');
                const result = await remote.forceClose(id);
                if (result.error !== null) throw new Error(result.error);
              };
            })()`),
            limit
          ])
        }
        const wc = view.webContents
        if (wc.getURL() !== INTERNALS_URL) throw new Error('IndexedDB 内部页面地址不匹配')
        await Promise.race([
          wc.executeJavaScript(`globalThis.closeImportBucket(${JSON.stringify(levelDbDir)})`),
          limit
        ])
      } catch (error) {
        throw new ImportEngineError(
          'target-locked',
          `未能关闭目标 IndexedDB 存储桶（${String(error)}）`
        )
      } finally {
        clearTimeout(timer)
      }
    },
    async dispose() {
      if (!view || view.webContents.isDestroyed()) return
      const wc = view.webContents
      const closed = once(wc, 'destroyed')
      wc.close({ waitForBeforeUnload: false })
      await closed
    }
  }
}
