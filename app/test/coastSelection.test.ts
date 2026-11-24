import { expect, test, vi } from 'vitest'
import { chooseScreens, coastFrames, differentText, localSecond, pixelChange, type Candidate } from '../src/main/coastSelection'

const start = new Date(2026, 3, 1, 12).getTime()
const candidates: Candidate[] = ['Roadmap', 'Inbox', 'Launch dates'].map((text, i) => ({ id: 701 + i, at: start + i * 4000, app: 'Slides', title: text, text, change: 1, path: '' }))

test('takes only frames inside a recorded interval and distinguishes empty from broken data', () => {
  const frames = [-1, 1, 3, 6].map(i => ({ frame_id: i + 10, timestamp: localSecond(start + i * 1000) }))
  const parse = (frames: unknown[]) => coastFrames(JSON.stringify({ frames, selected_count: frames.length }), start, start + 6000)
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
  expect((await chooseScreens({ chat }, 'Roadmap', candidates, false)).map(f => f.id)).toEqual([701, 703])
  expect(chat).toHaveBeenCalledTimes(2)
  expect(await chooseScreens({ chat: async () => '[]' }, '', candidates, false)).toEqual([])
  await expect(chooseScreens({ chat: async () => 'invalid' }, '', candidates, false)).rejects.toThrow()
})
