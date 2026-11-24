import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join, sep, extname } from 'node:path'
import { realpath, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { nativeImage } from 'electron'
import { coastFrames, localSecond } from './coastSelection'

const exec = promisify(execFile)
export const coastCLI = '/Applications/Coast Local.app/Contents/Resources/bin/coast'

export function coastClient(cli: string, temp: string, signal: AbortSignal) {
  const run = async (args: string[]) => (await exec(cli, args, { signal, timeout: 45_000, maxBuffer: 8 * 1024 * 1024,
    env: { HOME: process.env.HOME, PATH: process.env.PATH, LANG: process.env.LANG, TZ: process.env.TZ, TMPDIR: temp + sep,
      ...(cli === coastCLI ? {} : { YOGURT_FAKE_COAST_FIXTURE: process.env.YOGURT_FAKE_COAST_FIXTURE }) } })).stdout
  return {
    async frames(from: number, to: number) {
      const raw = await run(['--json', 'query', 'cover', '--tr', localSecond(from) + '|' + localSecond(to),
        '--min-difference-text', '0', '--min-difference-seconds', '4'])
      return coastFrames(raw, from, to)
    },
    async image(id: number) {
      const out = (await run(['query', 'image', '--id', String(id)])).trim()
      const file = await realpath(out)
      const privateDir = await realpath(temp)
      const sharedDir = join(await realpath(tmpdir()), 'coast-cli')
      if (!(file.startsWith(privateDir + sep) || file.startsWith(sharedDir + sep)) || extname(file) !== '.png') throw Error('Unexpected Coast image path')
      const info = await stat(file)
      if (!info.isFile() || !info.size || info.size > 80 * 1024 * 1024) throw Error('Unreadable Coast image')
      return file
    },
  }
}

export async function thumbnail(path: string) {
  const image = await nativeImage.createThumbnailFromPath(path, { width: 48, height: 36 })
  if (image.isEmpty()) throw Error('Unreadable screenshot')
  return image.resize({ width: 40, height: 30 }).toBitmap()
}
