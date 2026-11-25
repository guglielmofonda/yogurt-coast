import { expect, test, vi } from 'vitest'
import { chooseScreens, coastFrames, differentText, distinctResourceViews, localSecond, pixelChange, type Candidate } from '../src/main/coastSelection'

const start = new Date(2026, 3, 1, 12).getTime()
const meeting = { title: 'Roadmap', notes: 'https://example.test/workshop', summary: 'The team discussed launch dates.' }
const candidates: Candidate[] = ['Roadmap', 'Inbox', 'Launch dates'].map((text, i) => ({ id: 701 + i, at: start + i * 4000, app: 'Slides', title: text, text, pixels: Buffer.alloc(40), change: 1, path: '' }))

test('takes only frames inside a recorded interval and distinguishes empty from broken data', () => {
  const frames = [-1, 1, 3, 6].map(i => ({ frame_id: i + 10, timestamp: localSecond(start + i * 1000) }))
  const parse = (frames: unknown[]) => coastFrames(JSON.stringify({ frames, selected_count: frames.length }), start, start + 6000)
  expect(parse([{ ...frames[1], domain: 'meet.google.com' }])[0].domain).toBe('meet.google.com')
  expect(parse([...frames, frames[1]]).map(f => f.id)).toEqual([11, 13])
  expect(coastFrames('No frames found.\n', start, start + 1)).toEqual([])
  expect(() => parse([{ frame_id: 'bad' }])).toThrow()
})
test('detects slides with little text, ignores tiny colour shifts, and notices new text on the same background', () => {
  const white = Buffer.alloc(40, 255)
  expect(pixelChange(white, Buffer.alloc(40, 251))).toBe(0)
  expect(pixelChange(white, Buffer.alloc(40, 0))).toBe(1)
  expect(differentText('Roadmap funding priorities this year', 'Roadmap funding priorities this year 12')).toBe(false)
  expect(differentText('Roadmap funding priorities this year', 'Launch dates pricing and enterprise pilots')).toBe(true)
})
test('persists only a valid model choice, keeps timeline order, and lets the model choose nothing', async () => {
  const chat = vi.fn().mockResolvedValueOnce('[99]').mockResolvedValueOnce('```json\n[3,1,3]\n```')
  expect((await chooseScreens({ chat }, meeting, candidates, false)).map(f => f.id)).toEqual([701, 703])
  expect(chat).toHaveBeenCalledTimes(2)
  const evidence = JSON.parse(chat.mock.calls[0][0].split('\n').at(-1)!)
  expect(evidence).toMatchObject({ notes: meeting.notes, summary: meeting.summary })
  expect(await chooseScreens({ chat: async () => '[]' }, meeting, candidates, false)).toEqual([])
  await expect(chooseScreens({ chat: async () => 'invalid' }, meeting, candidates, false)).rejects.toThrow()
})

test('keeps the foreground call chat once and preserves new slides or links', () => {
  const link = 'example.test/workshop', text = 'In-call messages: here is the workshop link ' + link
  const frame = (id: number, app: string, more: Partial<Candidate> = {}): Candidate =>
    ({ ...candidates[0], id, at: start + 4000 * id, app, title: 'Team call', text, ...more })
  const overlay = frame(1, 'Yogurt'), call = frame(2, 'Browser', { domain: 'meet.google.com' })
  const repeat = frame(3, 'Browser', { domain: call.domain, pixels: Buffer.concat([Buffer.alloc(8, 255), Buffer.alloc(32)]) })
  const slide = frame(4, 'Browser', { domain: call.domain, pixels: Buffer.alloc(40, 255) })
  const nextLink = frame(5, 'Browser', { domain: call.domain, text: text + ' and example.test/slides' })
  const editor = frame(6, 'Yogurt + Coast', { text: 'Transcript My notes ' + link })
  expect(distinctResourceViews([overlay, call, repeat, slide, nextLink, editor], meeting.notes).map(f => f.id)).toEqual([2, 4, 5])
  expect(distinctResourceViews([repeat, slide], meeting.notes, call).map(f => f.id)).toEqual([4])
  expect(distinctResourceViews([call, slide], 'Unrelated notes')).toEqual([call, slide])
})
