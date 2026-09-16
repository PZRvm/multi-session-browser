import './assets/app.css'

import { Suspense, lazy, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import OmniboxSuggestWindow from './components/browser/OmniboxSuggestWindow'
import { useAppearanceStore } from './stores/appearance'
import { useBrowserStore, windowIdentity } from './stores/browser'
import { useSessionsStore } from './stores/sessions'
import { SETTINGS_WINDOW_ROLE } from '../../shared/settings'

// App 惰性加载（审查修复轮低 8）：子窗角色（?role=omnibox-suggest / ?role=settings）
// 只渲染轻量组件，不必加载 App 图（antd/组件全图随 App chunk 分流）；主窗与
// 独立窗首帧经 Suspense fallback=null 过渡，加载完成后照常绘制
const App = lazy(() => import('./App'))

// 设置窗壳体同款惰性分流（设置专项阶段一）：阶段一只有三组分组标题骨架
const SettingsWindow = lazy(() => import('./components/SettingsWindow'))

const role = new URLSearchParams(window.location.search).get('role')

// 设置窗角色先行分流（设置专项阶段一，?role=settings）：单例设置子窗由主进程加载
// 本 renderer 包进入该角色。不初始化 sessions/browser store（无会话面板与浏览区）；
// 阶段二起初始化 appearance 只读镜像（设置窗外观行显示真实当前模式）。壳体主题仍走
// CSS 媒体查询：app.css 的暗色 token 经 prefers-color-scheme 随主进程 nativeTheme
// .themeSource 自动翻转（与建窗注入的 backgroundColor 同源对账）
if (role === SETTINGS_WINDOW_ROLE) {
  document.body.dataset.role = SETTINGS_WINDOW_ROLE
  // 外观行只读镜像自阶段二初始化（兑现阶段一「阶段二再议」备注）：init 先订阅后拉取，
  // 有 in-flight 防重入与失败容错——失败不阻塞壳体渲染，保留 CSS 媒体查询主题；设置窗
  // 只读消费 mode/resolvedTheme，不调用 setMode（切换仍由板头/主进程承担）
  void useAppearanceStore.getState().init()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Suspense fallback={null}>
        <SettingsWindow />
      </Suspense>
    </StrictMode>
  )
} else if (role === 'omnibox-suggest') {
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
