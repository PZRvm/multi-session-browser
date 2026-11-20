import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { WebContentsView, type Session } from 'electron'

type StorageEntry = [key: string, value: string]
type StorageBackup = [key: string, value: string | null]

interface LocalStorageArea {
  read(keys: string[]): Promise<Map<string, string>>
  write(entries: StorageEntry[]): Promise<void>
  restore(entries: StorageBackup[]): Promise<void>
}

const documentHeaders = [
  { name: 'Content-Type', value: 'text/html; charset=utf-8' },
  {
    name: 'Content-Security-Policy',
    value: "sandbox allow-same-origin; default-src 'none'; base-uri 'none'; form-action 'none'"
  },
  { name: 'Cache-Control', value: 'no-store' }
]
const documentBody = Buffer.from('<!doctype html>').toString('base64')
const STORAGE_COMMAND_TIMEOUT_MS = 15_000
const STORAGE_WORKERS = 4

async function waitForBrowser<T>(task: Promise<T>, operation: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          console.warn(`[chromeImport] 浏览器存储操作超时: ${operation}`)
          reject(new Error('浏览器存储操作超时'))
        }, STORAGE_COMMAND_TIMEOUT_MS)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}

/** 同一阶段内每个站点只分给一个临时页面。错误后等已启动的任务全部退出再交还调用方。 */
export async function visitLocalStorageSites<T>(
  session: Session,
  sites: Map<string, T>,
  visit: (origin: string, value: T, area: LocalStorageArea) => Promise<void>,
  onProgress: (done: number, total: number) => void,
  continueOnError = false
): Promise<void> {
  const total = sites.size
  if (total === 0) return
  const remaining = sites.entries()
  let done = 0
  let stopped = false
  let lastReport = performance.now()
  onProgress(0, total)

  const worker = async (): Promise<void> => {
    let firstFailure: { error: unknown } | undefined
    while (!stopped) {
      let next = remaining.next()
      if (next.done) break
      let initialized = false
      try {
        await withLocalStorage(session, async (openArea) => {
          initialized = true
          try {
            while (!next.done && !stopped) {
              const [origin, value] = next.value
              const area = await openArea(origin)
              if (stopped) break
              await visit(origin, value, area)
              done += 1
              const now = performance.now()
              if (done === total || now - lastReport >= 500) {
                onProgress(done, total)
                lastReport = now
              }
              next = remaining.next()
            }
          } catch (error) {
            if (!continueOnError) stopped = true
            throw error
          }
        })
      } catch (error) {
        if (!continueOnError) {
          stopped = true
          throw error
        }
        firstFailure ??= { error }
        // 还原时单站点失败后换新页面继续。临时页面本身建立失败则结束该 worker。
        if (!initialized) break
      }
    }
    if (firstFailure) throw firstFailure.error
  }

  const results = await Promise.allSettled(
    Array.from({ length: Math.min(total, STORAGE_WORKERS) }, worker)
  )
  const failed = results.find((result) => result.status === 'rejected')
  if (failed) throw failed.reason
}

/** 在目标 Session 内访问 Chromium 当前的存储区。临时 view 只加载本地合成的同源空文档。 */
async function withLocalStorage<T>(
  session: Session,
  task: (openArea: (origin: string) => Promise<LocalStorageArea>) => Promise<T>
): Promise<T> {
  const view = new WebContentsView({
    webPreferences: { session, sandbox: true, contextIsolation: true, nodeIntegration: false }
  })
  const wc = view.webContents
  const client = wc.debugger
  const send = (
    method: string,
    params?: Record<string, unknown>
  ): ReturnType<typeof client.sendCommand> =>
    waitForBrowser(client.sendCommand(method, params), method)
  const path = `/.well-known/msb-local-storage-${randomUUID()}`
  let document: { url: string; response?: Promise<unknown> } | undefined
  const stopLoad = (): void => {
    if (!wc.isDestroyed()) wc.stop()
  }

  wc.setWindowOpenHandler(() => ({ action: 'deny' }))
  wc.on('will-navigate', (event) => event.preventDefault())
  wc.on('will-redirect', (event) => event.preventDefault())
  try {
    // 先建立初始 frame，Network 等调试命令才有接收方。
    await waitForBrowser(wc.loadURL('about:blank'), '初始临时页面')
    client.attach()
    await send('Network.setBypassServiceWorker', { bypass: true })
    await send('Network.setCacheDisabled', { cacheDisabled: true })
    await send('Network.emulateNetworkConditions', {
      offline: true,
      latency: 0,
      downloadThroughput: 0,
      uploadThroughput: 0
    })
    client.on('message', (_event, method, params) => {
      if (method !== 'Fetch.requestPaused') return
      const { requestId, resourceType, request } = params
      if (
        document &&
        !document.response &&
        resourceType === 'Document' &&
        request.method === 'GET' &&
        request.url === document.url
      ) {
        document.response = send('Fetch.fulfillRequest', {
          requestId,
          responseCode: 200,
          responseHeaders: documentHeaders,
          body: documentBody
        })
        void document.response.catch(stopLoad)
      } else {
        void client
          .sendCommand('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' })
          .catch(() => {})
      }
    })
    await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] })

    return await task(async (origin) => {
      const url = new URL(path, origin).href
      if (document?.url !== url) {
        const next: NonNullable<typeof document> = { url }
        document = next
        await waitForBrowser(wc.loadURL(url), '临时站点导航')
        if (wc.getURL() !== url || !next.response) throw new Error('同源存储文档未由本地提供')
        await next.response
      }

      const {
        frameTree: { frame }
      } = await send('Page.getFrameTree')
      const { executionContextId } = await send('Page.createIsolatedWorld', {
        frameId: frame.id,
        worldName: 'msb-local-storage'
      })
      // 只执行宿主生成的固定代码。JSON 转义保留 localStorage 中合法的单个 UTF-16 代理码元。
      const evaluate = async (code: string): Promise<unknown> => {
        const { result, exceptionDetails } = await send('Runtime.evaluate', {
          contextId: executionContextId,
          returnByValue: true,
          expression: `(() => {
            if (location.origin !== ${JSON.stringify(origin)}) throw new Error()
            ${code}
          })()`
        })
        if (exceptionDetails) throw new Error('浏览器存储操作失败')
        return result.value
      }
      const read = async (keys: string[]): Promise<Map<string, string>> => {
        const raw = await evaluate(`
          const entries = ${JSON.stringify(keys)}.map((key) => [key, localStorage.getItem(key)])
          return JSON.stringify(entries.filter(([, value]) => value !== null))
        `)
        if (typeof raw !== 'string') throw new Error('浏览器存储响应无效')
        return new Map(JSON.parse(raw) as StorageEntry[])
      }
      const verify = async (entries: StorageBackup[]): Promise<void> => {
        const actual = await read(entries.map(([key]) => key))
        if (entries.some(([key, value]) => (actual.get(key) ?? null) !== value)) {
          throw new Error('浏览器存储读回校验失败')
        }
      }

      return {
        read,
        async write(entries) {
          await evaluate(`
            for (const [key, value] of ${JSON.stringify(entries)}) localStorage.setItem(key, value)
          `)
          await verify(entries)
        },
        async restore(entries) {
          // 只还原已被改写的键，先移除其新值，避免还原过程中暂时超出配额。
          await evaluate(`
            const changed = ${JSON.stringify(entries)}.filter(([key, value]) => {
              return localStorage.getItem(key) !== value
            })
            for (const [key] of changed) localStorage.removeItem(key)
            for (const [key, value] of changed) {
              if (value !== null) localStorage.setItem(key, value)
            }
          `)
          await verify(entries)
        }
      }
    })
  } finally {
    if (!wc.isDestroyed()) {
      const closed = once(wc, 'destroyed')
      stopLoad()
      wc.close({ waitForBeforeUnload: false })
      await closed
    }
  }
}
