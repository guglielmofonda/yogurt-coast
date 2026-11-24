import { useEffect, useState } from 'react'
import type { CoastView } from '../../../shared/types'
import { t } from '../../../shared/i18n'
import { Modal, ModalClose } from './Modal'
import './CoastScreenshots.css'

export function CoastScreenshots({ id }: { id: string }) {
  const [view, setView] = useState<CoastView | null>(null)
  const [index, setIndex] = useState(0), [expanded, expand] = useState(false)
  const [image, setImage] = useState<{ file: string; url: string | null } | null>(null)
  const count = view?.files.length ?? 0
  const position = Math.min(index, Math.max(0, count - 1))
  const file = view?.files[position]
  useEffect(() => {
    let current = true, request = 0
    const refresh = () => {
      const n = ++request
      void window.yogurt.coast.get(id).then(v => { if (current && n === request) setView(v) }).catch(() => {})
    }
    const off = window.yogurt.coast.onChange(changed => { if (changed === id) refresh() })
    refresh()
    return () => { current = false; off() }
  }, [id])
  useEffect(() => {
    let current = true
    if (file) void window.yogurt.coast.image(id, file).then(url => { if (current) setImage({ file, url }) },
      () => { if (current) setImage({ file, url: null }) })
    return () => { current = false }
  }, [id, file])
  if (!view) return null
  const url = image?.file === file ? image?.url : undefined
  const time = file ? new Date(Number(file.split('-')[0])).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }) : ''
  const label = t('Screenshot') + ' · ' + time
  return <section className="coast-screenshots" aria-label={t('Coast screenshots')} data-testid="coast-screenshots">
    <h3>{t('Coast screenshots')}</h3>
    {view.status === 'working' && <p role="status">{t('Selecting screenshots on this Mac…')}</p>}
    {(view.status === 'error' || view.status === 'retry') && <div role="status">
      <p>{t('Screenshot selection is incomplete.')}</p>
      <button className="workspace-button" onClick={() => void window.yogurt.coast.retry(id)}>{t('Try again')}</button>
    </div>}
    {view.status === 'done' && !count && <p>{t('No screenshots selected for this call.')}</p>}
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
