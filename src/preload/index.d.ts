import type {
  CloseTabPayload,
  FindStartPayload,
  FindStopPayload,
  FoundInPageResult,
  NavigatePayload,
  NewTabPayload,
  OkResult,
  SetBoundsPayload,
  SwitchTabPayload,
  TabDragEndPayload,
  TabDragHoverPayload,
  TabDragInsertPayload,
  TabDragOutcome,
  TabDragStartPayload
} from '../shared/browser'
import type { BrowserSnapshot } from '../shared/browser'
import type { HistoryChangedPayload, HistoryEntry } from '../shared/history'
import type { AppearanceSnapshot, SetAppearanceModePayload } from '../shared/appearance'
import type {
  BatchDeleteSessionsPayload,
  BatchOpenUrlPayload,
  CloneSessionPayload,
  CreateSessionPayload,
  CreateWorkspacePayload,
  DeleteSessionPayload,
  DeleteWorkspacePayload,
  MoveSessionToWorkspacePayload,
  RenameSessionPayload,
  RenameWorkspacePayload,
  ReorderSessionsPayload,
  SessionStatusesPayload,
  SessionsSnapshot,
  SetActiveSessionPayload,
  SetActiveWorkspacePayload,
  StoredSession,
  StoredWorkspace
} from '../shared/sessions'

declare global {
  interface Window {
    api: {
      appearance: {
        getState(): Promise<AppearanceSnapshot>
        setMode(payload: SetAppearanceModePayload): Promise<AppearanceSnapshot>
        onChanged(callback: (snapshot: AppearanceSnapshot) => void): () => void
      }
      sessions: {
        list(): Promise<SessionsSnapshot>
        create(payload: CreateSessionPayload): Promise<StoredSession>
        rename(payload: RenameSessionPayload): Promise<StoredSession>
        delete(payload: DeleteSessionPayload): Promise<OkResult>
        setActive(payload: SetActiveSessionPayload): Promise<OkResult>
        getStatuses(): Promise<SessionStatusesPayload>
        onStatusChanged(callback: (payload: SessionStatusesPayload) => void): () => void
        clone(payload: CloneSessionPayload): Promise<StoredSession>
        deleteBatch(payload: BatchDeleteSessionsPayload): Promise<OkResult>
        batchOpenUrl(payload: BatchOpenUrlPayload): Promise<OkResult>
        reorder(payload: ReorderSessionsPayload): Promise<OkResult>
        workspaceCreate(payload: CreateWorkspacePayload): Promise<StoredWorkspace>
        workspaceRename(payload: RenameWorkspacePayload): Promise<StoredWorkspace>
        workspaceDelete(payload: DeleteWorkspacePayload): Promise<OkResult>
        workspaceMoveSession(payload: MoveSessionToWorkspacePayload): Promise<OkResult>
        workspaceSetActive(payload: SetActiveWorkspacePayload): Promise<OkResult>
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
        dragStart(payload: TabDragStartPayload): Promise<OkResult>
        dragEnd(payload: TabDragEndPayload): Promise<TabDragOutcome>
        dragInsert(payload: TabDragInsertPayload): Promise<OkResult>
        findStart(payload: FindStartPayload): Promise<OkResult>
        findStop(payload?: FindStopPayload): Promise<OkResult>
        getHistory(): Promise<HistoryEntry[]>
        onHistoryChanged(callback: (payload: HistoryChangedPayload) => void): () => void
        onStateChanged(callback: (snapshot: BrowserSnapshot) => void): () => void
        onFocusAddress(callback: () => void): () => void
        onDragHover(callback: (payload: TabDragHoverPayload) => void): () => void
        onFindRequest(callback: () => void): () => void
        onFindResult(callback: (result: FoundInPageResult) => void): () => void
      }
    }
  }
}

export {}
