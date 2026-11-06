// BM25 accuracy over the labeled set (enforced), plus hybrid plumbing with the fake embedder.
// Paraphrase accuracy needs real embeddings: see accuracy.real.test.ts (skipped by default).
import { describe, it, expect } from 'vitest'
import { readdirSync } from 'node:fs'
import { buildBm25Index } from './bm25.js'
import { hybridSearch } from './hybrid.js'
import { tokenize } from './tokenize.js'
import { createFakeEmbedder } from './embedder.fake.js'
import { loadRealCorpus, loadScaleCorpus, type Corpus } from './fixtures/corpus.js'
import { labeledQueries, type LabeledQuery } from './fixtures/queries.js'
import { TOPICS } from '../../../../scripts/fixtures/generate-scale.js'

const HIT3_MIN = 0.8

const scaleCorpus = loadScaleCorpus()
const realCorpus = loadRealCorpus()

function isRelevant(q: LabeledQuery, corpus: Corpus, slug: string): boolean {
  if (q.expectedSlugs) return q.expectedSlugs.includes(slug)
  const topic = corpus.topicOf(slug)
  return topic !== undefined && (q.expectedTopics ?? []).includes(topic)
}

function metrics(qs: LabeledQuery[], corpus: Corpus, rank: (q: string) => string[]) {
  let h1 = 0
  let h3 = 0
  let rr = 0
  const failed: string[] = []
  for (const q of qs) {
    const slugs = rank(q.query)
    const first = slugs.findIndex((s) => isRelevant(q, corpus, s))
    if (first === 0) h1++
    if (first >= 0 && first < 3) h3++
    else failed.push(`${q.id} "${q.query}"`)
    if (first >= 0) rr += 1 / (first + 1)
  }
  const n = qs.length || 1
  return { hit1: h1 / n, hit3: h3 / n, mrr: rr / n, failed }
}

const fmt = (m: ReturnType<typeof metrics>) =>
  `hit@1=${m.hit1.toFixed(2)} hit@3=${m.hit3.toFixed(2)} MRR=${m.mrr.toFixed(2)}`

const byCorpus = (c: 'scale' | 'real') => labeledQueries.filter((q) => q.corpus === c)
const kindIn = (qs: LabeledQuery[], ...kinds: string[]) => qs.filter((q) => kinds.includes(q.kind))

describe('fixture sanity', () => {
  const scaleQs = byCorpus('scale')
  it('has enough labeled queries covering all topics', () => {
    expect(scaleQs.length).toBeGreaterThanOrEqual(20)
    expect(byCorpus('real').length).toBeGreaterThanOrEqual(6)
    for (const t of TOPICS) {
      expect(scaleQs.filter((q) => q.expectedTopics?.includes(t.id)).length).toBeGreaterThanOrEqual(2)
    }
    expect(kindIn(scaleQs, 'keyword').length).toBeGreaterThanOrEqual(8)
    expect(kindIn(scaleQs, 'nl').length).toBeGreaterThanOrEqual(6)
    expect(kindIn(scaleQs, 'paraphrase').length).toBeGreaterThanOrEqual(6)
  })

  it('scale corpus is 150 unique deterministic docs', () => {
    expect(scaleCorpus.docs).toHaveLength(150)
    expect(new Set(scaleCorpus.docs.map((d) => d.slug)).size).toBe(150)
    expect(loadScaleCorpus().docs.map((d) => d.slug)).toEqual(scaleCorpus.docs.map((d) => d.slug))
  })

  it('real corpus has all the catalog agents (count derived from data/agents)', () => {
    // Top-level agent YAMLs in data/agents; adding a catalog agent needs no edit here.
    const agentYamls = readdirSync('./data/agents').filter((f) => f.endsWith('.yaml')).length
    expect(realCorpus.docs).toHaveLength(agentYamls)
  })

  it('paraphrase queries share no vocabulary with topic keywords or tool names', () => {
    const vocab = new Set<string>()
    for (const t of TOPICS) {
      for (const w of [t.id, ...t.title.toLowerCase().split(/\s+/), ...t.keywords, ...t.tools.map((x) => x.name.replace(/_/g, ' '))]) {
        for (const tok of tokenize(w)) vocab.add(tok)
      }
    }
    for (const q of kindIn(scaleQs, 'paraphrase')) {
      const overlap = tokenize(q.query).filter((t) => vocab.has(t))
      expect(overlap, `${q.id} overlaps: ${overlap.join(',')}`).toEqual([])
    }
  })

  it('every expected slug exists in the real corpus', () => {
    const slugs = new Set(realCorpus.docs.map((d) => d.slug))
    for (const q of byCorpus('real')) for (const s of q.expectedSlugs ?? []) expect(slugs.has(s), s).toBe(true)
  })
})

describe('BM25 accuracy', () => {
  const scaleIndex = buildBm25Index(scaleCorpus.docs)
  const realIndex = buildBm25Index(realCorpus.docs)
  const rankScale = (q: string) => scaleIndex.search(q).map((r) => r.slug)
  const rankReal = (q: string) => realIndex.search(q).map((r) => r.slug)

  it('scale corpus keyword + nl hit@3 >= 0.8', () => {
    const m = metrics(kindIn(byCorpus('scale'), 'keyword', 'nl'), scaleCorpus, rankScale)
    console.log(`[bm25 scale keyword+nl] ${fmt(m)}`)
    for (const kind of ['keyword', 'nl']) {
      console.log(`[bm25 scale ${kind}] ${fmt(metrics(kindIn(byCorpus('scale'), kind), scaleCorpus, rankScale))}`)
    }
    expect(m.hit3, `failing: ${m.failed.join('; ')}`).toBeGreaterThanOrEqual(HIT3_MIN)
  })

  it('keyword queries surface exact matches in the top 3', () => {
    const textOf = new Map(scaleCorpus.docs.map((d) => [d.slug, `${d.title} ${d.tags.join(' ')} ${d.text}`.toLowerCase()]))
    for (const q of kindIn(byCorpus('scale'), 'keyword')) {
      const top = scaleIndex.search(q.query).slice(0, 3)
      expect(top.length, q.id).toBe(3)
      const words = q.query.toLowerCase().split(/\s+/)
      for (const r of top) {
        const text = textOf.get(r.slug)!
        for (const w of words) expect(text.includes(w), `${q.id}: ${r.slug} lacks "${w}"`).toBe(true)
      }
    }
  })

  it('real corpus keyword + nl hit@3 >= 0.8', () => {
    const m = metrics(kindIn(byCorpus('real'), 'keyword', 'nl'), realCorpus, rankReal)
    console.log(`[bm25 real keyword+nl] ${fmt(m)}`)
    expect(m.hit3, `failing: ${m.failed.join('; ')}`).toBeGreaterThanOrEqual(HIT3_MIN)
  })

  it('logs paraphrase BM25 accuracy for information only', () => {
    const s = metrics(kindIn(byCorpus('scale'), 'paraphrase'), scaleCorpus, rankScale)
    const r = metrics(kindIn(byCorpus('real'), 'paraphrase'), realCorpus, rankReal)
    console.log(`[bm25 paraphrase scale] ${fmt(s)}  [real] ${fmt(r)} (not asserted)`)
  })
})

describe('hybrid plumbing with the fake embedder', () => {
  async function setup(corpus: Corpus) {
    const embedder = createFakeEmbedder()
    const vecs = await embedder.embed(corpus.docs.map((d) => d.text))
    const vectors = new Map(corpus.docs.map((d, i) => [d.slug, vecs[i]]))
    return { embedder, vectors, bm25: buildBm25Index(corpus.docs) }
  }

  it('returns valid, unique, deterministic hybrid rankings', async () => {
    const { embedder, vectors, bm25 } = await setup(scaleCorpus)
    const valid = new Set(scaleCorpus.docs.map((d) => d.slug))
    for (const q of byCorpus('scale')) {
      const [qv] = await embedder.embed([q.query])
      const a = hybridSearch({ query: q.query, bm25, vectors, queryVector: qv })
      const b = hybridSearch({ query: q.query, bm25, vectors, queryVector: qv })
      expect(a.mode).toBe('hybrid')
      expect(a.results.map((r) => r.slug)).toEqual(b.results.map((r) => r.slug))
      const slugs = a.results.map((r) => r.slug)
      expect(new Set(slugs).size).toBe(slugs.length)
      for (const s of slugs) expect(valid.has(s)).toBe(true)
    }
  })

  it('keeps the BM25 top hit in the hybrid top 3 for keyword queries', async () => {
    const { embedder, vectors, bm25 } = await setup(scaleCorpus)
    for (const q of kindIn(byCorpus('scale'), 'keyword')) {
      const [qv] = await embedder.embed([q.query])
      const top = bm25.search(q.query)[0].slug
      const hybrid = hybridSearch({ query: q.query, bm25, vectors, queryVector: qv })
      expect(hybrid.results.slice(0, 3).map((r) => r.slug), q.id).toContain(top)
    }
  })

  it('falls back to the BM25 ranking without a query vector', async () => {
    const { vectors, bm25 } = await setup(scaleCorpus)
    const r = hybridSearch({ query: 'sprinkler', bm25, vectors, queryVector: null, limit: 1000 })
    expect(r.mode).toBe('bm25')
    expect(r.results.map((x) => x.slug)).toEqual(bm25.search('sprinkler').map((x) => x.slug))
  })
})
