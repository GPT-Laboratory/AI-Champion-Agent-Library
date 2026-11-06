// Golden isolation gate (port of the source leak guard): no golden expected string may appear in a
// fixture that a generator is allowed to see. One explicit minimum length is used for BOTH storage and
// comparison, so a string is either tracked everywhere or nowhere (no off-by-one between the two sides).
import type { GoldenCheck } from './cases'

/** Expected strings shorter than this are neither stored nor compared. */
export const GOLDEN_MIN_LEN = 8

function collectStrings(v: unknown, out: string[]): void {
  if (typeof v === 'string') out.push(v)
  else if (typeof v === 'number' && Number.isFinite(v)) out.push(String(v))
  else if (Array.isArray(v)) for (const x of v) collectStrings(x, out)
  else if (v && typeof v === 'object') for (const x of Object.values(v)) collectStrings(x, out)
}

/** Lower-cased, de-duplicated expected strings (field_value values) of length >= minLen. */
export function goldenFingerprints(golden: GoldenCheck[], minLen = GOLDEN_MIN_LEN): string[] {
  const raw: string[] = []
  for (const g of golden) collectStrings(g.expect?.field_value, raw)
  const set = new Set<string>()
  for (const s of raw) {
    const t = s.trim().toLowerCase()
    if (t.length >= minLen) set.add(t)
  }
  return [...set]
}

export function checkGoldenIsolation(
  files: { path: string; content: string }[],
  golden: GoldenCheck[],
  minLen = GOLDEN_MIN_LEN
): { ok: boolean; violations: { path: string; fingerprint: string }[] } {
  const prints = goldenFingerprints(golden, minLen)
  const violations: { path: string; fingerprint: string }[] = []
  for (const f of files) {
    const hay = f.content.toLowerCase()
    for (const p of prints) if (hay.includes(p)) violations.push({ path: f.path, fingerprint: p })
  }
  return { ok: violations.length === 0, violations }
}
