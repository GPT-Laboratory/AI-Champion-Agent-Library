// src/lib/testing/fakeJobApi.ts
// Test-only `fetch` stub emulating the three real routes under
// src/routes/api/tryitout/jobs/** (SC-06/SC-07). Shared by
// src/lib/tryItOut.test.ts and src/lib/components/TryItOutPanel.test.ts so
// both exercise the same fake transport instead of duplicating fetch mocks.
//
// This file lives under src/lib/testing/, is imported by test files only,
// and its name does not end in `.test.ts` so vitest will not collect it as
// a suite.

import { vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { JobEvent, JobUpdate } from '$lib/tryItOut'

export interface RecordedRequest {
  method: string
  url: string
  fields?: Record<string, string>
  hasFile: boolean
}

export interface FakeJobApiOptions {
  /**
   * Explicit per-jobId scripted poll sequences. Each GET status poll for
   * that jobId consumes the next entry in order; the last entry repeats
   * once exhausted. Jobs with no entry here get the default scripted
   * timeline (see `defaultScript` below).
   */
  scripts?: Record<string, JobUpdate[]>
  /** Override the artifact text served for a given jobId (default embeds the submitted task + file name for parity with Phase 6 assertions). */
  artifactTextFor?: (jobId: string) => string
  /** Force this HTTP status for every artifact GET (>=400 to simulate failure; default 200). */
  artifactStatus?: number
  /** Force this HTTP status for the submit POST (>=400 to simulate failure; default 200). */
  submitStatus?: number
  /** Force this HTTP status for every status-poll GET (>=400 to simulate a non-404 poll failure). */
  statusPollStatus?: number
  /** Force every status-poll GET to 404 (unknown-job branch). */
  statusPollNotFound?: boolean
}

export interface InstalledFakeJobApi {
  uninstall(): void
  requests: RecordedRequest[]
}

// Exact contract regex from docs/job-api-contract.md, reused here only to
// let the fake stub decide success/fail per submitted task text — the same
// heuristic Phase 6's mock used, so existing "please fail now" / "summarize
// the csv" style task strings in tests keep working unchanged.
const FAIL_PATTERN = /(^|\W)fail(\W|$)/i

// A plausible real failure message (mirrors src/lib/server/tryItOutRunner.ts's
// own thrown message for an empty model response) — NOT the Phase 6 mock's
// container-exit-style string.
const FAILURE_ERROR = 'model returned no output text'

function nowTs(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

// Mirrors the real runner's exact pushEvent call sequence (07-03-SUMMARY.md
// frozen stage lines): 3 stage events + 1 terminal on success, 2 stage
// events + 1 terminal on failure — not Phase 6's mock tool_start/tool_end
// script.
function defaultScript(task: string, fileName: string | null): JobUpdate[] {
  const willFail = FAIL_PATTERN.test(task)
  const inputEvent: JobEvent = {
    ts: nowTs(),
    type: 'info',
    summary: fileName ? 'reading input…' : 'using task text as input…',
  }
  const callingEvent: JobEvent = { ts: nowTs(), type: 'info', summary: 'calling model…' }
  const writingEvent: JobEvent = { ts: nowTs(), type: 'info', summary: 'writing output…' }
  const settledEvent: JobEvent = { ts: nowTs(), type: 'info', summary: 'agent settled (clean exit)' }
  const failedEvent: JobEvent = { ts: nowTs(), type: 'info', summary: 'agent failed' }

  if (willFail) {
    return [
      { status: 'running', events: [], error: null },
      { status: 'running', events: [inputEvent], error: null },
      { status: 'running', events: [inputEvent, callingEvent], error: null },
      { status: 'running', events: [inputEvent, callingEvent], error: null },
      { status: 'failed', events: [inputEvent, callingEvent, failedEvent], error: FAILURE_ERROR },
    ]
  }

  return [
    { status: 'running', events: [], error: null },
    { status: 'running', events: [inputEvent], error: null },
    { status: 'running', events: [inputEvent, callingEvent], error: null },
    { status: 'running', events: [inputEvent, callingEvent, writingEvent], error: null },
    {
      status: 'succeeded',
      events: [inputEvent, callingEvent, writingEvent, settledEvent],
      error: null,
    },
  ]
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

export function installFakeJobApi(options: FakeJobApiOptions = {}): InstalledFakeJobApi {
  const requests: RecordedRequest[] = []
  const scripts = new Map<string, JobUpdate[]>()
  const pollIndex = new Map<string, number>()
  const jobMeta = new Map<string, { task: string; fileName: string | null }>()

  if (options.scripts) {
    for (const [jobId, script] of Object.entries(options.scripts)) {
      scripts.set(jobId, script)
      pollIndex.set(jobId, 0)
    }
  }

  const fakeFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = urlOf(input)
    const method = (init?.method ?? 'GET').toUpperCase()

    if (method === 'POST' && /\/api\/tryitout\/jobs$/.test(url)) {
      const form = init?.body as FormData
      const agentId = String(form.get('agentId') ?? '')
      const task = String(form.get('task') ?? '')
      const fileField = form.get('file')
      const fileName = fileField instanceof File ? fileField.name : null

      requests.push({ method, url, fields: { agentId, task }, hasFile: fileField instanceof File })

      if (options.submitStatus !== undefined && options.submitStatus >= 400) {
        return new Response('', { status: options.submitStatus })
      }

      // Real jobIds are crypto.randomUUID() (src/lib/server/tryItOutJobs.ts,
      // 07-03). The fake stub must match that shape — not an arbitrary
      // "fake-job-N" string — so that 07-05's ?job= session persistence
      // (which only accepts RFC-4122 UUIDs, threat T5-1) can be exercised
      // end to end against this stub.
      const jobId = randomUUID()
      jobMeta.set(jobId, { task, fileName })
      if (!scripts.has(jobId)) {
        scripts.set(jobId, defaultScript(task, fileName))
        pollIndex.set(jobId, 0)
      }

      return new Response(JSON.stringify({ jobId, status: 'queued' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Artifact route must be matched before the bare status route — both
    // share the `/api/tryitout/jobs/<id>` prefix.
    const artifactMatch = url.match(/\/api\/tryitout\/jobs\/([^/]+)\/artifact$/)
    if (method === 'GET' && artifactMatch) {
      const jobId = artifactMatch[1]
      requests.push({ method, url, hasFile: false })

      if (options.artifactStatus !== undefined && options.artifactStatus >= 400) {
        return new Response('', { status: options.artifactStatus })
      }

      const meta = jobMeta.get(jobId)
      const text = options.artifactTextFor
        ? options.artifactTextFor(jobId)
        : `fake artifact — task: ${meta?.task ?? ''}\nattached file: ${meta?.fileName ?? '(none)'}`

      return new Response(text, { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
    }

    const statusMatch = url.match(/\/api\/tryitout\/jobs\/([^/]+)$/)
    if (method === 'GET' && statusMatch) {
      const jobId = statusMatch[1]
      requests.push({ method, url, hasFile: false })

      if (options.statusPollNotFound) {
        return new Response('', { status: 404 })
      }
      if (options.statusPollStatus !== undefined && options.statusPollStatus >= 400) {
        return new Response('', { status: options.statusPollStatus })
      }

      const script = scripts.get(jobId)
      if (!script) {
        return new Response('', { status: 404 })
      }
      const idx = pollIndex.get(jobId) ?? 0
      const body = script[Math.min(idx, script.length - 1)]
      pollIndex.set(jobId, idx + 1)

      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    throw new Error(`fakeJobApi: unhandled fetch ${method} ${url}`)
  })

  vi.stubGlobal('fetch', fakeFetch)

  return {
    uninstall() {
      vi.unstubAllGlobals()
    },
    requests,
  }
}
