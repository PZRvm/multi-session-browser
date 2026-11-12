import { useCallback, useEffect, useState } from 'react'
import { Button, Input } from 'antd'
import {
  ApiOutlined,
  ExportOutlined,
  GlobalOutlined,
  InboxOutlined,
  PushpinFilled,
  PushpinOutlined
} from '@ant-design/icons'
import { useT } from '../../i18n'
import type { DictKey } from '../../../../shared/i18n'
import type { ExtensionListItem, InstallResult } from '../../../../shared/extensions/management'
import { SettingsPane } from './SettingsParts'

// 插件版面（2026-11-11 增量）：已装列表（名称/版本/来源/加载状态/卸载）+ 商店 ID
// 安装 + 本地 CRX 导入。安装确认走主进程原生框；错误与状态以行内副行如实呈现
//（设置窗行内 danger 先例），零 antd message 弹层。列表空态如实无插件引导安装。

interface LoadState {
  items: ExtensionListItem[]
  loading: boolean
  /** 行内反馈（安装/卸载结果与错误），随下一次成功操作清除 */
  notice: { tone: 'default' | 'danger'; text: string } | null
  installing: boolean
  storeId: string
}

export function PaneExtensions(): React.JSX.Element {
  const t = useT()
  const [state, setState] = useState<LoadState>({
    items: [],
    loading: true,
    notice: null,
    installing: false,
    storeId: ''
  })

  const refresh = useCallback(async (): Promise<void> => {
    const r = await window.api.extensions.list()
    setState((s) => ({ ...s, items: r.items, loading: false }))
  }, [])

  // 首拉：挂载后异步取清单（取消守卫防卸载后写入）
  useEffect(() => {
    let alive = true
    window.api.extensions
      .list()
      .then((r) => {
        if (alive) setState((s) => ({ ...s, items: r.items, loading: false }))
      })
      .catch(() => {
        if (alive) setState((s) => ({ ...s, loading: false }))
      })
    return () => {
      alive = false
    }
  }, [])

  // pins/安装集跨面变更联动（审查三轮 2.5）：订阅 extensions:changed → refresh——
  // 面板钉子/工具栏拖拽/其他窗口的固定与安装变更即时反映到设置页，不再陈旧
  useEffect(() => {
    return window.api.extensions.onChanged(() => refresh())
  }, [refresh])

  const setNotice = (tone: 'default' | 'danger', text: string): void => {
    setState((s) => ({ ...s, notice: { tone, text }, installing: false }))
  }

  // 拖拽 CRX 导入（2026-11-13）：dragover 放行 + drop 取 File 落盘路径走既有安装事务
  const [dropActive, setDropActive] = useState(false)
  const handleDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>): Promise<void> => {
      e.preventDefault()
      setDropActive(false)
      const file = e.dataTransfer.files?.[0]
      if (!file) return
      const path = window.api.extensions.getCrxPath(file)
      if (!path || !path.toLowerCase().endsWith('.crx')) {
        setNotice('danger', t('settings.extensions.dropInvalid'))
        return
      }
      try {
        const r = await window.api.extensions.importCrxFromPath(path)
        if (!r.ok) {
          setNotice('danger', t('settings.extensions.importFailed') + r.error)
          return
        }
        setNotice('default', t('settings.extensions.importDone'))
        await refresh()
      } catch {
        setNotice('danger', t('settings.extensions.importFailed'))
      }
    },
    [refresh, setNotice, t]
  )

  const installFromStore = useCallback(async (): Promise<void> => {
    const id = state.storeId.trim()
    if (!/^[a-p]{32}$/.test(id)) {
      setNotice('danger', t('settings.extensions.badId'))
      return
    }
    setState((s) => ({ ...s, installing: true, notice: null }))
    const r: InstallResult = await window.api.extensions.installFromStore(id)
    if (r.ok) {
      await refresh()
      setNotice(
        'default',
        t(r.duplicate ? 'settings.extensions.duplicate' : 'settings.extensions.installed')
      )
    } else {
      setNotice(
        'danger',
        t('settings.extensions.installFailed') + (r.error ? `（${r.error}）` : '')
      )
    }
  }, [state.storeId, refresh, t])

  const importCrx = useCallback(async (): Promise<void> => {
    setState((s) => ({ ...s, installing: true, notice: null }))
    const r = await window.api.extensions.importCrx()
    if (r.ok) {
      await refresh()
      setNotice(
        'default',
        t(r.duplicate ? 'settings.extensions.duplicate' : 'settings.extensions.installed')
      )
    } else if (r.error !== 'CANCELED') {
      setNotice(
        'danger',
        t('settings.extensions.installFailed') + (r.error ? `（${r.error}）` : '')
      )
    } else {
      setState((s) => ({ ...s, installing: false }))
    }
  }, [refresh, t])

  const uninstall = useCallback(
    async (id: string): Promise<void> => {
      const r = await window.api.extensions.uninstall(id)
      if (r.ok) {
        await refresh()
        setNotice('default', t('settings.extensions.uninstalled'))
      } else {
        setNotice(
          'danger',
          t('settings.extensions.uninstallFailed') + (r.error ? `（${r.error}）` : '')
        )
      }
    },
    [refresh, t]
  )

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        if (e.dataTransfer.types?.includes('Files')) setDropActive(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDropActive(false)
      }}
      onDrop={(e) => void handleDrop(e)}
    >
      <SettingsPane
        id="extensions"
        title={t('settings.extensions.paneTitle')}
        desc={t('settings.extensions.paneDesc')}
      >
        {/* 安装区：商店 ID + CRX 导入 */}
        <div className="settings-ext-install">
          <Input
            className="settings-ext-store-input"
            placeholder={t('settings.extensions.storePlaceholder')}
            value={state.storeId}
            maxLength={32}
            status={
              state.storeId.length > 0 && !/^[a-p]{32}$/.test(state.storeId) ? 'error' : undefined
            }
            onChange={(e) => setState((s) => ({ ...s, storeId: e.target.value }))}
            onPressEnter={() => void installFromStore()}
            aria-label={t('settings.extensions.storePlaceholder')}
          />
          <Button
            type="primary"
            loading={state.installing}
            disabled={!/^[a-p]{32}$/.test(state.storeId.trim())}
            onClick={() => void installFromStore()}
          >
            {t('settings.extensions.installStore')}
          </Button>
          {/* 打开 Chrome 商店（当前会话标签导航）；TODO(商店伴随插件)：给商店页每个
            插件加「添加到多会话浏览器」入口，替代手动复制 ID——单独任务排期 */}
          <Button icon={<GlobalOutlined />} onClick={() => void window.api.extensions.openStore()}>
            {t('settings.extensions.openStore')}
          </Button>
          <Button
            icon={<ExportOutlined />}
            disabled={state.installing}
            onClick={() => void importCrx()}
          >
            {t('settings.extensions.importCrx')}
          </Button>
        </div>
        {/* 行内反馈 */}
        {state.notice ? (
          <p
            className={
              state.notice.tone === 'danger'
                ? 'settings-ext-notice settings-ext-notice-danger'
                : 'settings-ext-notice'
            }
            role="status"
          >
            {state.notice.text}
          </p>
        ) : null}
        {/* 已装列表 */}
        {state.items.length === 0 && !state.loading ? (
          <div className="settings-ext-empty">
            <InboxOutlined aria-hidden="true" />
            <p>{t('settings.extensions.empty')}</p>
          </div>
        ) : (
          <ul className="settings-ext-list">
            {state.items.map((item) => (
              <li key={item.id} className="settings-ext-item">
                <span className="settings-ext-item-icon" aria-hidden="true">
                  <ApiOutlined />
                </span>
                <span className="settings-ext-item-main">
                  <span className="settings-ext-item-name">{item.name}</span>
                  <span className="settings-ext-item-meta">
                    v{item.version} · {t(`settings.extensions.source.${item.source}` as DictKey)}
                    {' · '}
                    {t('settings.extensions.loadedStat')
                      .replace('{n}', String(item.loadedPartitions))
                      .replace('{m}', String(item.totalPartitions))}
                  </span>
                </span>
                {/* 钉子开关（插件固定专项 2026-11-13）：与面板钉子同语义——固定态填充钉、
                  取消态描边钉；setPinned 落库后主进程广播 changed，工具栏即时联动 */}
                <Button
                  size="small"
                  type={item.pinned ? 'primary' : 'default'}
                  icon={item.pinned ? <PushpinFilled /> : <PushpinOutlined />}
                  aria-label={t(
                    item.pinned ? 'settings.extensions.unpinAria' : 'settings.extensions.pinAria'
                  )}
                  onClick={() => {
                    void window.api.extensions
                      .setPinned({ id: item.id, pinned: !item.pinned })
                      .then(() => refresh())
                      .catch(() => undefined)
                  }}
                />
                <Button
                  size="small"
                  danger
                  onClick={() => void uninstall(item.id)}
                  aria-label={t('settings.extensions.uninstallAria').replace('{name}', item.name)}
                >
                  {t('settings.extensions.uninstall')}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <p className="settings-ext-hint">{t('settings.extensions.hint')}</p>
        <p
          className={`settings-ext-drop-hint${dropActive ? ' active' : ''}`}
          aria-hidden={dropActive ? undefined : true}
        >
          {t('settings.extensions.dropHint')}
        </p>
      </SettingsPane>
    </div>
  )
}
