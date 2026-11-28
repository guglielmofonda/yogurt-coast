import { _electron, expect, test } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('Home groups the selected calendar and brings Granola history into notes, folders, search and Ask', async ({}, info) => {
  const profile = mkdtempSync(join(tmpdir(), 'granola-home-'))
  const file = join(profile, 'Granola.csv')
  const header = 'document_id,user_email,document_title,workspace_name,document_created,summary,notes,transcript'
  const now = new Date()
  const stamp = (days: number) => { const d = new Date(now); d.setDate(d.getDate() - days); d.setHours(11, 0, 0, 0); return d.toISOString() }
  const records = [
    ['one','','Fieldwork cover review','Fieldwork Editions',stamp(1),'## Print proof\nUse the river delta cover.','Request the folded proof.','[00:16] Maya: Use cobalt vellum.'],
    ['two','','Spring catalogue planning','Fieldwork Editions',stamp(2),'The new edition ships in March.','','Prepare the catalogue.'],
    ['three','','Paper and binding samples','Fieldwork Editions',stamp(2),'Keep the stitched binding.','','Compare the print samples.'],
  ]
  writeFileSync(file,[header,...records.map(row => row.map(v => '"' + v.replaceAll('"','""') + '"').join(','))].join('\r\n'))
  const app = await _electron.launch({ args: [join(import.meta.dirname,'../out/main/index.js')], env: {
    ...process.env, YOGURT_FAKE:'1', YOGURT_USER_DATA:profile, YOGURT_FAKE_SELECTED_CALENDARS:'work',
  } })
  try {
    const page = await app.firstWindow()
    const upcoming = page.getByTestId('home-upcoming')
    await expect(upcoming.getByRole('heading', { name: 'Coming up' })).toBeVisible()
    const review = upcoming.getByRole('button', { name: /Design review/ })
    await expect(review).toBeVisible()
    await upcoming.getByRole('button', { name: 'Next' }).click()
    await expect(review).toHaveCount(0)
    await upcoming.getByRole('button', { name: 'Previous' }).click()
    await expect(review).toBeVisible()
    await page.evaluate(() => window.yogurt.calendar.setEnabled('work',false))
    await expect(upcoming).toContainText('No calendars selected.')
    await expect(review).toHaveCount(0)
    await page.evaluate(() => window.yogurt.calendar.setEnabled('work',true))
    await expect(review).toBeVisible()

    await app.evaluate(({dialog}, file) => {
      const previews: string[] = []
      Object.assign(globalThis, { granolaPreviews:previews })
      Object.assign(dialog, {
        showOpenDialog:async () => ({ canceled:false, filePaths:[file] }),
        showMessageBox:async (_: unknown, data: { detail:string }) => {
          previews.push(data.detail); return { response:previews.length === 1 ? 1 : 0 }
        },
      })
    },file)
    const pick = page.getByTestId('granola-import')
    await pick.click()
    await expect(pick).toBeEnabled()
    await expect(page.getByTestId('past-note')).toHaveCount(0)
    await pick.click()
    const first = page.getByTestId('past-note').filter({ hasText:'Fieldwork cover review' })
    await expect(first).toBeVisible()
    await expect(page.getByTestId('past-note')).toHaveCount(3)
    await pick.click()
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { granolaPreviews:string[] }).granolaPreviews.at(-1))).toContain('Already in Yogurt 3')
    await expect(first).toContainText('Fieldwork Editions')
    const result = await page.evaluate(async () => (await window.yogurt.search.query('cobalt vellum'))[0])
    expect(result.title).toBe('Fieldwork cover review')
    await expect.poll(() => page.evaluate(async id => (await window.yogurt.notes.get(id))?.mine,result.meetingId)).toBe('Request the folded proof.')
    await page.emulateMedia({ colorScheme:'dark', reducedMotion:'reduce' })
    const win = await app.browserWindow(page)
    await win.evaluate(w => w.setContentSize(1240,800))
    const drawer = page.locator('#home-agenda-toggle')
    if (await drawer.getAttribute('aria-expanded') === 'true') await drawer.click()
    const notice = page.getByTestId('granola-result')
    if (await notice.isVisible()) await notice.getByRole('button', { name:'Close' }).click()
    await page.screenshot({ path:info.outputPath('home.png'), animations:'disabled' })
    await win.evaluate(w => w.setContentSize(830,660))
    await expect(upcoming.getByRole('heading')).toBeVisible()
    expect(await page.locator('.home-library').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)

    const model = page.getByTestId('ask-model')
    await expect(model).toContainText('Gemma 4 26B')
    await expect(model).toContainText('Q4_0')
    await model.click()
    const picker = page.getByRole('menu', { name: 'Choose an Ask model' })
    await expect(picker.getByRole('menuitemradio', { name: 'Auto' })).toBeChecked()
    await expect(picker.getByRole('menuitemradio')).toHaveCount(3)
    await page.screenshot({ path:info.outputPath('ask-model-picker.png'), animations:'disabled' })
    await picker.getByRole('menuitemradio', { name: /Gemma 4 E4B/ }).click()
    await expect(model).toHaveAttribute('title', /Loaded on this device\ngemma-4-E4B_q4_0-it\.gguf/)
    const ask = page.getByTestId('home-ask')
    await ask.fill('What did Maya say about cobalt vellum?')
    await ask.press('Enter')
    await expect(page.getByTestId('chat-page-turn')).toHaveAttribute('data-status','done',{ timeout:15_000 })
    await expect(model).toHaveAttribute('title', /Loaded on this device\ngemma-4-E4B_q4_0-it\.gguf/)
    await model.click()
    await expect(picker.getByRole('menuitemradio', { name: /Gemma 4 E4B/ })).toBeChecked()
    await picker.getByRole('menuitemradio', { name: /Gemma 4 26B/ }).click()
    await expect(model).toHaveAttribute('title', /Loaded on this device\ngemma-4-26B_q4_0-it\.gguf/)
    await expect(page.getByTestId('source-citation').first()).toContainText('Fieldwork cover review')
    await page.getByTestId('nav-back').click()
    await expect(upcoming).toBeVisible()
    await review.click()
    await expect(page.getByTestId('note-title')).toContainText('Design review')
  } finally { await app.close() }
})
