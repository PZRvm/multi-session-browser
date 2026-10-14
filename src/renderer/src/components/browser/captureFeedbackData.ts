// 悬浮反馈条数据源单例（2026-10-14 首现丢失缺陷修复）：订阅与 latest 缓存从
// CaptureFeedbackWindow.tsx（React.lazy 懒加载 chunk）提升到本模块，由 main.tsx
// 的 capture-feedback 角色分支在**入口求值期**同步挂接（attachCaptureFeedbackData）。
//
// 时序依据（原组件头注的裁决在新架构下失效，本模块恢复其确定性）：入口脚本是
// index.html 的 `<script type="module">`（defer 语义）——dom-ready（≈DOMContentLoaded）
// 必然等待其求值完成；而懒 chunk（含组件本体，反馈轮一编辑钮引入 @ant-design/icons
// 后依赖图变大）求值晚于 dom-ready。主进程恰在 dom-ready 冲洗 pendingData——订阅若
// 还在懒 chunk 里，首推必达于订阅挂接之前而丢失（用户缺陷「首击截图成功但反馈条
// 不弹、二击才弹」的根因）。挂接提升到入口求值期后，订阅必然先于 dom-ready 冲洗。
import type { CaptureFeedbackDataPayload } from '../../../../shared/capture'

let latest: CaptureFeedbackDataPayload | null = null
const listeners = new Set<(payload: CaptureFeedbackDataPayload) => void>()
let unsubscribe: (() => void) | null = null

/** 挂接主进程 feedback-data 推送（幂等）：capture-feedback 角色入口求值期调用一次，
 *  订阅先于 dom-ready 的 pendingData 冲洗建立 */
export function attachCaptureFeedbackData(): void {
  if (unsubscribe !== null) return
  unsubscribe = window.api.capture.onFeedbackData((payload) => {
    latest = payload
    for (const notify of listeners) notify(payload)
  })
  // HMR 热更新本模块时退订并清空监听集（原组件内同款，随订阅迁入）
  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      unsubscribe?.()
      unsubscribe = null
      listeners.clear()
    })
  }
}

/** 订阅推送（组件 useEffect 用）；返回退订函数 */
export function subscribeCaptureFeedbackData(
  notify: (payload: CaptureFeedbackDataPayload) => void
): () => void {
  listeners.add(notify)
  return () => {
    listeners.delete(notify)
  }
}

/** 最近一帧推送（组件 useState 初值用——挂载晚于首推时经此补读，不丢首帧） */
export function getLatestCaptureFeedbackData(): CaptureFeedbackDataPayload | null {
  return latest
}
