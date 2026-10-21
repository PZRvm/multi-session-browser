// 录屏域编排与 IPC 装配（录屏线 A' 架构，计划 20261009231903 步骤 5 + 审查修复轮
// 20261010：高-1/2 停止链路代际化与泄漏兜底、中-4/5/6/7/8/10 分区串对齐/写入序列化/
// 停止原因文案/busy 区分/tabId 权威核验/宿主发起窗；复审轮中-1/2、低-4/5/6/8 busy
// 原生框反馈/会话名防护/chunk 上限/启动期清扫/受理即广播）：
// begin/pause/resume/stop 四 UI 意图 + 采集器事件（ready/chunk/error/stopped）+ 五路
// 生命周期自动停止（registry.onBrowserLifecycle 单点路由）。状态机（state.ts）是唯一
// 裁决点；fileWriter（fileWriter.ts）管落盘；采集器 view 与分区 handler 在 captureView.ts。
// 停止健壮性（审查高-1/2 修复设计）：每次 begin 递增 generation，一切异步收尾回调
// （onstopped、stop 兜底、采集失败）持建录时代际比对——过期代际即忽略，防旧事件
// 串扰与跨录制误杀；采集页对就绪前 stop 排队（capturePage 内），主进程另有
// STOP_FALLBACK_MS 兜底与 begin 幂等清场（泄漏通道二次注册防线）。
import { readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { BrowserWindow, app, dialog, ipcMain } from 'electron'
import { CAPTURE_CHANNELS, COLLECTOR_CHANNELS } from '../../../shared/capture'
import type {
  CaptureBeginPayload,
  CaptureBeginResult,
  CaptureState,
  CaptureStopResult
} from '../../../shared/capture'
import { SESSION_ID_RE } from '../../../shared/sessions'
import { dialogIconForDarwin } from '../../dialogs'
import type { TFunc } from '../../../shared/i18n'
import { partitionFor, type SessionBrowserRegistry } from '../registry'
import { fileExists } from '../downloadNaming'
import { createRecordingStateMachine } from './state'
import { createRecordingFileWriter } from './fileWriter'
import type { RecordingFileWriter } from './fileWriter'
import { RECORDING_FILE_EXT } from './name'
import { createCollector } from './captureView'
import type { CollectorHandle } from './captureView'

/** begin 后等待采集器就绪的窗口（超时整体回滚——采集页加载异常/getDisplayMedia 卡死） */
const COLLECTOR_READY_TIMEOUT_MS = 10_000
/** 停止兜底基础窗：无分块到达后等待 onstopped 的时长（代际比对防误杀新录制） */
const STOP_FALLBACK_MS = 1_500
/** 兜底顺延上限：分块持续到达（末块冲刷上行中）时的最长额外等待（10 窗 = 15s），
 * 防异常流永不确定稿（MP4 化复审 20261021123907 中-2） */
const STOP_FALLBACK_MAX_EXTENSIONS = 10
/** 单块分片上限（复审低-4 纵深防御）：原 16MB 按 webm 周期小分块标定，MP4 化专项
 * 放宽至 64MB——末块 stop 冲刷可显著变大；超限只可能是异常通道数据，告警后丢弃
 * （发送方是内置受控采集页，此门为兜底而非信任前提） */
const CHUNK_MAX_BYTES = 64 * 1024 * 1024
/** 停止原因（settle 反馈文案选择）：用户停止 / 关被录 Tab / 切走（切 Tab、切会话、销毁） */
type StopReason = 'user' | 'tab-closed' | 'tab-moved' | 'auto'

export interface RecordingIpcDeps {
  /** 浏览器注册表（激活位核验 resolveSenderScope/getSnapshot + getActiveWebContents + 生命周期订阅） */
  registry: SessionBrowserRegistry
  /** 主窗现取（原生信息框父窗兜底优先；采集器宿主取发起窗） */
  getMainWindow: () => BrowserWindow | null
  /** 采集器 preload 产物绝对路径（electron-vite 多入口构建） */
  collectorPreloadPath: string
  /** capturePage.html 绝对路径（?asset） */
  collectorPagePath: string
  /** 会话名现取（命名锚定，异步读 snapshot；未知会话返回 undefined 时回退 'session'） */
  getSessionName: (sessionId: string) => Promise<string | undefined>
  /** 主进程 i18n（原生框文案随界面语言） */
  t: TFunc
  /** 临时区目录（fileWriter .part；userData 派生由装配层注入） */
  tmpDir: string
}

/** 原生信息框（information 型，AGENTS 结果反馈原生裁决；darwin 项目图标先例复用；
 * 审查中-10 修复：无可用父窗时不 new BrowserWindow（会弹空白窗），退应用级无父弹框） */
function showInfoBox(getMainWindow: () => BrowserWindow | null, message: string): void {
  const options = {
    type: 'info' as const,
    message,
    buttons: ['OK'],
    defaultId: 0,
    icon: dialogIconForDarwin()
  }
  const parent = getMainWindow()
  const shown =
    parent && !parent.isDestroyed()
      ? dialog.showMessageBox(parent, options)
      : dialog.showMessageBox(options)
  void shown.catch((error: unknown) => {
    console.warn('[recording] 结果反馈框失败:', error)
  })
}

export function registerRecordingIpc(deps: RecordingIpcDeps): {
  /** 挂载点：被录 Tab 确定消失——reason 区分关闭（tab-closed 文案）与拖出/跨窗（auto 文案） */
  handleTabGone: (sessionId: string, tabId: string, reason: 'tab-closed' | 'tab-moved') => void
  /** 挂载点：发起窗内切 Tab 到 newTabId（windowId 收窄防他窗误停，审查中-9） */
  handleActiveTabChanged: (sessionId: string, newTabId: string, windowId: string) => void
  /** 挂载点：激活会话变为 newActive（含 null 空态） */
  handleActiveSessionChanged: (newActive: string | null) => void
  /** 挂载点：被录会话销毁/关闭 */
  handleSessionGone: (sessionId: string) => void
  /** 录制中锚定窗（F''：manager 弹层收起按录制态分派应用矩形）；idle 为 null */
  getRecordedWindowId: () => string | null
} {
  // 启动期清扫（复审低-5）：上轮崩溃/失败保留下来的半截 .part 孤儿——现行 .mp4.part
  // 加旧版 .webm.part 遗留一次性兼容（MP4 化专项 20261020184445）——应用启动
  // 期无并发录制，恒安全；逐个 unlink 不清目录本身，目录不存在静默跳过，单个删除
  // 失败仅告警。fire-and-forget 不阻塞下方 IPC 注册
  void (async () => {
    let entries: string[]
    try {
      entries = await readdir(deps.tmpDir)
    } catch (error) {
      // 目录不存在（首启尚未录过）为常态，静默跳过；其余读取异常仅告警不阻断
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[recording] recording-tmp 清扫读取失败:', error)
      }
      return
    }
    for (const name of entries) {
      if (!name.endsWith(`${RECORDING_FILE_EXT}.part`) && !name.endsWith('.webm.part')) continue
      try {
        await unlink(join(deps.tmpDir, name))
      } catch (error) {
        console.warn('[recording] 残留 .part 清扫失败:', name, error)
      }
    }
  })()

  const machine = createRecordingStateMachine()
  // 单例运行态（录制中至多一个）：collector 与 writer 随 begin 建立、随终止回收
  let collector: CollectorHandle | null = null
  let writer: RecordingFileWriter | null = null
  let readyTimer: NodeJS.Timeout | null = null
  // 采集器就绪标志（onReady 置 true，终止路径复位）：failCollector 的启动期/录制期
  // 分支判据——readyTimer 置 null 有两条路径（onReady 与 timeout 回调自身），不能作判据
  let collectorReady = false
  // 停止代际（审查高-1/2）：begin 递增；一切异步收尾持建录时代际比对，过期即忽略
  let generation = 0
  // 待收尾的停止原因（requestStop 记录，settle 消费取文案）
  let pendingStopReason: StopReason = 'user'
  // 被录锚定窗（begin 时的发起窗作用域）：Tab 级生命周期事件仅响应同窗（审查中-9）
  let recordedWindowId: string | null = null
  // 最近分块到达时刻（begin 置起点、onChunk 顺延）：停止兜底「分块仍在到达即顺延」的判据
  let lastChunkAt = 0
  // 落盘统计（begin 复位、settle 成功点单行输出）：分块数/总字节/最大单块——MP4 化
  // 复审中-2 的实证面，长录分块尺寸分布无需插桩即可追溯
  let statsCount = 0
  let statsBytes = 0
  let statsMax = 0

  const broadcast = (state: CaptureState): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(CAPTURE_CHANNELS.stateChanged, state)
    }
  }

  const messageForReason = (reason: StopReason): ((file: string) => string) => {
    // 拖出/跨窗转移的 Tab 仍存活于新窗，复用「已离开被录会话」文案（事实陈述成立）
    if (reason === 'tab-closed') return (file) => deps.t('capture.stoppedTabClosed', { file })
    if (reason === 'tab-moved' || reason === 'auto') {
      return (file) => deps.t('capture.stoppedAuto', { file })
    }
    return (file) => deps.t('capture.done', { file })
  }

  /** 终态收尾：写入队列排空 → finalize 落盘 → 回收采集器 → idle 推送 → 原生框反馈
   *  （suppressDialog：退出路径静默——退出中弹框无意义且可能阻塞退出） */
  const settle = async (suppressDialog = false): Promise<void> => {
    machine.reset()
    collectorReady = false
    if (readyTimer !== null) {
      clearTimeout(readyTimer)
      readyTimer = null
    }
    collector?.destroy()
    collector = null
    broadcast({ status: 'idle' })
    const w = writer
    writer = null
    if (!w) return
    const reason = pendingStopReason
    try {
      await w.drain()
      const { path } = await w.finalize()
      // 落盘统计单行留痕（MP4 化复审中-2 实证面）：长录分块尺寸分布可追溯
      console.log(
        '[recording] 落盘完成:',
        path,
        `（${statsCount} 块 / 共 ${statsBytes} 字节 / 最大单块 ${statsMax} 字节）`
      )
      if (!suppressDialog) showInfoBox(deps.getMainWindow, messageForReason(reason)(path))
    } catch (error) {
      console.warn('[recording] finalize 失败:', error)
      if (suppressDialog) return
      // 审查低-2 修复：按失败形态分镜——下载目录缺失 ENOENT 与零块各自如实文案
      const msg = error instanceof Error ? error.message : String(error)
      if (msg.includes('没有任何内容')) {
        showInfoBox(deps.getMainWindow, deps.t('capture.startFailed'))
      } else if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        showInfoBox(deps.getMainWindow, deps.t('capture.downloadsUnavailable'))
      } else {
        showInfoBox(deps.getMainWindow, deps.t('capture.writeFailed'))
      }
    }
  }

  /** 采集失败：录制已开始（ready 已过）保已收块如实落盘；启动期整体回滚丢弃 */
  const failCollector = (message: string): void => {
    console.warn('[recording] 采集器失败:', message)
    if (collectorReady) {
      // 录制期失败：保已录内容（时长事实呈现，不伪造完整）
      void settle()
      return
    }
    // 启动期失败：回滚（timeout 路径 readyTimer 已由回调自身置 null）
    machine.reset()
    collectorReady = false
    if (readyTimer !== null) {
      clearTimeout(readyTimer)
      readyTimer = null
    }
    collector?.destroy()
    collector = null
    void writer?.abort()
    writer = null
    broadcast({ status: 'idle' })
    showInfoBox(deps.getMainWindow, deps.t('capture.startFailed'))
  }

  /** 停止请求统一出口（用户 stop 与五路自动停止共用）：指令下行 + 代际化兜底 */
  const requestStop = (reason: StopReason): void => {
    if (machine.getState().status === 'idle') return
    try {
      machine.stop()
    } catch {
      return
    }
    pendingStopReason = reason
    const gen = generation
    collector?.sendCommand('stop')
    // 兜底（MP4 化复审中-2 改造）：onstopped 未达（被录页销毁连带流终止/采集器渲染
    // 进程死）强制收尾。分块仍在到达（idle < 窗口）说明末块冲刷上行进行中，顺延再查
    // ——chunkChain 使 stopped 晚于分块上行，固定短窗会抢跑截尾；顺延次数封顶防异常
    // 流永不确定稿。代际比对（新 begin 已递增）+ 残留判据（已正常收尾则跳过）
    let fallbackExtensions = 0
    const fallbackCheck = (): void => {
      if (generation !== gen) return
      if (collector === null && writer === null) return
      const idleMs = Date.now() - lastChunkAt
      if (idleMs < STOP_FALLBACK_MS && fallbackExtensions < STOP_FALLBACK_MAX_EXTENSIONS) {
        fallbackExtensions += 1
        setTimeout(fallbackCheck, STOP_FALLBACK_MS - idleMs)
        return
      }
      console.warn('[recording] onstopped 未达，兜底强制收尾（顺延', fallbackExtensions, '次）')
      void settle()
    }
    setTimeout(fallbackCheck, STOP_FALLBACK_MS)
  }

  ipcMain.handle(
    CAPTURE_CHANNELS.begin,
    async (event, payload: unknown): Promise<CaptureBeginResult> => {
      // 运行时守卫：载荷结构 + sender 作用域核验 + 激活位一致（sessionId 与 tabId 都以
      // 主进程权威值为准，审查中-8：tabId 不一致即拒，防锚定错位）
      const p = payload as CaptureBeginPayload
      const reject = (): CaptureBeginResult => ({ accepted: false, state: machine.getState() })
      if (
        !p ||
        typeof p !== 'object' ||
        typeof p.sessionId !== 'string' ||
        !SESSION_ID_RE.test(p.sessionId) ||
        typeof p.tabId !== 'string'
      ) {
        return reject()
      }
      let scope: { windowId: string; sessionId: string | null }
      try {
        scope = deps.registry.resolveSenderScope(event.sender)
      } catch {
        return reject()
      }
      if (scope.sessionId !== p.sessionId) return reject()
      try {
        const snap = deps.registry.getSnapshot(scope.windowId)
        if (snap.activeTabId !== p.tabId) return reject()
      } catch {
        return reject()
      }
      try {
        machine.begin(p.sessionId, p.tabId, Date.now())
      } catch (error) {
        // busy（多窗毫秒竞态）：UI 主路径不可达，原生信息框兜底反馈独占拒绝（复审
        // 中-1：此前静默 reject 零反馈，PRD 3.10.2 跨窗拒绝须有反馈）；非 busy 异常
        // （状态机非法迁移等编排层 bug 信号）照旧静默 reject
        if (error instanceof Error && error.message === 'busy') {
          showInfoBox(deps.getMainWindow, deps.t('capture.busy'))
          return reject()
        }
        return reject()
      }
      // 授予目标捕获：发起窗激活 Tab 的 webContents（begin 时点闭包持有——录制期间
      // 激活位变化由生命周期钩子先行自动停止，此引用的时效即录制窗口）
      const target = (() => {
        try {
          return deps.registry.getActiveWebContents(scope.windowId)
        } catch {
          return null
        }
      })()
      if (!target || target.isDestroyed()) {
        machine.reset()
        broadcast({ status: 'idle' })
        return { accepted: false, state: { status: 'idle' } }
      }
      // 销毁收口（二审观察项）：页面自调用 window.close() 或渲染进程崩溃不经 registry
      // 生命周期——wc destroyed 强制走停录链（自愈假设不再承担正确性）
      target.once('destroyed', () => {
        const s = machine.getState()
        if (s.status === 'idle' || s.sessionId !== p.sessionId || s.tabId !== p.tabId) return
        requestStop('tab-closed')
      })
      // 审查高-2③ 修复：begin 前幂等清场——上次异常泄漏的采集器通道二次注册会抛
      // "Attempted to register a second handler"，先回收残留再建新
      generation += 1
      pendingStopReason = 'user'
      recordedWindowId = scope.windowId
      lastChunkAt = Date.now()
      statsCount = 0
      statsBytes = 0
      statsMax = 0
      collector?.destroy()
      for (const ch of Object.values(COLLECTOR_CHANNELS)) ipcMain.removeHandler(ch)
      // 会话名锚定（复审中-2）：命名是尽力而为语义，读盘失败不让其击穿录制流程——
      // 否则机器已 recording 而无 collector/writer，UI 胶囊悬死不可恢复观感
      let sessionName = 'session'
      try {
        sessionName = (await deps.getSessionName(p.sessionId)) ?? 'session'
      } catch (error) {
        console.warn('[recording] 会话名读取失败，回退默认名:', error)
      }
      writer = createRecordingFileWriter({
        tmpDir: deps.tmpDir,
        downloadsDir: app.getPath('downloads'),
        sessionName,
        now: () => Date.now(),
        exists: fileExists
      })
      try {
        collector = createCollector({
          partition: partitionFor(p.sessionId),
          preloadPath: deps.collectorPreloadPath,
          pagePath: deps.collectorPagePath,
          getTargetFrame: () => (target.isDestroyed() ? undefined : target.mainFrame),
          callbacks: {
            onReady: () => {
              if (readyTimer !== null) {
                clearTimeout(readyTimer)
                readyTimer = null
              }
              collectorReady = true
              // 受理广播后的二次广播确认态（幂等，复审低-6）
              broadcast(machine.getState())
            },
            onChunk: (buf) => {
              if (!(buf instanceof ArrayBuffer)) return
              lastChunkAt = Date.now()
              // 复审低-4 纵深防御：单块超上限告警后丢弃（MP4 化后末块 stop 冲刷可
              // 显著变大，超限只可能是异常通道数据，但丢失必须留痕——复审中-1/低-4）
              if (buf.byteLength > CHUNK_MAX_BYTES) {
                console.warn('[recording] 单块超上限丢弃:', buf.byteLength, '字节')
                return
              }
              statsCount += 1
              statsBytes += buf.byteLength
              if (buf.byteLength > statsMax) statsMax = buf.byteLength
              void writer?.append(new Uint8Array(buf)).catch((error: unknown) => {
                console.warn('[recording] 分块写入失败:', error)
              })
            },
            onError: (message) => failCollector(message),
            onStopped: () => {
              void settle()
            }
          }
        })
      } catch (error) {
        // 建采集器即抛（通道注册冲突已清场，此处防御其他建窗异常）：整体回滚
        console.warn('[recording] 采集器建立失败:', error)
        machine.reset()
        collectorReady = false
        collector = null
        void writer?.abort()
        writer = null
        broadcast({ status: 'idle' })
        showInfoBox(deps.getMainWindow, deps.t('capture.startFailed'))
        return { accepted: false, state: { status: 'idle' } }
      }
      readyTimer = setTimeout(() => {
        readyTimer = null
        failCollector('collector ready timeout')
      }, COLLECTOR_READY_TIMEOUT_MS)
      // 受理即广播（复审低-6）：UI 胶囊立即出现，不等采集器 ready（采集失败路径
      // 已有回滚广播纠正）
      broadcast(machine.getState())
      // 启动窗口内即返回 recording（UI 呈录制态；失败以推送 + 原生框纠正）
      return { accepted: true, state: machine.getState() }
    }
  )

  ipcMain.handle(CAPTURE_CHANNELS.pause, (): CaptureState => {
    try {
      machine.pause(Date.now())
    } catch {
      /* 非法迁移（未在录制）：返回当前态 */
    }
    collector?.sendCommand('pause')
    broadcast(machine.getState())
    return machine.getState()
  })

  ipcMain.handle(CAPTURE_CHANNELS.resume, (): CaptureState => {
    try {
      machine.resume(Date.now())
    } catch {
      /* 非法迁移：返回当前态 */
    }
    collector?.sendCommand('resume')
    broadcast(machine.getState())
    return machine.getState()
  })

  ipcMain.handle(CAPTURE_CHANNELS.stop, (): CaptureStopResult => {
    if (machine.getState().status === 'idle') return { ok: false }
    requestStop('user')
    return { ok: true }
  })

  /** 生命周期钩子：被录 Tab 确定消失——关闭走「已关闭」文案，拖出/跨窗走「已离开」文案 */
  const handleTabGone = (
    sessionId: string,
    tabId: string,
    reason: 'tab-closed' | 'tab-moved'
  ): void => {
    const s = machine.getState()
    if (s.status === 'idle' || s.sessionId !== sessionId || s.tabId !== tabId) return
    requestStop(reason)
  }

  /** 生命周期钩子：发起窗内切 Tab（newTabId = 新激活位；仅同窗事件，审查中-9） */
  const handleActiveTabChanged = (sessionId: string, newTabId: string, windowId: string): void => {
    if (recordedWindowId !== windowId) return
    const s = machine.getState()
    if (s.status === 'idle' || s.sessionId !== sessionId || s.tabId === newTabId) return
    requestStop('auto')
  }

  /** 生命周期钩子：激活会话变化（newActive 含 null 空态；≠ 被录会话即切走） */
  const handleActiveSessionChanged = (newActive: string | null): void => {
    const s = machine.getState()
    if (s.status === 'idle' || s.sessionId === newActive) return
    requestStop('auto')
  }

  /** 生命周期钩子：被录会话销毁/关闭 */
  const handleSessionGone = (sessionId: string): void => {
    const s = machine.getState()
    if (s.status === 'idle' || s.sessionId !== sessionId) return
    requestStop('auto')
  }

  // 退出收尾（审查低-7）：退出时录制不弹框、尽力排空落盘——进程退出时序不保证
  // 完成，未落盘部分留 .part 由下次启动清扫删除（如实的产品取舍，PRD 未承诺退出保存）
  app.on('before-quit', () => {
    if (machine.getState().status === 'idle') return
    pendingStopReason = 'user'
    try {
      machine.stop()
    } catch {
      return
    }
    collector?.sendCommand('stop')
    void settle(true)
  })

  console.log('[recording] IPC handlers 已注册（UI 4 条 + 采集器桥 4 条 + 生命周期订阅）')
  return {
    handleTabGone,
    handleActiveTabChanged,
    handleActiveSessionChanged,
    handleSessionGone,
    /** 录制中锚定窗（F''：manager 弹层收起按录制态分派应用矩形）；idle 为 null */
    getRecordedWindowId: () => (machine.getState().status === 'idle' ? null : recordedWindowId)
  }
}

/**
 * 五路自动停止的单点路由（装配层 main/index.ts 调用）：订阅 registry 生命周期流，
 * 分发到录制钩子（钩子内部与录制目标比对，不匹配零动作）。
 */
export function routeBrowserLifecycleToRecording(
  registry: SessionBrowserRegistry,
  hooks: {
    handleTabGone: (sessionId: string, tabId: string, reason: 'tab-closed' | 'tab-moved') => void
    handleActiveTabChanged: (sessionId: string, newTabId: string, windowId: string) => void
    handleActiveSessionChanged: (newActive: string | null) => void
    handleSessionGone: (sessionId: string) => void
  }
): void {
  registry.onBrowserLifecycle((kind, sessionId, tabId, windowId) => {
    // Tab 级事件 sessionId 恒非 null（registry emit 点保证）；null 仅 session-switched
    if (kind === 'tab-closed' && tabId !== undefined) {
      if (sessionId !== null) hooks.handleTabGone(sessionId, tabId, 'tab-closed')
    } else if (kind === 'tab-moved' && tabId !== undefined) {
      if (sessionId !== null) hooks.handleTabGone(sessionId, tabId, 'tab-moved')
    } else if (kind === 'tab-switched' && tabId !== undefined) {
      if (sessionId !== null && windowId !== undefined) {
        hooks.handleActiveTabChanged(sessionId, tabId, windowId)
      }
    } else if (kind === 'session-switched') {
      hooks.handleActiveSessionChanged(sessionId)
    } else if (kind === 'session-gone') {
      if (sessionId !== null) hooks.handleSessionGone(sessionId)
    }
  })
}
