// Reading author-supplied paths for a context pack (`generate-mcp --context-pack`). Rules (D-591):
// exactly the given files and directories, nothing else; symbolic links are skipped, never followed;
// names starting with `.env` are refused (an explicit one is an error, one found in a directory is
// skipped); other dotfiles are skipped; directories are walked at most 3 levels deep, entries sorted;
// only text extensions are read; size is checked before a file is read. No path is ever echoed
// unsanitised.
import { basename, join } from 'node:path'
import { isEnvFileName } from '../src/lib/mcpgen/credentials.js'
import { PACK_LIMITS } from '../src/lib/mcpgen/proposals/contextPack.js'

export interface PackIo {
  readFile: (path: string) => Promise<string>
  fileSize: (path: string) => Promise<number>
  readdir: (path: string) => Promise<string[]>
  /** Kind of the entry itself (a symbolic link is reported as such, not followed); null when it does not exist. */
  lstatKind: (path: string) => Promise<'file' | 'dir' | 'symlink' | 'other' | null>
}

export const DOC_EXTENSIONS = ['.md', '.txt', '.rst', '.json', '.yaml', '.yml', '.csv', '.tsv', '.sql', '.xml']
export const SAMPLE_EXTENSIONS = ['.csv', '.tsv', '.json', '.jsonl', '.ndjson', '.txt']
const MAX_DEPTH = 3
const MAX_ENTRIES = 200

const isEnvName = isEnvFileName
const ext = (n: string) => (n.lastIndexOf('.') >= 0 ? n.slice(n.lastIndexOf('.')).toLowerCase() : '')
const show = (p: string) => basename(p).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 60)

export type Collected = { ok: true; files: { name: string; text: string }[]; notes: string[] } | { ok: false; error: string }

export async function collectPackFiles(io: PackIo, paths: string[], kind: 'docs' | 'samples'): Promise<Collected> {
  const allowed = kind === 'docs' ? DOC_EXTENSIONS : SAMPLE_EXTENSIONS
  const maxBytes = kind === 'docs' ? PACK_LIMITS.docFileBytes : PACK_LIMITS.sampleFileBytes * 16
  const files: { name: string; text: string }[] = []
  const notes: string[] = []
  let seen = 0

  const readOne = async (path: string): Promise<string | null> => {
    if (!allowed.includes(ext(path))) {
      notes.push(`Skipped ${show(path)}: not a ${kind} text type.`)
      return null
    }
    const size = await io.fileSize(path)
    if (size > maxBytes) {
      if (kind === 'docs') return Promise.reject(new Error(`The ${kind} file ${show(path)} is larger than ${maxBytes} bytes.`))
      notes.push(`Skipped ${show(path)}: larger than ${maxBytes} bytes.`)
      return null
    }
    return io.readFile(path)
  }

  const walk = async (path: string, depth: number, explicit: boolean): Promise<void> => {
    if (++seen > MAX_ENTRIES) throw new Error(`More than ${MAX_ENTRIES} entries under the ${kind} paths.`)
    const name = basename(path)
    if (isEnvName(name)) {
      if (explicit) throw new Error('Environment files are never read.')
      notes.push(`Skipped an environment file inside a ${kind} directory.`)
      return
    }
    const k = await io.lstatKind(path)
    if (k === null) {
      if (explicit) throw new Error(`The ${kind} path ${show(path)} does not exist.`)
      return
    }
    if (k === 'symlink') {
      notes.push(`Skipped ${show(path)}: symbolic links are never followed.`)
      return
    }
    if (k === 'dir') {
      if (depth >= MAX_DEPTH) {
        notes.push(`Skipped ${show(path)}: deeper than ${MAX_DEPTH} levels.`)
        return
      }
      const entries = (await io.readdir(path)).filter((e) => !e.startsWith('.') || isEnvName(e)).sort()
      for (const e of entries) await walk(join(path, e), depth + 1, false)
      return
    }
    if (k !== 'file') return
    if (!explicit && name.startsWith('.')) return
    const text = await readOne(path)
    if (text !== null) files.push({ name: explicit ? name : join(...path.split('/').slice(-2)), text })
  }

  try {
    for (const p of paths) await walk(p, 0, true)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').slice(0, 200) : 'error' }
  }
  return { ok: true, files, notes }
}
