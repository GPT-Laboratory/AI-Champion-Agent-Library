// Slug finalisation for submissions (Phase 13, CR-02). Pure; flag-gated callers only.
import { createHash } from 'node:crypto'
import { slugify } from './types.js'

export const SLUG_MAX = 80

/**
 * A non-empty URL-safe slug: the adapter's slug, else one derived from the title, else from the
 * submission folder hint, else a short hash of the title. Capped at SLUG_MAX characters.
 * `derived` is true when the adapter's own slug was empty.
 */
export function finalizeSlug(slug: string, title: string, hint?: string): { slug: string; derived: boolean } {
  let s = slugify(slug)
  let derived = false
  if (!s) {
    derived = true
    s = slugify(title)
  }
  if (!s && hint) s = slugify(hint)
  if (!s) s = `item-${createHash('sha256').update(title).digest('hex').slice(0, 8)}`
  if (s.length > SLUG_MAX) s = s.slice(0, SLUG_MAX).replace(/-+$/, '')
  return { slug: s, derived }
}
