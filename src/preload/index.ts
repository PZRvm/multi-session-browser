import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
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
