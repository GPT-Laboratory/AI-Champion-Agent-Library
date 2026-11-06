// Shared canned data for the McpTestPanel tests (not a test file itself).
import type { CaseInfo, SubjectInfo } from '$lib/mcptest/uiModel.js'

export const SUBJECTS: SubjectInfo[] = [
  { id: 'fake:good', kind: 'fake', label: 'Fake variant good (scorer fixture)', runnable: true, note: 'Reference' },
  { id: 'fake:mirror', kind: 'fake', label: 'Fake variant mirror (scorer fixture)', runnable: true },
  { id: 'generator:openapi', kind: 'generator', label: 'Generator subject openapi', runnable: true },
  { id: 'real:server', kind: 'submitted', label: 'Real server', runnable: false, note: 'Needs a real runtime; run from the command line.' }
]

export const CASES: CaseInfo[] = [
  { id: 'T1-STD-CATALOG', tier: 1, title: 'Synthetic catalog gate case', badge: 'implemented' },
  { id: 'T2-CATALOG-API', tier: 2, title: 'Catalog API behaviour pack', badge: 'implemented' },
  { id: 'T2-CATALOG-DUMP', tier: 2, title: 'Catalog dump', badge: 'needs real runtime' },
  { id: 'T3-COMPOSITE', tier: 3, title: 'Composite tools', badge: 'synthetic' },
  { id: 'T4-PARTIAL-SPEC', tier: 4, title: 'Partial spec', badge: 'generator-only' }
]

export const REPORT = {
  schema: 'mcptest-report/1',
  run: { id: 'r1', generatedAt: '2026-01-01T00:00:00Z', runtime: 'fake', runtimeLabel: 'fake', platformVersion: '1', reruns: 1 },
  summary: {
    gate: 'pass',
    score: { value: 100, basis: 'x', casesRun: 3, casesApplicable: 4 },
    flags: { blockers: 2, warnings: 1 },
    verdict: 'BLOCKED'
  },
  cases: [
    {
      caseId: 'T1-STD-CATALOG',
      tier: 1,
      state: 'PASS',
      checks: [{ id: 'lookup_by_id', status: 'PASS' }, { id: 'bad_input', status: 'NA' }],
      flags: [{ id: 'NO_RETRY', severity: 'warning', detail: 'No retry after a timeout' }]
    },
    {
      caseId: 'T2-CATALOG-API',
      tier: 2,
      state: 'FAIL',
      checks: [{ id: 'lookup_by_id', status: 'FAIL' }],
      flags: [
        { id: 'LEAK', severity: 'blocker', detail: 'Upstream detail leaked' },
        { id: 'SECRET_ECHO', severity: 'blocker', detail: 'Key echoed' }
      ]
    },
    { caseId: 'T2-CATALOG-DUMP', tier: 2, state: 'PENDING_HUMAN', checks: [], flags: [] },
    { caseId: 'T4-PARTIAL-SPEC', tier: 4, state: 'NA_MODALITY', checks: [], flags: [] }
  ]
}

export function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/** A fetch that answers the run API: POST 202, status sequence, then the report. */
export function apiFetch(opts: { statuses?: unknown[]; report?: unknown } = {}) {
  const statuses = [...(opts.statuses ?? [{ status: 'done', progress: { done: 12, total: 12, current: null }, events: [], error: null }])]
  const calls: { url: string; init?: RequestInit }[] = []
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    if (init?.method === 'POST') return jsonRes({ id: 'run-1', status: 'queued' }, 202)
    if (String(url).endsWith('/report')) return jsonRes(opts.report ?? REPORT)
    const next = statuses.length > 1 ? statuses.shift() : statuses[0]
    return jsonRes(next)
  }) as unknown as typeof fetch
  return { fn, calls }
}
