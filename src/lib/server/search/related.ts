// Server-only related-agents ranking. Pure: no db, embedder or I/O imports.
import { cosine, SIM_FLOOR } from './hybrid.js'

export interface RelatedInput {
  slug: string
  category: string | null
  tags: string[]
  toolNames: string[]
  llm?: string
  /** Flag-on only (AGENT_KINDS). */
  kind?: string
}

export interface RelatedAgent {
  slug: string
  score: number
  via: 'embedding' | 'fallback'
}

const CATEGORY_WEIGHT = 0.5
const TOOLS_WEIGHT = 0.1
const LLM_WEIGHT = 0.05
const KIND_WEIGHT = 0.1
/** Maximum possible fallback score (tags 1 + category + tools + llm); used to scale into cosine range. */
const FALLBACK_MAX = 1 + CATEGORY_WEIGHT + TOOLS_WEIGHT + LLM_WEIGHT

function jaccard(a: string[], b: string[]): number {
  const sa = new Set(a.map((x) => x.toLowerCase()))
  const sb = new Set(b.map((x) => x.toLowerCase()))
  if (sa.size === 0 && sb.size === 0) return 0
  let inter = 0
  for (const x of sa) if (sb.has(x)) inter++
  return inter / (sa.size + sb.size - inter)
}

/** Tag/category/tool/LLM overlap score in [0, 1.65] (+0.1 when both carry a kind). No embeddings needed. */
export function fallbackScore(a: RelatedInput, b: RelatedInput): number {
  let s = jaccard(a.tags, b.tags)
  if (a.category && b.category && a.category.toLowerCase() === b.category.toLowerCase()) s += CATEGORY_WEIGHT
  s += TOOLS_WEIGHT * jaccard(a.toolNames, b.toolNames)
  if (a.llm && b.llm && a.llm === b.llm) s += LLM_WEIGHT
  if (typeof a.kind === 'string' && typeof b.kind === 'string' && a.kind === b.kind) s += KIND_WEIGHT
  return s
}

/**
 * Up to k agents most related to `slug`, never itself, deterministic (score desc, slug asc).
 * Candidates with a vector (and a target vector) are scored by cosine and dropped below
 * SIM_FLOOR; candidates without one get the fallback score scaled by FALLBACK_MAX into the
 * cosine range and are ranked in the same list. With no target vector everything uses the fallback.
 */
export function relatedAgents(
  slug: string,
  agents: RelatedInput[],
  vectors?: Map<string, Float32Array>,
  k = 4,
): RelatedAgent[] {
  const target = agents.find((a) => a.slug === slug)
  if (!target || k <= 0) return []
  const tv = vectors?.get(slug)
  // The kind bonus only exists when kinds are present (flag on), so only then does it raise the ceiling;
  // flag-off inputs keep the exact pre-Phase-13 scaling and no clamp is needed (IN-01).
  const max = FALLBACK_MAX + (typeof target.kind === 'string' ? KIND_WEIGHT : 0)
  const out: RelatedAgent[] = []
  for (const c of agents) {
    if (c.slug === slug) continue
    const cv = vectors?.get(c.slug)
    if (tv && cv) {
      const score = cosine(tv, cv)
      if (score >= SIM_FLOOR) out.push({ slug: c.slug, score, via: 'embedding' })
    } else {
      const f = fallbackScore(target, c)
      if (f > 0) out.push({ slug: c.slug, score: tv ? f / max : f, via: 'fallback' })
    }
  }
  out.sort((x, y) => y.score - x.score || (x.slug < y.slug ? -1 : x.slug > y.slug ? 1 : 0))
  return out.slice(0, k)
}
