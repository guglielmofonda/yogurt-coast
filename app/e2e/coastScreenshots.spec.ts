import { _electron, expect, test } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('imports only after stop, retries Coast, excludes pauses, and reopens a saved screenshot', async () => {
  const profile = mkdtempSync(join(process.env.YOGURT_TEST_ROOT ?? tmpdir(), 'coast-e2e-'))
  const app = await _electron.launch({ args: [join(import.meta.dirname, '../out/main/index.js')], env: {
    ...process.env, YOGURT_FAKE: '1', YOGURT_USER_DATA: profile, YOGURT_FAKE_COAST_FIXTURE: profile,
    YOGURT_FAKE_COAST_CLI: join(import.meta.dirname, 'fixtures/coast-cli.cjs'),
  } })
  try {
    const page = await app.firstWindow()
    await expect(page.getByTestId('home')).toBeVisible()
    await page.getByTestId('new-note').click()
    await expect(page.getByTestId('note-state')).toHaveAttribute('data-state', 'recording')
    const id = await page.evaluate(async () => (await window.yogurt.nav.current()).slice('/note/'.length))
    const recordingTime = () => new Promise(resolve => setTimeout(resolve, 2200))
    await recordingTime()
    await page.getByTestId('note-pause').click()
    await expect(page.getByTestId('note-state')).toHaveAttribute('data-paused', 'true')
    const paused = Date.now()
    await recordingTime()
    const resumed = Date.now()
    await page.getByTestId('note-pause').click()
    await recordingTime()
    expect(existsSync(join(profile, 'ranges'))).toBe(false)
    await page.getByTestId('note-stop').click()
    const gallery = page.getByTestId('coast-screenshots')
    await expect(gallery.getByRole('button', { name: 'Try again' })).toBeVisible({ timeout: 30_000 })
    writeFileSync(join(profile, 'ready'), '')
    await gallery.getByRole('button', { name: 'Try again' }).click()
    await expect(gallery.getByRole('button', { name: 'Enlarge screenshot' })).toBeVisible({ timeout: 20_000 })
    await expect.poll(() => page.evaluate(id => window.yogurt.coast.get(id), id)).toMatchObject({ status: 'done' })
    const hits = await page.evaluate(() => window.yogurt.search.query('Juniper observatory'))
    expect(hits).toEqual(expect.arrayContaining([expect.objectContaining({ meetingId: id })]))
    const ranges = readFileSync(join(profile, 'ranges'), 'utf8').trim().split('\n').map(s => s.split('|').map(x => new Date(x).getTime()))
    expect(ranges).toHaveLength(3)
    expect(ranges[0]).toEqual(ranges[1])
    expect(ranges[1][1]).toBeLessThanOrEqual(paused)
    expect(ranges[2][0]).toBeGreaterThanOrEqual(resumed)
    expect((await page.evaluate(id => window.yogurt.coast.get(id), id))?.files).toHaveLength(1)
    expect(await page.evaluate(id => window.yogurt.coast.image(id, '../settings.json'), id)).toBeNull()
    await gallery.getByRole('button', { name: 'Enlarge screenshot' }).click()
    await expect(page.getByTestId('coast-full-image').getByRole('img')).toBeVisible()
    await page.keyboard.press('Escape')
    await page.reload()
    await expect(gallery.getByRole('img')).toBeVisible()
  } finally { await app.close() }
})
