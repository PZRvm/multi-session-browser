// 采集器编排（录屏线 A' 架构核心，计划 20261009231903 步骤 5；spike 定稿：
// 发起方与授予目标须同 session——采集器在目标分区由它发起 getDisplayMedia，分区
// session 的 handler 把被录 Tab 的 WebFrameMain 授予它）。
// 承载形态（2026-10-10 破版修复定稿）：**隐藏子 BrowserWindow**——原 WebContentsView
// 挂主窗 contentView 方案实测触发 macOS 合成冻结（主进程 bounds 正确、窗口视觉停在
// 启动帧：页面 view 图层跑到 0,0 整窗、renderer 壳层停帧——共享 contentView 多
// WebContentsView 的已知类目 Electron 合成 bug）；独立子窗与主窗 view 树零接触，
// show:false + backgroundThrottling:false 保证采集页 JS/MediaRecorder 不受节流。
// 只管采集器生命周期：建窗 → 注册分区 handler → 指令下行 → 采集事件上行回调；
// 状态机联动与落盘编排在 index.ts。
import { BrowserWindow, session, type WebFrameMain } from 'electron'
import { COLLECTOR_CHANNELS } from '../../../shared/capture'
import { collectorGate } from './collectorGate'
import { ipcMain } from 'electron'

export interface CollectorCallbacks {
  /** 采集就绪（流建立 + MediaRecorder 已建；主进程随后推送 recording 态） */
  onReady: () => void
  /** 媒体分块（ArrayBuffer，已由采集页转好） */
  onChunk: (buf: ArrayBuffer) => void
  /** 失败上报（getDisplayMedia 拒绝 / MediaRecorder / 指令异常；主进程整体回滚） */
  onError: (message: string) => void
  /** 停止完成（MediaRecorder onstop；主进程 finalize 收尾） */
  onStopped: () => void
}

export interface CollectorHandle {
  /** 下行指令（'pause' | 'resume' | 'stop'） */
  sendCommand: (cmd: 'pause' | 'resume' | 'stop') => void
  /** 销毁采集器：注销分区 handler（置 null——页面自身 getDisplayMedia 回到默认拒绝）+ 关窗 */
  destroy: () => void
}

/**
 * 建采集器。分区 session 上注册的 handler 只认「请求方 = 采集器自己 frame」且
 * 目标 frame 存活（授予目标由 getTargetFrame 现取——被录 Tab 可能已切换/关闭，
 * 返回 undefined 即拒绝，采集页 getDisplayMedia 失败走 onError 回滚）。
 */
export function createCollector(opts: {
  /** 被录会话分区名（persist:sess-<id>，registry.partitionFor 单源拼装） */
  partition: string
  /** capturePreload 产物绝对路径（electron-vite 多入口构建） */
  preloadPath: string
  /** capturePage.html 绝对路径（?asset 导入） */
  pagePath: string
  /** 授予目标现取：被录 Tab 的 mainFrame；Tab 已销毁返回 undefined → handler 拒绝 */
  getTargetFrame: () => WebFrameMain | undefined
  callbacks: CollectorCallbacks
}): CollectorHandle {
  const partitionSession = session.fromPartition(opts.partition)
  // 隐藏子窗（1×1、无框、不进任务栏）：承载采集页的 JS 执行环境。show:false +
  // backgroundThrottling:false——窗口不可见但 JS/MediaRecorder 全速运行（采集管线
  // 不依赖本窗合成，视频帧来自被录 Tab 的捕获轨道）
  const win = new BrowserWindow({
    show: false,
    frame: false,
    width: 1,
    height: 1,
    resizable: false,
    skipTaskbar: true,
    minimizable: false,
    maximizable: false,
    focusable: false,
    title: 'msb-recording-collector',
    webPreferences: {
      session: partitionSession,
      preload: opts.preloadPath,
      backgroundThrottling: false,
      // sandbox: false 对齐主窗先例（模板默认）：多入口 preload 产物带共享 chunk
      //（rollup 拆包），sandboxed preload 无法 require 相对 chunk（冒烟实证桥挂载失败
      // →ready 超时）；采集页是内置受控页，nodeIntegration 恒 false + contextIsolation
      sandbox: false,
      nodeIntegration: false,
      contextIsolation: true
    }
  })
  // 权限门登记（二审中-3）：采集器 wc id 写入共享门，permissions.ts 的 'media' 放行
  // 只认这个 id——伪造同名页不可命中；destroy 时清门
  collectorGate.webContentsId = win.webContents.id
  // 采集器 frame 身份（frameToken 单源比较）：跨来源的 WebFrameMain JS 包装实例不保证
  // 引用相等（冒烟实证 request.frame === collectorFrame 恒 false → 授予被拒），frameToken
  // 是跨 IPC 稳定的字符串标识
  let collectorFrameToken: string | null = null
  win.webContents.once('did-frame-finish-load', () => {
    collectorFrameToken = win.webContents.mainFrame?.frameToken ?? null
  })

  partitionSession.setDisplayMediaRequestHandler((request, callback) => {
    const target = opts.getTargetFrame()
    // 安全契约（计划第 3 节点 4）：请求方必须是采集器自己、目标存活——页面自身发起的
    // getDisplayMedia（请求方 ≠ 采集器）一律拒绝。身份判定：顶层 frame + URL 是采集页
    //（did-frame-finish-load 晚于页面内联脚本发起 getDisplayMedia，token 捕获有时窗，
    // URL 判定先行；token 已捕获时双保险收紧）
    const fromCollector =
      request.frame !== null &&
      request.frame === request.frame.top &&
      (collectorFrameToken !== null
        ? request.frame.frameToken === collectorFrameToken
        : request.frame.url === win.webContents.getURL()) &&
      request.frame.url.startsWith('file://')
    if (fromCollector && target) {
      callback({ video: target })
    } else {
      callback({})
    }
  })

  // 审查高-2② 修复：采集器渲染进程崩溃/页面加载失败时 onerror/onStopped 均不会来，
  // 经 onError 上报触发主进程回滚（防泄漏）
  win.webContents.on('render-process-gone', (_e, details) => {
    opts.callbacks.onError(`render-process-gone: ${details.reason}`)
  })
  win.webContents.on('did-fail-load', (_e, errorCode, errorDescription) => {
    // -3 = ERR_ABORTED（销毁竞态的正常打断，不是失败）
    if (errorCode !== -3) {
      opts.callbacks.onError(`did-fail-load ${errorCode}: ${errorDescription}`)
    }
  })
  // 用户/系统关掉采集器窗（几乎不可达——不可聚焦不进任务栏）视同采集器死亡；
  // destroy() 的主动销毁不算（closed 在 destroy 下同样触发，需标志位区分）
  let destroyed = false
  win.on('closed', () => {
    if (!destroyed) opts.callbacks.onError('collector window closed')
  })

  // 纵深防御（审查低-3）：四通道 sender 白名单 = 采集器自己的 webContents
  const fromSelf = (e: Electron.IpcMainInvokeEvent): boolean =>
    e.sender === win.webContents && !win.webContents.isDestroyed()
  const readyHandler = (e: Electron.IpcMainInvokeEvent): void => {
    if (fromSelf(e)) opts.callbacks.onReady()
  }
  const chunkHandler = (e: Electron.IpcMainInvokeEvent, buf: unknown): void => {
    if (fromSelf(e) && buf instanceof ArrayBuffer) opts.callbacks.onChunk(buf)
  }
  const errorHandler = (e: Electron.IpcMainInvokeEvent, message: unknown): void => {
    if (fromSelf(e) && typeof message === 'string') opts.callbacks.onError(message)
  }
  const stoppedHandler = (e: Electron.IpcMainInvokeEvent): void => {
    if (fromSelf(e)) opts.callbacks.onStopped()
  }
  ipcMain.handle(COLLECTOR_CHANNELS.ready, readyHandler)
  ipcMain.handle(COLLECTOR_CHANNELS.chunk, chunkHandler)
  ipcMain.handle(COLLECTOR_CHANNELS.error, errorHandler)
  ipcMain.handle(COLLECTOR_CHANNELS.stopped, stoppedHandler)

  void win.loadFile(opts.pagePath)

  return {
    sendCommand: (cmd) => {
      if (!win.isDestroyed()) {
        win.webContents.send(COLLECTOR_CHANNELS.command, cmd)
      }
    },
    destroy: () => {
      // 通道注销在先（防 destroy 后采集页残留 invoke 打到已换目标的 handler）
      ipcMain.removeHandler(COLLECTOR_CHANNELS.ready)
      ipcMain.removeHandler(COLLECTOR_CHANNELS.chunk)
      ipcMain.removeHandler(COLLECTOR_CHANNELS.error)
      ipcMain.removeHandler(COLLECTOR_CHANNELS.stopped)
      partitionSession.setDisplayMediaRequestHandler(null)
      collectorFrameToken = null
      if (collectorGate.webContentsId === win.webContents.id) collectorGate.webContentsId = null
      destroyed = true
      if (!win.isDestroyed()) win.destroy()
    }
  }
}
