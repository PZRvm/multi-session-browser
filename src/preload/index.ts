import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { BROWSER_CHANNELS } from '../shared/browser'
import type {
  BrowserSnapshot,
  CloseTabPayload,
  FindStartPayload,
  FindStopPayload,
  FoundInPageResult,
  NavigatePayload,
  NewTabPayload,
  OkResult as BrowserOkResult,
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
import { HISTORY_CHANNELS } from '../shared/history'
import type { HistoryChangedPayload, HistoryEntry } from '../shared/history'
import { OMNIBOX_SUGGEST_CHANNELS } from '../shared/omniboxSuggest'
import type {
  OmniboxSuggestDataPayload,
  OmniboxSuggestHoverPayload,
  OmniboxSuggestPickPayload,
  OmniboxSuggestShowPayload
} from '../shared/omniboxSuggest'
import { APPEARANCE_CHANNELS } from '../shared/appearance'
import type {
  AppearanceSnapshot,
  SetAppearanceModePayload,
  SetThemeColorPayload
} from '../shared/appearance'
import { SESSIONS_CHANNELS } from '../shared/sessions'
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
  OkResult,
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
import { SETTINGS_CHANNELS } from '../shared/settings'
import type {
  OkResult as SettingsOkResult,
  SetHomepagePayload,
  SetLanguagePayload,
  SettingsAppInfo,
  SettingsSnapshot
} from '../shared/settings'
import { DIALOG_CHANNELS } from '../shared/dialog'
import type {
  ConfirmDestructivePayload,
  ConfirmWorkspaceDeletePayload,
  ShowWorkspacePickerPayload,
  WorkspaceDeleteChoice,
  WorkspacePickerContext,
  WorkspacePickerPickPayload,
  WorkspacePickerResult
} from '../shared/dialog'

// Custom APIs for renderer
const api = {
  appearance: {
    getState: (): Promise<AppearanceSnapshot> => ipcRenderer.invoke(APPEARANCE_CHANNELS.getState),
    setMode: (payload: SetAppearanceModePayload): Promise<AppearanceSnapshot> =>
      ipcRenderer.invoke(APPEARANCE_CHANNELS.setMode, payload),
    // 主题色切换（设置专项阶段五）：载荷与返回快照经 appearance 域守卫，订阅复用 onChanged
    setThemeColor: (payload: SetThemeColorPayload): Promise<AppearanceSnapshot> =>
      ipcRenderer.invoke(APPEARANCE_CHANNELS.setThemeColor, payload),
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
    // 会话备注编辑（2026-09-18 增量）：trim 后空串 = 清除备注，合法提交非拒绝
    setNote: (payload: SetNotePayload): Promise<StoredSession> =>
      ipcRenderer.invoke(SESSIONS_CHANNELS.setNote, payload),
    delete: (payload: DeleteSessionPayload): Promise<OkResult> =>
      ipcRenderer.invoke(SESSIONS_CHANNELS.delete, payload),
    setActive: (payload: SetActiveSessionPayload): Promise<OkResult> =>
      ipcRenderer.invoke(SESSIONS_CHANNELS.setActive, payload),
    getStatuses: (): Promise<SessionStatusesPayload> =>
      ipcRenderer.invoke(SESSIONS_CHANNELS.getStatuses),
    clone: (payload: CloneSessionPayload): Promise<StoredSession> =>
      ipcRenderer.invoke(SESSIONS_CHANNELS.clone, payload),
    deleteBatch: (payload: BatchDeleteSessionsPayload): Promise<OkResult> =>
      ipcRenderer.invoke(SESSIONS_CHANNELS.deleteBatch, payload),
    batchOpenUrl: (payload: BatchOpenUrlPayload): Promise<OkResult> =>
      ipcRenderer.invoke(SESSIONS_CHANNELS.batchOpenUrl, payload),
    // 会话列表排序：只接收当前全部会话 id 的完整顺序（全序），主进程整单校验拒绝制
    reorder: (payload: ReorderSessionsPayload): Promise<OkResult> =>
      ipcRenderer.invoke(SESSIONS_CHANNELS.reorder, payload),
    // 工作区六通道（2026-09-15 专项五条 + 2026-09-17 增量批量移动一条）：全部
    // invoke、零推送（工作区仅主窗左栏操作）
    workspaceCreate: (payload: CreateWorkspacePayload): Promise<StoredWorkspace> =>
      ipcRenderer.invoke(SESSIONS_CHANNELS.workspaceCreate, payload),
    workspaceRename: (payload: RenameWorkspacePayload): Promise<StoredWorkspace> =>
      ipcRenderer.invoke(SESSIONS_CHANNELS.workspaceRename, payload),
    workspaceDelete: (payload: DeleteWorkspacePayload): Promise<OkResult> =>
      ipcRenderer.invoke(SESSIONS_CHANNELS.workspaceDelete, payload),
    workspaceMoveSession: (payload: MoveSessionToWorkspacePayload): Promise<OkResult> =>
      ipcRenderer.invoke(SESSIONS_CHANNELS.workspaceMoveSession, payload),
    // 批量移动（2026-09-17 增量）：幂等跳过计数返回真值，renderer 反馈条不自算口径
    workspaceMoveSessionsBatch: (
      payload: MoveSessionsToWorkspacePayload
    ): Promise<MoveSessionsBatchResult> =>
      ipcRenderer.invoke(SESSIONS_CHANNELS.workspaceMoveSessionsBatch, payload),
    // 视野切换：id 为 'all'（WORKSPACE_VIEW_ALL 单源）或工作区 id；主进程原子级联
    workspaceSetActive: (payload: SetActiveWorkspacePayload): Promise<OkResult> =>
      ipcRenderer.invoke(SESSIONS_CHANNELS.workspaceSetActive, payload),
    // 工作区列表排序（拖动排序专项）：只接收当前全部工作区 id 的完整顺序（全序），
    // 主进程整单校验拒绝制；纯重排不动视野/激活位/激活记忆
    workspaceReorder: (payload: ReorderWorkspacesPayload): Promise<OkResult> =>
      ipcRenderer.invoke(SESSIONS_CHANNELS.workspaceReorder, payload),
    // 推送订阅：剥离 ipc 事件对象，回调只收全量状态 map；退订必须 removeListener 同一 listener
    onStatusChanged: (callback: (payload: SessionStatusesPayload) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, payload: SessionStatusesPayload): void => {
        callback(payload)
      }
      ipcRenderer.on(SESSIONS_CHANNELS.statusChanged, listener)
      return () => {
        ipcRenderer.removeListener(SESSIONS_CHANNELS.statusChanged, listener)
      }
    },
    // 会话事实变更订阅（恢复出厂增量）：回调收完整快照，收方以快照权威接管；
    // 订阅/退订形态对齐 onStatusChanged 先例
    onChanged: (callback: (snapshot: SessionsSnapshot) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, snapshot: SessionsSnapshot): void => {
        callback(snapshot)
      }
      ipcRenderer.on(SESSIONS_CHANNELS.changed, listener)
      return () => {
        ipcRenderer.removeListener(SESSIONS_CHANNELS.changed, listener)
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
    // 同窗口 Tab 重排（栏内拖拽排序）：ids 为该窗全部 Tab id 的无重复全序，整单校验
    // 不匹配拒绝（renderer 据失败回滚本地预览序）
    reorderTabs: (payload: ReorderTabsPayload): Promise<BrowserSnapshot> =>
      ipcRenderer.invoke(BROWSER_CHANNELS.reorderTabs, payload),
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
    // 拖拽手势（阶段 9）：dragStart 开启主进程拖拽会话（同会话窗口悬停轮询），
    // dragEnd 上报落点屏幕坐标并取回裁决结果（TabDragOutcome）
    dragStart: (payload: TabDragStartPayload): Promise<BrowserOkResult> =>
      ipcRenderer.invoke(BROWSER_CHANNELS.dragStart, payload),
    dragEnd: (payload: TabDragEndPayload): Promise<TabDragOutcome> =>
      ipcRenderer.invoke(BROWSER_CHANNELS.dragEnd, payload),
    // 拖入插入位上报（阶段 10）：尽力而为 hint——主进程无 hint/陈旧时回退末位追加
    dragInsert: (payload: TabDragInsertPayload): Promise<BrowserOkResult> =>
      ipcRenderer.invoke(BROWSER_CHANNELS.dragInsert, payload),
    // Tab 栏矩形上报（拖出裁决修订）：fire-and-forget 布局通道——TabStrip 挂载/resize
    // 上报视口矩形、卸载上报零矩形清除；主进程据此做 Tab 栏命中裁决
    reportTabstripRect: (payload: TabstripRectPayload): Promise<BrowserOkResult> =>
      ipcRenderer.invoke(BROWSER_CHANNELS.reportTabstripRect, payload),
    // 页内查找（Chrome find-in-page 对齐）：findStart 对激活 Tab 发起/步进查找，
    // findStop 结束会话（缺省清除高亮）且主进程随即归还页面焦点；计数经 onFindResult 推送
    findStart: (payload: FindStartPayload): Promise<BrowserOkResult> =>
      ipcRenderer.invoke(BROWSER_CHANNELS.findStart, payload),
    findStop: (payload?: FindStopPayload): Promise<BrowserOkResult> =>
      ipcRenderer.invoke(BROWSER_CHANNELS.findStop, payload ?? {}),
    // 地址栏历史补全（契约见 shared/history.ts）：拉取当前作用域会话的全量历史镜像；
    // 建议检索在 renderer 本地完成，编辑期零 IPC
    getHistory: (): Promise<HistoryEntry[]> => ipcRenderer.invoke(HISTORY_CHANNELS.get),
    // 历史变化增量推送：payload.entry 按 url 并入镜像；订阅/退订照 onDragHover 惯例
    onHistoryChanged: (callback: (payload: HistoryChangedPayload) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, payload: HistoryChangedPayload): void => {
        callback(payload)
      }
      ipcRenderer.on(HISTORY_CHANNELS.changed, listener)
      return () => {
        ipcRenderer.removeListener(HISTORY_CHANNELS.changed, listener)
      }
    },
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
    },
    // 拖拽悬停推送（主进程 → 同会话窗口广播）：同 onStateChanged 的订阅/退订惯例
    onDragHover: (callback: (payload: TabDragHoverPayload) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, payload: TabDragHoverPayload): void => {
        callback(payload)
      }
      ipcRenderer.on(BROWSER_CHANNELS.dragHover, listener)
      return () => {
        ipcRenderer.removeListener(BROWSER_CHANNELS.dragHover, listener)
      }
    },
    // 页面聚焦态 Cmd/Ctrl+F 唤起 shell 查找栏的推送（focusAddress 同构，无载荷）
    onFindRequest: (callback: () => void): (() => void) => {
      const listener = (): void => {
        callback()
      }
      ipcRenderer.on(BROWSER_CHANNELS.findRequest, listener)
      return () => {
        ipcRenderer.removeListener(BROWSER_CHANNELS.findRequest, listener)
      }
    },
    // found-in-page 计数推送：回调只收结果载荷（Electron 事件对象在此剥离）
    onFindResult: (callback: (result: FoundInPageResult) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, result: FoundInPageResult): void => {
        callback(result)
      }
      ipcRenderer.on(BROWSER_CHANNELS.findResult, listener)
      return () => {
        ipcRenderer.removeListener(BROWSER_CHANNELS.findResult, listener)
      }
    }
  },
  // 地址栏建议原生子窗口（承载机制见 shared/omniboxSuggest.ts 头注释）：宿主 shell
  // 用 show/hide 编排开合 + onHovered/onPicked 消费子窗鼠标转发；子窗用 hover/pick
  // 上报 + onData 接收渲染数据。同一 preload 按窗口角色各取所需
  omniboxSuggest: {
    show: (payload: OmniboxSuggestShowPayload): Promise<BrowserOkResult> =>
      ipcRenderer.invoke(OMNIBOX_SUGGEST_CHANNELS.show, payload),
    hide: (): Promise<BrowserOkResult> => ipcRenderer.invoke(OMNIBOX_SUGGEST_CHANNELS.hide),
    hover: (payload: OmniboxSuggestHoverPayload): Promise<BrowserOkResult> =>
      ipcRenderer.invoke(OMNIBOX_SUGGEST_CHANNELS.hover, payload),
    pick: (payload: OmniboxSuggestPickPayload): Promise<BrowserOkResult> =>
      ipcRenderer.invoke(OMNIBOX_SUGGEST_CHANNELS.pick, payload),
    onData: (callback: (payload: OmniboxSuggestDataPayload) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, payload: OmniboxSuggestDataPayload): void => {
        callback(payload)
      }
      ipcRenderer.on(OMNIBOX_SUGGEST_CHANNELS.data, listener)
      return () => {
        ipcRenderer.removeListener(OMNIBOX_SUGGEST_CHANNELS.data, listener)
      }
    },
    onHovered: (callback: (payload: OmniboxSuggestHoverPayload) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, payload: OmniboxSuggestHoverPayload): void => {
        callback(payload)
      }
      ipcRenderer.on(OMNIBOX_SUGGEST_CHANNELS.hovered, listener)
      return () => {
        ipcRenderer.removeListener(OMNIBOX_SUGGEST_CHANNELS.hovered, listener)
      }
    },
    onPicked: (callback: (payload: OmniboxSuggestPickPayload) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, payload: OmniboxSuggestPickPayload): void => {
        callback(payload)
      }
      ipcRenderer.on(OMNIBOX_SUGGEST_CHANNELS.picked, listener)
      return () => {
        ipcRenderer.removeListener(OMNIBOX_SUGGEST_CHANNELS.picked, listener)
      }
    }
  },
  // 设置域（契约见 shared/settings.ts）：板头齿轮请求主进程打开/聚焦单例设置窗口；
  // 应用菜单路径在主进程内直连不经此通道。阶段三并入关于信息两通道（get-app-info /
  // open-data-dir），阶段四并入值域三通道（get / changed / set-homepage——订阅-推送
  // 返回退订函数的形态对齐 appearance.onChanged 先例）
  settings: {
    open: (): Promise<SettingsOkResult> => ipcRenderer.invoke(SETTINGS_CHANNELS.open),
    getAppInfo: (): Promise<SettingsAppInfo> => ipcRenderer.invoke(SETTINGS_CHANNELS.getAppInfo),
    openDataDir: (): Promise<SettingsOkResult> => ipcRenderer.invoke(SETTINGS_CHANNELS.openDataDir),
    getHomepage: (): Promise<SettingsSnapshot> => ipcRenderer.invoke(SETTINGS_CHANNELS.get),
    setHomepage: (payload: SetHomepagePayload): Promise<SettingsSnapshot> =>
      ipcRenderer.invoke(SETTINGS_CHANNELS.setHomepage, payload),
    // 语言切换（设置专项阶段六）：合法值 = shared/i18n 注册表闭集，主进程守卫承担
    setLanguage: (payload: SetLanguagePayload): Promise<SettingsSnapshot> =>
      ipcRenderer.invoke(SETTINGS_CHANNELS.setLanguage, payload),
    // 恢复出厂（阶段七）：两步确认通过后调用；无 payload，sender 白名单 = 设置窗
    factoryReset: (): Promise<SettingsOkResult> =>
      ipcRenderer.invoke(SETTINGS_CHANNELS.factoryReset),
    onChanged: (callback: (snapshot: SettingsSnapshot) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, snapshot: SettingsSnapshot): void => {
        callback(snapshot)
      }
      ipcRenderer.on(SETTINGS_CHANNELS.changed, listener)
      return () => {
        ipcRenderer.removeListener(SETTINGS_CHANNELS.changed, listener)
      }
    }
  },
  // 破坏性确认域（契约见 shared/dialog.ts）：删除类二次确认走主进程原生对话框
  // （PRD 4.10），弹框期间页面视图保持可见、不经 overlay 登记收起右区。载荷只带
  // 数据参数，文案由主进程经 main/i18n 语言态复用既有字典键组装；返回 true 仅当
  // 用户按下确认按钮，取消/Esc/关闭一律 false。
  // 工作区选择模态框（PRD 4.11，2026-09-21 增量）：三通道三侧各取所需——show 归
  // 主窗 shell（发起 + 等待最终结论），payload/pick 归 sheet 页面（拉展示上下文 /
  // 提交选择）；主进程持单请求 pending 态，模态阻塞由窗口系统承担
  dialog: {
    confirmDestructive: (payload: ConfirmDestructivePayload): Promise<boolean> =>
      ipcRenderer.invoke(DIALOG_CHANNELS.confirmDestructive, payload),
    // 删除工作区会话处置三选（PRD 4.10，2026-09-24 增量）：结论三态返回，
    // cancel 覆盖全部未确认路径；执行由既有 sessions:delete-batch /
    // workspaces:delete 通道在 renderer 侧编排
    confirmWorkspaceDelete: (
      payload: ConfirmWorkspaceDeletePayload
    ): Promise<WorkspaceDeleteChoice> =>
      ipcRenderer.invoke(DIALOG_CHANNELS.confirmWorkspaceDelete, payload),
    showWorkspacePicker: (payload: ShowWorkspacePickerPayload): Promise<WorkspacePickerResult> =>
      ipcRenderer.invoke(DIALOG_CHANNELS.showWorkspacePicker, payload),
    workspacePickerPayload: (): Promise<WorkspacePickerContext | null> =>
      ipcRenderer.invoke(DIALOG_CHANNELS.workspacePickerPayload),
    workspacePickerPick: (payload: WorkspacePickerPickPayload): Promise<OkResult> =>
      ipcRenderer.invoke(DIALOG_CHANNELS.workspacePickerPick, payload)
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
