import { BrowserWindow, dialog, ipcMain } from 'electron'
import { basename } from 'node:path'
import { t } from '../shared/i18n'
import type { GranolaImportResult } from '../shared/types'
import type { Store } from './store'
import { commitGranolaImport, planGranolaImport } from './granolaImport'

export function hookGranolaImport(d: { store: Store; me(): string; window(): BrowserWindow | undefined; changed(): void }) {
  let busy = false
  ipcMain.handle('granola:import', async (event): Promise<GranolaImportResult> => {
    const win = d.window()
    if (!win || event.sender !== win.webContents) return { status: 'failed' }
    if (busy) return { status: 'busy' }
    busy = true
    try {
      const picked = await dialog.showOpenDialog(win, { title: t('Import from Granola'), properties: ['openFile'],
        filters: [{ name: 'Granola', extensions: ['zip', 'csv'] }] })
      if (picked.canceled || !picked.filePaths[0]) return { status: 'cancelled' }
      const path = picked.filePaths[0]
      const plan = await planGranolaImport(path, d.store).catch(() => null)
      if (!plan) return { status: 'invalid' }
      const preview = t('Ready to import {ready} · Already in Yogurt {existing} · Skipped {skipped}',
        { ready: plan.notes.length, existing: plan.duplicates, skipped: plan.rejected })
      const answer = await dialog.showMessageBox(win, { type: 'info', message: t('Import from Granola'),
        detail: [basename(path), preview, ...plan.issues].join('\n'), defaultId: 0, cancelId: plan.notes.length ? 1 : 0,
        buttons: plan.notes.length ? [t('Import notes'), t('Cancel')] : [t('Close')] })
      if (!plan.notes.length || answer.response !== 0) return { status: 'cancelled' }
      try { return { status: 'done', ...await commitGranolaImport(plan, d.store, d.me()) } }
      finally { d.changed() }
    } catch { return { status: 'failed' } }
    finally { busy = false }
  })
}
