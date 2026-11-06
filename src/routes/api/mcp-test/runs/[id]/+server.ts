// GET /api/mcp-test/runs/:id (Phase 15, flag MCP_TESTER). Status poll.
import { error, json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { mcpTesterEnabled } from '$lib/flags.js'
import { isValidRunId, runStore } from '$lib/server/mcptest/jobs.js'
import { methodNotAllowed } from '$lib/server/mcptest/methodFallback.js'

export const GET: RequestHandler = ({ params }) => {
  if (!mcpTesterEnabled()) error(404, 'Not found')
  if (!isValidRunId(params.id)) error(404, 'Not found')
  const run = runStore.getRun(params.id)
  if (!run) error(404, 'Not found')
  const { status, progress, events, error: err } = runStore.publicView(run)
  // Literal body: the record (session key, report) is never spread.
  return json({ status, progress: { done: progress.done, total: progress.total, current: progress.current }, events, error: err })
}

// WR-02: every other method is 404 with the flag off, 405 with it on.
export const fallback: RequestHandler = () => methodNotAllowed('GET')
