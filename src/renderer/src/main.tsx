import './assets/app.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { useBrowserStore } from './stores/browser'
import { useSessionsStore } from './stores/sessions'

// 首帧前从主进程加载状态；init 内部有防重入守卫，StrictMode 下安全。
// 顺序约束（阶段 4）：sessions.init 必须先行完成再 init browser——browser store 的快照
// 守卫以 sessions 的 activeId 为准，而 browser:get-state（主进程同步 handler）几乎必然
// 先于 sessions:list（异步读盘）resolve；并发触发会把启动期合法快照误判过期丢弃，
// 右侧卡死在零会话空态（波次 4 检查点实测并修复的竞态）
void useSessionsStore.getState().init().then(() => useBrowserStore.getState().init())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
