import { randomBytes } from 'node:crypto'
import { json, redirect, type Handle, type HandleServerError, type ServerInit } from '@sveltejs/kit'
import { redactText } from '$lib/spec/security'
import { AUTH_COOKIE_NAME, authCookieOptions, getAuthService } from '$lib/server/auth'
import { isAuthenticationEnabled } from '$lib/server/auth-config'
import { resolveWithTheme } from '$lib/theme'
import { startTryItOutService } from '$lib/server/tryitout/service'
import { localMcpAgentsEnabled } from '$lib/flags'

const PUBLIC_ROUTES = new Set(['/login', '/health'])
// The LLM proxy authenticates with per-lease bearer tokens (D-17); containers carry no user cookie.
// The local MCP proxy (Phase 36, LOCAL_MCP_AGENTS) authenticates the same way; its prefix is public only while the flag is on.
const publicPrefixes = (): string[] => ['/api/llm/', ...(localMcpAgentsEnabled() ? ['/api/local-mcp/'] : [])]

// Runs once at server start (not at import): orphan sweep + idle reaper.
export const init: ServerInit = async () => {
  try {
    startTryItOutService()
  } catch (err) {
    console.warn('Try It Out service failed to start:', err instanceof Error ? err.message : err)
  }
  // Fire-and-forget: warm the embedding model in the background; never fatal.
  if (process.env.SEARCH_EMBEDDINGS !== 'off') {
    try {
      void import('$lib/server/search/index.js')
        .then((m) => m.warmUp())
        .catch((err) => console.warn('Search warm-up failed:', err instanceof Error ? err.message : err))
    } catch (err) {
      console.warn('Search warm-up failed:', err instanceof Error ? err.message : err)
    }
  }
}

// D-462: unexpected errors are logged server-side under a short reference id (details redacted with the
// shared inline-token redaction) and the visitor only gets { message: 'Internal Error', ref }.
// Handled errors (4xx, 404 for unmatched routes) keep SvelteKit's own message.
export const handleError: HandleServerError = ({ error, event, status, message }) => {
  if (status < 500) return { message }
  const ref = randomBytes(4).toString('hex')
  const detail = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : String(error)
  console.error(`[ref ${ref}] ${event.request.method} ${event.url.pathname} failed (${status}):`, redactText(detail))
  return { message: 'Internal Error', ref }
}

export const handle: Handle = async ({ event, resolve }) => {
  if (!isAuthenticationEnabled()) {
    event.locals.user = null
    if (event.url.pathname === '/login' && event.request.method === 'GET') {
      redirect(303, '/catalog')
    }
    return resolveWithTheme(event, resolve)
  }

  const token = event.cookies.get(AUTH_COOKIE_NAME)
  const session = token ? getAuthService().getSession(token) : null
  event.locals.user = session ? { email: session.email } : null
  if (token && session) {
    event.cookies.set(AUTH_COOKIE_NAME, token, authCookieOptions(event.url, session.expiresAt))
  }

  const pathname = event.url.pathname
  const isPublic =
    PUBLIC_ROUTES.has(pathname) ||
    publicPrefixes().some((p) => pathname.startsWith(p)) ||
    event.route.id === null
  if (!event.locals.user && !isPublic) {
    if (event.url.pathname.startsWith('/api/')) {
      return json({ message: 'Authentication required' }, { status: 401 })
    }
    const next = `${event.url.pathname}${event.url.search}`
    redirect(303, `/login?next=${encodeURIComponent(next)}`)
  }

  if (event.locals.user && event.url.pathname === '/login' && event.request.method === 'GET') {
    redirect(303, '/catalog')
  }

  return resolveWithTheme(event, resolve)
}
