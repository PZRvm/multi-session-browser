import { useCallback, useEffect, useRef, useState } from 'react'
import { App as AntdApp, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import SessionPanel from './components/SessionPanel'
import BrowserFrame from './components/BrowserFrame'

const PANEL_MIN = 220
const PANEL_MAX = 420
const PANEL_DEFAULT = 280

function App(): React.JSX.Element {
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
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', stopDrag)
    }
  }, [onPointerMove, stopDrag])

  const startDrag = (): void => {
    dragging.current = true
    document.body.classList.add('col-resizing')
  }

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#FFB000',
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif'
        }
      }}
    >
      <AntdApp>
        <div className="app-shell">
          <div className="panel-left" style={{ width: panelWidth }}>
            <SessionPanel />
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
      </AntdApp>
    </ConfigProvider>
  )
}

export default App
