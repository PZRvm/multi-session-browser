// 录屏域共享契约（快速截图与快速录屏专项·录屏线，计划
// notes/plans/20261009231903-录屏功能开发计划.md 第 3 节契约点 1，spike 定稿 A' 架构）：
// renderer（工具栏录屏钮）只发意图（begin/pause/resume/stop）与订阅状态推送；
// 采集数据链路不经本契约暴露面——chunk 通道由主进程采集器专用桥（recording/capturePreload.ts）
// 自持使用，UI preload 不暴露。begin 由主进程全编排：预检 → 目标分区建采集器 view →
// 分区 session 注册 handler（授予被录 Tab 的 WebFrameMain，跨 session 授予被 spike 证伪）
// → 采集页 getDisplayMedia + MediaRecorder → chunk 直达主进程落盘。

export const CAPTURE_CHANNELS = {
  /** UI → 主进程：开始录制（载荷 CaptureBeginPayload；主进程编排采集器，失败整体回滚 idle） */
  begin: 'capture:record-begin',
  /** UI → 主进程：暂停录制（MediaRecorder.pause 映射，暂停段不落帧不计时长） */
  pause: 'capture:record-pause',
  /** UI → 主进程：恢复录制（续录同一文件） */
  resume: 'capture:record-resume',
  /** UI → 主进程：停止录制（finalize 落盘 + 原生信息框反馈） */
  stop: 'capture:record-stop',
  /** 主进程 → 全部窗口：录制状态推送（appearance 广播式先例）。媒体分块走
   *  COLLECTOR_CHANNELS（采集器私有桥，不经 UI preload 暴露） */
  stateChanged: 'capture:state-changed'
} as const

/** 录制状态机（主进程单源裁决；renderer 纯镜像） */
export type CaptureStatus = 'idle' | 'recording' | 'paused'

/** begin 载荷：目标 = 当前激活会话的当前激活 Tab（renderer 不自报 id，主进程现取权威值核验一致——
 *  sessionId 按 resolveSenderScope、tabId 按发起窗快照 activeTabId，不一致即拒） */
export interface CaptureBeginPayload {
  sessionId: string
  tabId: string
}

/** begin 返回：accepted 区分受理与拒绝（busy/载荷非法/激活位不一致），拒绝时 state
 *  携带当前态（renderer busy 提示判据，审查中-7） */
export interface CaptureBeginResult {
  accepted: boolean
  state: CaptureState
}

/** 状态推送载荷：idle 态仅 { status: 'idle' }（会话/计时字段全部缺席 = 类型层硬保证） */
export interface CaptureState {
  status: CaptureStatus
  /** 以下字段仅 recording/paused 态存在 */
  sessionId?: string
  tabId?: string
  /** 开始时刻（Date.now() ms） */
  startedAt?: number
  /** 已结束的暂停累计毫秒（resume 时结算累加） */
  pausedAccumMs?: number
  /** 当前暂停段的开始时刻（仅 paused 态存在；进行中暂停段的时长由 elapsedMs 现扣） */
  pauseStartedAt?: number
}

/** stop/自动停止的编排结果（主进程原生信息框消费；file 为最终落盘绝对路径） */
export interface CaptureStopResult {
  ok: boolean
  file?: string
  error?: string
}

/** 采集器私有通道（主进程 ↔ 采集器 view 专用桥，不经 UI preload 暴露；与 CAPTURE_CHANNELS
 *  分离是因为消费方不同——UI 面契约 vs 采集器内部管线，但同源单文件管理禁手写字符串） */
export const COLLECTOR_CHANNELS = {
  /** 采集页 → 主进程：采集器就绪（流已建立、MediaRecorder 已建） */
  ready: 'capture:collector-ready',
  /** 采集页 → 主进程：媒体分块上行（ArrayBuffer） */
  chunk: 'capture:collector-chunk',
  /** 采集页 → 主进程：失败上报（getDisplayMedia 拒绝/MediaRecorder 错误，message） */
  error: 'capture:collector-error',
  /** 采集页 → 主进程：停止完成上报（MediaRecorder onstop，主进程做 finalize 收尾） */
  stopped: 'capture:collector-stopped',
  /** 主进程 → 采集页：指令下行（'pause' | 'resume' | 'stop'） */
  command: 'capture:collector-command'
} as const

/** 有效录制时长（ms）：now − startedAt − pausedAccumMs −（暂停中：now − pauseStartedAt）。
 *  暂停段不落帧不计时长；主进程状态机与 renderer 本地 ticking 共用同一口径 */
export function elapsedMs(state: CaptureState, now: number): number {
  if (state.status === 'idle' || state.startedAt === undefined) return 0
  const closedPauses = state.pausedAccumMs ?? 0
  const openPause =
    state.status === 'paused' && state.pauseStartedAt !== undefined
      ? Math.max(0, now - state.pauseStartedAt)
      : 0
  return Math.max(0, now - state.startedAt - closedPauses - openPause)
}
