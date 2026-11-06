// POST /api/mcp-generate (Phase 14, flag MCP_GENERATOR, default off).
// Nothing is persisted or logged: no file or database access and no logging. The input is never echoed.
import { error, json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { mcpGeneratorEnabled } from '$lib/flags.js'
import { MAX_INPUT_BYTES } from '$lib/mcpgen/api-contract.js'
import type { GenerateErrorResponse } from '$lib/mcpgen/api-contract.js'
import { toZip } from '$lib/mcpgen/bundle.js'
import { listAdapters } from '$lib/mcpgen/registry.js'
import { runPipelineAsync } from '$lib/mcpgen/pipeline.js'
import type { Gap, GenerateOptions } from '$lib/mcpgen/types.js'
import { generatorGate, generatorLimitConfig } from '$lib/mcpgen/limits.js'

const fail = (status: number, code: string, message: string) => {
  const body: GenerateErrorResponse = { ok: false, message, gaps: [{ code, message, severity: 'error' } as Gap] }
  return json(body, { status })
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const clampInt = (v: unknown, lo: number, hi: number): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.trunc(v))) : undefined

function sanitizeOptions(raw: unknown): GenerateOptions | null {
  if (raw === undefined) return {}
  if (!isObj(raw)) return null
  const o: GenerateOptions = {}
  if (typeof raw.serverName === 'string') o.serverName = raw.serverName.slice(0, 80)
  if (Array.isArray(raw.allowWrite)) {
    o.allowWrite = raw.allowWrite.filter((s): s is string => typeof s === 'string').slice(0, 50).map((s) => s.slice(0, 100))
  }
  if (isObj(raw.limits)) {
    const limits: NonNullable<GenerateOptions['limits']> = {}
    const mps = clampInt(raw.limits.maxPageSize, 1, 10_000)
    const rc = clampInt(raw.limits.resultCeiling, 1, 1_000_000)
    const mri = clampInt(raw.limits.maxResponseItems, 1, 10_000)
    if (mps !== undefined) limits.maxPageSize = mps
    if (rc !== undefined) limits.resultCeiling = rc
    if (mri !== undefined) limits.maxResponseItems = mri
    o.limits = limits
  }
  return o
}

/**
 * Reads and validates the request, then takes the admission slot just before the pipeline runs and releases it in
 * `finally`. The slot is not held while the body is read (CR-50): a client that trickles its body must not occupy
 * the few concurrency slots. `admit` returns a response (429) or a release function.
 */
async function generate(request: Request, admit: () => Response | (() => void)): Promise<Response> {
  const len = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(len) && len > MAX_INPUT_BYTES * 2) {
    return fail(413, 'input-too-large', `Request exceeds the ${MAX_INPUT_BYTES} byte input limit.`)
  }
  let body: unknown
  try {
    const text = await request.text()
    if (Buffer.byteLength(text, 'utf8') > MAX_INPUT_BYTES * 2) {
      return fail(413, 'input-too-large', `Request exceeds the ${MAX_INPUT_BYTES} byte input limit.`)
    }
    body = JSON.parse(text)
  } catch {
    return fail(400, 'bad-request', 'Body must be JSON.')
  }
  if (!isObj(body) || typeof body.input !== 'string') {
    return fail(400, 'bad-request', 'Field "input" must be a string.')
  }
  if (Buffer.byteLength(body.input, 'utf8') > MAX_INPUT_BYTES) {
    return fail(413, 'input-too-large', `Input exceeds the ${MAX_INPUT_BYTES} byte limit.`)
  }
  let adapterId: string | undefined
  if (body.adapter !== undefined && body.adapter !== 'auto') {
    if (typeof body.adapter !== 'string' || !listAdapters().some((a) => a.id === body.adapter)) {
      return fail(400, 'bad-request', 'Unknown adapter.')
    }
    adapterId = body.adapter
  }
  const options = sanitizeOptions(body.options)
  if (options === null) return fail(400, 'bad-request', 'Field "options" must be an object.')

  const admitted = admit()
  if (typeof admitted !== 'function') return admitted
  let result: Awaited<ReturnType<typeof runPipelineAsync>>
  try {
    result = await runPipelineAsync(body.input, { adapterId, options })
  } finally {
    admitted()
  }
  if (!result.ok) return json({ ok: false, message: result.gaps[0]?.message ?? 'The input could not be converted.', gaps: result.gaps } satisfies GenerateErrorResponse, { status: 422 })

  let zip: Uint8Array
  try {
    zip = toZip(result.files, result.serverName)
  } catch {
    return fail(422, 'output-too-large', 'The generated package could not be bundled.')
  }
  const safe = /^[A-Za-z0-9_-]{1,64}$/.test(result.serverName) ? result.serverName : 'server'
  return new Response(zip as BodyInit, {
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${safe}-mcp.zip"`,
      'cache-control': 'no-store',
      'x-mcp-gaps': String(result.report.gaps.length),
    },
  })
}

// D-465: flag-off stays a 404 first; then a global concurrency cap and a per-client rate limit (429 { message },
// env-configurable, see docs/mcp-generator.md). The in-memory gate keeps no input.
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
  if (!mcpGeneratorEnabled()) error(404, 'Not found')

  let clientKey: string | undefined
  try {
    clientKey = getClientAddress?.()
  } catch {
    clientKey = undefined
  }
  const admit = (): Response | (() => void) => {
    const admission = generatorGate().admit(clientKey)
    if (admission.ok) return () => admission.release()
    const message = admission.reason === 'busy' ? 'The generator is busy. Try again in a moment.' : 'Too many generation requests from this client, try again later.'
    return json({ message }, { status: 429, headers: { 'retry-after': admission.reason === 'busy' ? '5' : String(Math.max(1, Math.ceil(generatorLimitConfig().windowMs / 1000))) } })
  }
  return await generate(request, admit)
}
