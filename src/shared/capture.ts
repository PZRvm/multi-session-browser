// 快速截图域共享契约（快速截图专项，需求见 docs/PRD.md 3.10.1/4.13、计划
// notes/plans/20261009232146-快速截图开发计划.md 契约核对第 1 条）：工具栏截图钮与
// 自定义快捷键共用的截图执行口、「下载」次动作口、页面聚焦态快捷键触发的回程推送。
// 三通道：
// - capture（invoke，任意壳层 → 主进程）：截当前激活 Tab 可视区入剪贴板，返回
//   captureId（主进程单槽缓存标识，供 save-last 对账）；
// - save-last（invoke，任意壳层 → 主进程）：把单槽缓存的最近一次截图落盘系统下载
//   目录（会话名锚定命名、非法字符清洗、同名追加序号、临时名 + rename 原子落地），
//   返回绝对路径；
// - request（推送，主进程 → 发起窗）：页面聚焦态命中自定义截图快捷键时经 manager
//   before-input-event 定向推送（find-request 同构），汇流该窗 renderer 的同一
//   capture 动作——shell 聚焦态不经此通道（renderer keydown 直调 store）。
// 单槽语义：主进程只缓存最近一次截图 PNG（新截图覆盖、退出即失，不做历史/图库），
// save-last 校验 captureId 不匹配即「截图已过期」——防连续截图竞态落错图。

export const CAPTURE_CHANNELS = {
  /** 任意壳层 → 主进程：截当前激活 Tab 入剪贴板 */
  capture: 'capture:capture',
  /** 任意壳层 → 主进程：最近一次截图落盘系统下载目录 */
  saveLast: 'capture:save-last',
  /** 主进程 → 发起窗：页面聚焦态快捷键触发回程（renderer 汇流 capture 动作） */
  request: 'capture:request',
  /** 任意壳层 → 主进程：显示/更新悬浮截图反馈条（原生子窗承载，浮于页面上方） */
  showFeedback: 'capture:show-feedback',
  /** 任意壳层 → 主进程：隐藏悬浮截图反馈条 */
  hideFeedback: 'capture:hide-feedback',
  /** 主进程 → 反馈子窗：推送反馈内容（kind/text/actionLabel） */
  feedbackData: 'capture:feedback-data',
  /** 反馈子窗 → 主进程：「下载」次动作点击上报（主进程转发宿主 shell） */
  feedbackAction: 'capture:feedback-action',
  /** 主进程 → 宿主 shell：「下载」点击转发（shell 汇流 saveLastCapture 动作） */
  downloadRequest: 'capture:download-request'
} as const

/** 反馈子窗角色（建窗 query role，main.tsx 第六角色分流） */
export const CAPTURE_FEEDBACK_WINDOW_ROLE = 'capture-feedback'

/** 悬浮反馈条度量常量（与 app.css .chrome-capturebar 系同源配对，改一处必改另一处）：
 * 全宽通知条贴宿主内容区（chrome-body）顶缘——覆盖在网页上方、宿主布局零压缩；
 * 宽度随锚点（chrome-body 宽），仅高度为固定常量 */
export const CAPTURE_FEEDBACK_HEIGHT = 28

export type CaptureFeedbackKind = 'copied' | 'saved' | 'danger'

/** show-feedback 载荷：kind/text/actionLabel 为宿主 shell 组装好的展示数据（反馈子窗
 * 为纯展示零自治面，同建议面板数据驱动口径）；anchorLeft/anchorTop/anchorWidth 为
 * 宿主内容区 chrome-body 的左缘/顶缘/宽度（客户端坐标 DIP，主进程 +
 * getContentBounds 原点换算屏幕位）——反馈条贴顶全宽覆盖该区域 */
export interface CaptureFeedbackShowPayload {
  kind: CaptureFeedbackKind
  text: string
  /** 「下载」次动作钮文案（仅 copied 态携带） */
  actionLabel?: string
  anchorLeft: number
  anchorTop: number
  anchorWidth: number
}

/** feedback-data 推送载荷（主进程 → 反馈子窗；hint 与反馈条共用通道，kind 分流） */
export interface CaptureFeedbackDataPayload {
  kind: CaptureFeedbackKind | 'hint'
  text: string
  actionLabel?: string
  /** hint 键帽显示串（仅 kind === 'hint' 携带） */
  keyText?: string
  /** hint 箭头 x 偏移（窗口内 px，= 按钮宽度一半即按钮中心；仅 kind === 'hint'） */
  arrowLeft?: number
}

/** feedback-action 载荷（反馈子窗 → 主进程） */
export interface CaptureFeedbackActionPayload {
  action: 'download'
}

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
