import type {
  CloseTabPayload,
  NavigatePayload,
  NewTabPayload,
  OkResult,
  SetBoundsPayload,
  SwitchTabPayload
} from '../shared/browser'
import type { BrowserSnapshot } from '../shared/browser'
import type {
  CreateSessionPayload,
  DeleteSessionPayload,
  RenameSessionPayload,
  SessionsSnapshot,
  SetActiveSessionPayload,
  StoredSession
} from '../shared/sessions'

declare global {
  interface Window {
    api: {
      sessions: {
        list(): Promise<SessionsSnapshot>
        create(payload: CreateSessionPayload): Promise<StoredSession>
        rename(payload: RenameSessionPayload): Promise<StoredSession>
        delete(payload: DeleteSessionPayload): Promise<OkResult>
        setActive(payload: SetActiveSessionPayload): Promise<OkResult>
      }
      browser: {
        getState(): Promise<BrowserSnapshot>
        newTab(payload?: NewTabPayload): Promise<BrowserSnapshot>
        closeTab(payload: CloseTabPayload): Promise<BrowserSnapshot>
        switchTab(payload: SwitchTabPayload): Promise<BrowserSnapshot>
        navigate(payload: NavigatePayload): Promise<BrowserSnapshot>
        back(): Promise<BrowserSnapshot>
        forward(): Promise<BrowserSnapshot>
        reload(): Promise<BrowserSnapshot>
        stop(): Promise<BrowserSnapshot>
        setBounds(payload: SetBoundsPayload): Promise<OkResult>
        toggleDevTools(): Promise<BrowserSnapshot>
        closeDevTools(): Promise<BrowserSnapshot>
        onStateChanged(callback: (snapshot: BrowserSnapshot) => void): () => void
        onFocusAddress(callback: () => void): () => void
      }
    }
  }
}

export {}
