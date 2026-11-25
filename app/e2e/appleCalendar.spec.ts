import { _electron, expect, test, type ElectronApplication } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('@everywhere Mac calendar access is local and opt-in, including after a restart', async () => {
  const profile = mkdtempSync(join(process.env.YOGURT_TEST_ROOT ?? tmpdir(), 'apple-cal-'))
  const launch = () => _electron.launch({ args: [join(import.meta.dirname, '../out/main/index.js')], env: {
    ...process.env, YOGURT_FAKE: '1', YOGURT_FAKE_PLATFORM: 'darwin', YOGURT_FAKE_SELECTED_CALENDARS: '', YOGURT_USER_DATA: profile,
  } })
  const sources = (app: ElectronApplication, extra = false) => app.evaluate((_electron, extra) => {
    const rows = ['Office', 'Personal', ...(extra ? ['New account'] : [])].map((source, i) => ({
      id: String(i), calendarId: String(i), calendar: 'Meetings', calendarSource: source, title: source + ' meeting',
      start: new Date(Date.now() - 60000).toISOString(), end: new Date(Date.now() + 1800000).toISOString(),
    }))
    ;(globalThis as unknown as { __fake__: { calendarEvents(events: unknown[]): void } }).__fake__.calendarEvents(rows)
  }, extra)
  let app = await launch()
  try {
    let page = await app.firstWindow()
    await expect(page.getByTestId('home')).toBeVisible()
    await sources(app)
    await page.getByRole('button', { name: 'Choose calendars' }).click()
    const choices = page.getByTestId('calendar-choice')
    await expect(choices).toHaveCount(2)
    await expect(choices.getByRole('checkbox', { checked: true })).toHaveCount(0)
    await expect(page.getByTestId('google-calendar')).toHaveCount(0)
    await expect(page.getByTestId('calendar-link-add')).toHaveCount(0)
    expect(await page.evaluate(() => window.yogurt.calendar.google('connect'))).toMatchObject({ ok: false, error: 'unsupported' })
    expect(await page.evaluate(() => window.yogurt.calendar.addLink('http://127.0.0.1:1/calendar.ics'))).toMatchObject({ ok: false, error: 'bad-url' })
    await choices.filter({ hasText: 'Office' }).getByRole('checkbox').check()
    await page.getByTestId('nav-home').click()
    await expect(page.getByTestId('event')).toHaveCount(1)
    await expect(page.getByTestId('event')).toContainText('Office meeting')
    expect(await page.evaluate(async () => (await window.yogurt.calendar.comingUp()).events.map(e => e.title))).toEqual(['Office meeting'])
    await app.close()
    app = await launch()
    page = await app.firstWindow()
    await expect(page.getByTestId('home')).toBeVisible()
    await sources(app, true)
    await page.getByTestId('agenda-calendars').click()
    const afterRestart = page.getByTestId('calendar-choice')
    await expect(afterRestart).toHaveCount(3)
    await expect(afterRestart.filter({ hasText: 'New account' }).getByRole('checkbox')).not.toBeChecked()
    await expect(afterRestart.getByRole('checkbox', { checked: true })).toHaveCount(1)
    await afterRestart.filter({ hasText: 'Office' }).getByRole('checkbox').uncheck()
    await page.getByTestId('nav-home').click()
    await expect(page.getByRole('button', { name: 'Choose calendars' })).toBeVisible()
    expect(await page.evaluate(async () => (await window.yogurt.calendar.day(Date.now(), 'link-event')).events)).toEqual([])
  } finally { await app.close() }
})
