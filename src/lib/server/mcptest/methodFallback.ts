// Server-only. Answer for HTTP methods a route does not handle (WR-02). SvelteKit replies 405 with an Allow header
// to such methods before any handler runs, which would reveal that the route exists while MCP_TESTER is off.
// Each route exports `fallback`, so a flag-off deployment answers 404 for every method; with the flag on the
// answer is the usual 405.
import { error, json } from '@sveltejs/kit'
import { mcpTesterEnabled } from '$lib/flags.js'

export function methodNotAllowed(allow: string): Response {
  if (!mcpTesterEnabled()) error(404, 'Not found')
  return json({ ok: false, message: 'Method not allowed.' }, { status: 405, headers: { allow } })
}
