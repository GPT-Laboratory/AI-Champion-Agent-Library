// GenerationReport: what was emitted, what was dropped and why, what was assumed (design doc 7, 9).
import { cmp, formatGaps } from './diagnostics.js'
import { DROP_CODES, OAUTH2_PURPOSE, pageSizeKnown, resolveEnv, toolKind } from './plan.js'
import type { Gap, GenerationReport, ServerPlan } from './types.js'

export function buildReport(plan: ServerPlan): GenerationReport {
  const m = plan.model
  const env = resolveEnv(m)
  const toolsDropped = plan.gaps
    .filter((g) => DROP_CODES.includes(g.code))
    .map((g) => ({ id: g.path ?? g.code, reason: g.message }))
    .sort((a, b) => cmp(a.id, b.id) || cmp(a.reason, b.reason))

  const envVars: { name: string; purpose: string }[] = []
  if (env.baseUrl) envVars.push({ name: env.baseUrl, purpose: 'Base address of the upstream service' })
  if (env.auth) envVars.push({ name: env.auth, purpose: plan.model.auth.oauth2 ? OAUTH2_PURPOSE : 'API key for the upstream service (value never stored in the package)' })
  if (env.dataFile) envVars.push({ name: env.dataFile, purpose: 'Location of the CSV data file' })
  if (env.dsn) envVars.push({ name: env.dsn, purpose: 'Location of the SQLite database file (opened read-only)' })

  const assumptions: string[] = [
    'FastMCP is pinned as fastmcp>=3.4,<5 (verified on 3.4.8 and 4.1.0 on 2026-10-14).',
    'Tools are registered with mcp.tool(function) and called directly in the generated tests. UNVERIFIED against the pinned FastMCP version.',
    'The generated Python was syntax-checked at most; it was never executed or installed by the generator.',
  ]
  const kinds = plan.tools.map((t) => toolKind(plan, t))
  if (m.backend.kind === 'http') {
    assumptions.push('Upstream list responses are read as a JSON array or as an object holding one array (items, results, data, content, records, rows, entries or values).')
    if (kinds.includes('list') || kinds.includes('search') || kinds.includes('filter')) {
      assumptions.push('Page numbers start at 1 and are sent unchanged in the declared page parameter. UNVERIFIED for this source.')
      if (plan.tools.some((t) => m.operations.find((o) => o.id === t.operation)?.offsetParam)) {
        assumptions.push('Offset paging: offsets start at 0 and are sent unchanged in the declared offset parameter. UNVERIFIED for this source.')
      }
      const unknown = plan.tools.some((t) => {
        const op = m.operations.find((o) => o.id === t.operation)
        return op?.pageSizeParam && !pageSizeKnown(m, op)
      })
      if (unknown) assumptions.push('No documented page size maximum was found for some operations; 100 was assumed.')
    }
    assumptions.push('Retries: at most 2, with 0.5 s then 1 s backoff, on 429, 5xx and network failures. Requests time out after 10 s.')
  }
  if (m.backend.kind === 'dataset') {
    const delimiter = m.backend.delimiter === '\t' ? 'a tab' : m.backend.delimiter === ';' ? 'a semicolon' : 'a comma'
    assumptions.push(`Dataset backend reads one UTF-8 delimited text file with a header row (the delimiter is ${delimiter}) using the Python standard library only (no pandas or spreadsheet libraries).`)
  }
  if (m.backend.kind === 'sql') assumptions.push('SQL backend supports SQLite files only (Python standard library, read-only connection). Other database systems are out of scope.')
  if (m.backend.kind !== 'http' && m.limits.maxPageSize === undefined) assumptions.push('No page size maximum was supplied; 100 rows per call was assumed.')
  if (m.limits.resultCeiling === undefined) assumptions.push('No result ceiling was supplied, so no ceiling warning is emitted.')

  const gaps: Gap[] = plan.gaps
  return {
    toolsEmitted: plan.tools.map((t) => t.name).sort(),
    toolsDropped,
    gaps,
    assumptions,
    envVars: envVars.sort((a, b) => cmp(a.name, b.name)),
    ...(plan.proposals ? { proposals: plan.proposals } : {}),
  }
}

export function formatReport(report: GenerationReport): string {
  const out: string[] = ['Tools emitted:', ...report.toolsEmitted.map((t) => `  - ${t}`)]
  out.push('', 'Dropped or skipped:')
  out.push(...(report.toolsDropped.length ? report.toolsDropped.map((d) => `  - ${d.id}: ${d.reason}`) : ['  (none)']))
  out.push('', 'Environment variables:')
  out.push(...(report.envVars.length ? report.envVars.map((e) => `  - ${e.name}: ${e.purpose}`) : ['  (none)']))
  out.push('', 'Assumptions:', ...report.assumptions.map((a) => `  - ${a}`))
  out.push('', 'Gaps:', report.gaps.length ? formatGaps(report.gaps) : '(none)')
  return out.join('\n') + '\n'
}
