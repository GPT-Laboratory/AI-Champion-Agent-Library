// POST /api/mcp-test/runs (Phase 15, flag MCP_TESTER, default off).
// Starts a run of a KNOWN subject (fake variant or generator sample) and returns 202 immediately; the run
// is never awaited here. No uploaded code, no cmd: subjects, nothing persisted, input never echoed.
import { error, json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { mcpTesterEnabled } from '$lib/flags.js'
import { MAX_BODY_BYTES, MAX_CASES, MAX_RERUNS } from '$lib/mcptest/api-contract.js'
import type { ApiError, StartRunRequest, StartRunResponse } from '$lib/mcptest/api-contract.js'
import { runStore } from '$lib/server/mcptest/jobs.js'
import { methodNotAllowed } from '$lib/server/mcptest/methodFallback.js'
import { admitStart, isAllowedSubject, isKnownCase, startRun } from '$lib/server/mcptest/service.js'
import { sessionKey } from '$lib/server/tryitout/session.js'

const fail = (status: number, message: string) => json({ ok: false, message } satisfies ApiError, { status })
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function validate(body: unknown): StartRunRequest | string {
  if (!isObj(body)) return 'Body must be a JSON object.'
  for (const k of Object.keys(body)) if (k !== 'subject' && k !== 'cases' && k !== 'reruns') return 'Unknown field.'
  if (!isAllowedSubject(body.subject)) return 'Unknown subject.'
  const out: StartRunRequest = { subject: body.subject }
  if (body.cases !== undefined) {
    if (!Array.isArray(body.cases) || body.cases.length === 0 || body.cases.length > MAX_CASES) return 'Invalid cases.'
    if (!body.cases.every(isKnownCase)) return 'Unknown case.'
    out.cases = [...new Set(body.cases as string[])]
  }
  if (body.reruns !== undefined) {
    if (typeof body.reruns !== 'number' || !Number.isInteger(body.reruns) || body.reruns < 1 || body.reruns > MAX_RERUNS) return 'Invalid reruns.'
    out.reruns = body.reruns
  }
  return out
}

export const POST: RequestHandler = async ({ request, locals, cookies, url, getClientAddress }) => {
  if (!mcpTesterEnabled()) error(404, 'Not found')

  const len = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(len) && len > MAX_BODY_BYTES) return fail(413, 'Request body is too large.')
  let text: string
  try {
    text = await request.text()
  } catch {
    return fail(400, 'Body must be JSON.')
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) return fail(413, 'Request body is too large.')
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return fail(400, 'Body must be JSON.')
  }
  const input = validate(body)
  if (typeof input === 'string') return fail(400, input)

  const key = sessionKey({ locals, cookies, url })
  // Single flight: one active run globally and one per session (checked and created synchronously).
  if (!runStore.tryAcquire(key)) return fail(429, 'A test run is already in progress. Try again when it finishes.')
  let clientKey: string | undefined
  try {
    clientKey = getClientAddress?.()
  } catch {
    clientKey = undefined
  }
  if (!admitStart(clientKey)) return fail(429, 'Too many test runs from this client, try again later.')

  const run = runStore.createRun(key, 0)
  startRun(run.id, input)
  return json({ id: run.id, status: 'queued' } satisfies StartRunResponse, { status: 202 })
}

// WR-02: every other method is 404 with the flag off, 405 with it on.
export const fallback: RequestHandler = () => methodNotAllowed('POST')
