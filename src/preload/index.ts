import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { BROWSER_CHANNELS } from '../shared/browser'
import type {
  BrowserSnapshot,
  CloseTabPayload,
  NavigatePayload,
  NewTabPayload,
  OkResult as BrowserOkResult,
  SetBoundsPayload,
  SwitchTabPayload,
  TearOffTabPayload
} from '../shared/browser'
import { APPEARANCE_CHANNELS } from '../shared/appearance'
import type { AppearanceSnapshot, SetAppearanceModePayload } from '../shared/appearance'
import { SESSIONS_CHANNELS } from '../shared/sessions'
import type {
  BatchOpenUrlPayload,
  CloneSessionPayload,
  CreateSessionPayload,
  DeleteSessionPayload,
  OkResult,
  RenameSessionPayload,
  SessionStatusesPayload,
  SessionsSnapshot,
  SetActiveSessionPayload,
  StoredSession
} from '../shared/sessions'

// Custom APIs for renderer
const api = {
  appearance: {
    getState: (): Promise<AppearanceSnapshot> => ipcRenderer.invoke(APPEARANCE_CHANNELS.getState),
    setMode: (payload: SetAppearanceModePayload): Promise<AppearanceSnapshot> =>
      ipcRenderer.invoke(APPEARANCE_CHANNELS.setMode, payload),
    onChanged: (callback: (snapshot: AppearanceSnapshot) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, snapshot: AppearanceSnapshot): void => {
        callback(snapshot)
      }
      ipcRenderer.on(APPEARANCE_CHANNELS.changed, listener)
      return () => {
        ipcRenderer.removeListener(APPEARANCE_CHANNELS.changed, listener)
      }
    }
  },
  sessions: {
    list: (): Promise<SessionsSnapshot> => ipcRenderer.invoke(SESSIONS_CHANNELS.list),
    create: (payload: CreateSessionPayload): Promise<StoredSession> =>
      ipcRenderer.invoke(SESSIONS_CHANNELS.create, payload),
    rename: (payload: RenameSessionPayload): Promise<StoredSession> =>
      ipcRenderer.invoke(SESSIONS_CHANNELS.rename, payload),
    delete: (payload: DeleteSessionPayload): Promise<OkResult> =>
      ipcRenderer.invoke(SESSIONS_CHANNELS.delete, payload),
    setActive: (payload: SetActiveSessionPayload): Promise<OkResult> =>
      ipcRenderer.invoke(SESSIONS_CHANNELS.setActive, payload),
    getStatuses: (): Promise<SessionStatusesPayload> =>
      ipcRenderer.invoke(SESSIONS_CHANNELS.getStatuses),
    clone: (payload: CloneSessionPayload): Promise<StoredSession> =>
      ipcRenderer.invoke(SESSIONS_CHANNELS.clone, payload),
    deleteAll: (): Promise<OkResult> => ipcRenderer.invoke(SESSIONS_CHANNELS.deleteAll),
    batchOpenUrl: (payload: BatchOpenUrlPayload): Promise<OkResult> =>
      ipcRenderer.invoke(SESSIONS_CHANNELS.batchOpenUrl, payload),
    // 推送订阅：剥离 ipc 事件对象，回调只收全量状态 map；退订必须 removeListener 同一 listener
    onStatusChanged: (callback: (payload: SessionStatusesPayload) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, payload: SessionStatusesPayload): void => {
        callback(payload)
      }
      ipcRenderer.on(SESSIONS_CHANNELS.statusChanged, listener)
      return () => {
        ipcRenderer.removeListener(SESSIONS_CHANNELS.statusChanged, listener)
      }
    }
  },
  browser: {
    getState: (): Promise<BrowserSnapshot> => ipcRenderer.invoke(BROWSER_CHANNELS.getState),
    newTab: (payload?: NewTabPayload): Promise<BrowserSnapshot> =>
      ipcRenderer.invoke(BROWSER_CHANNELS.newTab, payload ?? {}),
    closeTab: (payload: CloseTabPayload): Promise<BrowserSnapshot> =>
      ipcRenderer.invoke(BROWSER_CHANNELS.closeTab, payload),
    switchTab: (payload: SwitchTabPayload): Promise<BrowserSnapshot> =>
      ipcRenderer.invoke(BROWSER_CHANNELS.switchTab, payload),
    navigate: (payload: NavigatePayload): Promise<BrowserSnapshot> =>
      ipcRenderer.invoke(BROWSER_CHANNELS.navigate, payload),
    back: (): Promise<BrowserSnapshot> => ipcRenderer.invoke(BROWSER_CHANNELS.back),
    forward: (): Promise<BrowserSnapshot> => ipcRenderer.invoke(BROWSER_CHANNELS.forward),
    reload: (): Promise<BrowserSnapshot> => ipcRenderer.invoke(BROWSER_CHANNELS.reload),
    stop: (): Promise<BrowserSnapshot> => ipcRenderer.invoke(BROWSER_CHANNELS.stop),
    setBounds: (payload: SetBoundsPayload): Promise<BrowserOkResult> =>
      ipcRenderer.invoke(BROWSER_CHANNELS.setBounds, payload),
    toggleDevTools: (): Promise<BrowserSnapshot> =>
      ipcRenderer.invoke(BROWSER_CHANNELS.toggleDevTools),
    closeDevTools: (): Promise<BrowserSnapshot> =>
      ipcRenderer.invoke(BROWSER_CHANNELS.closeDevTools),
    // 移出 Tab 为独立窗口（作用域 = 本窗口；阶段 9 拖拽手势替换临时右键入口，通道保留）
    tearOffTab: (payload: TearOffTabPayload): Promise<BrowserSnapshot> =>
      ipcRenderer.invoke(BROWSER_CHANNELS.tearOffTab, payload),
    // 推送订阅：listener 内剥离 ipc 事件对象，renderer 回调只收 payload；退订必须 removeListener 同一 listener
    onStateChanged: (callback: (snapshot: BrowserSnapshot) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, snapshot: BrowserSnapshot): void => {
        callback(snapshot)
      }
      ipcRenderer.on(BROWSER_CHANNELS.stateChanged, listener)
      return () => {
        ipcRenderer.removeListener(BROWSER_CHANNELS.stateChanged, listener)
      }
    },
    onFocusAddress: (callback: () => void): (() => void) => {
      const listener = (): void => {
        callback()
      }
      ipcRenderer.on(BROWSER_CHANNELS.focusAddress, listener)
      return () => {
        ipcRenderer.removeListener(BROWSER_CHANNELS.focusAddress, listener)
      }
    }
  }
}

// 只暴露白名单 api 桥，不再暴露 @electron-toolkit/preload 的 electronAPI
// （其含原始 ipcRenderer 与 process 对象，会让 renderer 绕过 api 白名单任意
// invoke 全部 IPC 通道——安全边界收口，renderer 一律经 window.api 通信）。
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.api = api
}
