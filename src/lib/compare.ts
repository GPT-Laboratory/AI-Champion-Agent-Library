// DISC-02 (flag AGENT_COMPARE): pure helpers for the side-by-side comparison. No db access here;
// SvelteKit only allows load/actions from +page.server.ts, so everything shared lives in $lib.
import { agentCompareEnabled } from '$lib/compareFlag.js'
import { safeHttpUrl } from '$lib/safeUrl.js'

export const MAX_COMPARE = 3
/** Allow-list for a slug coming from the URL: conservative charset, bounded length. */
export const SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/

export interface ParsedCompare {
  /** Valid, de-duplicated slugs, at most MAX_COMPARE, in request order. */
  slugs: string[]
  /** Number of syntactically invalid entries that were dropped. */
  invalidCount: number
  /** True when more than MAX_COMPARE valid slugs were requested. */
  truncated: boolean
}

/** Parse every value of a query param; each may itself be comma-separated (`a,b` or `a=1&a=2`). */
export function parseCompareSlugs(values: (string | null | undefined)[]): ParsedCompare {
  const seen = new Set<string>()
  let invalidCount = 0
  let truncated = false
  const slugs: string[] = []
  for (const v of values) {
    if (typeof v !== 'string') continue
    for (const raw of v.split(',')) {
      const s = raw.trim()
      if (!s) continue
      if (!SLUG_PATTERN.test(s)) {
        invalidCount++
        continue
      }
      if (seen.has(s)) continue
      seen.add(s)
      if (slugs.length >= MAX_COMPARE) truncated = true
      else slugs.push(s)
    }
  }
  return { slugs, invalidCount, truncated }
}

/** Catalog loader extension: keys exist only when the flag is on, so flag-off data is unchanged. */
export function catalogCompareData(
  url: URL,
  env: Record<string, string | undefined> = process.env
): { compareEnabled?: true; compare?: string[] } {
  if (!agentCompareEnabled(env)) return {}
  return { compareEnabled: true, compare: parseCompareSlugs(url.searchParams.getAll('compare')).slugs }
}

/** Layout loader extension (nav link), same additive-key pattern. */
export function layoutCompareData(
  env: Record<string, string | undefined> = process.env
): { compareEnabled?: true } {
  return agentCompareEnabled(env) ? { compareEnabled: true } : {}
}

export interface CompareAgentInput {
  slug: string
  title: string
  summary: string
  category: string | null
  tags: string[]
  llmName: string
  llmTemperature: number | null
  toolNames: string[]
  inputFields: unknown
  requiresHumanApproval: boolean
  maturityStatus: string
  tryItOutMode: string
  githubUrl: string | null
  linkLabel?: string | null
  customizableFields: string[] | null
  kind?: string
  framework?: string | null
}

export interface CompareCell {
  text: string
  href?: string
}
export interface CompareRow {
  key: string
  label: string
  cells: CompareCell[]
  /** True when the cells are not all identical (rendered with a non-colour "Differs" marker). */
  differs: boolean
}

const MODE_LABELS: Record<string, string> = {
  none: 'Not available',
  external: 'External link',
  runnable: 'Runnable in the library',
}

function list(items: string[]): string {
  return items.length ? items.join(', ') : 'None'
}

function inputNames(fields: unknown): string[] {
  if (!Array.isArray(fields)) return []
  return fields.flatMap((f) => {
    if (f && typeof f === 'object') {
      const o = f as Record<string, unknown>
      const n = o.label ?? o.name
      return typeof n === 'string' && n ? [n] : []
    }
    return []
  })
}

/**
 * Build the comparison rows. Memory, invocation style and deployment are not part of the catalog
 * data model, so "Invocation" shows the declared input fields and the others are not invented (D-362).
 */
export function buildCompareRows(
  agents: CompareAgentInput[],
  opts: { kinds?: boolean } = {}
): CompareRow[] {
  const rows: { key: string; label: string; cells: CompareCell[] }[] = []
  const add = (key: string, label: string, f: (a: CompareAgentInput) => CompareCell | string) =>
    rows.push({
      key,
      label,
      cells: agents.map((a) => {
        const c = f(a)
        return typeof c === 'string' ? { text: c } : c
      }),
    })

  add('summary', 'Summary', (a) => a.summary || 'No summary')
  if (opts.kinds)
    add('kind', 'Kind', (a) =>
      a.kind && a.kind !== 'agent' ? (a.framework ? `${a.kind} (${a.framework})` : a.kind) : 'agent'
    )
  add('category', 'Category', (a) => a.category ?? 'Uncategorised')
  add('tags', 'Tags', (a) => list(a.tags))
  add('llm', 'LLM', (a) =>
    a.llmTemperature != null ? `${a.llmName} (temperature ${a.llmTemperature})` : a.llmName
  )
  add('tools', 'Tools', (a) => list(a.toolNames))
  add('invocation', 'Invocation (input fields)', (a) => list(inputNames(a.inputFields)))
  add('approval', 'Human approval', (a) => (a.requiresHumanApproval ? 'Required' : 'Not required'))
  add('maturity', 'Maturity', (a) => a.maturityStatus)
  add('tryitout', 'Try-it-out mode', (a) => MODE_LABELS[a.tryItOutMode] ?? a.tryItOutMode)
  add('github', 'GitHub', (a) => {
    const href = safeHttpUrl(a.githubUrl)
    return href ? { text: a.linkLabel || 'Source on GitHub', href } : { text: 'None' }
  })
  add('tailorable', 'Tailorable fields', (a) =>
    a.customizableFields === null ? 'All fields' : list(a.customizableFields)
  )
  return rows.map((r) => ({
    ...r,
    differs: new Set(r.cells.map((c) => `${c.text}\u0000${c.href ?? ''}`)).size > 1,
  }))
}
