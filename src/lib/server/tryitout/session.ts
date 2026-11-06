// src/lib/server/tryitout/session.ts
// Server-only module — SvelteKit enforces that src/lib/server/ cannot be imported client-side.
//
// One session identity shared by the page load (warm) and the job POST
// (claim): the signed-in user's email, else an httpOnly random cookie.
// The key is never logged and never written into container labels.

import { randomBytes } from 'node:crypto'
import { authCookieOptions } from '../auth'

export const TRYOUT_SESSION_COOKIE = 'aic_tryout_sid'

const VALID_SID = /^[A-Za-z0-9_-]{22}$/

interface SessionEvent {
  locals?: { user?: { email: string } | null }
  cookies?: {
    get(name: string): string | undefined
    set(name: string, value: string, opts: object): void
  }
  url?: URL
}

export function sessionKey(event: SessionEvent): string {
  const email = event.locals?.user?.email
  if (email) return `user:${email}`

  const cookies = event.cookies
  if (!cookies) return `anon:ephemeral-${randomBytes(8).toString('base64url')}`

  const existing = cookies.get(TRYOUT_SESSION_COOKIE)
  if (existing && VALID_SID.test(existing)) return `anon:${existing}`

  const sid = randomBytes(16).toString('base64url')
  const base = event.url ? authCookieOptions(event.url) : { path: '/', httpOnly: true, sameSite: 'lax' as const }
  cookies.set(TRYOUT_SESSION_COOKIE, sid, { ...base, maxAge: 60 * 60 * 24 })
  return `anon:${sid}`
}
