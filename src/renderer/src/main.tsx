import './assets/app.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { useAppearanceStore } from './stores/appearance'
import { useBrowserStore, windowIdentity } from './stores/browser'
import { useSessionsStore } from './stores/sessions'

// 外观镜像独立初始化：失败时保留首帧的系统 media query 结果，不阻塞会话与浏览器恢复。
// 独立窗口同走此链路（各窗实例自拉取），与主窗口主题保持一致。
void useAppearanceStore.getState().init()

if (windowIdentity.mode === 'main') {
  // 首帧前从主进程加载状态；init 内部有防重入守卫，StrictMode 下安全。
  // 顺序约束（阶段 4）：sessions.init 必须先行完成再 init browser——browser store 的快照
  // 守卫以 sessions 的 activeId 为准，而 browser:get-state（主进程同步 handler）几乎必然
  // 先于 sessions:list（异步读盘）resolve；并发触发会把启动期合法快照误判过期丢弃，
  // 右侧卡死在零会话空态（波次 4 检查点实测并修复的竞态）
  void useSessionsStore
    .getState()
    .init()
    .then(() => useBrowserStore.getState().init())
    .catch(() => undefined)
} else {
  // 独立窗口不初始化 sessions store（无会话面板，作用域会话由建窗 query 绑定）：
  // browser 守卫按 windowId 比对、不依赖 activeId，上述串行约束不存在，直接 init
  void useBrowserStore.getState().init()
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
