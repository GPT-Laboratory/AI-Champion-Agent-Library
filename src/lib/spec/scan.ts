// Directory scanner for submissions (Phase 13). The ONLY module here that touches fs.
// Reads text only: nothing is executed, imported or fetched. Symlinks are skipped.
import { lstatSync, readdirSync, readFileSync } from 'node:fs'
import { basename, join, relative, sep } from 'node:path'
import type { SubmissionFile } from './kinds.js'

export const SCAN_MAX_FILES = 200
export const SCAN_MAX_FILE_BYTES = 256 * 1024
export const SCAN_MAX_TOTAL_BYTES = 2 * 1024 * 1024
export const SCAN_MAX_DEPTH = 4

const SKIP_DIRS = new Set(['node_modules', '.git'])
const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.gz', '.tar', '.tgz',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.onnx', '.pt', '.safetensors', '.woff', '.woff2',
  '.mp3', '.mp4', '.wasm', '.pyc',
])

/** Well-known credential files and key material, matched case-insensitively (IN-04). */
const SECRET_NAMES = new Set([
  '.npmrc', '.netrc', '.pypirc', '.htpasswd', '.pgpass', '.git-credentials', '.dockercfg',
  'credentials', 'credentials.json', 'secrets.json', 'secrets.yaml', 'secrets.yml', 'service-account.json',
])
const SECRET_EXT = new Set(['.pem', '.key', '.p12', '.pfx', '.jks', '.keystore', '.ppk', '.kdbx'])

export function isSecretFileName(name: string): boolean {
  const n = name.toLowerCase()
  return (
    n.startsWith('.env') ||
    n.startsWith('id_rsa') ||
    n.startsWith('id_dsa') ||
    n.startsWith('id_ecdsa') ||
    n.startsWith('id_ed25519') ||
    SECRET_NAMES.has(n) ||
    SECRET_EXT.has(ext(n))
  )
}

function ext(name: string): string {
  const i = name.lastIndexOf('.')
  return i < 0 ? '' : name.slice(i).toLowerCase()
}

export interface ScanOptions {
  /** Directory names (case-insensitive, any depth) that are skipped and reported in `skipped`. Default: none beyond node_modules and .git. */
  skipDirNames?: readonly string[]
}

export function readSubmissionDir(dir: string, opts: ScanOptions = {}): { files: SubmissionFile[]; skipped: string[] } {
  const extraSkip = new Set((opts.skipDirNames ?? []).map((n) => n.toLowerCase()))
  const files: SubmissionFile[] = []
  const skipped: string[] = []
  let total = 0

  const addFile = (abs: string, rel: string): void => {
    const name = basename(abs)
    if (isSecretFileName(name) || BINARY_EXT.has(ext(name)) || files.length >= SCAN_MAX_FILES) {
      skipped.push(rel)
      return
    }
    try {
      const st = lstatSync(abs)
      if (!st.isFile() || st.size > SCAN_MAX_FILE_BYTES || total + st.size > SCAN_MAX_TOTAL_BYTES) {
        skipped.push(rel)
        return
      }
      const buf = readFileSync(abs)
      if (buf.includes(0)) {
        skipped.push(rel)
        return
      }
      total += buf.length
      files.push({ path: rel, text: buf.toString('utf8') })
    } catch {
      skipped.push(rel)
    }
  }

  const walk = (abs: string, depth: number): void => {
    let names: string[]
    try {
      names = readdirSync(abs).sort()
    } catch {
      skipped.push(relative(dir, abs).split(sep).join('/') || '.')
      return
    }
    for (const name of names) {
      const child = join(abs, name)
      const rel = relative(dir, child).split(sep).join('/')
      let st
      try {
        st = lstatSync(child)
      } catch {
        skipped.push(rel)
        continue
      }
      if (st.isSymbolicLink()) {
        skipped.push(rel)
      } else if (st.isDirectory()) {
        if (SKIP_DIRS.has(name) || extraSkip.has(name.toLowerCase()) || depth + 1 > SCAN_MAX_DEPTH) skipped.push(rel)
        else walk(child, depth + 1)
      } else if (st.isFile()) {
        addFile(child, rel)
      }
    }
  }

  try {
    const st = lstatSync(dir)
    if (st.isSymbolicLink()) skipped.push(basename(dir))
    else if (st.isFile()) addFile(dir, basename(dir))
    else if (st.isDirectory()) walk(dir, 0)
  } catch {
    skipped.push(basename(dir))
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return { files, skipped }
}
