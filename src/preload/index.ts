import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { BROWSER_CHANNELS } from '../shared/browser'
import type {
  BrowserSnapshot,
  CloseTabPayload,
  NavigatePayload,
  NewTabPayload,
  OkResult as BrowserOkResult,
  SetBoundsPayload,
  SwitchTabPayload
} from '../shared/browser'
import { SESSIONS_CHANNELS } from '../shared/sessions'
import type {
  CreateSessionPayload,
  DeleteSessionPayload,
  OkResult,
  RenameSessionPayload,
  SessionsSnapshot,
  SetActiveSessionPayload,
  StoredSession
} from '../shared/sessions'

// Custom APIs for renderer
const api = {
  sessions: {
    list: (): Promise<SessionsSnapshot> => ipcRenderer.invoke(SESSIONS_CHANNELS.list),
    create: (payload: CreateSessionPayload): Promise<StoredSession> =>
      ipcRenderer.invoke(SESSIONS_CHANNELS.create, payload),
    rename: (payload: RenameSessionPayload): Promise<StoredSession> =>
      ipcRenderer.invoke(SESSIONS_CHANNELS.rename, payload),
    delete: (payload: DeleteSessionPayload): Promise<OkResult> =>
      ipcRenderer.invoke(SESSIONS_CHANNELS.delete, payload),
    setActive: (payload: SetActiveSessionPayload): Promise<OkResult> =>
      ipcRenderer.invoke(SESSIONS_CHANNELS.setActive, payload)
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

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
