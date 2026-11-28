import { useState } from 'react'
import { t } from '../../../shared/i18n'
import { Upload } from './Icons'
import { toasts } from './TrashToast'

export function GranolaImportButton() {
  const [busy, setBusy] = useState(false)
  const pick = async () => {
    setBusy(true)
    try {
      const result = await window.yogurt.granola.import()
      if (result.status === 'cancelled' || result.status === 'busy') return
      const title = result.status === 'done'
        ? t('Imported {added} · Already in Yogurt {existing} · Skipped {skipped}', { added: result.added, existing: result.duplicates, skipped: result.rejected })
        : result.status === 'invalid' ? t('Choose a Granola export ZIP or CSV up to 128 MB.') : t('Choose the file again to finish importing.')
      toasts.add({ id: 'granola-result', title, data: { testId: 'granola-result' } })
    } catch { toasts.add({ title: t('Choose the file again to finish importing.') }) }
    finally { setBusy(false) }
  }
  return <button type="button" className="workspace-button granola-import" data-testid="granola-import" disabled={busy} onClick={() => void pick()}>
    <Upload size={14} aria-hidden="true" />{busy ? t('Importing…') : t('Import from Granola')}
  </button>
}
