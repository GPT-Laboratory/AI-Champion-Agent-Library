// src/routes/api/tryitout/jobs/[id]/+server.ts
// SvelteKit server route — GET /api/tryitout/jobs/:id (SC-06 status poll).
//
// `params.id` is untrusted input flowing toward a filesystem path helper via
// `getJob`'s internal `Map` lookup (T4-1) — validated by `isValidJobId`
// before any lookup, returning 404 for anything malformed or unknown.

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

  // Constructed literally — never spread the record, which would leak
  // `agentId`/`task`/`fileName` to the client.
  return json({ status: job.status, events: job.events, error: job.error })
}
