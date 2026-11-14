import { useEffect, useRef, useState } from 'react'
import type { WorkspacePickerContext } from '../../../shared/dialog'
import { useT } from '../i18n'

/** 日志作为文本渲染，只支持标题、列表及段落；不执行远端HTML或加载图片。 */
function Notes({ text }: { text: string }): React.JSX.Element {
  return (
    <>
      {text.split('\n').map((raw, index) => {
        const line = raw.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1')
        const heading = /^#{1,6}\s+(.+)$/.exec(line)
        if (heading) return <h2 key={index}>{heading[1]}</h2>
        const item = /^[-*]\s+(.+)$/.exec(line)
        if (item)
          return (
            <p className="update-note-item" key={index}>
              {item[1]}
            </p>
          )
        return line.trim() ? <p key={index}>{line}</p> : null
      })}
    </>
  )
}
export function UpdateDetailsSheet({
  context
}: {
  context: WorkspacePickerContext
}): React.JSX.Element {
  const t = useT()
  const button = useRef<HTMLButtonElement>(null)
  const [submitting, setSubmitting] = useState(false)
  useEffect(() => {
    button.current?.focus()
  }, [])
  const state = context.updateDetails
  const version = state?.downloadedVersion ?? state?.candidateVersion
  const action = state?.downloadedVersion ? 'install' : 'download'
  const unavailable =
    !state ||
    !version ||
    ['disabled', 'checking', 'downloading', 'preparing', 'installing'].includes(state.status)
  const submit = (): void => {
    if (!version || unavailable || submitting) return
    setSubmitting(true)
    void window.api.dialog
      .workspacePickerPick({
        requestId: context.requestId,
        updateVersion: version,
        updateAction: action
      })
      .catch(() => {
        setSubmitting(false)
      })
  }
  return (
    <div
      className="picker-body update-details"
      role="dialog"
      aria-labelledby="update-details-title"
    >
      <header>
        <h1 id="update-details-title" className="picker-title">
          {t('updates.detailsTitle')}
        </h1>
        <p className="update-details-version">
          {t('updates.version', { v: version ?? state?.currentVersion ?? '' })}
        </p>
      </header>
      <article className="update-release-notes" tabIndex={0} aria-label={t('updates.releaseNotes')}>
        {state?.releaseNotes ? <Notes text={state.releaseNotes} /> : <p>{t('updates.noNotes')}</p>}
      </article>
      <footer className="picker-foot">
        <button type="button" className="picker-btn" onClick={() => window.close()}>
          {t('updates.later')}
        </button>
        <button
          ref={button}
          type="button"
          className="picker-btn picker-btn-primary"
          disabled={unavailable || submitting}
          onClick={submit}
        >
          {action === 'install' ? t('updates.restart') : t('updates.downloadAction')}
        </button>
      </footer>
    </div>
  )
}
