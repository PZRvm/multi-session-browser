import { contextBridge, ipcRenderer } from 'electron'

// 仅给 Electron 内置 DevTools 使用，不暴露到应用壳或被测网页。
contextBridge.exposeInMainWorld('__msbDevToolsLayout', {
  report: (message: unknown) => ipcRenderer.send('msb:devtools-layout', message)
})

window.addEventListener(
  'DOMContentLoaded',
  () => {
    contextBridge.executeInMainWorld({
      func: () => {
        const hostWindow = globalThis as unknown as {
          DevToolsHost?: { sendMessageToEmbedder: (message: string) => void }
          __msbDevToolsLayout: { report: (message: unknown) => void }
        }
        let attempts = 0
        const install = (): void => {
          const host = hostWindow.DevToolsHost
          if (!host) {
            if (++attempts < 300) setTimeout(install, 10)
            else hostWindow.__msbDevToolsLayout.report({ method: 'hostUnavailable' })
            return
          }
          const send = host.sendMessageToEmbedder.bind(host)
          const forwarded = new Set([
            'setIsDocked',
            'setInspectedPageBounds',
            'closeWindow',
            'bringToFront',
            'activateWindow'
          ])
          host.sendMessageToEmbedder = (raw: string): void => {
            try {
              const message = JSON.parse(raw)
              if (forwarded.has(message.method)) hostWindow.__msbDevToolsLayout.report(message)
            } catch {
              // 解析失败仍交给原生宿主，不改变原生消息处理。
            }
            send(raw)
          }
          hostWindow.__msbDevToolsLayout.report({ method: 'hostReady' })
          window.dispatchEvent(new Event('resize'))
        }
        install()
      }
    })
  },
  { once: true }
)
