// 快速截图与快速录屏·共享契约（截图线计划 20261009232146 + 录屏线计划
// 20261009231903 两线合并融合，2026-10-10）：
// 截图面——工具栏截图钮与自定义快捷键共用的截图执行口、「下载」次动作口、页面聚焦态
// 快捷键触发的回程推送、悬浮反馈条编排（主进程单槽缓存语义：只存最近一次截图 PNG，
// 新截图覆盖、退出即失，save-last 校验 captureId 不匹配即「截图已过期」）。
// 录屏面——renderer（工具栏录屏钮）只发意图（begin/pause/resume/stop）与订阅状态推送；
// 采集数据链路不经本契约暴露面——chunk 通道由主进程采集器专用桥（recording/capturePreload.ts）
// 自持使用，UI preload 不暴露。begin 由主进程全编排：预检 → 目标分区建采集器 →
// 分区 session 注册 handler（授予被录 Tab 的 WebFrameMain，跨 session 授予被 spike 证伪）
// → 采集页 getDisplayMedia + MediaRecorder → chunk 直达主进程落盘。

export const CAPTURE_CHANNELS = {
  // ===== 截图面 =====
  /** 任意壳层 → 主进程：截当前激活 Tab 入剪贴板 */
  capture: 'capture:capture',
  /** 任意壳层 → 主进程：最近一次截图落盘系统下载目录 */
  saveLast: 'capture:save-last',
  /** 主进程 → 发起窗：页面聚焦态快捷键触发回程（renderer 汇流 capture 动作） */
  request: 'capture:request',
  /** 任意壳层 → 主进程：显示/更新悬浮截图反馈条 */
  showFeedback: 'capture:show-feedback',
  /** 任意壳层 → 主进程：隐藏悬浮截图反馈条 */
  hideFeedback: 'capture:hide-feedback',
  /** 主进程 → 反馈子窗：推送反馈内容（kind/text/actionLabel） */
  feedbackData: 'capture:feedback-data',
  /** 反馈子窗 → 主进程：反馈条按钮点击上报（download=「下载」次动作 / dismiss=关闭钮，
   *  主进程校验 sender 白名单后转发宿主 shell） */
  feedbackAction: 'capture:feedback-action',
  /** 主进程 → 宿主 shell：「下载」点击转发（shell 汇流 saveLastCapture 动作） */
  downloadRequest: 'capture:download-request',
  /** 主进程 → 宿主 shell：关闭钮点击转发（载荷带内容指纹，shell 与最近一次 show
   *  镜像比对后收起——不匹配即忽略，防迟到 dismiss 收起新一轮反馈条） */
  dismissRequest: 'capture:dismiss-request',
  // ===== 录屏面 =====
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

/** 反馈子窗角色（建窗 query role，main.tsx 第六角色分流） */
export const CAPTURE_FEEDBACK_WINDOW_ROLE = 'capture-feedback'

/** 悬浮反馈条度量常量（与 app.css .chrome-capturebar 系同源配对，改一处必改另一处）：
 * 全宽通知条贴宿主内容区（chrome-body）顶缘——覆盖在网页上方、宿主布局零压缩；
 * 宽度随锚点（chrome-body 宽），仅高度为固定常量 */
export const CAPTURE_FEEDBACK_HEIGHT = 28

export type CaptureFeedbackKind = 'copied' | 'saved' | 'danger'

/** show-feedback 载荷：kind/text/actionLabel 为宿主 shell 组装好的展示数据（反馈子窗
 * 为纯展示零自治面）；anchorLeft/anchorTop/anchorWidth 为宿主内容区 chrome-body 的
 * 左缘/顶缘/宽度（客户端坐标 DIP）——反馈条贴顶全宽覆盖该区域 */
export interface CaptureFeedbackShowPayload {
  kind: CaptureFeedbackKind
  text: string
  /** 「下载」次动作钮文案（仅 copied 态携带） */
  actionLabel?: string
  anchorLeft: number
  anchorTop: number
  anchorWidth: number
}

/**
 * feedback-data 推送载荷（主进程 → 反馈子窗）：kind 三态与反馈条一致。工具钮悬停
 * 提示已随 2026-10-10 合并裁决统一为 renderer 自绘气泡（Toolbar .chrome-tools-pop，
 * 显于按钮上方），不经本通道——原 hint kind 与键帽/箭头字段已随修复轮清除
 */
export interface CaptureFeedbackDataPayload {
  kind: CaptureFeedbackKind
  text: string
  actionLabel?: string
}

/** dismiss 内容指纹（dismiss action / dismiss-request 共用载荷面）：被关那条的
 *  kind + text——宿主与最近一次 show 的镜像比对，不匹配说明已显示更新一轮反馈，
 *  迟到的 dismiss 应忽略（审查 20261014105226 低-2 加固；连续两次同文案截图指纹
 *  相同属可接受残留：新条与被关条内容一致，隐藏即用户所指） */
export interface CaptureDismissRequestPayload {
  kind: CaptureFeedbackKind
  text: string
}

/** feedback-action 载荷（反馈子窗 → 主进程）：download=「下载」次动作（转发宿主汇流
 *  saveLastCapture），dismiss=关闭钮收起（携带内容指纹，转发宿主比对镜像后收起） */
export type CaptureFeedbackActionPayload =
  { action: 'download' } | ({ action: 'dismiss' } & CaptureDismissRequestPayload)

/** capture 返回：captureId 为主进程单槽缓存标识（save-last 对账用） */
export interface CaptureResult {
  captureId: string
}

/** save-last 载荷：capture 必须为最近一次 capture 返回值（不匹配报「截图已过期」） */
export interface CaptureSavePayload {
  captureId: string
}

/** save-last 返回：落盘绝对路径（反馈条「已保存：{path}」消费） */
export interface CaptureSaveResult {
  path: string
}

// ===== 录屏面类型 =====

/** 录制状态机（主进程单源裁决；renderer 纯镜像） */
export type CaptureStatus = 'idle' | 'recording' | 'paused'

/** begin 载荷：目标 = 当前激活会话的当前激活 Tab（renderer 不自报 id，主进程现取权威值核验一致——
 *  sessionId 按 resolveSenderScope、tabId 按发起窗快照 activeTabId，不一致即拒） */
export interface CaptureBeginPayload {
  sessionId: string
  tabId: string
}

/** begin 返回：accepted 区分受理与拒绝（busy/载荷非法/激活位不一致），拒绝时 state
 *  携带当前态 */
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
