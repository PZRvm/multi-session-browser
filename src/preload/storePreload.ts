/** 远程商店页专用隔离世界；不向主世界暴露任何Node或window.api。 */
import { ipcRenderer } from 'electron'
import {
  STORE_PAGE_CHANNELS,
  storeDetailId,
  type StorePageStatus
} from '../shared/extensions/storePage'

if (process.isMainFrame && location.origin === 'https://chromewebstore.google.com') {
  let host: HTMLDivElement | null = null
  let button: HTMLButtonElement | null = null
  let currentId: string | null = null
  let pending = false
  let updating = false

  const refresh = async (): Promise<void> => {
    if (updating) return
    const id = storeDetailId(location.href)
    if (!id) {
      host?.remove()
      host = null
      button = null
      currentId = null
      return
    }
    updating = true
    try {
      const status: StorePageStatus | null = await ipcRenderer.invoke(
        STORE_PAGE_CHANNELS.status,
        id
      )
      if (!status || id !== storeDetailId(location.href) || !document.body) return
      if (!host?.isConnected) {
        host = document.createElement('div')
        const shadow = host.attachShadow({ mode: 'closed' })
        const style = document.createElement('style')
        style.textContent = `:host{position:fixed;right:20px;bottom:20px;z-index:2147483647;color-scheme:light dark}
          button{font:500 14px system-ui,sans-serif;min-height:36px;max-width:calc(100vw - 40px);padding:8px 16px;border:1px solid #747775;border-radius:6px;background:#f1f3f4;color:#202124;cursor:pointer}
          button:hover:not(:disabled){background:#e3e3e3}button:focus-visible{outline:2px solid #1a73e8;outline-offset:3px}
          button:disabled{cursor:default;color:#5f6368}
          @media(prefers-color-scheme:dark){button{background:#303134;color:#e8eaed}button:hover:not(:disabled){background:#3c4043}button:disabled{color:#bdc1c6}}`
        button = document.createElement('button')
        button.type = 'button'
        button.addEventListener('click', async (event) => {
          if (!event.isTrusted || pending || !currentId) return
          const targetId = currentId
          pending = true
          button!.disabled = true
          button!.textContent = status.installingLabel
          try {
            await ipcRenderer.invoke(STORE_PAGE_CHANNELS.install, targetId)
          } catch (error) {
            console.warn('[商店] 安装请求失败:', error)
          } finally {
            pending = false
            void refresh()
          }
        })
        shadow.append(style, button)
        document.body.append(host)
      }
      currentId = id
      const busy = pending || status.installing
      button!.disabled = busy || status.installed
      button!.textContent = busy
        ? status.installingLabel
        : status.installed
          ? status.installedLabel
          : status.installLabel
    } finally {
      updating = false
    }
  }
  const update = (): void => {
    void refresh().catch(() => undefined)
  }
  window.addEventListener('DOMContentLoaded', update, { once: true })
  let timer = setInterval(update, 750)
  window.addEventListener('pagehide', () => clearInterval(timer))
  window.addEventListener('pageshow', () => {
    clearInterval(timer)
    timer = setInterval(update, 750)
    update()
  })
  update()
}
