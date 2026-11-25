import { createHash } from 'node:crypto'
import type { CalendarSource } from '../calendar'
import type { RawEvent } from '../calendarLink/ics'
import { loadSettings, updateSettings } from '../settings'
import { GoogleFailure, tokenRequest, type GoogleClient, type Token } from './oauth'

type GoogleCal = { id: string; summary?: string; summaryOverride?: string; backgroundColor?: string; primary?: boolean; deleted?: boolean }
type Event = { id: string; iCalUID?: string; summary?: string; status?: string; start?: { dateTime?: string }; end?: { dateTime?: string }
  hangoutLink?: string; location?: string; description?: string; conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] }
  attendees?: { displayName?: string; email?: string; self?: boolean; responseStatus?: string }[] }
type SavedCalendar = { id: string; name: string; color?: string }
export type SavedGoogle = { account: string; credential: string; clientId: string; calendars: SavedCalendar[]; selected: string[] }
type Options = { file: string; client(): GoogleClient | undefined; secure(): boolean; seal(s: string): string; unseal(s: string): string
  grant(c: GoogleClient, signal: AbortSignal): Promise<Token>; request?: typeof fetch }

const api = 'https://www.googleapis.com/calendar/v3'
const localId = (id: string) => 'google:' + createHash('sha256').update(id).digest('hex')

export function createGoogleCalendar(d: Options) {
  const request: typeof fetch = d.request ?? ((input, init) => fetch(input, init))
  const saved = () => loadSettings(d.file).googleCalendar
  const expired = new Set<string>()
  let access: { owner: string; value: string; until: number } | undefined
  let refreshing: { owner: string; promise: Promise<string> } | undefined
  let connecting: AbortController | undefined
  let generation = 0
  let reads = new AbortController()
  const cache = new Map<string, { until: number; rows: Promise<RawEvent[]> }>()
  function clearReads() { generation++; reads.abort(); reads = new AbortController(); cache.clear() }
  const remember = (owner: string, token: Token) => {
    access = { owner, value: token.access_token, until: Date.now() + Math.max(0, token.expires_in - 60) * 1000 }
    expired.delete(owner)
    return token.access_token
  }
  async function bearer(s: SavedGoogle): Promise<string> {
    if (expired.has(s.credential)) throw new GoogleFailure('reconnect')
    if (access?.owner === s.credential && access.until > Date.now()) return access.value
    if (refreshing?.owner === s.credential) return refreshing.promise
    const c = d.client()
    if (!c || c.client_id !== s.clientId) throw new GoogleFailure('setup')
    const job = tokenRequest(c, { grant_type: 'refresh_token', refresh_token: d.unseal(s.credential) }, request)
      .then(token => {
        if (saved()?.credential !== s.credential) throw new GoogleFailure('cancelled')
        return remember(s.credential, token)
      }).catch(e => { if (e instanceof GoogleFailure && e.reason === 'reconnect') expired.add(s.credential); throw e })
      .finally(() => { if (refreshing?.promise === job) refreshing = undefined })
    refreshing = { owner: s.credential, promise: job }
    return job
  }
  async function pages<T>(path: string, params: Record<string, string>, token: string, signal?: AbortSignal) {
    const items: T[] = [], seen = new Set<string>()
    const url = new URL(api + path)
    url.search = new URLSearchParams(params).toString()
    for (;;) {
      const timeout = AbortSignal.timeout(20_000)
      const res = await request(url, { redirect: 'error', headers: { Authorization: 'Bearer ' + token }, signal: signal ? AbortSignal.any([signal, timeout]) : timeout })
      if (!res.ok) throw new GoogleFailure(res.status === 401 ? 'reconnect' : 'connection')
      const body = await res.json()
      if (body.items != null && !Array.isArray(body.items)) throw new GoogleFailure('connection')
      items.push(...(body.items ?? []))
      if (!body.nextPageToken) return items
      if (typeof body.nextPageToken !== 'string' || seen.has(body.nextPageToken)) throw new GoogleFailure('connection')
      seen.add(body.nextPageToken); url.searchParams.set('pageToken', body.nextPageToken)
    }
  }
  async function inventory(token: string, signal?: AbortSignal) {
    const all = await pages<GoogleCal>('/users/me/calendarList', { maxResults: '250', showHidden: 'true', minAccessRole: 'reader',
      fields: 'nextPageToken,items(id,summary,summaryOverride,primary,backgroundColor,deleted)' }, token, signal)
    const account = all.find(c => c.primary)?.id
    if (!account) throw new GoogleFailure('connection')
    const calendars = all.filter(c => c.id && !c.deleted).map(c => ({ id: c.id, name: c.summaryOverride || c.summary || c.id,
      ...(/^#[\da-f]{6}$/i.test(c.backgroundColor ?? '') ? { color: c.backgroundColor } : {}) }))
    return { account, calendars }
  }
  async function authorized<T>(s: SavedGoogle, run: (token: string) => Promise<T>) {
    try { return await run(await bearer(s)) }
    catch (e) {
      if (!(e instanceof GoogleFailure) || e.reason !== 'reconnect' || expired.has(s.credential)) throw e
      access = undefined
      try { return await run(await bearer(s)) }
      catch (retry) {
        if (retry instanceof GoogleFailure && retry.reason === 'reconnect') expired.add(s.credential)
        throw retry
      }
    }
  }
  async function readEvents(s: SavedGoogle, cal: SavedCalendar, from: number, to: number, signal: AbortSignal): Promise<RawEvent[]> {
    const rows = await authorized(s, token => pages<Event>(`/calendars/${encodeURIComponent(cal.id)}/events`, {
      timeMin: new Date(from).toISOString(), timeMax: new Date(to).toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '2500',
      fields: 'nextPageToken,items(id,iCalUID,summary,status,start(dateTime),end(dateTime),location,description,hangoutLink,conferenceData(entryPoints(entryPointType,uri)),attendees(self,displayName,email,responseStatus))',
    }, token, signal))
    return rows.flatMap(e => {
      if (!e.id || !e.start?.dateTime || !e.end?.dateTime || e.status === 'cancelled') return []
      const people = e.attendees ?? [], self = people.find(p => p.self)
      return [{ id: localId(cal.id + '/' + e.id), externalId: e.iCalUID || e.id, title: e.summary || '', start: e.start.dateTime, end: e.end.dateTime,
        calendarId: localId(cal.id), calendar: cal.name, calendarSource: s.account, me: self?.email ?? s.account, declined: self?.responseStatus === 'declined',
        attendees: people.filter(p => !p.self).map(p => ({ name: p.displayName ?? null, email: p.email ?? null })),
        url: e.hangoutLink ?? e.conferenceData?.entryPoints?.find(p => p.entryPointType === 'video')?.uri ?? null, location: e.location ?? null, notes: e.description ?? null }]
    })
  }
  return {
    info() { const s = saved(); return { configured: !!d.client(), account: s?.account, reconnect: !!s && expired.has(s.credential) } },
    async connect() {
      const c = d.client()
      if (!c) throw new GoogleFailure('setup')
      if (!d.secure()) throw new GoogleFailure('storage')
      connecting?.abort(); const stop = new AbortController(); connecting = stop
      try {
        const token = await d.grant(c, stop.signal)
        const { account, calendars } = await inventory(token.access_token, stop.signal)
        stop.signal.throwIfAborted()
        const old = saved(), same = old?.account === account && old.clientId === c.client_id
        const credential = token.refresh_token ? d.seal(token.refresh_token) : same ? old!.credential : undefined
        if (!credential) throw new GoogleFailure('permission')
        const selected = same ? old!.selected.filter(id => calendars.some(cal => cal.id === id)) : []
        updateSettings(d.file, { googleCalendar: { account, calendars, credential, clientId: c.client_id, selected },
          ...(loadSettings(d.file).useSystemCalendars == null ? { useSystemCalendars: false } : {}) })
        clearReads(); remember(credential, token)
      } finally { if (connecting === stop) connecting = undefined }
    },
    cancel() { connecting?.abort() },
    disconnect() {
      connecting?.abort(); clearReads(); access = undefined; expired.clear()
      updateSettings(d.file, { googleCalendar: undefined })
    },
    async refresh() {
      const s = saved(); if (!s) return
      const result = await authorized(s, inventory), current = saved()
      if (current?.credential !== s.credential || result.account !== s.account) return
      updateSettings(d.file, { googleCalendar: { ...current, calendars: result.calendars, selected: current.selected.filter(id => result.calendars.some(c => c.id === id)) } })
      clearReads()
    },
    calendars(): CalendarSource[] { const s = saved(); return s?.calendars.map(c => ({ ...c, id: localId(c.id), source: s.account })) ?? [] },
    selectedIds(s = saved()) { return new Set(s?.selected.map(localId)) },
    setEnabled(id: string, enabled: boolean) {
      const s = saved(), c = s?.calendars.find(c => localId(c.id) === id)
      if (!s || !c) return false
      const ids = new Set(s.selected)
      if (enabled) ids.add(c.id); else ids.delete(c.id)
      updateSettings(d.file, { googleCalendar: { ...s, selected: [...ids] } })
      clearReads(); return true
    },
    async events(from: number, to: number, unavailable?: string[]): Promise<RawEvent[]> {
      const s = saved(), version = generation
      if (!s?.selected.length) return []
      const now = Date.now()
      for (const [key, value] of cache) if (value.until < now) cache.delete(key)
      const selected = new Set(s.selected), calendars = s.calendars.filter(c => selected.has(c.id))
      const start = Math.floor(from / 60_000) * 60_000, end = Math.ceil(to / 60_000) * 60_000
      const all: RawEvent[] = []
      const read = async (c: SavedCalendar) => {
        const key = JSON.stringify([c.id, start, end])
        let entry = cache.get(key)
        if (!entry) {
          entry = { until: now + 60_000, rows: readEvents(s, c, start, end, reads.signal) }
          cache.set(key, entry)
        }
        try { return await entry.rows }
        catch { if (version === generation) unavailable?.push(c.name); if (cache.get(key) === entry) cache.delete(key); return [] }
      }
      for (let i = 0; i < calendars.length && version === generation; i += 4) {
        const batch = await Promise.all(calendars.slice(i, i + 4).map(read))
        for (const rows of batch) all.push(...rows)
      }
      return version === generation ? all.filter(row => Date.parse(row.start) < to && Date.parse(row.end) > from) : []
    },
  }
}
