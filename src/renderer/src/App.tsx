import { useCallback, useEffect, useRef, useState } from 'react'
import { App as AntdApp, ConfigProvider, theme } from 'antd'
import { THEME_SYSTEMS } from '../../shared/themeSystems'
import BrowserFrame from './components/BrowserFrame'
import IndependentWindowFrame from './components/IndependentWindowFrame'
import SessionPanel from './components/SessionPanel'
import { useAppearanceStore } from './stores/appearance'
import { useBrowserStore, windowIdentity } from './stores/browser'
import { useI18nStore } from './stores/i18n'
import { ANTD_LOCALES, useT } from './i18n'
import { applyThemeTokens } from './theme'

const PANEL_MIN = 220
const PANEL_MAX = 420
const PANEL_DEFAULT = 280
/* 收起态轨道宽（2026-09-28 侧边栏收起专项，契约冻结于
   notes/plans/20260928143655 2.4 节；反馈轮二定稿 48px——收起态原生三灯整组隐藏
   （shell:set-native-window-buttons-visible，左上角仅剩自绘关闭点），灯组宽度不再
   是轨道下限） */
const PANEL_COLLAPSED_WIDTH = 48

// 主窗口 shell：左会话面板 + 分隔条 + 右浏览器区；面板拖拽逻辑内聚于此——
// 独立窗口形态不渲染本组件，分隔条与其全局指针监听也随之不挂接。
// HTML 全屏（视频全屏等）期间左栏与分隔条不渲染（Chrome 对齐，快照 htmlFullscreen
// 驱动）；panel-right flex:1 自然占满整宽，退出后随快照回落复原。
// 收起态（collapsed）为渲染层瞬态 UI 态：不持久化，重启恢复展开态（与 panelWidth
// 不落盘同口径）；收起只换轨道宽，panelWidth 原值保留、展开即原宽恢复；
// 收起期间分隔条不渲染（轨道恒宽不可拖，展开/收起只经板头按钮）
function MainShell(): React.JSX.Element {
  const [panelWidth, setPanelWidth] = useState(PANEL_DEFAULT)
  const [collapsed, setCollapsed] = useState(false)
  const dragging = useRef(false)
  const t = useT()
  const { message } = AntdApp.useApp()
  const htmlFullscreen = useBrowserStore((s) => s.htmlFullscreen)

  // 收起/展开切换：先以当前渲染闭包的 collapsed 定序再提交——IPC 副作用不进
  // setState updater（updater 须纯，StrictMode dev 双调用会重复发 IPC——审查
  // 20260928165442 中 2）；失败经 message.warning 反馈（审查低 6，原 console.warn
  // 为不可感知的静默）
  const toggleCollapsed = (): void => {
    const next = !collapsed
    setCollapsed(next)
    window.api.shell.setNativeWindowButtonsVisible({ visible: !next }).catch(() => {
      console.warn('收起态原生三灯显隐切换失败:', next)
      message.warning(t('sessions.panel.shellToggleFailed'))
    })
  }

  const onPointerMove = useCallback((e: PointerEvent): void => {
    if (!dragging.current) return
    const width = Math.min(PANEL_MAX, Math.max(PANEL_MIN, e.clientX))
    setPanelWidth(width)
  }, [])

  const stopDrag = useCallback((): void => {
    dragging.current = false
    document.body.classList.remove('col-resizing')
  }, [])

  useEffect(() => {
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', stopDrag)
    // 指针取消（系统接管/设备切换）同样结束拖拽，防 dragging 残留
    window.addEventListener('pointercancel', stopDrag)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', stopDrag)
      window.removeEventListener('pointercancel', stopDrag)
    }
  }, [onPointerMove, stopDrag])

  // 捕获指针：拖出窗口外松开时 pointerup 仍送达分隔条（冒泡到 window 收尾），
  // 否则事件丢失导致 dragging 残留——鼠标回窗后无按键移动持续改宽度
  const startDrag = (e: React.PointerEvent<HTMLDivElement>): void => {
    e.currentTarget.setPointerCapture(e.pointerId)
    dragging.current = true
    document.body.classList.add('col-resizing')
  }

  return (
    <div className="app-shell">
      {!htmlFullscreen && (
        <div
          className={`panel-left${collapsed ? ' panel-left-collapsed' : ''}`}
          style={{ width: collapsed ? PANEL_COLLAPSED_WIDTH : panelWidth }}
        >
          <SessionPanel
            panelWidth={panelWidth}
            collapsed={collapsed}
            onToggleCollapse={toggleCollapsed}
          />
        </div>
      )}
      {!htmlFullscreen && !collapsed && (
        <div
          className="panel-divider"
          role="separator"
          aria-orientation="vertical"
          aria-label={t('browser.divider.adjustWidth')}
          onPointerDown={startDrag}
        />
      )}
      <div className="panel-right">
        <BrowserFrame />
      </div>
    </div>
  )
}

// 根组件按窗口身份分流（query 解析见 stores/browser.ts）：独立窗口渲染
// IndependentWindowFrame（无左栏/分隔条），主窗口渲染既有 shell；两形态共用同一
// ConfigProvider/AntdApp 上下文——主题与 antd 弹层行为跨窗口一致
function App(): React.JSX.Element {
  const resolvedTheme = useAppearanceStore((s) => s.resolvedTheme)
  const themeColor = useAppearanceStore((s) => s.themeColor)
  const appearanceInitialized = useAppearanceStore((s) => s.initialized)
  // 界面语言（阶段六 i18n）：语言镜像按选择器订阅，切换即时翻转 antd 组件内置文案
  const language = useI18nStore((s) => s.language)

  // 运行期主题 token 重注（首帧与 OS 翻转归 theme.ts bootstrap）：以 init 真值回填为
  // 门控（审查修复轮中 1）——未初始化期间 store 的 'amber' 占位初值不得覆盖 bootstrap
  // 按 sys 注入的首帧；themeColor 与 resolvedTheme 任一变化即重注
  useEffect(() => {
    if (!appearanceInitialized) return
    applyThemeTokens(themeColor, resolvedTheme)
  }, [appearanceInitialized, themeColor, resolvedTheme])

  return (
    <ConfigProvider
      locale={ANTD_LOCALES[language]}
      theme={{
        algorithm: resolvedTheme === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          // 主色取主题配置单源（shared/themeSystems.ts），随主题色镜像动态切换；
          // accent 落在昼夜两态 token 内（该层形状由冻结契约决定，非顶层字段）
          colorPrimary: THEME_SYSTEMS[themeColor][resolvedTheme].accent,
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif'
        }
      }}
    >
      <AntdApp>
        {windowIdentity.mode === 'independent' ? <IndependentWindowFrame /> : <MainShell />}
      </AntdApp>
    </ConfigProvider>
  )
}

export default App
