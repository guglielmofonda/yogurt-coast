import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { copyFile, mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { CoastView } from '../shared/types'
import { isId } from './ipcArgs'
import type { Store } from './store'
import type { Queue } from './notes/queue'
import type { NotesModel } from './notes/model'
import { coastClient, thumbnail } from './coastClient'
import { chooseScreens, differentText, distinctResourceViews, pixelChange, type Candidate, type Screen } from './coastSelection'

type Span = [number, number]
const fileName = /^\d{10,14}-[1-9]\d{0,15}\.png$/
const windowMs = 80_000
const fileOf = (f: { at: number; id: number }) => `${f.at}-${f.id}.png`

export function createCoastScreenshots(o: {
  root: string; cli?: string; store: Store; model: Pick<NotesModel, 'llm'>; queue: Queue; changed(id: string): void
  recognize?(path: string): Promise<string>; indexed(): void
}) {
  // Jobs stay outside portable meeting backups: importing someone else's note must never query this Mac's history.
  const jobs = join(o.root, 'coast-imports')
  const jobFile = (id: string) => join(jobs, id + '.json')
  const dir = (id: string) => join(o.root, 'meetings', id, 'coast')
  const files = (id: string) => existsSync(dir(id))
    ? readdirSync(dir(id), { withFileTypes: true }).filter(f => f.isFile() && fileName.test(f.name)).map(f => f.name).sort() : []
  const running = new Set<string>(), failed = new Set<string>()
  const unsaved = new Map<string, Span[]>()
  let live: { id: string; since: number | null; spans: Span[] } | undefined
  const eligible = (id: string) => {
    const m = o.store.meeting(id)
    return m && m.trashedAt == null && (m.state === 'stopped' || m.state === 'done') && m.endedAt != null ? m : undefined
  }
  function spans(id: string): Span[] {
    if (!existsSync(jobFile(id))) return []
    const value: unknown = JSON.parse(readFileSync(jobFile(id), 'utf8'))
    if (!Array.isArray(value) || !value.every(v => Array.isArray(v) && v.length === 2 && v.every(Number.isSafeInteger) && v[0] < v[1])) throw Error('Invalid recording windows')
    return value as Span[]
  }
  function save(id: string, pending: Span[]) {
    if (!pending.length) { rmSync(jobFile(id), { force: true }); return }
    mkdirSync(jobs, { recursive: true, mode: 0o700 })
    writeFileSync(jobFile(id) + '.tmp', JSON.stringify(pending), { mode: 0o600 })
    renameSync(jobFile(id) + '.tmp', jobFile(id))
  }
  function flush(id: string) {
    const ranges = unsaved.get(id)
    if (!ranges) return true
    try { save(id, [...spans(id), ...ranges]); unsaved.delete(id); return true }
    catch { failed.add(id); o.changed(id); return false }
  }
  function pause(id: string, paused: boolean, at = Date.now()) {
    if (!live || live.id !== id) return
    if (paused && live.since !== null) {
      if (at > live.since) live.spans.push([live.since, at])
      live.since = null
    } else if (!paused && live.since === null) live.since = at
  }

  async function processWindow(id: string, from: number, to: number, signal: AbortSignal, last?: Screen): Promise<Screen | undefined> {
    const m = eligible(id)
    if (!m || !o.cli || from < m.startedAt || to > m.endedAt!) throw Error('Outside the saved meeting')
    const temp = await mkdtemp(join(tmpdir(), 'yogurt-coast-'))
    try {
      const client = coastClient(o.cli, temp, signal)
      // Coast reports whole seconds. Drop the boundary seconds that might include time outside the recording.
      const rows = await client.frames(Math.ceil(from / 1000) * 1000, Math.floor(to / 1000) * 1000)
      const existing = files(id)
      const prior = existing.filter(f => Number(f.split('-')[0]) < from).at(-1)
      let previous = last && prior === fileOf(last) ? last : undefined
      let pixels = previous?.pixels ?? (prior ? await thumbnail(join(dir(id), prior)) : undefined)
      // After an interrupted import, recover the last saved view for comparison.
      if (prior && pixels && !previous) {
        const at = Number(prior.split('-')[0])
        if (at >= m.startedAt && at + 1000 <= m.endedAt!) {
          const row = (await client.frames(at, at + 1000).catch(() => [])).find(f => fileOf(f) === prior)
          if (row) previous = { ...row, pixels }
        }
      }
      let earlier: Candidate | undefined
      const candidates: Candidate[] = []
      for (const row of rows) {
        signal.throwIfAborted()
        const path = await client.image(row.id)
        const next = await thumbnail(path), change = pixels ? pixelChange(pixels, next) : 1
        const changedWords = earlier && (earlier.app !== row.app || earlier.domain !== row.domain || differentText(earlier.title + ' ' + earlier.text, row.title + ' ' + row.text))
        if (pixels && change < 0.075 && !changedWords) continue
        const retained = join(temp, 'candidate-' + row.id + '.png')
        await copyFile(path, retained)
        earlier = { ...row, pixels: next, change, path: retained }
        candidates.push(earlier)
        pixels = next
      }
      signal.throwIfAborted()
      const note = o.store.notes(id)
      const context = { title: m.title, notes: note.mine, summary: note.enhanced }
      const picks = candidates.length ? await chooseScreens(await o.model.llm(signal), context, candidates, !!prior) : []
      const selected = distinctResourceViews(picks, note.mine, previous)
      console.info('COAST', `selection meeting=${id} sampled=${rows.length} candidates=${candidates.length} selected=${selected.length}`)
      for (const f of selected) {
        signal.throwIfAborted()
        if (!eligible(id)) return
        const dest = join(dir(id), fileOf(f))
        if (existsSync(dest)) continue
        const partial = dest + '.part'
        await copyFile(f.path, partial)
        if (eligible(id) && !signal.aborted) renameSync(partial, dest)
        else rmSync(partial, { force: true })
      }
      return selected.at(-1) ?? previous
    } finally { await rm(temp, { recursive: true, force: true }) }
  }
  async function imagePath(id: string, name: string) {
    const folder = await realpath(join(o.root, 'meetings'))
    const expected = join(folder, id, 'coast', name)
    const info = await stat(expected)
    if (await realpath(expected) !== expected || !info.isFile() || info.size > 80 * 1024 * 1024) throw Error('Invalid screenshot')
    return expected
  }
  function missing(id: string) {
    if (!o.recognize) return []
    const known = new Set(o.store.screenTexts(id).map(row => row.file))
    return files(id).filter(name => !known.has(name))
  }
  async function recognizeSaved(id: string, signal: AbortSignal) {
    if (!o.recognize) return
    let indexed = false
    try {
      for (const name of missing(id)) {
        if (signal.aborted || !eligible(id)) return
        const text = await o.recognize(await imagePath(id, name))
        if (signal.aborted || !eligible(id)) return
        o.store.saveScreenText(id, name, Number(name.split('-')[0]), text)
        indexed ||= text.length > 0
      }
    } finally { if (indexed) o.indexed() }
  }
  function schedule(id: string) {
    if (running.has(id) || !eligible(id) || !flush(id)) return
    if (!(o.cli && existsSync(jobFile(id))) && !missing(id).length) return
    failed.delete(id); running.add(id); o.changed(id)
    void o.queue.enqueue(async signal => {
      let last: Screen | undefined
      while (!signal.aborted && eligible(id)) {
        const pending = spans(id)
        if (!o.cli || !pending.length) break
        const [from, end] = pending[0]
        const to = Math.min(end, Math.floor(from / 1000) * 1000 + windowMs)
        mkdirSync(dir(id), { recursive: true, mode: 0o700 })
        if (Math.ceil(from / 1000) < Math.floor(to / 1000)) last = await processWindow(id, from, to, signal, last)
        if (signal.aborted || !eligible(id)) return
        const rest = spans(id).slice(1)
        save(id, to < end ? [[to, end], ...rest] : rest)
        o.changed(id)
      }
      if (!signal.aborted && eligible(id)) await recognizeSaved(id, signal)
    }, 'screenshots', id).catch(() => { failed.add(id) }).finally(() => { running.delete(id); o.changed(id) })
  }
  function view(id: string): CoastView | null {
    if (!eligible(id)) return null
    const pending = existsSync(jobFile(id))
    if (!pending && !failed.has(id) && !existsSync(dir(id))) return null
    return { files: files(id), status: failed.has(id) ? 'error' : running.has(id) ? 'working' : pending ? 'retry' : 'done' }
  }
  return {
    start(id: string, at: number) { if (o.cli) live = { id, since: at, spans: [] } },
    pause,
    stopped(id: string, end: number) {
      if (!live || live.id !== id) return
      pause(id, true, end)
      if (live.spans.length) unsaved.set(id, [...(unsaved.get(id) ?? []), ...live.spans])
      live = undefined
      flush(id)
    },
    schedule, view,
    restore() {
      const ids = new Set<string>()
      if (o.cli && existsSync(jobs)) for (const f of readdirSync(jobs)) if (f.endsWith('.json')) ids.add(f.slice(0, -5))
      const meetings = join(o.root, 'meetings')
      if (o.recognize && existsSync(meetings)) {
        for (const entry of readdirSync(meetings, { withFileTypes: true })) {
          if (entry.isDirectory() && existsSync(dir(entry.name))) ids.add(entry.name)
        }
      }
      for (const id of ids) if (isId(id)) schedule(id)
    },
    forget(id: string) { unsaved.delete(id); failed.delete(id); rmSync(jobFile(id), { force: true }) },
    async image(id: string, name: unknown) {
      if (!eligible(id) || typeof name !== 'string' || !fileName.test(name)) return null
      try {
        const png = await readFile(await imagePath(id, name))
        if (!eligible(id) || !png.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return null
        return 'data:image/png;base64,' + png.toString('base64')
      } catch { return null }
    },
  }
}
