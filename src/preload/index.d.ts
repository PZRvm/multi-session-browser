import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  CreateSessionPayload,
  DeleteSessionPayload,
  OkResult,
  RenameSessionPayload,
  SessionsSnapshot,
  SetActiveSessionPayload,
  StoredSession
} from '../shared/sessions'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      sessions: {
        list(): Promise<SessionsSnapshot>
        create(payload: CreateSessionPayload): Promise<StoredSession>
        rename(payload: RenameSessionPayload): Promise<StoredSession>
        delete(payload: DeleteSessionPayload): Promise<OkResult>
        setActive(payload: SetActiveSessionPayload): Promise<OkResult>
      }
    }
  }
}

export {}
