import { _electron, expect, test } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('signs in from the agenda and uses only the chosen Google calendar after reopening Settings', async () => {
  const profile = mkdtempSync(join(process.env.YOGURT_TEST_ROOT ?? tmpdir(), 'google-e2e-'))
  writeFileSync(join(profile, 'google-calendar-client.json'), JSON.stringify({ installed: { client_id: 'fixture.apps.googleusercontent.com' } }))
  const app = await _electron.launch({ args: [join(import.meta.dirname, '../out/main/index.js')], env: { ...process.env, YOGURT_FAKE: '1', YOGURT_FAKE_PLATFORM: 'win32', YOGURT_USER_DATA: profile } })
  try {
    const page = await app.firstWindow()
    await expect(page.getByTestId('home')).toBeVisible()
    await app.evaluate(({ shell, safeStorage }) => {
      const real = globalThis.fetch
      shell.openExternal = async address => {
        const url = new URL(address)
        if (url.origin !== 'https://accounts.google.com') throw Error('Unexpected sign-in page')
        const callback = new URL(url.searchParams.get('redirect_uri')!)
        callback.search = new URLSearchParams({ code: 'fixture-code', state: url.searchParams.get('state')! }).toString()
        await real(callback)
      }
      safeStorage.isEncryptionAvailable = () => true
      if (process.platform === 'linux') safeStorage.getSelectedStorageBackend = () => 'gnome_libsecret'
      safeStorage.encryptString = s => Buffer.from(s)
      safeStorage.decryptString = b => b.toString()
      const calls: string[] = []
      Object.assign(globalThis, { googleEventReads: calls })
      globalThis.fetch = async (input, init) => {
        const url = new URL(String(input))
        if (url.hostname === 'oauth2.googleapis.com') return Response.json({ access_token: 'fixture-access', refresh_token: 'fixture-refresh', expires_in: 3600 })
        if (url.hostname !== 'www.googleapis.com') return real(input, init)
        if (url.pathname.endsWith('/calendarList')) return Response.json({ items: [{ id: 'primary@example.test', primary: true, summary: 'Personal' }, { id: 'team', summary: 'Product team' }] })
        calls.push(url.pathname)
        const start = new Date(Date.now() - 60_000)
        return Response.json({ items: [{ id: 'demo', summary: 'Google product demo', start: { dateTime: start.toISOString() }, end: { dateTime: new Date(+start + 600_000).toISOString() } }] })
      }
    })
    await page.getByTestId('agenda-calendars').click()
    await page.getByRole('button', { name: 'Sign in with Google' }).click()
    const choices = page.getByTestId('calendar-choice')
    await expect(choices).toHaveCount(2)
    await expect(page.getByTestId('system-calendars')).toHaveCount(0)
    await expect(choices.getByRole('checkbox').first()).not.toBeChecked()
    expect(await app.evaluate(() => (globalThis as unknown as { googleEventReads: string[] }).googleEventReads)).toEqual([])
    const team = choices.filter({ hasText: 'Product team' }).getByRole('checkbox')
    await team.check()
    await page.evaluate(() => window.yogurt.nav.go(''))
    await expect(page.getByRole('complementary', { name: 'Agenda' }).getByText('Google product demo')).toBeVisible()
    const events = await page.evaluate(() => window.yogurt.calendar.day(Date.now()))
    expect(events.events.every(e => e.calendar?.name === 'Product team')).toBe(true)
    const coming = await page.evaluate(() => window.yogurt.calendar.comingUp())
    expect(coming.events.map(e => e.calendar?.name)).toEqual(['Product team'])
    expect(await app.evaluate(() => (globalThis as unknown as { googleEventReads: string[] }).googleEventReads.every(p => p.endsWith('/team/events')))).toBe(true)
    await page.getByTestId('agenda-calendars').click()
    await expect(team).toBeChecked()
    await team.uncheck()
    await page.evaluate(() => window.yogurt.nav.go(''))
    await expect(page.getByRole('complementary', { name: 'Agenda' }).getByText('No meetings')).toBeVisible()
  } finally { await app.close() }
})
