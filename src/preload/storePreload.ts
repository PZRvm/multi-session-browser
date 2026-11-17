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
          button{font:600 15px system-ui,sans-serif;min-height:48px;max-width:calc(100vw - 40px);padding:12px 24px;border:0;border-radius:8px;background:#0b57d0;color:#fff;box-shadow:0 4px 14px #0000003d;cursor:pointer}
          button:hover:not(:disabled){background:#0842a0}button:active:not(:disabled){background:#062e6f}
          button:focus-visible{outline:3px solid #0b57d0;outline-offset:4px}
          button:disabled{background:#e8eaed;color:#5f6368;box-shadow:none;cursor:default}
          @media(prefers-color-scheme:dark){button{background:#a8c7fa;color:#062e6f;box-shadow:0 4px 14px #00000066}button:hover:not(:disabled){background:#c2d7fb}button:active:not(:disabled){background:#8ab4f8}button:focus-visible{outline-color:#a8c7fa}button:disabled{background:#303134;color:#bdc1c6;box-shadow:none}}`
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
