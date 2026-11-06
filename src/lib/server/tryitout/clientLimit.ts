// src/lib/server/tryitout/clientLimit.ts
// Server-only. Sliding-window cap on how many NEW anonymous sessions one client may start
// (WR-07): with auth off a session costs nothing to mint, so without this a cookie-less client
// could fill the container cap with one request each.

export interface ClientLimiter {
  /** Records one admission for the client; false when the client is over its cap. */
  tryAdmit(clientKey: string): boolean
}

const MAX_TRACKED_CLIENTS = 10_000

export function createClientLimiter(opts: {
  max: number // 0 = unlimited
  windowMs: number
  now?: () => number
}): ClientLimiter {
  const now = opts.now ?? Date.now
  const hits = new Map<string, number[]>()
  return {
    tryAdmit(clientKey) {
      if (opts.max <= 0) return true
      const t = now()
      const recent = (hits.get(clientKey) ?? []).filter((x) => t - x < opts.windowMs)
      if (recent.length >= opts.max) {
        hits.set(clientKey, recent)
        return false
      }
      recent.push(t)
      // Re-insert so Map order tracks recency; drop the oldest client when the table is full.
      hits.delete(clientKey)
      hits.set(clientKey, recent)
      if (hits.size > MAX_TRACKED_CLIENTS) {
        const oldest = hits.keys().next().value
        if (oldest !== undefined) hits.delete(oldest)
      }
      return true
    },
  }
}
