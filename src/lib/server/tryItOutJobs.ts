// src/lib/server/tryItOutJobs.ts
// Server-only module — SvelteKit enforces that src/lib/server/ cannot be imported client-side.
//
// In-memory job store singleton (module-level `Map`) and every filesystem
// path helper for the "Try It Out" demo backend. Because ESM modules are
// cached by resolved path, every importer of this file shares the exact
// same `jobs` Map instance — no extra singleton machinery needed.
//
// Accepted tradeoff (threat T3-7, RESEARCH.md Pitfall 2): the Map is never
// evicted and is not persisted anywhere. A process restart (or, in dev,
// a Vite HMR reload of this module) loses all job state. This is fine for
// a single-process demo — it is explicitly not a production job queue.

import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { JobStatus, JobEvent } from '$lib/tryItOut'

// RESEARCH.md Pitfall 4: process.cwd() resolves against the launch
// directory, not the location of this file — `node build` must be started
// from the project root for this path to land where expected.
const WORK_ROOT = process.env.TRYITOUT_WORK_DIR ?? join(process.cwd(), '.tryitout-work')

export interface JobRecord {
  jobId: string
  agentId: string
  task: string
  fileName: string | null
  status: JobStatus
  events: JobEvent[]
  error: string | null
  createdAt: number
  // Per-visitor session key (e.g. 'anon:abc'); server-side only, never returned by GET status.
  sessionKey: string | null
}

// Module-level singleton — every importer of this file gets this same Map
// instance (ESM module cache). No eviction, no persistence (T3-7).
const jobs = new Map<string, JobRecord>()

// RFC-4122 UUID shape, case-insensitive. This is the traversal guard for
// T3-3: every path helper below calls this first and throws on a miss, so
// a malicious/malformed jobId can never reach `join()`.
const JOB_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isValidJobId(id: unknown): id is string {
  return typeof id === 'string' && JOB_ID_RE.test(id)
}

function assertValidJobId(id: unknown): asserts id is string {
  if (!isValidJobId(id)) {
    throw new Error(`invalid jobId: ${id}`)
  }
}

export function workDir(jobId: string): string {
  assertValidJobId(jobId)
  return join(WORK_ROOT, jobId)
}

export function inputDir(jobId: string): string {
  assertValidJobId(jobId)
  return join(workDir(jobId), 'input')
}

export function outputDir(jobId: string): string {
  assertValidJobId(jobId)
  return join(workDir(jobId), 'output')
}

// FIXED server-chosen filename (threat T3-1) — the client's uploaded
// `File.name` must NEVER become a path component. `JobRecord.fileName`
// retains the original name for display/logging only.
export function inputFilePath(jobId: string): string {
  assertValidJobId(jobId)
  return join(inputDir(jobId), 'input.txt')
}

export function outputFilePath(jobId: string): string {
  assertValidJobId(jobId)
  return join(outputDir(jobId), 'result.txt')
}

export function artifactZipPath(jobId: string): string {
  assertValidJobId(jobId)
  return join(workDir(jobId), 'artifact.zip')
}

export function createJob(
  agentId: string,
  task: string,
  file: File | null,
  sessionKey: string | null = null,
): JobRecord {
  const jobId = randomUUID() // RESEARCH.md "Don't Hand-Roll" — never a hand-rolled random id
  const record: JobRecord = {
    jobId,
    agentId,
    task,
    fileName: file?.name ?? null, // display/logging only — never passed to join()
    status: 'queued',
    events: [],
    error: null,
    createdAt: Date.now(),
    sessionKey,
  }
  jobs.set(jobId, record)
  return record
}

export function getJob(jobId: string): JobRecord | undefined {
  return jobs.get(jobId)
}

export function pushEvent(
  jobId: string,
  summary: string,
  type: JobEvent['type'] = 'info',
  tool?: string,
): void {
  const job = jobs.get(jobId)
  if (!job) return // silent no-op on unknown jobId
  // Phase 8 D-12: container runs may emit tool_start/tool_end; the direct-LLM
  // path keeps emitting plain `info` events.
  const ev: JobEvent = { ts: nowTs(), type, summary }
  if (tool !== undefined) ev.tool = tool
  job.events.push(ev)
}

export function setStatus(jobId: string, status: JobStatus, error: string | null = null): void {
  const job = jobs.get(jobId)
  if (!job) return // silent no-op on unknown jobId
  job.status = status
  job.error = error
}

// Test-only helper — clears the singleton Map between test cases. Not for
// production use.
export function __resetJobs(): void {
  jobs.clear()
}

// "10:46:48" — built from Date parts only, with zero locale/ICU dependency.
// Duplicated verbatim from src/lib/tryItOut.ts (lines 79-84): a client
// module must never be pulled into server-only code, and vice versa.
function nowTs(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
