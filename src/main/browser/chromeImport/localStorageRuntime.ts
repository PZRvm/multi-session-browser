import { randomUUID } from 'node:crypto'
import { WebContentsView, type Session } from 'electron'

type StorageEntry = [key: string, value: string]
type StorageBackup = [key: string, value: string | null]

interface LocalStorageArea {
  read(): Promise<Map<string, string>>
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

/** 在目标 Session 内访问 Chromium 当前的存储区。临时 view 只加载本地合成的同源空文档。 */
export async function withLocalStorage<T>(
  session: Session,
  task: (openArea: (origin: string) => Promise<LocalStorageArea>) => Promise<T>
): Promise<T> {
  const view = new WebContentsView({
    webPreferences: { session, sandbox: true, contextIsolation: true, nodeIntegration: false }
  })
  const wc = view.webContents
  const client = wc.debugger
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
    await wc.loadURL('about:blank')
    client.attach()
    await client.sendCommand('Network.setBypassServiceWorker', { bypass: true })
    await client.sendCommand('Network.setCacheDisabled', { cacheDisabled: true })
    await client.sendCommand('Network.emulateNetworkConditions', {
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
        document.response = client.sendCommand('Fetch.fulfillRequest', {
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
    await client.sendCommand('Fetch.enable', { patterns: [{ urlPattern: '*' }] })

    return await task(async (origin) => {
      const url = new URL(path, origin).href
      if (document?.url !== url) {
        const next: NonNullable<typeof document> = { url }
        document = next
        const timer = setTimeout(stopLoad, 10_000)
        try {
          await wc.loadURL(url)
          if (wc.getURL() !== url || !next.response) throw new Error('同源存储文档未由本地提供')
          await next.response
        } finally {
          clearTimeout(timer)
        }
      }

      const {
        frameTree: { frame }
      } = await client.sendCommand('Page.getFrameTree')
      const { executionContextId } = await client.sendCommand('Page.createIsolatedWorld', {
        frameId: frame.id,
        worldName: 'msb-local-storage'
      })
      // 只执行宿主生成的固定代码。JSON 转义保留 localStorage 中合法的单个 UTF-16 代理码元。
      const evaluate = async (code: string): Promise<unknown> => {
        const { result, exceptionDetails } = await client.sendCommand('Runtime.evaluate', {
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
      const read = async (): Promise<Map<string, string>> => {
        const raw = await evaluate(`
          const entries = []
          for (let index = 0; index < localStorage.length; index++) {
            const key = localStorage.key(index)
            entries.push([key, localStorage.getItem(key)])
          }
          return JSON.stringify(entries)
        `)
        if (typeof raw !== 'string') throw new Error('浏览器存储响应无效')
        return new Map(JSON.parse(raw) as StorageEntry[])
      }
      const verify = async (entries: StorageBackup[]): Promise<void> => {
        const actual = await read()
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
    if (!wc.isDestroyed()) wc.close({ waitForBeforeUnload: false })
  }
}
