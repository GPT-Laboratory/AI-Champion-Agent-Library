// Dependency-free URL guard shared by server code (spec registry, adapters) and Svelte pages.
// Only http(s) URLs may reach an href: `javascript:`, `data:` and friends are dropped (CR-03).

/** The trimmed URL when it parses and uses http or https, otherwise null. */
export function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const s = value.trim()
  if (!s) return null
  try {
    const u = new URL(s)
    return u.protocol === 'http:' || u.protocol === 'https:' ? s : null
  } catch {
    return null
  }
}
