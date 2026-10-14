import './assets/app.css'

import { Suspense, lazy, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import OmniboxSuggestWindow from './components/browser/OmniboxSuggestWindow'
import { useAppearanceStore } from './stores/appearance'
import { useBrowserStore, windowIdentity } from './stores/browser'
import { bootstrapLanguage, useI18nStore } from './stores/i18n'
import { useSessionsStore } from './stores/sessions'
import { useSettingsStore } from './stores/settings'
import { bootstrapThemeTokens } from './theme'
import { SETTINGS_WINDOW_ROLE } from '../../shared/settings'
import { WORKSPACE_PICKER_WINDOW_ROLE } from '../../shared/dialog'
import { CAPTURE_EDITOR_WINDOW_ROLE, CAPTURE_FEEDBACK_WINDOW_ROLE } from '../../shared/capture'

// App 惰性加载（审查修复轮低 8）：子窗角色（?role=omnibox-suggest / ?role=settings）
// 只渲染轻量组件，不必加载 App 图（antd/组件全图随 App chunk 分流）；主窗与
// 独立窗首帧经 Suspense fallback=null 过渡，加载完成后照常绘制
const App = lazy(() => import('./App'))

// 设置窗壳体同款惰性分流（设置专项阶段一）：阶段一只有三组分组标题骨架
const SettingsWindow = lazy(() => import('./components/SettingsWindow'))

// 工作区选择模态框渲染端（原生 sheet 专项，?role=workspace-picker）：同款惰性分流
const WorkspacePickerWindow = lazy(() => import('./components/WorkspacePickerWindow'))

// 悬浮截图反馈条子窗渲染端（快速截图专项反馈轮三，?role=capture-feedback）：同建议
// 子窗形态的纯展示端
const CaptureFeedbackWindow = lazy(() => import('./components/browser/CaptureFeedbackWindow'))

// 截图编辑子窗渲染端（截图编辑器专项，?role=capture-editor）：独立 BrowserWindow
// （settings 窗单例先例）挂本 renderer 包进入该角色——编辑器本体（Konva Stage 工具
// 集与产出链，components/browser/captureEditor/）；react-konva/konva 随本懒加载
// chunk 分流，不进主包
const CaptureEditorWindow = lazy(() => import('./components/browser/captureEditor/EditorWindow'))

// 主题 token 首帧注入（设置专项阶段五）：建窗 URL query 的 sys 是主进程建窗注入的
// 首帧初始值契约（运行期主题变更不再读 query，一律经 appearance:changed 推送收敛）。
// 求值期同步执行、先于 role 分流与 createRoot——设置窗 / 建议子窗 / 主窗与独立窗
// 三分支全覆盖，首帧先于 React 提交，非琥珀主题开窗不闪琥珀缺省色
bootstrapThemeTokens()

// 语言首帧注入（设置专项阶段六 i18n）：建窗 URL query 的 lang 是主进程建窗注入的
// 首帧初始值契约（sys 同点），求值期同步定 i18n 镜像初值——先于 role 分流与一切
// 渲染，四角色全覆盖；isSupportedLanguage 校验，非法/缺省忽略走默认中文，英文窗
// 首帧不闪中文
bootstrapLanguage(new URLSearchParams(window.location.search).get('lang'))

const role = new URLSearchParams(window.location.search).get('role')

// 设置窗角色先行分流（设置专项阶段一，?role=settings）：单例设置子窗由主进程加载
// 本 renderer 包进入该角色。不初始化 sessions/browser store（无会话面板与浏览区）；
// 阶段二起初始化 appearance 只读镜像（设置窗外观行显示真实当前模式）。壳体主题仍走
// CSS 媒体查询：app.css 的暗色 token 经 prefers-color-scheme 随主进程 nativeTheme
// .themeSource 自动翻转（与建窗注入的 backgroundColor 同源对账）
if (role === SETTINGS_WINDOW_ROLE) {
  document.body.dataset.role = SETTINGS_WINDOW_ROLE
  // 外观行只读镜像自阶段二初始化（兑现阶段一「阶段二再议」备注）：init 先订阅后拉取，
  // 有 in-flight 防重入与失败容错——失败不阻塞壳体渲染，保留 CSS 媒体查询主题；阶段三
  // 起设置窗同时消费与写入（外观行 onChange 经 setMode）
  void useAppearanceStore.getState().init()
  // 设置值域镜像自阶段四初始化（主页行受控值与写入）；失败不阻塞壳体渲染
  void useSettingsStore.getState().init()
  // 语言镜像自阶段六初始化（语言行受控值与写入 + ConfigProvider locale）：首帧语言
  // 已由 bootstrapLanguage 按 query 定值，init 只做 changed 订阅与真值校准；失败
  // 不阻塞壳体渲染
  void useI18nStore.getState().init()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Suspense fallback={null}>
        <SettingsWindow />
      </Suspense>
    </StrictMode>
  )
} else if (role === 'omnibox-suggest') {
  document.body.dataset.role = 'omnibox-suggest'
  // 语言镜像订阅（阶段六 i18n）：建议子窗是懒建复用池，语言切换不重建已存活子窗，
  // 文案更新只能靠 settings:changed 推送——仅 init i18n 镜像（失败不阻塞面板渲染）；
  // 不初始化 sessions/browser/settings 等其他 store 的现状保持不变
  void useI18nStore.getState().init()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <OmniboxSuggestWindow />
    </StrictMode>
  )
} else if (role === WORKSPACE_PICKER_WINDOW_ROLE) {
  document.body.dataset.role = WORKSPACE_PICKER_WINDOW_ROLE
  // 工作区选择模态框（原生 sheet 专项）：同建议子窗形态——仅 init i18n 镜像（一次性
  // 窗口秒级存活，语言切换经订阅兜底），不初始化 sessions/browser/settings store
  //（展示上下文由主进程经 payload 通道现取，页面零事实）
  void useI18nStore.getState().init()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Suspense fallback={null}>
        <WorkspacePickerWindow />
      </Suspense>
    </StrictMode>
  )
} else if (role === CAPTURE_FEEDBACK_WINDOW_ROLE) {
  document.body.dataset.role = CAPTURE_FEEDBACK_WINDOW_ROLE
  // 悬浮截图反馈条子窗（快速截图专项反馈轮三）：同建议子窗形态——仅 init i18n 镜像
  //（懒建复用池，语言切换经 settings:changed 推送），不初始化其他 store（内容由
  // 主进程 feedback-data 推送，纯展示零自治）
  void useI18nStore.getState().init()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Suspense fallback={null}>
        <CaptureFeedbackWindow />
      </Suspense>
    </StrictMode>
  )
} else if (role === CAPTURE_EDITOR_WINDOW_ROLE) {
  document.body.dataset.role = CAPTURE_EDITOR_WINDOW_ROLE
  // 截图编辑子窗：同建议子窗形态——仅 init i18n 镜像（语言切换经 settings:changed
  // 推送），不初始化 sessions/browser 等其他 store（图源由主进程 get-edit-image 拉取，
  // 编辑态窗内自持）
  void useI18nStore.getState().init()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Suspense fallback={null}>
        <CaptureEditorWindow />
      </Suspense>
    </StrictMode>
  )
} else {
  // 外观镜像独立初始化：失败时保留首帧的系统 media query 结果，不阻塞会话与浏览器恢复。
  // 独立窗口同走此链路（各窗实例自拉取），与主窗口主题保持一致。
  void useAppearanceStore.getState().init()
  // 设置值域镜像（阶段四，主页按钮消费）：与快照守卫无耦合，不进 sessions→browser
  // 串行链，与 browser.init 并行即可
  void useSettingsStore.getState().init()
  // 语言镜像（阶段六 i18n，主窗与独立窗共用此分支）：失败不阻塞会话与浏览器恢复，
  // 首帧语言已由 bootstrapLanguage 按 query 定值
  void useI18nStore.getState().init()

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
