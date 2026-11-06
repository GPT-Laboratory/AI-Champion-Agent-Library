// src/routes/api/tryitout/jobs/[id]/artifact/+server.ts
// SvelteKit server route — GET /api/tryitout/jobs/:id/artifact (SC-06 download).
//
// `params.id` is untrusted input (T4-1) — validated by `isValidJobId` before
// any lookup or path helper runs. Serves the real generated file only when
// the job has actually succeeded (T4-5); an ENOENT on a succeeded-but-
// missing output file is converted to 404, never an unhandled 500.

import { error } from '@sveltejs/kit'
import { readFile } from 'node:fs/promises'
import type { RequestHandler } from './$types'
import { isValidJobId, getJob, artifactZipPath } from '$lib/server/tryItOutJobs'

export const GET: RequestHandler = async ({ params }) => {
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

  let buf: Buffer
  try {
    buf = await readFile(artifactZipPath(params.id))
  } catch {
    error(404, `artifact missing for job: ${params.id}`)
  }

  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/zip',
      // T4-6: the filename is built from a validated UUID only — no
      // user-controlled substring reaches this header.
      'Content-Disposition': `attachment; filename="aic-job-${params.id}.zip"`,
    },
  })
}
