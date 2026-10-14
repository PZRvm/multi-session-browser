import type {
  CloseTabPayload,
  FindStartPayload,
  FindStopPayload,
  FoundInPageResult,
  NavigatePayload,
  NewTabPayload,
  OkResult,
  ReorderTabsPayload,
  SetBoundsPayload,
  SwitchTabPayload,
  TabDragEndPayload,
  TabDragHoverPayload,
  TabDragInsertPayload,
  TabDragOutcome,
  TabDragStartPayload,
  TabstripRectPayload
} from '../shared/browser'
import type { BrowserSnapshot } from '../shared/browser'
import type { HistoryChangedPayload, HistoryEntry } from '../shared/history'
import type {
  ChromeImportOptions,
  ChromeImportPlan,
  ChromeImportResolution,
  ChromeImportResult,
  ChromeProfilesPayload
} from '../shared/chromeImport'
import type {
  CaptureBeginPayload,
  CaptureBeginResult,
  CaptureDismissRequestPayload,
  CaptureFeedbackActionPayload,
  CaptureFeedbackDataPayload,
  CaptureFeedbackShowPayload,
  CaptureResult,
  CaptureSavePayload,
  CaptureSaveResult,
  CaptureState,
  CaptureStopResult
} from '../shared/capture'
import type {
  OmniboxSuggestDataPayload,
  OmniboxSuggestHoverPayload,
  OmniboxSuggestPickPayload,
  OmniboxSuggestShowPayload
} from '../shared/omniboxSuggest'
import type {
  AppearanceSnapshot,
  SetAppearanceModePayload,
  SetThemeColorPayload
} from '../shared/appearance'
import type {
  OkResult as SettingsOkResult,
  SetHomepagePayload,
  SetLanguagePayload,
  SetScreenshotShortcutPayload,
  SettingsAppInfo,
  SettingsSnapshot
} from '../shared/settings'
import type { NativeWindowButtonsVisiblePayload } from '../shared/shell'
import type {
  ConfirmDestructivePayload,
  ConfirmWorkspaceDeletePayload,
  ShowWorkspacePickerPayload,
  WorkspaceDeleteChoice,
  WorkspacePickerContext,
  WorkspacePickerPickPayload,
  WorkspacePickerResult
} from '../shared/dialog'
import type {
  BatchDeleteSessionsPayload,
  BatchOpenUrlPayload,
  CloneSessionPayload,
  CreateSessionPayload,
  CreateWorkspacePayload,
  DeleteSessionPayload,
  DeleteWorkspacePayload,
  MoveSessionToWorkspacePayload,
  MoveSessionsBatchResult,
  MoveSessionsToWorkspacePayload,
  RenameSessionPayload,
  RenameWorkspacePayload,
  ReorderSessionsPayload,
  ReorderWorkspacesPayload,
  SessionStatusesPayload,
  SessionsSnapshot,
  SetActiveSessionPayload,
  SetActiveWorkspacePayload,
  SetNotePayload,
  StoredSession,
  StoredWorkspace
} from '../shared/sessions'

declare global {
  interface Window {
    api: {
      appearance: {
        getState(): Promise<AppearanceSnapshot>
        setMode(payload: SetAppearanceModePayload): Promise<AppearanceSnapshot>
        setThemeColor(payload: SetThemeColorPayload): Promise<AppearanceSnapshot>
        onChanged(callback: (snapshot: AppearanceSnapshot) => void): () => void
      }
      sessions: {
        list(): Promise<SessionsSnapshot>
        create(payload: CreateSessionPayload): Promise<StoredSession>
        rename(payload: RenameSessionPayload): Promise<StoredSession>
        setNote(payload: SetNotePayload): Promise<StoredSession>
        delete(payload: DeleteSessionPayload): Promise<OkResult>
        setActive(payload: SetActiveSessionPayload): Promise<OkResult>
        getStatuses(): Promise<SessionStatusesPayload>
        onStatusChanged(callback: (payload: SessionStatusesPayload) => void): () => void
        onChanged(callback: (snapshot: SessionsSnapshot) => void): () => void
        clone(payload: CloneSessionPayload): Promise<StoredSession>
        deleteBatch(payload: BatchDeleteSessionsPayload): Promise<OkResult>
        batchOpenUrl(payload: BatchOpenUrlPayload): Promise<OkResult>
        reorder(payload: ReorderSessionsPayload): Promise<OkResult>
        workspaceCreate(payload: CreateWorkspacePayload): Promise<StoredWorkspace>
        workspaceRename(payload: RenameWorkspacePayload): Promise<StoredWorkspace>
        workspaceDelete(payload: DeleteWorkspacePayload): Promise<OkResult>
        workspaceMoveSession(payload: MoveSessionToWorkspacePayload): Promise<OkResult>
        workspaceMoveSessionsBatch(
          payload: MoveSessionsToWorkspacePayload
        ): Promise<MoveSessionsBatchResult>
        workspaceSetActive(payload: SetActiveWorkspacePayload): Promise<OkResult>
        workspaceReorder(payload: ReorderWorkspacesPayload): Promise<OkResult>
      }
      browser: {
        getState(): Promise<BrowserSnapshot>
        newTab(payload?: NewTabPayload): Promise<BrowserSnapshot>
        closeTab(payload: CloseTabPayload): Promise<BrowserSnapshot>
        switchTab(payload: SwitchTabPayload): Promise<BrowserSnapshot>
        reorderTabs(payload: ReorderTabsPayload): Promise<BrowserSnapshot>
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
        reportTabstripRect(payload: TabstripRectPayload): Promise<OkResult>
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
      omniboxSuggest: {
        show(payload: OmniboxSuggestShowPayload): Promise<OkResult>
        hide(): Promise<OkResult>
        hover(payload: OmniboxSuggestHoverPayload): Promise<OkResult>
        pick(payload: OmniboxSuggestPickPayload): Promise<OkResult>
        onData(callback: (payload: OmniboxSuggestDataPayload) => void): () => void
        onHovered(callback: (payload: OmniboxSuggestHoverPayload) => void): () => void
        onPicked(callback: (payload: OmniboxSuggestPickPayload) => void): () => void
      }
      chromeImport: {
        listProfiles(): Promise<ChromeProfilesPayload>
        dryRun(payload: ChromeImportOptions): Promise<ChromeImportPlan>
        execute(payload: ChromeImportResolution): Promise<ChromeImportResult>
      }
      /** 快速截图 + 快速录屏（契约 shared/capture.ts 两线融合：截图执行/反馈条编排 + 录制四意图与状态订阅） */
      capture: {
        capture(): Promise<CaptureResult>
        saveLast(payload: CaptureSavePayload): Promise<CaptureSaveResult>
        showFeedback(payload: CaptureFeedbackShowPayload): Promise<void>
        hideFeedback(): Promise<void>
        feedbackAction(payload: CaptureFeedbackActionPayload): Promise<void>
        begin(payload: CaptureBeginPayload): Promise<CaptureBeginResult>
        pause(): Promise<CaptureState>
        resume(): Promise<CaptureState>
        stop(): Promise<CaptureStopResult>
        onRequest(callback: () => void): () => void
        onFeedbackData(callback: (payload: CaptureFeedbackDataPayload) => void): () => void
        onDownloadRequest(callback: () => void): () => void
        onDismissRequest(callback: (payload: CaptureDismissRequestPayload) => void): () => void
        onStateChanged(callback: (state: CaptureState) => void): () => void
      }
      settings: {
        open(): Promise<SettingsOkResult>
        getAppInfo(): Promise<SettingsAppInfo>
        openDataDir(): Promise<SettingsOkResult>
        getHomepage(): Promise<SettingsSnapshot>
        setHomepage(payload: SetHomepagePayload): Promise<SettingsSnapshot>
        setLanguage(payload: SetLanguagePayload): Promise<SettingsSnapshot>
        setScreenshotShortcut(payload: SetScreenshotShortcutPayload): Promise<SettingsSnapshot>
        factoryReset(): Promise<SettingsOkResult>
        onChanged(callback: (snapshot: SettingsSnapshot) => void): () => void
      }
      shell: {
        setNativeWindowButtonsVisible(payload: NativeWindowButtonsVisiblePayload): Promise<void>
      }
      dialog: {
        confirmDestructive(payload: ConfirmDestructivePayload): Promise<boolean>
        confirmWorkspaceDelete(
          payload: ConfirmWorkspaceDeletePayload
        ): Promise<WorkspaceDeleteChoice>
        showWorkspacePicker(payload: ShowWorkspacePickerPayload): Promise<WorkspacePickerResult>
        workspacePickerPayload(): Promise<WorkspacePickerContext | null>
        workspacePickerPick(payload: WorkspacePickerPickPayload): Promise<OkResult>
        workspacePickerClose(): Promise<OkResult>
      }
    }
  }
}

export {}
