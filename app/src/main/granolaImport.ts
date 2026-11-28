import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { buffer } from 'node:stream/consumers'
import { setImmediate } from 'node:timers/promises'
import { crc32 } from 'node:zlib'
import yauzl from 'yauzl'
import { TITLE_MAX } from './meeting'
import { NOTES_MAX } from './notes'
import { IMPORT_LINES_MAX, saveImportedNote } from './mcp/importMeeting'
import { parseTranscript } from './mcp/transcriptImport'
import type { Store } from './store'

const MAX_BYTES = 128 * 1024 * 1024
type Note = Parameters<typeof saveImportedNote>[2]
export type GranolaPlan = { notes: Note[]; duplicates: number; rejected: number; issues: string[] }

function* records(csv: string) {
  let at = csv.charCodeAt(0) === 0xfeff ? 1 : 0
  const separator = /[",\r\n]/g
  while (at < csv.length) {
    const row: string[] = []
    for (;;) {
      let value = ''
      if (csv[at] === '"') {
        at++
        for (;;) {
          const end = csv.indexOf('"', at)
          if (end < 0) throw Error('Invalid CSV')
          value += csv.slice(at, end)
          at = end + 1
          if (csv[at] !== '"') break
          value += '"'
          at++
        }
      } else {
        separator.lastIndex = at
        const end = separator.exec(csv)?.index ?? csv.length
        value = csv.slice(at, end)
        at = end
      }
      row.push(value)
      if (row.length > 256) throw Error('Invalid CSV')
      const delimiter = csv[at++]
      if (delimiter === ',') continue
      if (delimiter === '\r' && csv[at] === '\n') at++
      if (delimiter !== undefined && delimiter !== '\r' && delimiter !== '\n') throw Error('Invalid CSV')
      break
    }
    if (row.length !== 1 || row[0].trim()) yield row
  }
}

async function readCsv(csv: string, name: string, store: Store, seen: Set<string>, plan: GranolaPlan) {
  const rows = records(csv)
  const header = rows.next()
  const columns = header.done ? undefined : header.value.map(s => s.trim().toLowerCase())
  if (!columns || !columns.includes('document_title') || !columns.includes('document_created') ||
      !['summary', 'notes', 'transcript'].some(key => columns.includes(key))) throw Error('Unrecognized Granola CSV')
  let number = 1
  for (const row of rows) {
    number++
    if (number % 50 === 0) await setImmediate()
    const field = (key: string) => row[columns.indexOf(key)] ?? ''
    const title = field('document_title').trim(), date = field('document_created').trim()
    const summary = field('summary'), mine = field('notes'), transcript = field('transcript')
    const workspace = field('workspace_name').trim(), startedAt = Date.parse(date)
    const sourceId = field('document_id').trim() || 'granola:' + createHash('sha256').update(JSON.stringify([workspace, date, title, summary, mine, transcript])).digest('hex')
    if (seen.has(sourceId) || store.meetingFromSource('import', sourceId)) { plan.duplicates++; continue }
    const content = summary.trim() || mine.trim() || transcript.trim()
    if (row.length === columns.length && title && title.length <= TITLE_MAX && Number.isFinite(startedAt) &&
        content && Math.max(summary.length, mine.length, transcript.length) <= NOTES_MAX && sourceId.length <= 200 && workspace.length <= 200) {
      const lines = parseTranscript(transcript, 'lines')
      if (lines.length <= IMPORT_LINES_MAX) {
        plan.notes.push({ title, startedAt, endedAt: null, sourceId, attendees: [], lines, summary: summary.trim() ? summary : null, mine, newFolder: workspace || undefined })
        seen.add(sourceId)
        continue
      }
    }
    plan.rejected++
    if (plan.issues.length < 10) plan.issues.push(`${name} · #${number}`)
  }
}

export async function planGranolaImport(path: string, store: Store): Promise<GranolaPlan> {
  const plan: GranolaPlan = { notes: [], duplicates: 0, rejected: 0, issues: [] }
  const seen = new Set<string>()
  const info = await stat(path)
  if (!info.isFile() || info.size > MAX_BYTES) throw Error('File exceeds import limit')
  const utf8 = new TextDecoder('utf-8', { fatal: true })
  if (extname(path).toLowerCase() === '.csv') {
    const bytes = await buffer(createReadStream(path, { end: MAX_BYTES }))
    if (bytes.length > MAX_BYTES) throw Error('File exceeds import limit')
    await readCsv(utf8.decode(bytes), basename(path), store, seen, plan)
  } else if (extname(path).toLowerCase() === '.zip') {
    const archive = await yauzl.openPromise(path, { lazyEntries: true, autoClose: false })
    let bytes = 0, files = 0
    try {
      for await (const entry of archive.eachEntry()) {
        if (entry.fileName.startsWith('__MACOSX/') || basename(entry.fileName).startsWith('.') || !/\.csv$/i.test(entry.fileName)) continue
        if (++files > 256 || entry.uncompressedSize > MAX_BYTES - bytes) throw Error('Archive exceeds import limit')
        const buffers: Buffer[] = []
        let checksum = 0
        for await (const data of await archive.openReadStreamPromise(entry)) {
          bytes += data.length
          if (bytes > MAX_BYTES) throw Error('Archive exceeds import limit')
          checksum = crc32(data, checksum)
          buffers.push(data)
        }
        if (checksum !== entry.crc32) throw Error('Damaged CSV in archive')
        await readCsv(utf8.decode(Buffer.concat(buffers)), basename(entry.fileName), store, seen, plan)
        await setImmediate()
      }
    } finally { archive.close() }
    if (!files) throw Error('No CSV files')
  } else throw Error('Choose a Granola CSV or ZIP')
  return plan
}

export async function commitGranolaImport(plan: GranolaPlan, store: Store, me: string) {
  let added = 0, duplicates = plan.duplicates
  for (let i = 0; i < plan.notes.length; i++) {
    const result = saveImportedNote(store, me, plan.notes[i])
    if (result.already_imported) duplicates++
    else added++
    if (i % 10 === 9) await setImmediate()
  }
  return { added, duplicates, rejected: plan.rejected }
}
