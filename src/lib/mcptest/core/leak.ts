// Leak detector: port of the source harness rule. The core rule must not be changed (comparability);
// runtime extras are additive only.
export const LEAK_CORE = [
  'Traceback (most recent call last)',
  'httpx.',
  'all shards failed',
  'requests.exceptions',
  'ConnectionError',
  'JSONDecodeError'
]
export const RUNTIME_LEAK_EXTRA = ['ECONNREFUSED', 'undici', 'at Object.<anonymous>', 'node:internal']
export const ENVELOPE_WORDS = ['timestamp', 'status', 'error', 'path']

/** Returns the rule that fired ('substring:<s>' or 'envelope:<n>of4') or null. Extras are NOT included by default. */
export function leakReason(text: string, extra: string[] = []): string | null {
  const hit = [...LEAK_CORE, ...extra].find((s) => text.includes(s))
  if (hit) return `substring:${hit}`
  const lower = text.toLowerCase()
  const n = ENVELOPE_WORDS.filter((w) => lower.includes(w)).length
  return n >= 3 ? `envelope:${n}of4` : null
}

/** Boolean form using the core rule plus the per-runtime extras. */
export function looksLikeLeak(text: string, extra: string[] = RUNTIME_LEAK_EXTRA): boolean {
  return leakReason(text, extra) !== null
}
