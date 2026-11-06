// src/routes/api/tryitout/jobs/+server.ts
// SvelteKit server route — POST /api/tryitout/jobs (SC-01/SC-02).
//
// Validates the multipart submission, writes an uploaded file's bytes (if
// any) to the job's fixed input path, then fires the real staged runner
// WITHOUT awaiting it — the HTTP response returns `queued` immediately, long
// before the model call completes (SC-01/SC-04 anti-pattern guard).

import { json, error } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { mkdir, writeFile } from 'node:fs/promises'
import { createJob, inputDir, inputFilePath } from '$lib/server/tryItOutJobs'
import { runJob } from '$lib/server/tryItOutRunner'
import { sessionKey } from '$lib/server/tryitout/session'
import { AgentIdSchema } from '$lib/server/tryItOutPrompts'
import { getTryItOutService } from '$lib/server/tryitout/service'
import { agentKindsEnabled } from '$lib/flags.js'

// Threat T4-3: hard cap enforced BEFORE createJob/mkdir/runJob — an
// unauthenticated public demo endpoint must not allow disk exhaustion or a
// runaway model bill via an oversized request.
const MAX_UPLOAD_BYTES = 200 * 1024

export const POST: RequestHandler = async ({ request, locals, cookies, url, getClientAddress }) => {
  // E6 (D-404): a non-multipart or malformed body is a client error, not an unhandled 500.
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    error(400, 'multipart form data required')
  }
  const agentId = form.get('agentId')
  const task = form.get('task')
  const rawFile = form.get('file')

  if (typeof agentId !== 'string' || agentId.length === 0) {
    error(400, 'agentId is required')
  }
  if (typeof task !== 'string' || task.length === 0) {
    error(400, 'task is required')
  }
  if (!AgentIdSchema.safeParse(agentId).success) {
    error(400, 'agentId is invalid')
  }

  // WR-09 (flag AGENT_KINDS): the backend, not only the UI, refuses to run a non-agent kind.
  if (agentKindsEnabled()) {
    const [{ isNonAgentKind }, { db }] = await Promise.all([import('$lib/server/kinds.js'), import('$lib/server/db.js')])
    if (isNonAgentKind(db as never, agentId)) error(403, 'Try It Out is not available for this kind of submission')
  }

  // RESEARCH.md Pitfall 3: a browser's empty file-input submission arrives
  // as a zero-byte, empty-named File, not as a missing field — treat that
  // exactly like "no file uploaded" (fall back to task text in the runner).
  const file = rawFile instanceof File && rawFile.size > 0 && rawFile.name !== '' ? rawFile : null

  if ((file !== null && file.size > MAX_UPLOAD_BYTES) || task.length > MAX_UPLOAD_BYTES) {
    error(413, 'upload too large')
  }

  const key = sessionKey({ locals, cookies, url })
  // WR-07: with auth off a session is free to mint; cap new anonymous sessions per client.
  let admitted = true
  try {
    let clientKey: string | undefined
    try {
      clientKey = getClientAddress?.()
    } catch {
      clientKey = undefined
    }
    admitted = getTryItOutService().admitSession(key, clientKey)
  } catch {
    // invalid runner config etc.: runJob records its own failure; do not block here
  }
  if (!admitted) error(429, 'too many new sessions from this client, try again later')

  const job = createJob(agentId, task, file, key)
  // Captured immediately after creation — createJob always sets 'queued'.
  // `runJob`, invoked below, flips the store's status to 'running'
  // synchronously (before its first `await`), so `job.status` read AFTER
  // firing `runJob` would already read back 'running'. Reading it now
  // guarantees SC-01's literal `{ status: 'queued' }` contract.
  const initialStatus = job.status

  if (file) {
    // Write to the job's fixed server-chosen path ONLY — never a path
    // derived from `file.name` (threat T4-2). `file.name` is read only in
    // the empty-file check above; it is never joined into a filesystem path.
    await mkdir(inputDir(job.jobId), { recursive: true })
    await writeFile(inputFilePath(job.jobId), Buffer.from(await file.arrayBuffer()))
  }

  // Fire-and-forget: do NOT await — `runJob` records its own `failed`
  // status + error message into the job store on any failure. Awaiting it
  // here would collapse the `queued`/`running` staging SC-04 requires.
  runJob(job.jobId).catch(() => {})

  return json({ jobId: job.jobId, status: initialStatus })
}
