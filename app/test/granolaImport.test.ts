import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openStore, type Store } from '../src/main/store'
import { commitGranolaImport, planGranolaImport } from '../src/main/granolaImport'
import { packPortable } from '../src/main/zip'

const header = 'document_id,user_email,document_title,workspace_name,document_created,summary,notes,transcript'
const fields = ['doc-1','owner@example.test','Paper, proofs','Fieldwork','2026-05-07T10:00:00.000Z','## Print\nKeep the "blue" cover.','Ask for a proof.','[00:12] Maya: Indigo proof\nUnattributed words\nAnother line']
const csv = (values: string[]) => values.map(value => '"' + value.replaceAll('"','""') + '"').join(',')
let store: Store, dir: string
beforeEach(async () => { store = openStore(':memory:'); dir = await mkdtemp(join(tmpdir(),'granola-')) })
afterEach(async () => { store.close(); await rm(dir, { recursive: true, force: true }) })

it('keeps notes, summary, transcript lines, workspace and search across a multi-workspace ZIP and an overlapping CSV', async () => {
  const input = join(dir,'exports'), zip = join(dir,'granola.zip')
  await mkdir(input)
  const first = join(input,'one.csv')
  await writeFile(first,'\uFEFF' + header + '\r\n' + csv(fields) + '\r\n')
  await writeFile(join(input,'two.csv'),[header,csv(fields),csv(['doc-2','','Next edition','Studio',fields[4],'## Another edition','','']),csv(['doc-3','','Bad date','','yesterday-ish','summary','',''])].join('\n'))
  await packPortable(input,zip)
  const plan = await planGranolaImport(zip,store)
  expect(plan).toMatchObject({ duplicates: 1, rejected: 1, issues: ['two.csv · #4'] })
  expect(plan.notes).toHaveLength(2)
  expect(store.meetingFromSource('import','doc-1')).toBeUndefined()
  expect(await commitGranolaImport(plan,store,'Sam')).toEqual({ added: 2, duplicates: 1, rejected: 1 })
  const m = store.meetingFromSource('import','doc-1')!
  expect(m).toMatchObject({ title: fields[2], startedAt: Date.parse(fields[4]), endedAt: null, attendees: [] })
  expect(store.notes(m.id)).toMatchObject({ enhanced: fields[5], mine: fields[6], edited: true })
  expect(store.segments(m.id).map(s => [s.speaker,s.text])).toEqual([['Maya','Indigo proof'],[null,'Unattributed words'],[null,'Another line']])
  expect(store.segments(m.id)[0].startMs).toBe(12000)
  expect(store.foldersOf(m.id).map(f => f.name)).toEqual(['Fieldwork'])
  expect(store.search('indigo',10).map(h => h.meetingId)).toContain(m.id)
  store.setNotes(m.id,{ mine:'Edited in Yogurt' })
  expect(await planGranolaImport(first,store)).toMatchObject({ notes:[], duplicates:1 })
  expect(await commitGranolaImport(plan,store,'Sam')).toMatchObject({ added:0, duplicates:3 })
  expect(store.notes(m.id)?.mine).toBe('Edited in Yogurt')
})

it('rolls back an incomplete meeting and imports it on retry', async () => {
  const file = join(dir, 'notes.csv')
  await writeFile(file, [header, csv(fields)].join('\n'))
  const plan = await planGranolaImport(file, store)
  const notes = vi.spyOn(store, 'setNotes').mockImplementationOnce(() => { throw Error('interrupted') })
  try {
    await expect(commitGranolaImport(plan, store, 'Sam')).rejects.toThrow('interrupted')
  } finally { notes.mockRestore() }
  expect(store.meetingFromSource('import', 'doc-1')).toBeUndefined()
  expect(store.search('indigo', 10)).toHaveLength(0)
  expect(await commitGranolaImport(plan, store, 'Sam')).toEqual({ added: 1, duplicates: 0, rejected: 0 })
})

it('declines damaged and unrelated files before importing anything', async () => {
  const file=join(dir,'bad.csv')
  for (const contents of ['title,secret\nExample,value',header+'\n'+csv(fields)+'\n"unclosed',header+'\n"quoted"x']) {
    await writeFile(file,contents)
    await expect(planGranolaImport(file,store)).rejects.toThrow()
    expect(store.meetingFromSource('import','doc-1')).toBeUndefined()
  }
})
