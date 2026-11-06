// src/routes/api/tryitout/jobs/[id]/usage/+server.ts
// Diagnostic route — GET /api/tryitout/jobs/:id/usage.
// Off by default: returns 404 unless TRYITOUT_USAGE_ENDPOINT=1. Exposes token counts only
// (never prompt or completion text) so a run harness can log real spend.

import { json, error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { isValidJobId } from '$lib/server/tryItOutJobs'
import { getJobUsage } from '$lib/server/tryitout/llmProxy'
import { MODEL } from '$lib/server/tryItOutModel'

export const GET: RequestHandler = ({ params }) => {
  if (process.env.TRYITOUT_USAGE_ENDPOINT !== '1') {
    error(404, 'not found')
  }
  if (!isValidJobId(params.id)) {
    error(404, `unknown job: ${params.id}`)
  }
  const usage = getJobUsage(params.id)
  if (!usage) {
    error(404, `no usage recorded for job: ${params.id}`)
  }
  return json({
    model: MODEL,
    totalTokens: usage.totalTokens,
    requests: usage.requests,
    budgetExceeded: usage.budgetExceeded,
  })
}
