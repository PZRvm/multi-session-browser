import { useEffect, useRef, useState } from 'react'
import { AppstoreOutlined, SettingOutlined } from '@ant-design/icons'
import { useT } from '../../i18n'
import { EXTENSIONS_PANEL_SHADOW_MARGIN } from '../../../../shared/extensionsPanel'
import type { ExtensionsPanelDataPayload } from '../../../../shared/extensionsPanel'

// 扩展面板子窗渲染端（原生子窗口化，白屏根除专项）：纯展示零自治——宿主 shell 经
// show 命令全量推送面板数据（items），本组件渲染最新一帧；pick（open/manage/close）
// 经 invoke 上报，主进程转发回宿主 shell（三语义状态机唯一在宿主 shell）。
// 就绪时序（建议子窗同款）：data 订阅在模块求值期同步建立——先于首帧 paint 与主
// 进程 ready-to-show 后的数据推送，从结构上消除「推送先于订阅」的竞态窗口；推送到达
// 早于 React 挂载时暂存 latest，挂载即取初值。视觉复用 .chrome-ext-panel 语系（承载
// 态定位由 app.css 的 body[data-role] 作用域承担：窗口边界即面板边界外扩 24px 阴影
// 环带，面板 div 缩进同值；宽度恒 360 由主进程常量对账）。

let latest: ExtensionsPanelDataPayload | null = null
const listeners = new Set<(payload: ExtensionsPanelDataPayload) => void>()

const unsubscribeData = window.api.extensionsPanel.onData((payload) => {
  latest = payload
  for (const notify of listeners) notify(payload)
})

// HMR 热更新该模块时退订并清空监听集，防旧模块实例的订阅残留在 ipcRenderer 上
//（建议子窗同款先例）
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    unsubscribeData()
    listeners.clear()
  })
}

function subscribe(notify: (payload: ExtensionsPanelDataPayload) => void): () => void {
  listeners.add(notify)
  return () => {
    listeners.delete(notify)
  }
}

export default function ExtensionsPanelWindow(): React.JSX.Element | null {
  const t = useT()
  // 初值取模块级暂存：推送可能早于组件挂载到达（ready-to-show 先 flush 再显窗）
  const [data, setData] = useState<ExtensionsPanelDataPayload | null>(latest)

  useEffect(() => subscribe(setData), [])

  // Esc 关闭（面板收键盘——子窗 focusable:true 是 blur 关闭与 Esc 的共同前提）：
  // 经 pick close 上报，由宿主 shell 调 hide 收合（开合态唯一在 shell）
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        void window.api.extensionsPanel.pick({ kind: 'close' }).catch(() => {})
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  // 阴影环带鼠标穿通（建议子窗同款）：光标落在环带（纯阴影像素）时整窗
  // setIgnoreMouseEvents(forward)——环带点击穿透回工具栏/页面；forward 使忽略态下
  // mousemove 仍达本页，光标回到面板实域即切回接收态
  const passthroughRef = useRef(false)
  useEffect(() => {
    const onMouseMove = (e: MouseEvent): void => {
      const m = EXTENSIONS_PANEL_SHADOW_MARGIN
      const inMargin =
        e.clientX < m ||
        e.clientX > window.innerWidth - m ||
        e.clientY < m ||
        e.clientY > window.innerHeight - m
      if (inMargin !== passthroughRef.current) {
        passthroughRef.current = inMargin
        void window.api.extensionsPanel.setMousePassthrough(inMargin).catch(() => {})
      }
    }
    window.addEventListener('mousemove', onMouseMove)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      if (passthroughRef.current) {
        passthroughRef.current = false
        void window.api.extensionsPanel.setMousePassthrough(false).catch(() => {})
      }
    }
  }, [])

  // 子窗显窗前必有数据推送（ready-to-show 先 flush 再显窗），空态仅为防御
  if (!data) return null
  const items = data.items

  return (
    <div className="chrome-ext-panel" role="dialog" aria-label={t('browser.extpanel.aria')}>
      <div className="chrome-ext-panel-head">
        <h3>{t('browser.extpanel.title')}</h3>
        <button
          type="button"
          className="chrome-ext-panel-close"
          aria-label={t('browser.extpanel.closeAria')}
          onClick={() => {
            void window.api.extensionsPanel.pick({ kind: 'close' }).catch(() => {})
          }}
        >
          ×
        </button>
      </div>
      <p className="chrome-ext-panel-hint-title">{t('browser.extpanel.hintTitle')}</p>
      <p className="chrome-ext-panel-hint-body">{t('browser.extpanel.hintBody')}</p>
      {items.length === 0 ? (
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
                  void window.api.extensionsPanel
                    .pick({ kind: 'open', id: item.id })
                    .catch(() => {})
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
            void window.api.extensionsPanel.pick({ kind: 'manage' }).catch(() => {})
          }}
        >
          <SettingOutlined aria-hidden="true" />
          <span>{t('browser.extpanel.manage')}</span>
        </button>
      </div>
    </div>
  )
}
