// Client helper: the text files of a succeeded job's artifact, for showing the result on the page next to the download
// (docs/tryitout-example.md, "The result of a run"). It reads the same route as downloadArtifact (src/lib/tryItOut.ts,
// frozen, unchanged) and unzips in the browser. Only small text files are decompressed: the zip and each entry are
// size-checked from the zip directory BEFORE inflating, so a large or hostile artifact is never expanded.
import { unzipSync } from 'fflate'

export interface ResultFile {
  name: string
  text: string
}

/** Largest zip read for the inline view; bigger artifacts are download-only. */
export const MAX_INLINE_ZIP_BYTES = 1024 * 1024
/** Largest uncompressed total shown inline (the same cap as an upload). */
export const MAX_INLINE_TEXT_BYTES = 200 * 1024
export const TEXT_FILE = /\.(md|txt|csv|json)$/i

/** result.* first, then the rest by name (e.g. ebom-join-check.md after result.md). */
export function orderResultFiles(files: ResultFile[]): ResultFile[] {
  const rank = (n: string) => (/^result\.[a-z]+$/i.test(n) ? 0 : 1)
  return [...files].sort((a, b) => rank(a.name) - rank(b.name) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

/**
 * The text files of a zip, or null when it is too big, not a zip, or holds no text file small enough to show.
 * Pure; exported for tests.
 */
export function textFilesOfZip(zip: Uint8Array): ResultFile[] | null {
  if (zip.byteLength > MAX_INLINE_ZIP_BYTES) return null
  let budget = MAX_INLINE_TEXT_BYTES
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(zip, {
      filter: (f) => {
        if (!TEXT_FILE.test(f.name) || f.originalSize > budget) return false
        budget -= f.originalSize
        return true
      },
    })
  } catch {
    return null // not a zip, or a corrupt one
  }
  const decoder = new TextDecoder('utf-8')
  const files = Object.entries(entries)
    .filter(([, b]) => b.byteLength <= MAX_INLINE_TEXT_BYTES)
    .map(([name, b]) => ({ name, text: decoder.decode(b) }))
  return files.length ? orderResultFiles(files) : null
}

/** Fetches the artifact of a succeeded job and returns its text files; null when they cannot be shown inline. */
export async function fetchResultFiles(jobId: string, fetchFn: typeof fetch = fetch): Promise<ResultFile[] | null> {
  try {
    const res = await fetchFn(`/api/tryitout/jobs/${encodeURIComponent(jobId)}/artifact`)
    if (!res.ok) return null
    const declared = Number(res.headers.get('content-length') ?? '0')
    if (declared > MAX_INLINE_ZIP_BYTES) return null
    return textFilesOfZip(new Uint8Array(await res.arrayBuffer()))
  } catch {
    return null
  }
}
