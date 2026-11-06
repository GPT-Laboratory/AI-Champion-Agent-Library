import { AGENT_KIND_VALUES, type AgentKind } from './spec/kinds.js'

export interface CatalogParamsInput {
  category?: string
  llm?: string
  maturity?: string
  q?: string | null
  kind?: string
}

/** Validate a `kind` query param against the allowed kinds (case-sensitive); null otherwise. */
export function parseKind(raw: string | null | undefined): AgentKind | null {
  if (typeof raw !== 'string') return null
  return (AGENT_KIND_VALUES as readonly string[]).includes(raw) ? (raw as AgentKind) : null
}

/** Build catalog query params; empty values are omitted and page always resets to 1. */
export function buildCatalogParams(input: CatalogParamsInput): URLSearchParams {
  const params = new URLSearchParams()
  if (input.category) params.set('category', input.category)
  if (input.llm) params.set('llm', input.llm)
  if (input.maturity) params.set('maturity', input.maturity)
  const q = (input.q ?? '').trim()
  if (q) params.set('q', q)
  if (input.kind) params.set('kind', input.kind)
  params.set('page', '1')
  return params
}

const MAX_PAGE = 1_000_000

/** Parse the `page` query param: NaN, non-numeric and < 1 become 1; huge values are capped so OFFSET stays a safe integer. */
export function parsePage(raw: string | null | undefined): number {
  const n = Number.parseInt(raw ?? '1', 10)
  if (!Number.isFinite(n) || n < 1) return 1
  return Math.min(n, MAX_PAGE)
}

const MAX_DISPLAY_QUERY = 200

/** Trim and cap a user query for display (by code point), adding an ellipsis when cut. */
export function truncateQuery(q: string, max: number = MAX_DISPLAY_QUERY): string {
  const t = q.trim()
  const chars = Array.from(t)
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : t
}
