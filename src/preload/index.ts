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
  SetBoundsPayload,
  SwitchTabPayload,
  TabDragEndPayload,
  TabDragHoverPayload,
  TabDragInsertPayload,
  TabDragOutcome,
  TabDragStartPayload
} from '../shared/browser'
import { HISTORY_CHANNELS } from '../shared/history'
import type { HistoryChangedPayload, HistoryEntry } from '../shared/history'
import { APPEARANCE_CHANNELS } from '../shared/appearance'
import type { AppearanceSnapshot, SetAppearanceModePayload } from '../shared/appearance'
import { SESSIONS_CHANNELS } from '../shared/sessions'
import type {
  BatchDeleteSessionsPayload,
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
    deleteBatch: (payload: BatchDeleteSessionsPayload): Promise<OkResult> =>
      ipcRenderer.invoke(SESSIONS_CHANNELS.deleteBatch, payload),
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
    // 拖拽手势（阶段 9）：dragStart 开启主进程拖拽会话（同会话窗口悬停轮询），
    // dragEnd 上报落点屏幕坐标并取回裁决结果（TabDragOutcome）
    dragStart: (payload: TabDragStartPayload): Promise<BrowserOkResult> =>
      ipcRenderer.invoke(BROWSER_CHANNELS.dragStart, payload),
    dragEnd: (payload: TabDragEndPayload): Promise<TabDragOutcome> =>
      ipcRenderer.invoke(BROWSER_CHANNELS.dragEnd, payload),
    // 拖入插入位上报（阶段 10）：尽力而为 hint——主进程无 hint/陈旧时回退末位追加
    dragInsert: (payload: TabDragInsertPayload): Promise<BrowserOkResult> =>
      ipcRenderer.invoke(BROWSER_CHANNELS.dragInsert, payload),
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
