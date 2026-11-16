// 使用 Chromium 验证真实解码及解析 HTML；工具分区无凭据、无 preload，禁止自行联网。
import { BrowserWindow } from 'electron'

export function createHistoryIconTools(): {
  validate(data: string, signal: AbortSignal): Promise<boolean>
  findIcons(html: string, baseUrl: string): Promise<string[]>
  dispose(): void
} {
  let win: BrowserWindow | null = null
  let ready: Promise<void> | null = null
  let idle: ReturnType<typeof setTimeout> | null = null
  let pending = 0

  function dispose(): void {
    if (idle) clearTimeout(idle)
    idle = null
    const current = win
    win = null
    ready = null
    if (current && !current.isDestroyed()) current.destroy()
  }

  async function run<T>(source: string, fallback: T): Promise<T> {
    if (idle) clearTimeout(idle)
    pending++
    try {
      if (!win || win.isDestroyed()) {
        const created = new BrowserWindow({
          show: false,
          skipTaskbar: true,
          webPreferences: {
            partition: 'history-icon-tools',
            sandbox: true,
            nodeIntegration: false,
            contextIsolation: true,
            backgroundThrottling: false
          }
        })
        win = created
        created.webContents.session.webRequest.onBeforeRequest((details, callback) => {
          callback({ cancel: !details.url.startsWith('data:') && details.url !== 'about:blank' })
        })
        created.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) =>
          callback(false)
        )
        created.webContents.session.setPermissionCheckHandler(() => false)
        created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
        created.webContents.on('will-navigate', (event) => event.preventDefault())
        ready = created.loadURL(
          'data:text/html,' +
            encodeURIComponent(
              '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:">'
            )
        )
      }
      const current = win
      await ready
      if (current !== win || current.isDestroyed()) return fallback
      return (await current.webContents.executeJavaScript(source)) as T
    } catch {
      return fallback
    } finally {
      pending--
      if (!pending) idle = setTimeout(dispose, 1000)
    }
  }

  return {
    async validate(data, signal) {
      if (signal.aborted) return false
      let abort: () => void = () => {}
      const cancelled = new Promise<boolean>((resolve) => {
        abort = () => resolve(false)
        signal.addEventListener('abort', abort, { once: true })
      })
      try {
        return await Promise.race([
          cancelled,
          run(
            `new Promise(resolve => {
          const img = new Image()
          const finish = value => { clearTimeout(timer); img.onload = img.onerror = null; img.src = ''; resolve(value) }
          const timer = setTimeout(() => finish(false), 1500)
          img.onload = () => finish(img.naturalWidth > 0 && img.naturalHeight > 0)
          img.onerror = () => finish(false)
          img.src = ${JSON.stringify(data)}
        })`,
            false
          )
        ])
      } finally {
        signal.removeEventListener('abort', abort)
      }
    },
    findIcons(html, baseUrl) {
      return run(
        `(() => {
        const doc = new DOMParser().parseFromString(${JSON.stringify(html)}, 'text/html')
        let base = ${JSON.stringify(baseUrl)}
        try { base = new URL(doc.querySelector('base[href]')?.getAttribute('href') || base, base).href } catch {}
        const urls = []
        for (const link of doc.querySelectorAll('link[rel][href]')) {
          if (!link.getAttribute('rel').toLowerCase().split(/\\s+/).some(rel => rel === 'icon' || rel === 'apple-touch-icon')) continue
          try {
            const url = new URL(link.getAttribute('href'), base)
            if ((url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password && !urls.includes(url.href)) urls.push(url.href)
          } catch {}
          if (urls.length === 3) break
        }
        return urls
      })()`,
        []
      )
    },
    dispose
  }
}
