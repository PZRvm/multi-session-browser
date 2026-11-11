/**
 * 协议v1 桥 preload（E线）：contextBridge 暴露最小请求面。
 * 二进制经独立 ArrayBuffer 参数（结构化克隆），与 JSON 控制面分离。
 */
import { contextBridge, ipcRenderer } from 'electron'

const bridge = {
  request: (payload: unknown, binary?: ArrayBuffer): Promise<unknown> =>
    ipcRenderer.invoke('msb:extension-bridge', payload, binary)
}

contextBridge.exposeInMainWorld('extensionsBridge', bridge)
