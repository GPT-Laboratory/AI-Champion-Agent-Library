// src/lib/tryItOutSession.ts
// Client-safe `?job=` URL session helper (D-10). Persists a running/finished
// job's id in the browser URL so a refresh can restore it (SC-08) — NOT a
// cookie, and shareable by design.
//
// Transport-free by construction: no network call of any kind, no absolute
// URL literal. This module must never gain a network call — see
// src/lib/components/TryItOutPanel.test.ts's transport-discipline guard,
// which this helper must not force the panel to violate.

import { replaceState } from '$app/navigation'

// RFC-4122 UUID v1-v5 shape (case-insensitive). Anything else — script tags,
// path traversal, empty, overlong — is discarded (threat T5-1).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Reads the `job` query param and returns it only if it is a well-formed
 * RFC-4122 UUID. Returns `null` for a missing/empty/malformed value, and for
 * SSR (no `window`) without throwing.
 */
export function readJobIdFromUrl(): string | null {
  if (typeof window === 'undefined') return null
  const raw = new URLSearchParams(window.location.search).get('job')
  if (raw === null) return null
  return UUID_RE.test(raw) ? raw : null
}

/**
 * Sets the `job` query param to `jobId`, preserving every other existing
 * query param, without creating a browser history entry (the back button
 * must never walk through job ids). A no-op for an invalid `jobId`.
 *
 * Uses `$app/navigation`'s `replaceState` rather than the DOM History API's
 * equivalent method directly — SvelteKit owns routing/navigation state, and
 * bypassing it can desync the router (threat T5-4). When no SvelteKit
 * router is initialized (standalone render, jsdom unit tests), `replaceState`
 * throws; the try/catch below degrades that to a silent no-op so the panel
 * stays renderable outside a full app context.
 */
export function writeJobIdToUrl(jobId: string): void {
  if (typeof window === 'undefined') return
  if (!UUID_RE.test(jobId)) return

  const url = new URL(window.location.href)
  url.searchParams.set('job', jobId)

  try {
    replaceState(url, {})
  } catch {
    // No router available — degrade to a no-op (standalone render / jsdom).
  }
}

/**
 * Removes only the `job` query param, leaving every other param intact,
 * without creating a browser history entry. Same router-optional discipline
 * as `writeJobIdToUrl`.
 */
export function clearJobIdFromUrl(): void {
  if (typeof window === 'undefined') return

  const url = new URL(window.location.href)
  url.searchParams.delete('job')

  try {
    replaceState(url, {})
  } catch {
    // No router available — degrade to a no-op (standalone render / jsdom).
  }
}
