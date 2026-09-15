import './assets/app.css'

import { Suspense, lazy, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import OmniboxSuggestWindow from './components/browser/OmniboxSuggestWindow'
import { useAppearanceStore } from './stores/appearance'
import { useBrowserStore, windowIdentity } from './stores/browser'
import { useSessionsStore } from './stores/sessions'

// App 惰性加载（审查修复轮低 8）：子窗角色（?role=omnibox-suggest）只渲染轻量的
// OmniboxSuggestWindow，不必加载 App 图（antd/组件全图随 App chunk 分流）；主窗与
// 独立窗首帧经 Suspense fallback=null 过渡，加载完成后照常绘制
const App = lazy(() => import('./App'))

// 建议子窗角色先行分流（原生子窗口化专项）：纯渲染端——只订阅 data 推送渲染建议
// 面板，不初始化 sessions/browser stores（零拉取零持有，状态单源在宿主 shell）；
// 主题随 nativeTheme themeSource 驱动的 prefers-color-scheme 自动亮暗，appearance
// 订阅亦不需要。其余角色同走既有链路
if (new URLSearchParams(window.location.search).get('role') === 'omnibox-suggest') {
  document.body.dataset.role = 'omnibox-suggest'
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <OmniboxSuggestWindow />
    </StrictMode>
  )
} else {
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
      <Suspense fallback={null}>
        <App />
      </Suspense>
    </StrictMode>
  )
}
