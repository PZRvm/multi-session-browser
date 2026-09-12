// 独立窗口登记表（阶段 7—8）：tear-off 产物 BrowserWindow 生命周期的唯一事实源——
// 创建（同 renderer 入口 + query 独立窗口模式，契约点 1）、windowId ↔ 窗口/绑定会话
// 映射、标题与会话名同源、单窗/按会话/全量级联关闭。
// 分层约束：不拼分区串（persist:sess-<id> 单源在 registry，本模块经登记表与参数拿
// sessionId）；不碰持久化（会话名经创建参数与 setTitleForSession 传入，不做 renderer
// 侧乐观标题）；不持有任何 WebContentsView（挂摘一律经 manager，本模块只在
// ready-to-show / closed 两个时点回调 registry 编排）。

import { BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import icon from '../../../resources/icon.png?asset'
import { installShellInputGuard } from '../inputGuard'

/** 默认/最小窗口尺寸（DIP）：Chrome 新窗口量级，可自由调整 */
const DEFAULT_WIDTH = 1024
const DEFAULT_HEIGHT = 720
const MIN_WIDTH = 480
const MIN_HEIGHT = 320

/** 独立窗口登记项：windowId 即 BrowserWindow.id 字符串化（创建时分配，生命周期内稳定） */
export interface IndependentWindowEntry {
  windowId: string
  win: BrowserWindow
  /** 绑定会话（tear-off 发起会话；窗口内一切命令作用于该会话的此窗口作用域） */
  sessionId: string
}

export interface IndependentWindows {
  /**
   * 创建并登记独立窗口：隐藏创建（show: false），renderer 首帧就绪（ready-to-show）
   * 才显示并回调 onWindowReady 挂 view——建窗到首 Tab 挂入之间的空窗瞬态对用户不可见
   * （防白屏）；title=会话名由调用方传入（本模块不读会话元数据）
   */
  createWindow(sessionId: string, title: string): { windowId: string; win: BrowserWindow }
  getWindowById(windowId: string): BrowserWindow | null
  /** windowId → 绑定会话 id（未登记返回 null）：ipc 作用域解析与 tear-off 路由此查 */
  getSessionId(windowId: string): string | null
  /** 同步该会话全部独立窗口标题（会话重命名经 index.ts 注入；标题与会话名严格同源） */
  setTitleForSession(sessionId: string, name: string): void
  /** 关闭单个独立窗口（registry 空作用域收口用；closed 级联清 manager 作用域状态） */
  closeWindow(windowId: string): void
  /** 关闭该会话全部独立窗口（会话销毁/关闭/克隆前置级联；步骤 5 接线） */
  closeAllForSession(sessionId: string): void
  /** 关闭全部独立窗口（应用退出级联） */
  closeAll(): void
}

export function createIndependentWindows(deps: {
  /** 窗口背景色（防首帧白闪，随外观主题；index.ts 注入外观控制器读数） */
  getBackgroundColor: () => string
  /** ready-to-show：窗口就绪（防白屏时点），registry 经此挂入该窗口作用域激活 Tab 的 view */
  onWindowReady: (sessionId: string, windowId: string) => void
  /** 窗口已销毁：registry 经此销毁该窗口作用域全部 Tab（含 webContents）并清槽位 */
  onWindowClosed: (sessionId: string, windowId: string) => void
}): IndependentWindows {
  const windowsById = new Map<string, IndependentWindowEntry>()

  function unregister(windowId: string): void {
    windowsById.delete(windowId)
  }

  function createWindow(
    sessionId: string,
    title: string
  ): { windowId: string; win: BrowserWindow } {
    const win = new BrowserWindow({
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
      minWidth: MIN_WIDTH,
      minHeight: MIN_HEIGHT,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: deps.getBackgroundColor(),
      title,
      ...(process.platform === 'linux' ? { icon } : {}),
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false
      }
    })
    const windowId = String(win.id)
    windowsById.set(windowId, { windowId, win, sessionId })
    installShellInputGuard(win.webContents)

    // 窗口标题专属会话名（PRD 验收 13）：拦截页面 document.title 对窗口标题的覆盖——
    // renderer 加载 index.html 时会把标题刷成产品名，重命名同步（setTitleForSession）
    // 也会被下一次页面标题更新冲掉，preventDefault 后标题只归本登记表管理
    win.on('page-title-updated', (event) => event.preventDefault())

    // 防白屏时点：renderer 首帧就绪才显示，view 也在此刻经回调挂入（此前 view 摘离
    // 保活、窗口隐藏，建窗到首 Tab 挂入之间的空窗瞬态用户无感）。就绪前窗口被关
    //（before-quit 级联等）时跳过
    win.once('ready-to-show', () => {
      if (win.isDestroyed()) return
      win.show()
      deps.onWindowReady(sessionId, windowId)
    })

    // shell 层 window.open 一律转系统浏览器（与主窗口同规；页面侧弹窗由 manager
    // setWindowOpenHandler 拦截转新 Tab，不经此处）
    win.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url)
      return { action: 'deny' }
    })

    // 销毁级联：先摘登记表再通知 registry——registry 若按 windowId 反查绑定会话将扑空
    //（getSessionId 已 null），故回调显式携带 sessionId；本回调内不得再触碰 win 的
    // 任何属性（窗口已销毁）
    win.once('closed', () => {
      unregister(windowId)
      deps.onWindowClosed(sessionId, windowId)
    })

    // 同 renderer 入口 + query 独立窗口模式（契约点 1：URL 无 query = 主窗口；
    // role=tab-window = 独立窗口，windowId/session 取自 query；dev 走 HMR 入口 + query）
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      const query = new URLSearchParams({ role: 'tab-window', session: sessionId, windowId })
      win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?${query.toString()}`)
    } else {
      win.loadFile(join(__dirname, '../renderer/index.html'), {
        query: { role: 'tab-window', session: sessionId, windowId }
      })
    }
    return { windowId, win }
  }

  function getWindowById(windowId: string): BrowserWindow | null {
    const entry = windowsById.get(windowId)
    if (!entry || entry.win.isDestroyed()) return null
    return entry.win
  }

  function getSessionId(windowId: string): string | null {
    return windowsById.get(windowId)?.sessionId ?? null
  }

  function setTitleForSession(sessionId: string, name: string): void {
    for (const entry of windowsById.values()) {
      if (entry.sessionId === sessionId && !entry.win.isDestroyed()) entry.win.setTitle(name)
    }
  }

  function closeWindow(windowId: string): void {
    const entry = windowsById.get(windowId)
    if (!entry) return
    if (entry.win.isDestroyed()) {
      // 已销毁但 closed 尚未触发的极端窗口期：手动补摘登记表与级联（后续 closed 再
      // 触发时两步均幂等）
      unregister(windowId)
      deps.onWindowClosed(entry.sessionId, windowId)
      return
    }
    entry.win.close()
  }

  function closeAllForSession(sessionId: string): void {
    for (const entry of [...windowsById.values()]) {
      if (entry.sessionId === sessionId) closeWindow(entry.windowId)
    }
  }

  function closeAll(): void {
    // 拷贝快照迭代：close → closed 异步触发 unregister，不并发改写本迭代
    for (const entry of [...windowsById.values()]) closeWindow(entry.windowId)
  }

  return {
    createWindow,
    getWindowById,
    getSessionId,
    setTitleForSession,
    closeWindow,
    closeAllForSession,
    closeAll
  }
}
