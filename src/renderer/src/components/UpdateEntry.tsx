import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons'
import { TOOLTIP_FONT_STACK, TOOLTIP_METRICS } from '../../../shared/toolbarTooltip'
import { useUpdatesStore } from '../stores/updates'
import { useT } from '../i18n'
import { SettingsRow } from './settings/SettingsParts'

function HeaderUpdateButton({
  label,
  tooltip,
  busy,
  downloaded,
  progress,
  onClick
}: {
  label: string
  tooltip: string
  busy: boolean
  downloaded: boolean
  progress: number | null
  onClick: () => void
}): React.JSX.Element {
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null)
  const delay = useRef<ReturnType<typeof setTimeout> | null>(null)
  const measurement = useRef<HTMLDivElement>(null)
  const shown = useRef(false)
  const hidePopover = useCallback((): void => {
    if (delay.current !== null) clearTimeout(delay.current)
    delay.current = null
    setAnchor(null)
    if (shown.current) {
      shown.current = false
      void window.api.toolbarTooltip.hide().catch(() => undefined)
    }
  }, [])
  const showPopover = (element: HTMLElement): void => {
    if (delay.current !== null) clearTimeout(delay.current)
    delay.current = setTimeout(() => {
      delay.current = null
      const rect = element.getBoundingClientRect()
      setAnchor({ x: rect.left + rect.width / 2, y: rect.bottom + 6 })
    }, 300)
  }
  useLayoutEffect(() => {
    if (!anchor || !measurement.current) return
    const { width, height } = measurement.current.getBoundingClientRect()
    shown.current = true
    void window.api.toolbarTooltip
      .show({ ...anchor, width, height, label: tooltip, keyText: null })
      .catch((error: unknown) => console.warn('显示更新气泡失败:', error))
  }, [anchor, tooltip])
  useEffect(() => {
    window.addEventListener('resize', hidePopover)
    return () => {
      window.removeEventListener('resize', hidePopover)
      hidePopover()
    }
  }, [hidePopover])

  return (
    <div
      className="update-entry"
      onMouseEnter={(event) => showPopover(event.currentTarget)}
      onMouseLeave={hidePopover}
      onFocus={(event) => showPopover(event.currentTarget)}
      onBlur={hidePopover}
    >
      <button
        type="button"
        className="update-button"
        disabled={busy}
        aria-label={label}
        onClick={() => {
          hidePopover()
          onClick()
        }}
      >
        {progress !== null && (
          <span
            className="update-progress-fill update-progress-fill-vertical"
            aria-hidden="true"
            style={{ transform: `scaleY(${progress / 100})` }}
          />
        )}
        {downloaded ? <ReloadOutlined /> : <DownloadOutlined />}
      </button>
      {anchor && (
        <div
          ref={measurement}
          className="chrome-tools-pop"
          aria-hidden="true"
          style={{
            left: anchor.x,
            top: anchor.y,
            fontFamily: TOOLTIP_FONT_STACK,
            fontSize: TOOLTIP_METRICS.fontSize,
            lineHeight: TOOLTIP_METRICS.lineHeight,
            padding: `${TOOLTIP_METRICS.paddingY}px ${TOOLTIP_METRICS.paddingX}px`,
            whiteSpace: 'nowrap'
          }}
        >
          <span>{tooltip}</span>
        </div>
      )}
    </div>
  )
}

export function UpdateEntry({ about = false }: { about?: boolean }): React.JSX.Element | null {
  const state = useUpdatesStore((s) => s.state)
  const t = useT()
  if (!state || !(about ? state.policy.showSettingsEntry : state.policy.showHeaderEntry))
    return null
  if (!about && !state.candidateVersion && !state.downloadedVersion) return null
  const busy = ['checking', 'downloading', 'preparing', 'installing'].includes(state.status)
  const percent = state.progress?.percent
  const progress =
    state.status === 'downloading' && percent != null && Number.isFinite(percent)
      ? Math.max(0, Math.min(100, percent))
      : null
  const action = state.downloadedVersion || state.candidateVersion ? 'showDetails' : 'check'
  const label =
    state.status === 'downloading'
      ? progress === null
        ? t('updates.downloading')
        : t('updates.percent', { n: Math.floor(progress) })
      : busy
        ? t(`updates.${state.status as 'checking' | 'preparing' | 'installing'}`)
        : state.downloadedVersion
          ? t(state.error ? 'updates.retryInstall' : 'updates.restart')
          : state.candidateVersion
            ? t('updates.download')
            : t('updates.check')
  const onClick = (): void => {
    void window.api.updates[action]().catch(() => undefined)
  }
  if (!about)
    return (
      <HeaderUpdateButton
        label={label}
        tooltip={state.error ? t(`updates.errors.${state.error}`) : label}
        busy={busy}
        downloaded={!!state.downloadedVersion}
        progress={progress}
        onClick={onClick}
      />
    )
  const status = state.error
    ? t(`updates.errors.${state.error}`)
    : state.candidateVersion
      ? t('updates.version', { v: state.candidateVersion })
      : state.status === 'up-to-date'
        ? t('updates.latest')
        : busy
          ? label
          : null
  return (
    <SettingsRow
      label={t('updates.title')}
      desc={<span role="status">{status}</span>}
      control={
        <button
          type="button"
          className="settings-action-button update-settings-button"
          disabled={busy}
          onClick={onClick}
        >
          {progress !== null && (
            <span
              className="update-progress-fill"
              aria-hidden="true"
              style={{ transform: `scaleX(${progress / 100})` }}
            />
          )}
          <span className="update-button-label">{label}</span>
        </button>
      }
    />
  )
}
