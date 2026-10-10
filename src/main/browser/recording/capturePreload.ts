// 采集器专用桥（录屏线 A' 架构，计划 20261009231903 步骤 5）：只挂进采集器 view
// （captureView.ts 建造时 webPreferences.preload 指定本产物），不进主 preload 白名单
// ——UI renderer 拿不到 __msbCapture，媒体分块链路与 UI 契约面（window.api.capture）
// 物理分离。通道常量与 UI 面同源于 shared/capture.ts（通道名禁手写）。
import { contextBridge, ipcRenderer } from 'electron'
import { COLLECTOR_CHANNELS } from '../../../shared/capture'

const collectorApi = {
  /** 采集就绪（getDisplayMedia 已通过、MediaRecorder 已建未 start——主进程收到后放行状态推送） */
  ready: (): void => {
    void ipcRenderer.invoke(COLLECTOR_CHANNELS.ready)
  },
  /** 媒体分块上行（ArrayBuffer） */
  saveChunk: (buf: ArrayBuffer): void => {
    void ipcRenderer.invoke(COLLECTOR_CHANNELS.chunk, buf)
  },
  /** 失败上报（getDisplayMedia 拒绝 / MediaRecorder 错误 / 指令执行异常） */
  reportError: (message: string): void => {
    void ipcRenderer.invoke(COLLECTOR_CHANNELS.error, message)
  },
  /** 停止完成上报（onstop 后主进程做 finalize 收尾） */
  reportStopped: (): void => {
    void ipcRenderer.invoke(COLLECTOR_CHANNELS.stopped)
  },
  /** 指令下行订阅（'pause' | 'resume' | 'stop'）；返回退订函数 */
  onCommand: (handler: (cmd: string) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, cmd: string): void => {
      handler(cmd)
    }
    ipcRenderer.on(COLLECTOR_CHANNELS.command, listener)
    return () => {
      ipcRenderer.removeListener(COLLECTOR_CHANNELS.command, listener)
    }
  }
}

contextBridge.exposeInMainWorld('__msbCapture', collectorApi)
