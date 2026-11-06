// Deterministic zip of the generated package (fflate zipSync). Pure, size-capped.
import { zipSync } from 'fflate'
import { MAX_OUTPUT_BYTES } from './api-contract.js'
import type { GeneratedFile } from './types.js'

export class BundleError extends Error {
  readonly code: string
  constructor(code: string) {
    super(code)
    this.name = 'BundleError'
    this.code = code
  }
}

const FIXED_MTIME = new Date(1980, 0, 1, 0, 0, 0)
const FOLDER = /^[A-Za-z0-9_-]{1,64}$/

export function validPath(p: string): boolean {
  if (typeof p !== 'string' || p === '' || p.length > 200) return false
  if (p.includes('\\') || p.includes('\0') || p.startsWith('/') || /^[A-Za-z]:/.test(p)) return false
  return p.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..')
}

export function toZip(files: GeneratedFile[], serverName = 'server'): Uint8Array {
  const folder = FOLDER.test(serverName) ? serverName : 'server'
  const enc = new TextEncoder()
  const entries: Record<string, [Uint8Array, { mtime: Date; level: 6 }]> = {}
  let total = 0
  for (const f of files.slice().sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    if (!validPath(f.path)) throw new BundleError('invalid-path')
    const data = enc.encode(f.content)
    total += data.length
    if (total > MAX_OUTPUT_BYTES) throw new BundleError('output-too-large')
    entries[`${folder}/${f.path}`] = [data, { mtime: FIXED_MTIME, level: 6 }]
  }
  return zipSync(entries)
}
