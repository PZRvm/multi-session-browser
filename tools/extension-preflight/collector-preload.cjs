/* eslint @typescript-eslint/explicit-function-return-type: off, @typescript-eslint/no-require-imports: off -- 独立验证脚本使用原生 JavaScript，sandbox preload 使用 CommonJS */
const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('preflightCollector', {
  complete: (payload) => ipcRenderer.invoke('preflight:collector', payload),
  request: (payload, binary) => ipcRenderer.invoke('preflight:contract', payload, binary)
})
