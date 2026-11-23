// Client helper: the text files and spreadsheets of a succeeded job's artifact, and its tool check, for showing the
// result on the page next to the download
// (docs/tryitout-example.md, "The result of a run"). It reads the same route as downloadArtifact (src/lib/tryItOut.ts,
// frozen, unchanged) and unzips in the browser. Only small text files are decompressed: the zip and each entry are
// size-checked from the zip directory BEFORE inflating, so a large or hostile artifact is never expanded.
import { unzipSync } from 'fflate'
import type { CheckStatus, JobCheck } from './tryItOutCheck'

export interface ResultFile {
  name: string
  text: string
}

/** A spreadsheet of the artifact (e.g. ebom.xlsx written by the post-run check), offered as its own download. */
export interface SheetFile {
  name: string
  bytes: Uint8Array
}

export interface ResultBundle {
  texts: ResultFile[]
  sheets: SheetFile[]
}

/** Largest zip read for the inline view; bigger artifacts are download-only. */
export const MAX_INLINE_ZIP_BYTES = 1024 * 1024
/** Largest uncompressed total shown inline (the same cap as an upload). */
export const MAX_INLINE_TEXT_BYTES = 200 * 1024
export const TEXT_FILE = /\.(md|txt|csv|json)$/i
export const SHEET_FILE = /\.xlsx$/i

/** result.* first, then the rest by name (e.g. ebom-join-check.md after result.md). */
export function orderResultFiles(files: ResultFile[]): ResultFile[] {
  const rank = (n: string) => (/^result\.[a-z]+$/i.test(n) ? 0 : 1)
  return [...files].sort((a, b) => rank(a.name) - rank(b.name) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

/**
 * The text files and spreadsheets of a zip, or null when it is too big, not a zip, or holds neither. Text files share
 * the text cap; each spreadsheet may be up to the zip cap. Pure; exported for tests.
 */
export function filesOfZip(zip: Uint8Array): ResultBundle | null {
  if (zip.byteLength > MAX_INLINE_ZIP_BYTES) return null
  let budget = MAX_INLINE_TEXT_BYTES
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(zip, {
      filter: (f) => {
        if (SHEET_FILE.test(f.name)) return f.originalSize <= MAX_INLINE_ZIP_BYTES
        if (!TEXT_FILE.test(f.name) || f.originalSize > budget) return false
        budget -= f.originalSize
        return true
      },
    })
  } catch {
    return null // not a zip, or a corrupt one
  }
  const decoder = new TextDecoder('utf-8')
  const texts: ResultFile[] = []
  const sheets: SheetFile[] = []
  for (const [name, b] of Object.entries(entries)) {
    if (SHEET_FILE.test(name)) {
      if (b.byteLength <= MAX_INLINE_ZIP_BYTES) sheets.push({ name, bytes: b })
    } else if (b.byteLength <= MAX_INLINE_TEXT_BYTES) texts.push({ name, text: decoder.decode(b) })
  }
  if (!texts.length && !sheets.length) return null
  return { texts: orderResultFiles(texts), sheets: sheets.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) }
}

/** The text files of a zip, or null when there is none to show. Pure; exported for tests. */
export function textFilesOfZip(zip: Uint8Array): ResultFile[] | null {
  const r = filesOfZip(zip)
  return r && r.texts.length ? r.texts : null
}

/** Fetches the artifact of a succeeded job; its text files and spreadsheets, or null when they cannot be shown inline. */
export async function fetchResultFiles(jobId: string, fetchFn: typeof fetch = fetch): Promise<ResultBundle | null> {
  try {
    const res = await fetchFn(`/api/tryitout/jobs/${encodeURIComponent(jobId)}/artifact`)
    if (!res.ok) return null
    const declared = Number(res.headers.get('content-length') ?? '0')
    if (declared > MAX_INLINE_ZIP_BYTES) return null
    return filesOfZip(new Uint8Array(await res.arrayBuffer()))
  } catch {
    return null
  }
}

const STATUSES: readonly CheckStatus[] = ['match', 'differences', 'not-checked']

/**
 * The tool check of a succeeded job (GET /api/tryitout/jobs/:id/check, docs/tryitout-post-run-check.md); null when the
 * agent has no check or it cannot be read. The shape is checked, so a broken answer never reaches the badge.
 */
export async function fetchJobCheck(jobId: string, fetchFn: typeof fetch = fetch): Promise<JobCheck | null> {
  try {
    const res = await fetchFn(`/api/tryitout/jobs/${encodeURIComponent(jobId)}/check`)
    if (!res.ok) return null
    const body = (await res.json()) as { check?: unknown }
    const c = body?.check as Partial<JobCheck> | null | undefined
    if (!c || !STATUSES.includes(c.status as CheckStatus) || typeof c.summary !== 'string') return null
    return {
      status: c.status as CheckStatus,
      summary: c.summary.slice(0, 500),
      file: typeof c.file === 'string' ? c.file : null,
    }
  } catch {
    return null
  }
}

/** Saves bytes as a download in the browser. The name is reduced to safe characters. */
export function saveBytes(name: string, bytes: Uint8Array, type: string): void {
  const safe = name.replace(/^.*[\\/]/, '').replace(/[^A-Za-z0-9._-]/g, '_') || 'download'
  const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = safe
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
