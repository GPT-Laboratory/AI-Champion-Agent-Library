// GET /api/mcp-test/runs/:id/report (Phase 15, flag MCP_TESTER). Downloads report.json once the run is done.
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
  if (run.status === 'queued' || run.status === 'running') {
    return json({ ok: false, message: 'The run has not finished yet.' }, { status: 409 })
  }
  if (run.status === 'failed' || run.report === null) {
    return json({ ok: false, message: 'The run failed and has no report.' }, { status: 404 })
  }
  return new Response(run.report, {
    headers: {
      'content-type': 'application/json',
      'content-disposition': 'attachment; filename="mcptest-report.json"',
      'cache-control': 'no-store'
    }
  })
}

// WR-02: every other method is 404 with the flag off, 405 with it on.
export const fallback: RequestHandler = () => methodNotAllowed('GET')
