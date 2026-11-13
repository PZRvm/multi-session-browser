import type { ToolbarTooltipPayload } from '../shared/toolbarTooltip'
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
  ChromeImportCancelPayload,
  ChromeImportCancelResult,
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
  CaptureEditApplyPayload,
  CaptureEditImagePayload,
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
  OmniboxSuggestShowPayload,
  OmniboxSuggestShowResult
} from '../shared/omniboxSuggest'
import type {
  ExtensionsPanelDataPayload,
  ExtensionsPanelPickedPayload,
  ExtensionsPanelPickPayload,
  ExtensionsPanelShowPayload
} from '../shared/extensionsPanel'
import type {
  AppearanceSnapshot,
  SetAppearanceModePayload,
  SetThemeColorPayload
} from '../shared/appearance'
import type {
  OkResult as SettingsOkResult,
  SetHomepagePayload,
  SetLanguagePayload,
  SetShowCapturePayload,
  SetShowRecorderPayload,
  SettingsAppInfo,
  SettingsSnapshot
} from '../shared/settings'
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
  CheckProxyPayload,
  CloneSessionPayload,
  CreateSessionPayload,
  CreateWorkspacePayload,
  DeleteSessionPayload,
  DeleteWorkspacePayload,
  MoveSessionToWorkspacePayload,
  PopupRowMenuPayload,
  PopupWorkspaceMenuPayload,
  ProxyCheckResult,
  RenameSessionPayload,
  RowMenuActionPayload,
  WorkspaceMenuActionPayload,
  RenameWorkspacePayload,
  ReorderSessionsPayload,
  ReorderWorkspacesPayload,
  SessionStatusesPayload,
  SessionsSnapshot,
  SetActiveSessionPayload,
  SetActiveWorkspacePayload,
  SetNotePayload,
  SetProxyPayload,
  StoredSession,
  StoredWorkspace
} from '../shared/sessions'

declare global {
  interface Window {
    api: {
      toolbarTooltip: {
        show(payload: ToolbarTooltipPayload): Promise<void>
        hide(): Promise<void>
      }
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
        reorder(payload: ReorderSessionsPayload): Promise<OkResult>
        workspaceCreate(payload: CreateWorkspacePayload): Promise<StoredWorkspace>
        workspaceRename(payload: RenameWorkspacePayload): Promise<StoredWorkspace>
        workspaceDelete(payload: DeleteWorkspacePayload): Promise<OkResult>
        workspaceMoveSession(payload: MoveSessionToWorkspacePayload): Promise<OkResult>
        workspaceSetActive(payload: SetActiveWorkspacePayload): Promise<OkResult>
        workspaceReorder(payload: ReorderWorkspacesPayload): Promise<OkResult>
        /** 独立代理增量（2026-10-15）：保存（非空）/ 清除（null），返回更新后会话 */
        setProxy(payload: SetProxyPayload): Promise<StoredSession>
        /** 独立代理增量（2026-10-15）：按草稿值探测该会话出口 IP（不落盘） */
        checkProxy(payload: CheckProxyPayload): Promise<ProxyCheckResult>
        /** 行原生菜单增量：请求主进程在指定视口坐标弹出系统原生菜单 */
        popupRowMenu(payload: PopupRowMenuPayload): void
        /** 行原生菜单增量：订阅菜单项点击结论（定向推回发起窗口） */
        onRowMenuAction(callback: (payload: RowMenuActionPayload) => void): () => void
        /** 工作区原生菜单增量（2026-10-27）：请求主进程在指定视口坐标弹出工作区原生菜单 */
        popupWorkspaceMenu(payload: PopupWorkspaceMenuPayload): void
        /** 工作区原生菜单增量（2026-10-27）：订阅菜单项点击结论（定向推回发起窗口） */
        onWorkspaceMenuAction(callback: (payload: WorkspaceMenuActionPayload) => void): () => void
      }
      browser: {
        getState(): Promise<BrowserSnapshot>
        newTab(payload?: NewTabPayload): Promise<BrowserSnapshot>
        closeTab(payload: CloseTabPayload): Promise<BrowserSnapshot>
        switchTab(payload: SwitchTabPayload): Promise<BrowserSnapshot>
        reorderTabs(payload: ReorderTabsPayload): Promise<BrowserSnapshot>
        /** 将本独立窗口全部 Tab 合回主窗口；来源由主进程解析 */
        mergeToMain(): Promise<BrowserOkResult>
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
        show(payload: OmniboxSuggestShowPayload): Promise<OmniboxSuggestShowResult>
        hide(): Promise<OkResult>
        hover(payload: OmniboxSuggestHoverPayload): Promise<OkResult>
        pick(payload: OmniboxSuggestPickPayload): Promise<OkResult>
        setMousePassthrough(enabled: boolean): Promise<OkResult>
        onData(callback: (payload: OmniboxSuggestDataPayload) => void): () => void
        onHovered(callback: (payload: OmniboxSuggestHoverPayload) => void): () => void
        onPicked(callback: (payload: OmniboxSuggestPickPayload) => void): () => void
      }
      chromeImport: {
        listProfiles(): Promise<ChromeProfilesPayload>
        dryRun(payload: ChromeImportOptions): Promise<ChromeImportPlan>
        execute(payload: ChromeImportResolution): Promise<ChromeImportResult>
        cancel(payload: ChromeImportCancelPayload): Promise<ChromeImportCancelResult>
      }
      /** 快速截图 + 快速录屏（契约 shared/capture.ts 两线融合：截图执行/反馈条编排 + 录制四意图与状态订阅） */
      capture: {
        capture(): Promise<CaptureResult>
        saveLast(payload: CaptureSavePayload): Promise<CaptureSaveResult>
        showFeedback(payload: CaptureFeedbackShowPayload): Promise<void>
        hideFeedback(): Promise<void>
        feedbackAction(payload: CaptureFeedbackActionPayload): Promise<void>
        openEditor(): Promise<void>
        /** 读取本编辑窗绑定的图像版本，产出后重取本窗成品。 */
        getEditImage(): Promise<CaptureEditImagePayload>
        editCopy(payload: CaptureEditApplyPayload): Promise<void>
        editDownload(payload: CaptureEditApplyPayload): Promise<CaptureSaveResult>
        begin(payload: CaptureBeginPayload): Promise<CaptureBeginResult>
        pause(): Promise<CaptureState>
        resume(): Promise<CaptureState>
        stop(): Promise<CaptureStopResult>
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
        setShowCapture(payload: SetShowCapturePayload): Promise<SettingsSnapshot>
        setShowRecorder(payload: SetShowRecorderPayload): Promise<SettingsSnapshot>
        factoryReset(): Promise<SettingsOkResult>
        onChanged(callback: (snapshot: SettingsSnapshot) => void): () => void
      }
      extensions: {
        list(): Promise<import('../../shared/extensions/management').ExtensionListResult>
        installFromStore(
          id: string
        ): Promise<import('../../shared/extensions/management').InstallResult>
        importCrx(): Promise<import('../../shared/extensions/management').InstallResult>
        uninstall(id: string): Promise<import('../../shared/extensions/management').UninstallResult>
        openStore(): Promise<{ ok: boolean; error?: string }>
        /** 拖拽 CRX 导入：path 为落盘路径（webUtils 取得） */
        importCrxFromPath(path: string): Promise<
          import('../shared/extensions/management').InstallResult
        >
        /** File → 落盘路径（webUtils） */
        getCrxPath(file: File): string
        openPopup(
          id: string,
          anchor: { x: number; y: number }
        ): Promise<{ ok: boolean; error?: string }>
        manage(): Promise<{ ok: boolean }>
        /** 固定/取消固定单个插件（显式目标态），落库后主进程广播 changed */
        setPinned(payload: {
          id: string
          pinned: boolean
        }): Promise<import('../../shared/extensions/management').PinResult>
        /** 固定全序覆盖（拖拽重排提交），落库后主进程广播 changed */
        orderPinned(ids: string[]): Promise<import('../../shared/extensions/management').PinResult>
        /** pins/安装集变更广播订阅：消费者重取 list（list 恒唯一数据源） */
        onChanged(callback: () => void): () => void
      }
      /** 扩展面板原生子窗口（契约 shared/extensionsPanel.ts）：宿主 shell 用
       *  show/hide 编排开合 + onPicked/onClosed 消费转发与关闭推送；面板子窗用
       *  pick 上报 + onData 接收渲染数据。同一 preload 按窗口角色各取所需 */
      extensionsPanel: {
        show(payload: ExtensionsPanelShowPayload): Promise<{ ok: boolean; canPresent: boolean }>
        hide(): Promise<OkResult>
        pick(payload: ExtensionsPanelPickPayload): Promise<OkResult>
        setMousePassthrough(enabled: boolean): Promise<OkResult>
        onData(callback: (payload: ExtensionsPanelDataPayload) => void): () => void
        onPicked(callback: (payload: ExtensionsPanelPickedPayload) => void): () => void
        onClosed(callback: () => void): () => void
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
