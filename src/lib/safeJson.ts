/**
 * E6 (D-402): tolerant reader for the JSON-in-text columns (tags, tool_names, input_schema, ...).
 * One hand-edited or half-migrated row must not turn the whole catalog into a 500: anything that
 * is not valid JSON, or not a JSON array, reads as the fallback.
 */
export function parseJsonArray<T = unknown>(raw: string | null | undefined, fallback: T[] = []): T[] {
  if (typeof raw !== 'string') return fallback
  try {
    const v: unknown = JSON.parse(raw)
    return Array.isArray(v) ? (v as T[]) : fallback
  } catch {
    return fallback
  }
}

/** Array of strings only; non-string members are dropped (they would break `.join` / `{#each}` keys). */
export function parseJsonStringArray(raw: string | null | undefined): string[] {
  return parseJsonArray<unknown>(raw).filter((x): x is string => typeof x === 'string')
}
