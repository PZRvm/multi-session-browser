import { useEffect, useRef, useState } from 'react'
import { AppstoreOutlined, SettingOutlined } from '@ant-design/icons'
import { useT } from '../../i18n'
import { useUiStore } from '../../stores/ui'
import type { ExtensionListItem } from '../../../../shared/extensions/management'

// 工具栏扩展面板（2026-11-11 增量，Chrome 拼图菜单还原）：
// 标题行 + 无需访问说明 + 插件行（真实图标 + 名称；点击＝打开该插件 action popup，
// 锚定工具栏拼图按钮）+ 底部分隔的管理入口（打开设置窗插件版面）。
// 世界 = 浏览器区 chrome 表面族（--chrome-* token 随亮暗自动翻转）；钉住/右键菜单、
// 站点访问态与固定图标位为后续增量（与 Chrome 对齐节奏见 plan TODO）。

export interface ExtensionsPanelProps {
  /** 拼图按钮视口坐标（面板右对齐其下），并回传主进程作 popup 锚点 */
  anchor: { x: number; y: number }
  onClose: () => void
}

export function ExtensionsPanel({ anchor, onClose }: ExtensionsPanelProps): React.JSX.Element {
  const t = useT()
  const [items, setItems] = useState<ExtensionListItem[]>([])
  const [loaded, setLoaded] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  // 原生层让位登记：面板存活期间 overlayDepth>0，BrowserContentAnchor 上报零矩形
  // 收起 WebContentsView，面板成为窗口最高层（DOM 层级压不过原生视图的既有机制）
  useEffect(() => {
    useUiStore.getState().openOverlay()
    return () => {
      useUiStore.getState().closeOverlay()
    }
  }, [])
  useEffect(() => {
    let alive = true
    window.api.extensions
      .list()
      .then((list) => {
        if (!alive) return
        setItems(list)
        setLoaded(true)
      })
      .catch(() => {
        if (alive) setLoaded(true)
      })
    return () => {
      alive = false
    }
  }, [])

  // 外点关闭与 Esc 关闭（Chrome 气泡行为）
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const openPopup = (item: ExtensionListItem): void => {
    if (!item.hasAction) return
    void window.api.extensions
      .openPopup(item.id, anchor)
      .then((r) => {
        // 成功才收面板（Chrome 行为：菜单关、弹窗开）；失败保留面板便于重试
        if (r.ok) onClose()
        else console.warn('[extensions-panel] popup 打开失败:', r.error)
      })
      .catch((e) => console.warn('[extensions-panel] popup 异常:', String(e).slice(0, 80)))
  }

  return (
    <div
      ref={rootRef}
      className="chrome-ext-panel"
      role="dialog"
      aria-label={t('browser.extpanel.aria')}
      style={{ top: anchor.y + 30, right: Math.max(8, window.innerWidth - anchor.x - 30) }}
    >
      <div className="chrome-ext-panel-head">
        <h3>{t('browser.extpanel.title')}</h3>
        <button type="button" className="chrome-ext-panel-close" aria-label={t('browser.extpanel.closeAria')} onClick={onClose}>
          ×
        </button>
      </div>
      <p className="chrome-ext-panel-hint-title">{t('browser.extpanel.hintTitle')}</p>
      <p className="chrome-ext-panel-hint-body">{t('browser.extpanel.hintBody')}</p>
      {loaded && items.length === 0 ? (
        <p className="chrome-ext-panel-empty">{t('browser.extpanel.empty')}</p>
      ) : (
        <ul className="chrome-ext-panel-list">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="chrome-ext-panel-row"
                disabled={!item.hasAction}
                title={item.hasAction ? undefined : t('browser.extpanel.noAction')}
                onClick={() => {
                  openPopup(item)
                  onClose()
                }}
              >
                <span className="chrome-ext-panel-icon" aria-hidden="true">
                  {item.icon ? (
                    <img src={item.icon} alt="" width="20" height="20" />
                  ) : (
                    <AppstoreOutlined />
                  )}
                </span>
                <span className="chrome-ext-panel-name">{item.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="chrome-ext-panel-foot">
        <button
          type="button"
          className="chrome-ext-panel-manage"
          onClick={() => {
            void window.api.extensions.manage()
            onClose()
          }}
        >
          <SettingOutlined aria-hidden="true" />
          <span>{t('browser.extpanel.manage')}</span>
        </button>
      </div>
    </div>
  )
}
