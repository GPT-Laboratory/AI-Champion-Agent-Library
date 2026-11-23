// src/routes/api/tryitout/jobs/[id]/check/+server.ts
// SvelteKit server route — GET /api/tryitout/jobs/:id/check: the tool check of a succeeded job
// (docs/tryitout-post-run-check.md), for the "Checked by tool" badge. `{ check: null }` when the agent has no check.
// Same guards as the artifact route: the id is validated before any lookup (T4-1), and only a succeeded job answers.

import { json, error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { isValidJobId, getJob } from '$lib/server/tryItOutJobs'

export const GET: RequestHandler = ({ params }) => {
  if (!isValidJobId(params.id)) {
    error(404, `unknown job: ${params.id}`)
  }
  const job = getJob(params.id)
  if (!job) {
    error(404, `unknown job: ${params.id}`)
  }
  if (job.status !== 'succeeded') {
    error(409, `job ${params.id} is not succeeded (status: ${job.status})`)
  }
  // Constructed literally: only the three check fields leave the server.
  const c = job.check
  return json({ check: c ? { status: c.status, summary: c.summary, file: c.file } : null })
}
