import { useEffect, useState } from 'react'
import type { AgendaEvent, YogurtApi } from '../../../shared/types'
import { language, t } from '../../../shared/i18n'
import { HOME_AGENDA_DAYS } from '../../../shared/comingUp'
import { eventTimeRange } from '../../../shared/dates'
import { shiftDay } from '../agenda'
import { timeOf, useDay } from '../dates'
import { ChevronLeft, ChevronRight } from './Icons'
import { InlineError } from './InlineError'
import { toasts } from './TrashToast'

type Range = Awaited<ReturnType<YogurtApi['calendar']['overview']>>
const VISIBLE_EVENTS = 4

export function HomeUpcoming({ open, agendaOpen }: { open: (id: string) => void; agendaOpen: boolean }) {
  const today = useDay()
  const [offset, setOffset] = useState(0), [all, setAll] = useState(false)
  const [revision, setRevision] = useState(0)
  const [view, setView] = useState<{ at: number; range: Range; now: number }>()
  const [opening, setOpening] = useState<string>()
  const at = shiftDay(new Date(today).getTime(), offset)
  const range = view?.at === at ? view.range : undefined
  useEffect(() => {
    let request = 0, active = true
    const refresh = async () => {
      const seq = ++request
      const range = await window.yogurt.calendar.overview(at).catch((): Range => ({ status: 'error', events: [] }))
      if (active && seq === request) setView({ at, range, now: Date.now() })
    }
    void refresh()
    const offCalendar = window.yogurt.calendar.onChange(() => { setView(undefined); void refresh() })
    const offMeetings = window.yogurt.meetings.onChange(() => void refresh())
    const timer = setInterval(refresh, 60_000)
    window.addEventListener('focus', refresh)
    return () => { active = false; offCalendar(); offMeetings(); clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [at, revision])
  const events = range?.status === 'granted' ? range.events.filter(e => e.end > (view?.now ?? Date.now())) : []
  const groups = new Map<string, AgendaEvent[]>()
  for (const event of all ? events : events.slice(0, VISIBLE_EVENTS)) {
    // An overnight event already in progress belongs to the first visible day.
    const date = new Date(Math.max(event.start, new Date(at).setHours(0, 0, 0, 0))).toDateString()
    const group = groups.get(date)
    if (group) group.push(event); else groups.set(date, [event])
  }
  const step = (next: number) => { setOffset(next); setAll(false) }
  const openEvent = async (event: AgendaEvent) => {
    if (event.note) { open(event.note.id); return }
    setOpening(event.id)
    try {
      const result = await window.yogurt.meetings.prepare(event.id, event.start)
      if ('error' in result) {
        if (result.error === 'gone') setRevision(n => n + 1)
        throw Error()
      }
      open(result.id)
    } catch { toasts.add({ title: t("Yogurt couldn't start the notes. Try again in a moment.") }) }
    finally { setOpening(undefined) }
  }
  const shortDate = new Intl.DateTimeFormat(language(), { month: 'short', day: 'numeric' })
  const calendars = () => window.yogurt.nav.go('/settings/calendars')
  return <section className="home-upcoming" aria-labelledby="home-upcoming-title" data-testid="home-upcoming">
    <div className="home-section-head"><h2 id="home-upcoming-title">{t('Coming up')}</h2>
      <div className="home-range-nav">
        {offset > 0 && <button className="ghost-btn" onClick={() => step(0)}>{t('Today')}</button>}
        <span aria-live="polite">{shortDate.formatRange(at, shiftDay(at, HOME_AGENDA_DAYS - 1))}</span>
        <button className="ghost-btn workspace-icon" aria-label={t('Previous')} disabled={!offset} onClick={() => step(offset - HOME_AGENDA_DAYS)}><ChevronLeft size={15} className="rtl:-scale-x-100" /></button>
        <button className="ghost-btn workspace-icon" aria-label={t('Next')} onClick={() => step(offset + HOME_AGENDA_DAYS)}><ChevronRight size={15} className="rtl:-scale-x-100" /></button>
      </div>
    </div>
    <div className="upcoming-card" aria-busy={!range}>
      {!range ? <p className="upcoming-state">{t('Loading…')}</p>
        : range.status === 'error' ? <InlineError testId="home-upcoming-error" className="upcoming-state" retry={() => setRevision(n => n + 1)} />
        : range.status !== 'granted' || range.needsSelection ? <div className="upcoming-state">
          <span>{range.needsSelection ? t('No calendars selected.') : t('Calendar access')}</span>
          {!agendaOpen && <button className="workspace-button" onClick={calendars}>{t('Choose calendars')}</button>}
        </div>
        : <>
          {!!range.unavailable?.length && <InlineError testId="home-upcoming-error" className="upcoming-state" retry={() => setRevision(n => n + 1)} />}
          {!groups.size && !range.unavailable?.length && <p className="upcoming-state">{t('No upcoming meetings')}</p>}
          {Array.from(groups, ([key, list]) => {
            const date = new Date(key)
            return <div key={key} className="upcoming-day">
              <div className="upcoming-date" aria-label={date.toLocaleDateString(language(), { dateStyle: 'full' })}>
                <strong>{date.toLocaleDateString(language(), { day: 'numeric' })}</strong>
                <span>{date.toLocaleDateString(language(), { month: 'short' })}<small>{date.toLocaleDateString(language(), { weekday: 'short' })}</small></span>
              </div>
              <ul>{list.map(event => <li key={event.id}><button type="button" className="upcoming-event" disabled={!!opening}
                title={event.note ? t('Open note') : t('Prepare note')} onClick={() => void openEvent(event)}>
                <i aria-hidden="true" style={{ backgroundColor: event.calendar?.color }} />
                <span><strong>{event.title || t('Untitled')}</strong><small>{new Date(event.start).toDateString() === new Date(event.end).toDateString()
                  ? eventTimeRange(event.start, event.end) : `${shortDate.format(event.start)}, ${timeOf(event.start)} – ${shortDate.format(event.end)}, ${timeOf(event.end)}`}</small></span>
                <ChevronRight size={14} className="upcoming-open rtl:-scale-x-100" />
              </button></li>)}</ul>
            </div>
          })}
          {!all && events.length > VISIBLE_EVENTS && <button className="upcoming-more ghost-btn" onClick={() => setAll(true)}>{t('Show all')}</button>}
        </>}
    </div>
  </section>
}
