import { createHash } from 'node:crypto'
import { statSync } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { basename, extname, isAbsolute } from 'node:path'
import type { AskModelOption } from '../shared/types'

export type LocalAskFile = { path: string; name: string; quant: string; size: number; mtimeMs: number }
export type AskPreference = { selected?: string; files: LocalAskFile[] }
export const askModelId = (path: string) => createHash('sha256').update(path).digest('hex')
export const askOption = ({ path, name, quant }: Pick<LocalAskFile, 'path' | 'name' | 'quant'>): AskModelOption =>
  ({ id: askModelId(path), name, quant, fileName: basename(path) })

export function stillAvailable(file: LocalAskFile) {
  if (!file || typeof file.path !== 'string' || !isAbsolute(file.path) || extname(file.path).toLowerCase() !== '.gguf') return false
  try {
    const disk = statSync(file.path)
    return disk.isFile() && disk.size === file.size && disk.mtimeMs === file.mtimeMs
  } catch { return false }
}

/** Only the native Open dialog supplies this path. Read metadata locally before asking the engine to load the weights. */
export async function inspectAskFile(chosen: string): Promise<LocalAskFile> {
  const path = await realpath(chosen)
  const disk = await stat(path)
  if (extname(path).toLowerCase() !== '.gguf' || !disk.isFile()) throw new Error('Expected a local GGUF file')
  const { readGgufFileInfo, GgufFileType } = await import('node-llama-cpp')
  const { metadata, tensorCount } = await readGgufFileInfo(path, {
    sourceType: 'filesystem', readTensorInfo: false, spliceSplitFiles: false, logWarnings: false,
    ignoreKeys: ['tokenizer.ggml.tokens', 'tokenizer.ggml.scores', 'tokenizer.ggml.merges', 'tokenizer.ggml.token_type'],
  })
  const { architecture, name, file_type } = metadata.general
  const arch = metadata[architecture]
  const pooled = arch && 'pooling_type' in arch && (arch.pooling_type ?? 0) > 0
  const adapter = 'type' in metadata.general && metadata.general.type === 'adapter'
  if (!tensorCount || !metadata.tokenizer?.ggml?.model || /bert|clip|embed|whisper/i.test(architecture)
    || pooled || adapter || metadata.tokenizer['chat_template.rerank']) {
    throw new Error('Expected a text generation model')
  }
  return { path, name: name || basename(path, extname(path)), quant: (file_type != null && GgufFileType[file_type]?.replace(/^MOSTLY_|^ALL_/, '')) || 'GGUF', size: disk.size, mtimeMs: disk.mtimeMs }
}
