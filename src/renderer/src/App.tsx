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

// 主窗口 shell：左会话面板 + 分隔条 + 右浏览器区；面板拖拽逻辑内聚于此——
// 独立窗口形态不渲染本组件，分隔条与其全局指针监听也随之不挂接。
// HTML 全屏（视频全屏等）期间左栏与分隔条不渲染（Chrome 对齐，快照 htmlFullscreen
// 驱动）；panel-right flex:1 自然占满整宽，退出后随快照回落复原
function MainShell(): React.JSX.Element {
  const [panelWidth, setPanelWidth] = useState(PANEL_DEFAULT)
  const dragging = useRef(false)
  const t = useT()
  const htmlFullscreen = useBrowserStore((s) => s.htmlFullscreen)

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
        <div className="panel-left" style={{ width: panelWidth }}>
          <SessionPanel panelWidth={panelWidth} />
        </div>
      )}
      {!htmlFullscreen && (
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
