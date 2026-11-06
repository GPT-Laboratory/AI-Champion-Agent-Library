// Server-only in-memory BM25 (Okapi) index. Pure, no I/O, no FTS5.
import { tokenize } from './tokenize.js'

export interface Bm25Doc {
  slug: string
  title: string
  tags: string[]
  text: string
}
export interface Scored {
  slug: string
  score: number
}
export interface Bm25Index {
  search(query: string, opts?: { prefixLast?: boolean }): Scored[]
}

const K1 = 1.2
const B = 0.75
const PREFIX_WEIGHT = 0.5

export function buildBm25Index(docs: Bm25Doc[]): Bm25Index {
  // term -> (docIndex -> tf)
  const postings = new Map<string, Map<number, number>>()
  const lengths: number[] = []
  const slugs: string[] = []

  docs.forEach((doc, i) => {
    const stream: string[] = [
      ...tokenize(doc.title),
      ...tokenize(doc.title),
      ...tokenize(doc.title),
      ...doc.tags.flatMap(t => tokenize(t)),
      ...doc.tags.flatMap(t => tokenize(t)),
      ...tokenize(doc.text),
    ]
    slugs.push(doc.slug)
    lengths.push(stream.length)
    for (const term of stream) {
      let p = postings.get(term)
      if (!p) postings.set(term, (p = new Map()))
      p.set(i, (p.get(i) ?? 0) + 1)
    }
  })

  const N = docs.length
  const avgdl = N === 0 ? 0 : lengths.reduce((a, b) => a + b, 0) / N
  const vocab = [...postings.keys()]

  function idf(df: number): number {
    return Math.log(1 + (N - df + 0.5) / (df + 0.5))
  }

  function addTerm(scores: Map<number, number>, term: string, weight: number): void {
    const p = postings.get(term)
    if (!p) return
    const w = idf(p.size) * weight
    for (const [di, tf] of p) {
      const norm = 1 - B + B * (avgdl === 0 ? 1 : lengths[di] / avgdl)
      const s = w * ((tf * (K1 + 1)) / (tf + K1 * norm))
      scores.set(di, (scores.get(di) ?? 0) + s)
    }
  }

  return {
    search(query, opts) {
      const prefixLast = opts?.prefixLast ?? true
      const tokens = [...new Set(tokenize(query))]
      if (N === 0 || tokens.length === 0) return []
      const scores = new Map<number, number>()
      for (const t of tokens) addTerm(scores, t, 1)

      if (prefixLast) {
        const all = tokenize(query)
        const last = all[all.length - 1]
        if (last && last.length >= 2) {
          for (const term of vocab) {
            if (term !== last && term.startsWith(last)) addTerm(scores, term, PREFIX_WEIGHT)
          }
        }
      }

      const out: Scored[] = []
      for (const [di, score] of scores) if (score > 0) out.push({ slug: slugs[di], score })
      out.sort((a, b) => b.score - a.score || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
      return out
    },
  }
}
