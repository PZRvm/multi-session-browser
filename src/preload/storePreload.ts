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
        host.toggleAttribute('data-motion-paused', document.hidden)
        const shadow = host.attachShadow({ mode: 'closed' })
        const style = document.createElement('style')
        style.textContent = `:host{position:fixed;right:20px;bottom:20px;z-index:2147483647;color-scheme:light dark;perspective:600px}
          button{display:inline-flex;align-items:center;justify-content:center;gap:8px;font:600 15px system-ui,sans-serif;min-height:48px;max-width:calc(100vw - 40px);padding:12px 24px;border:0;border-radius:999px;background:var(--store-accent);color:var(--store-accent-ink);box-shadow:0 3px 10px #0000001f;cursor:pointer;animation:store-depth 2s ease-in-out infinite}
          button:hover:not(:disabled){background:var(--store-accent-strong)}button:active:not(:disabled){background:var(--store-accent-press)}
          button:disabled{animation:none}
          button[aria-busy="true"]{cursor:wait}
          button[aria-busy="true"]::before{content:"";width:14px;height:14px;flex-shrink:0;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:store-spin .8s linear infinite}
          :host([data-motion-paused]) button,:host([data-motion-paused]) button::before{animation-play-state:paused}
          @keyframes store-depth{0%,100%{transform:translateZ(0)}50%{transform:translateZ(32px)}}
          @keyframes store-spin{to{transform:rotate(360deg)}}
          @media(prefers-reduced-motion:reduce){button{animation:none}button[aria-busy="true"]::before{animation-duration:2s}}
          button:focus-visible{outline:3px solid var(--store-accent);outline-offset:4px}
          button:disabled:not([aria-busy="true"]){background:var(--store-raised);color:var(--store-ink-dim);box-shadow:none;cursor:default}
`
        button = document.createElement('button')
        button.type = 'button'
        // 先采样当前深度，再平滑回到基准；移出时从基准重启，避免动画撤销导致跳变。
        const control = button
        const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
        let settling: Animation | null = null
        const resume = (): void => {
          if (control.disabled || control.matches(':hover, :focus-visible')) return
          if (settling && settling.playState !== 'finished') return
          control.style.animation = 'none'
          void control.offsetWidth
          control.style.removeProperty('animation')
          control.style.removeProperty('animation-play-state')
          settling?.cancel()
          settling = null
        }
        const settle = (): void => {
          if (control.disabled || reducedMotion.matches) return
          const from = getComputedStyle(control).transform
          control.style.animationPlayState = 'paused'
          settling?.cancel()
          settling = control.animate([{ transform: from }, { transform: 'translateZ(0)' }], {
            duration: 500,
            easing: 'ease-out',
            fill: 'forwards'
          })
          settling.onfinish = resume
        }
        control.addEventListener('pointerenter', settle)
        control.addEventListener('pointerleave', resume)
        control.addEventListener('focus', () => {
          if (control.matches(':focus-visible')) settle()
        })
        control.addEventListener('blur', resume)
        reducedMotion.addEventListener('change', () => {
          if (reducedMotion.matches) settling?.finish()
        })
        button.addEventListener('click', async (event) => {
          if (!event.isTrusted || pending || !currentId) return
          const targetId = currentId
          pending = true
          button!.disabled = true
          button!.setAttribute('aria-busy', 'true')
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
      const theme = status.theme
      for (const [key, value] of Object.entries(theme)) {
        const variable = key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
        host!.style.setProperty(`--store-${variable}`, value)
      }
      currentId = id
      const busy = pending || status.installing
      button!.disabled = busy || status.installed
      button!.setAttribute('aria-busy', String(busy))
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
  document.addEventListener('visibilitychange', () => {
    host?.toggleAttribute('data-motion-paused', document.hidden)
  })
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
