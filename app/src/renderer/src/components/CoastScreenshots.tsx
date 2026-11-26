import { useEffect, useRef, useState } from 'react'
import type { CoastView } from '../../../shared/types'
import { t } from '../../../shared/i18n'
import { InlineError } from './InlineError'
import { Modal, ModalClose } from './Modal'
import './CoastScreenshots.css'

export function CoastScreenshots({ id, active, target }: { id: string; active: boolean; target?: { screenCapturedAt?: number; seq: number } }) {
  const [view, setView] = useState<CoastView | null>()
  const [readFailed, setReadFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const appliedTarget = useRef<number | undefined>(undefined)
  const [index, setIndex] = useState(0), [expanded, expand] = useState(false)
  const [image, setImage] = useState<{ file: string; url: string | null } | null>(null)
  const count = view?.files.length ?? 0
  const position = Math.min(index, Math.max(0, count - 1))
  const file = view?.files[position]
  useEffect(() => {
    if (!active) return
    let current = true, request = 0
    const refresh = () => {
      const n = ++request
      void window.yogurt.coast.get(id).then(v => {
        if (current && n === request) { setView(v); setReadFailed(false) }
      }, () => { if (current && n === request) setReadFailed(true) })
    }
    const off = window.yogurt.coast.onChange(changed => { if (changed === id) refresh() })
    refresh()
    return () => { current = false; off() }
  }, [id, active, attempt])
  useEffect(() => {
    if (!active || !view || target?.screenCapturedAt == null || appliedTarget.current === target.seq) return
    const match = view.files.findIndex(f => Number(f.split('-')[0]) === target.screenCapturedAt)
    if (match >= 0) { setIndex(match); appliedTarget.current = target.seq }
  }, [active, view, target])
  useEffect(() => {
    let current = true
    if (file) void window.yogurt.coast.image(id, file).then(url => { if (current) setImage({ file, url }) },
      () => { if (current) setImage({ file, url: null }) })
    return () => { current = false }
  }, [id, file])

  const url = image?.file === file ? image?.url : undefined
  const time = file ? new Date(Number(file.split('-')[0])).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }) : ''
  const label = t('Screenshot') + ' · ' + time
  return <section className="coast-screenshots" aria-label={t('Coast screenshots')} data-testid="coast-screenshots">
    {readFailed && <InlineError testId="coast-read-error" retry={() => setAttempt(n => n + 1)} />}
    {!readFailed && view === undefined && <p role="status">{t('Loading…')}</p>}
    {!readFailed && view === null && <p>{t('No screenshots were saved for this meeting.')}</p>}
    {view?.status === 'working' && <p role="status">{t('Selecting screenshots on this Mac…')}</p>}
    {(view?.status === 'error' || view?.status === 'retry') && <div role="status">
      <p>{t('Screenshot selection is incomplete.')}</p>
      <button className="workspace-button" onClick={() => void window.yogurt.coast.retry(id)}>{t('Try again')}</button>
    </div>}
    {view?.status === 'done' && !count && <p>{t('No screenshots selected for this call.')}</p>}
    {!!count && <figure>
      {url ? <button type="button" aria-label={t('Enlarge screenshot')} className="coast-preview" onClick={() => expand(true)}><img src={url} alt={label} /></button>
        : <p role="status">{url === null ? t('This screenshot could not be read.') : t('Loading…')}</p>}
      <figcaption>
        <span aria-live="polite">{time} · {position + 1} / {count}</span>
        {count > 1 && <span><button className="workspace-button" disabled={position === 0} onClick={() => setIndex(position - 1)}>{t('Previous')}</button>
          <button className="workspace-button" disabled={position + 1 === count} onClick={() => setIndex(position + 1)}>{t('Next')}</button></span>}
      </figcaption>
    </figure>}
    {expanded && url && <Modal title={label} onCancel={() => expand(false)} testId="coast-full-image">
      <img className="coast-full-image" src={url} alt={label} />
      <div className="modal-actions"><ModalClose data-dialog-cancel className="workspace-button">{t('Close')}</ModalClose></div>
    </Modal>}
  </section>
}
