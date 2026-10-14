import { useEffect, useState } from 'react'
import { CloseOutlined } from '@ant-design/icons'
import { useT } from '../../i18n'
import { getLatestCaptureFeedbackData, subscribeCaptureFeedbackData } from './captureFeedbackData'

// 悬浮截图反馈条子窗渲染端（快速截图专项反馈轮三，承载机制同建议子窗
// OmniboxSuggestWindow）：纯展示零自治——宿主 shell 经 show-feedback 组装内容（kind/
// text/actionLabel 已本地化），主进程经 feedback-data 全量推送，本组件渲染最新一帧；
// 「下载」点击经 feedback-action 上报，主进程校验转发宿主 shell（download-request）
// 汇流 saveLastCapture。**数据订阅在 main.tsx 入口求值期挂接**（2026-10-14 首现丢失
// 缺陷修复，见 captureFeedbackData.ts 模块头注的时序依据——本组件是 React.lazy 懒
// chunk，订阅留在组件内时首推先于求值到达而丢失）；组件经共享模块取 latest 初值 +
// 订阅后续推送，挂载晚于首推也不丢帧。
// 左端常驻关闭钮：dismiss 经 feedback-action 上报（携 kind/text 内容指纹，主进程
// 转发 dismiss-request）→ 宿主与 6s 自动隐藏同路收起（danger 常驻条由此获得手动
// 出口）；文案经 useT（建窗 query lang 首帧注入，语言切换经 settings:changed 推送）。
// 「编辑」入口（截图编辑器专项步骤 4，位次 2026-10-14 二轮批复「编辑入口显示在
// 最右边」）：copied/saved 态显示、danger 不显示（错误态无编辑对象）；DOM 序列在
// 「下载」钮之后即条最右端（saved 态无下载钮则独占右端），点击经 feedback-action
// 的 edit 动作上报，主进程直接开/聚焦编辑子窗（不经宿主回程）。
// 视觉：透明窗体 + .chrome-capturebar（app.css body[data-role] 满窗作用域），主题随
// prefers-color-scheme 自动亮暗。可访问性（审查 20261014105226 低-3）：role="status"
// 落在文本 span 上——live region 不含可聚焦按钮，关闭/下载钮在静默容器内。

function CaptureFeedbackWindow(): React.JSX.Element | null {
  // 初值经共享模块现读（latest 缓存在入口求值期的订阅里维护——组件挂载晚于首推
  // 也不丢帧），后续经订阅驱动重渲染
  const [data, setData] = useState(getLatestCaptureFeedbackData)
  const t = useT()

  useEffect(() => subscribeCaptureFeedbackData(setData), [])

  // 显窗前必有内容推送（ready-to-show 先 flush 再 showInactive），空态仅为防御
  if (!data) return null

  return (
    <div className={`chrome-capturebar${data.kind === 'danger' ? ' is-danger' : ''}`}>
      <button
        type="button"
        className="chrome-capturebar-close"
        aria-label={t('browser.capture.close')}
        title={t('browser.capture.close')}
        onClick={() => {
          void window.api.capture
            .feedbackAction({ action: 'dismiss', kind: data.kind, text: data.text })
            .catch(() => {})
        }}
      >
        <CloseOutlined />
      </button>
      <span className="chrome-capturebar-text" role="status" title={data.text}>
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
      {(data.kind === 'copied' || data.kind === 'saved') && (
        <button
          type="button"
          className="chrome-capturebar-save chrome-capturebar-edit"
          aria-label={t('browser.capture.edit')}
          title={t('browser.capture.edit')}
          onClick={() => {
            void window.api.capture.feedbackAction({ action: 'edit' }).catch(() => {})
          }}
        >
          {t('browser.capture.edit')}
        </button>
      )}
    </div>
  )
}

export default CaptureFeedbackWindow
