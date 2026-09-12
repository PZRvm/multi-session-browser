import { useCallback, useEffect, useRef, useState } from 'react'
import { App as AntdApp, ConfigProvider, theme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import BrowserFrame from './components/BrowserFrame'
import IndependentWindowFrame from './components/IndependentWindowFrame'
import SessionPanel from './components/SessionPanel'
import { useAppearanceStore } from './stores/appearance'
import { windowIdentity } from './stores/browser'

const PANEL_MIN = 220
const PANEL_MAX = 420
const PANEL_DEFAULT = 280

// 主窗口 shell：左会话面板 + 分隔条 + 右浏览器区；面板拖拽逻辑内聚于此——
// 独立窗口形态不渲染本组件，分隔条与其全局指针监听也随之不挂接
function MainShell(): React.JSX.Element {
  const [panelWidth, setPanelWidth] = useState(PANEL_DEFAULT)
  const dragging = useRef(false)

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
      <div className="panel-left" style={{ width: panelWidth }}>
        <SessionPanel panelWidth={panelWidth} />
      </div>
      <div
        className="panel-divider"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整面板宽度"
        onPointerDown={startDrag}
      />
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

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: resolvedTheme === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          colorPrimary: '#FFB000',
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
