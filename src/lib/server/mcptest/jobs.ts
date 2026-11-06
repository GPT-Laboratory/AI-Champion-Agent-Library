// Server-only. In-memory run store for the MCP test API (flag MCP_TESTER). Nothing is persisted.
// Improvement over the Phase 8 job store: runs are evicted after a TTL and the store is size-capped.
import { randomUUID } from 'node:crypto'
import type { RunStatus, RunStatusResponse } from '$lib/mcptest/api-contract'
import { publicText } from '../tryitout/redact'

export const MAX_EVENTS = 200
export const MAX_EVENT_CHARS = 300
export const MAX_REPORT_JSON_BYTES = 1_000_000
export const DEFAULT_TTL_MS = 30 * 60 * 1000
export const DEFAULT_MAX_RUNS = 50

export interface RunRecord {
  id: string
  status: RunStatus
  progress: { done: number; total: number; current: string | null }
  events: { t: string; text: string }[]
  error: string | null
  report: string | null
  createdAt: number
  // Per-visitor session key; server side only, never part of publicView.
  sessionKey: string
}

const RUN_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isValidRunId(id: unknown): id is string {
  return typeof id === 'string' && RUN_ID_RE.test(id)
}

const cap = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s)
const active = (r: RunRecord) => r.status === 'queued' || r.status === 'running'

export interface RunStoreOptions {
  ttlMs?: number
  maxRuns?: number
  now?: () => number
}

export function createRunStore(opts: RunStoreOptions = {}) {
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS
  const maxRuns = opts.maxRuns ?? DEFAULT_MAX_RUNS
  const now = opts.now ?? Date.now
  const runs = new Map<string, RunRecord>()

  function evict(): void {
    const t = now()
    // WR-03: an active run is never evicted, by the TTL or by the cap. Evicting it would free the single-flight
    // slot while its work keeps running; the executor's own deadline ends a stuck run, and then the TTL applies.
    for (const [id, r] of runs) if (!active(r) && t - r.createdAt > ttlMs) runs.delete(id)
    if (runs.size > maxRuns) {
      // Map order is insertion order = oldest first; running runs are never evicted by the cap.
      for (const [id, r] of runs) {
        if (runs.size <= maxRuns) break
        if (!active(r)) runs.delete(id)
      }
    }
  }

  function activeCount(): number {
    evict()
    let n = 0
    for (const r of runs.values()) if (active(r)) n += 1
    return n
  }

  function activeFor(sessionKey: string): number {
    evict()
    let n = 0
    for (const r of runs.values()) if (active(r) && r.sessionKey === sessionKey) n += 1
    return n
  }

  return {
    createRun(sessionKey: string, total = 0): RunRecord {
      evict()
      const rec: RunRecord = {
        id: randomUUID(),
        status: 'queued',
        progress: { done: 0, total, current: null },
        events: [],
        error: null,
        report: null,
        createdAt: now(),
        sessionKey
      }
      runs.set(rec.id, rec)
      evict()
      return rec
    },
    getRun(id: unknown): RunRecord | null {
      if (!isValidRunId(id)) return null
      evict()
      return runs.get(id) ?? null
    },
    activeCount,
    activeFor,
    /** True when a new run may start: none active globally and none for this session. */
    tryAcquire(sessionKey: string): boolean {
      return activeCount() === 0 && activeFor(sessionKey) === 0
    },
    setStatus(id: string, status: RunStatus, error: string | null = null): void {
      const r = runs.get(id)
      if (!r) return
      r.status = status
      r.error = error === null ? null : cap(publicText(error), MAX_EVENT_CHARS)
    },
    setProgress(id: string, p: { done: number; total: number; current?: string | null }): void {
      const r = runs.get(id)
      if (!r) return
      r.progress = { done: p.done, total: p.total, current: p.current ? cap(publicText(p.current), 100) : null }
    },
    addEvent(id: string, text: string): void {
      const r = runs.get(id)
      if (!r) return
      r.events.push({ t: new Date(now()).toISOString(), text: cap(publicText(text), MAX_EVENT_CHARS) })
      if (r.events.length > MAX_EVENTS) r.events.splice(0, r.events.length - MAX_EVENTS)
    },
    /** Stores the report JSON and marks the run done; an oversize report fails the run instead. */
    setReport(id: string, json: string): void {
      const r = runs.get(id)
      if (!r) return
      if (Buffer.byteLength(json, 'utf8') > MAX_REPORT_JSON_BYTES) {
        r.status = 'failed'
        r.error = 'report exceeded the size cap'
        return
      }
      r.report = json
      r.status = 'done'
      r.error = null
    },
    publicView(r: RunRecord): RunStatusResponse {
      return {
        status: r.status,
        progress: { done: r.progress.done, total: r.progress.total, current: r.progress.current },
        events: r.events.map((e) => ({ t: e.t, text: e.text })),
        error: r.error
      }
    },
    reset(): void {
      runs.clear()
    }
  }
}

export type RunStore = ReturnType<typeof createRunStore>

// Module singleton shared by the routes and the service.
export const runStore: RunStore = createRunStore()
