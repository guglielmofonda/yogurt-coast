import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { createGoogleCalendar } from '../src/main/googleCalendar'
import { browserGrant } from '../src/main/googleCalendar/oauth'
import { loadSettings } from '../src/main/settings'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
const client = { client_id: 'sample.apps.googleusercontent.com' }
const when = Date.parse('2026-11-18T18:00:00Z')

it('uses the browser, a loopback callback, offline read-only scopes and a matching PKCE verifier', async () => {
  let challenge = '', callback = ''
  const exchange: typeof fetch = async (url, init) => {
    expect(String(url)).toBe('https://oauth2.googleapis.com/token')
    const body = init!.body as URLSearchParams
    expect(body.get('code')).toBe('local-code')
    expect(body.get('redirect_uri')).toBe(callback)
    expect(createHash('sha256').update(body.get('code_verifier')!).digest('base64url')).toBe(challenge)
    return Response.json({ access_token: 'unit-access', refresh_token: 'unit-refresh', expires_in: 3600 })
  }
  const result = await browserGrant(client, async address => {
    const url = new URL(address)
    expect(url.origin).toBe('https://accounts.google.com')
    expect(url.searchParams.get('scope')?.split(' ')).toEqual([
      'https://www.googleapis.com/auth/calendar.calendarlist.readonly', 'https://www.googleapis.com/auth/calendar.events.readonly',
    ])
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    challenge = url.searchParams.get('code_challenge')!
    callback = url.searchParams.get('redirect_uri')!
    expect(new URL(callback).hostname).toBe('127.0.0.1')
    expect((await fetch(callback + '/?state=unrelated')).status).toBe(400)
    const response = await fetch(callback + '/?' + new URLSearchParams({ state: url.searchParams.get('state')!, code: 'local-code' }))
    expect(response.ok).toBe(true)
  }, new AbortController().signal, exchange)
  expect(result.access_token).toBe('unit-access')
})

it('lists all calendars without reading events, pages only selected calendars and preserves the choice on restart and refresh', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'yogurt-google-')); dirs.push(dir)
  const file = join(dir, 'settings.json'), called: string[] = []
  let revoked = false
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); called.push(url.pathname)
    if (url.hostname === 'oauth2.googleapis.com') {
      expect((init?.body as URLSearchParams).get('refresh_token')).toBe('unit-refresh')
      return revoked ? Response.json({ error: 'invalid_grant' }, { status: 400 }) : Response.json({ access_token: 'unit-access', expires_in: 3600 })
    }
    expect(url.origin).toBe('https://www.googleapis.com')
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer unit-access')
    const next = url.searchParams.has('pageToken')
    if (url.pathname.endsWith('/calendarList')) return Response.json(next ? { items: [{ id: 'team/calendar', summaryOverride: 'Project' }] }
      : { items: [{ id: 'sample@example.test', summary: 'Personal', primary: true }], nextPageToken: 'calendar-page' })
    expect(decodeURIComponent(url.pathname)).toBe('/calendar/v3/calendars/team/calendar/events')
    expect(url.searchParams.get('singleEvents')).toBe('true')
    const event = { id: next ? 'b' : 'a', iCalUID: next ? 'uid-b' : 'uid-a', summary: 'Demo', start: { dateTime: new Date(when).toISOString() },
      end: { dateTime: new Date(when + 600_000).toISOString() }, hangoutLink: 'https://meet.google.com/abc-defg-hij', attendees: [{ email: 'sample@example.test', self: true }, { displayName: 'Colleague' }] }
    return Response.json({ items: [event, { id: 'all-day', start: { date: '2026-11-18' } }], ...(next ? {} : { nextPageToken: 'events-page' }) })
  }
  const options = { file, client: () => client, secure: () => true, request: fetcher, seal: () => 'opaque-credential', unseal: () => 'unit-refresh',
    grant: vi.fn(async () => ({ access_token: 'unit-access', refresh_token: 'unit-refresh', expires_in: 3600 })) }
  const google = createGoogleCalendar(options)
  await google.connect()
  expect(google.info().account).toBe('sample@example.test')
  expect(google.calendars().map(c => c.name)).toEqual(['Personal', 'Project'])
  expect(loadSettings(file).useSystemCalendars).toBe(false)
  expect(readFileSync(file, 'utf8')).not.toContain('unit-refresh')
  expect(await google.events(when, when + 600_000)).toEqual([])
  expect(called.some(x => x.endsWith('/events'))).toBe(false)
  const id = google.calendars()[1].id
  expect(google.setEnabled(id, true)).toBe(true)
  const restart = createGoogleCalendar(options)
  await restart.refresh()
  expect(restart.selectedIds().has(id)).toBe(true)
  const events = await restart.events(when, when + 600_000)
  expect(events.map(e => e.externalId)).toEqual(['uid-a', 'uid-b'])
  expect(events[0]).toMatchObject({ calendarId: id, calendar: 'Project', attendees: [{ name: 'Colleague', email: null }], url: 'https://meet.google.com/abc-defg-hij' })
  const before = called.length
  await restart.events(when + 1, when + 599_999)
  expect(called.length).toBe(before)
  restart.setEnabled(id, false)
  expect(await restart.events(when, when + 600_000)).toEqual([])
  expect(called.length).toBe(before)
  const denied = createGoogleCalendar({ ...options, request: (input, init) => String(input).startsWith('https://oauth2.googleapis.com/') ?
    fetcher(input, init) : Promise.resolve(new Response(null, { status: 401 })) })
  await expect(denied.refresh()).rejects.toMatchObject({ reason: 'reconnect' })
  expect(denied.info().reconnect).toBe(true)
  revoked = true
  const expired = createGoogleCalendar(options)
  await expect(expired.refresh()).rejects.toMatchObject({ reason: 'reconnect' })
  expect(expired.info().reconnect).toBe(true)
  expired.disconnect()
  expect(loadSettings(file).googleCalendar).toBeUndefined()
  expect(loadSettings(file).useSystemCalendars).toBe(false)
})

it('requires a publisher client and protected storage before starting consent', async () => {
  const grant = vi.fn()
  const opts = { file: 'unused', client: () => client, secure: () => false, grant, seal: String, unseal: String }
  await expect(createGoogleCalendar(opts).connect()).rejects.toMatchObject({ reason: 'storage' })
  await expect(createGoogleCalendar({ ...opts, client: () => undefined }).connect()).rejects.toMatchObject({ reason: 'setup' })
  expect(grant).not.toHaveBeenCalled()
})
