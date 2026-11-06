// Server-only ranking core: cosine, weighted reciprocal rank fusion, hybrid combiner.
// Pure: the query vector is an argument; no embedder, db or I/O imports.
import type { Bm25Index, Scored } from './bm25.js'
import { tokenize } from './tokenize.js'

export const RRF_K = 60
// Untuned starting value; retune against the real-model accuracy run and record it.
export const SIM_FLOOR = 0.25

/** Dot product. Vectors must be L2-normalised. Returns 0 on length mismatch. */
export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

function bySlug(a: Scored, b: Scored): number {
  return b.score - a.score || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0)
}

export function rrf(rankings: { weight: number; slugs: string[] }[], k: number = RRF_K): Scored[] {
  const scores = new Map<string, number>()
  for (const r of rankings) {
    r.slugs.forEach((slug, i) => {
      scores.set(slug, (scores.get(slug) ?? 0) + r.weight / (k + i + 1))
    })
  }
  return [...scores].map(([slug, score]) => ({ slug, score })).sort(bySlug)
}

export function hybridSearch(args: {
  query: string
  bm25: Bm25Index
  vectors: Map<string, Float32Array>
  queryVector: Float32Array | null
  simFloor?: number
  limit?: number
}): { results: Scored[]; mode: 'hybrid' | 'bm25' } {
  const limit = args.limit ?? 50
  const bm25Results = args.bm25.search(args.query)

  if (!args.queryVector) {
    return { results: bm25Results.slice(0, limit), mode: 'bm25' }
  }

  const floor = args.simFloor ?? SIM_FLOOR
  const qv = args.queryVector
  const semantic: Scored[] = []
  for (const [slug, v] of args.vectors) {
    const score = cosine(qv, v)
    if (score >= floor) semantic.push({ slug, score })
  }
  semantic.sort(bySlug)

  const short = tokenize(args.query).length <= 2
  const fused = rrf([
    { weight: 1.0, slugs: bm25Results.map(r => r.slug) },
    { weight: short ? 0.5 : 1.0, slugs: semantic.map(r => r.slug) },
  ])
  return { results: fused.slice(0, limit), mode: 'hybrid' }
}
