import { useEffect, useState } from 'react'
import type { CaptureFeedbackDataPayload } from '../../../../shared/capture'

// 悬浮截图反馈条子窗渲染端（快速截图专项反馈轮三，承载机制同建议子窗
// OmniboxSuggestWindow）：纯展示零自治——宿主 shell 经 show-feedback 组装内容（kind/
// text/actionLabel 已本地化），主进程经 feedback-data 全量推送，本组件渲染最新一帧；
// 「下载」点击经 feedback-action 上报，主进程校验转发宿主 shell（download-request）
// 汇流 saveLastCapture。data 订阅在模块求值期同步建立（先于首帧 paint 与主进程
// ready-to-show 后的推送，消除「推送先于订阅」竞态；推送早于挂载时暂存 latest）。
// 视觉：透明窗体 + .chrome-capturebar 圆角胶囊（app.css body[data-role] 满窗作用域），
// 主题随 prefers-color-scheme 自动亮暗。

let latest: CaptureFeedbackDataPayload | null = null
const listeners = new Set<(payload: CaptureFeedbackDataPayload) => void>()

const unsubscribeData = window.api.capture.onFeedbackData((payload) => {
  latest = payload
  for (const notify of listeners) notify(payload)
})

// HMR 热更新该模块时退订并清空监听集（OmniboxSuggestWindow 同款）
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    unsubscribeData()
    listeners.clear()
  })
}

function subscribe(notify: (payload: CaptureFeedbackDataPayload) => void): () => void {
  listeners.add(notify)
  return () => {
    listeners.delete(notify)
  }
}

function CaptureFeedbackWindow(): React.JSX.Element | null {
  const [data, setData] = useState<CaptureFeedbackDataPayload | null>(latest)

  useEffect(() => subscribe(setData), [])

  // 显窗前必有内容推送（ready-to-show 先 flush 再 showInactive），空态仅为防御
  if (!data) return null

  return (
    <div className={`chrome-capturebar${data.kind === 'danger' ? ' is-danger' : ''}`} role="status">
      <span className="chrome-capturebar-text" title={data.text}>
        {data.text}
      </span>
      {data.kind === 'copied' && data.actionLabel && (
        <button
          type="button"
          className="chrome-capturebar-save"
          onClick={() => {
            void window.api.capture.feedbackAction({ action: 'download' }).catch(() => {})
          }}
        >
          {data.actionLabel}
        </button>
      )}
    </div>
  )
}

export default CaptureFeedbackWindow
