// Real-model hybrid accuracy. SKIPPED unless SEARCH_REAL_EMBEDDINGS=1 (downloads ~90 MB on first run).
// This is the ONLY test that calls createTransformersEmbedder(); never import it from other tests.
import { describe, it, expect } from 'vitest'
import { buildBm25Index } from './bm25.js'
import { hybridSearch } from './hybrid.js'
import { createTransformersEmbedder } from './embedder.js'
import { loadRealCorpus, loadScaleCorpus, type Corpus } from './fixtures/corpus.js'
import { labeledQueries, type LabeledQuery } from './fixtures/queries.js'

const HIT3_MIN = 0.8

function isRelevant(q: LabeledQuery, corpus: Corpus, slug: string): boolean {
  if (q.expectedSlugs) return q.expectedSlugs.includes(slug)
  const topic = corpus.topicOf(slug)
  return topic !== undefined && (q.expectedTopics ?? []).includes(topic)
}

function score(qs: LabeledQuery[], corpus: Corpus, rank: (q: LabeledQuery) => string[]) {
  let h1 = 0
  let h3 = 0
  let rr = 0
  const failed: string[] = []
  for (const q of qs) {
    const first = rank(q).findIndex((s) => isRelevant(q, corpus, s))
    if (first === 0) h1++
    if (first >= 0 && first < 3) h3++
    else failed.push(`${q.id} "${q.query}"`)
    if (first >= 0) rr += 1 / (first + 1)
  }
  const n = qs.length || 1
  return { hit1: h1 / n, hit3: h3 / n, mrr: rr / n, failed }
}

describe.skipIf(process.env.SEARCH_REAL_EMBEDDINGS !== '1')('real-model hybrid accuracy', () => {
  it(
    'hybrid hit@3 >= 0.8 over all kinds and beats BM25 on paraphrases',
    async () => {
      process.env.HF_CACHE_DIR ??= './db/models'
      const embedder = await createTransformersEmbedder()
      expect(embedder, 'real embedder must load').not.toBeNull()
      const e = embedder!

      for (const [name, corpus] of [['scale', loadScaleCorpus()], ['real', loadRealCorpus()]] as const) {
        const qs = labeledQueries.filter((q) => q.corpus === name)
        const vecs = await e.embed(corpus.docs.map((d) => d.text))
        const vectors = new Map(corpus.docs.map((d, i) => [d.slug, vecs[i]]))
        const bm25 = buildBm25Index(corpus.docs)
        const qvecs = new Map<string, Float32Array>()
        for (const q of qs) qvecs.set(q.id, (await e.embed([q.query]))[0])

        const hybrid = (q: LabeledQuery) =>
          hybridSearch({ query: q.query, bm25, vectors, queryVector: qvecs.get(q.id)!, limit: 50 }).results.map((r) => r.slug)
        const lexical = (q: LabeledQuery) => bm25.search(q.query).map((r) => r.slug)

        const all = score(qs, corpus, hybrid)
        const para = qs.filter((q) => q.kind === 'paraphrase')
        const hp = score(para, corpus, hybrid)
        const bp = score(para, corpus, lexical)
        console.log(`[real ${name}] hybrid all: hit@1=${all.hit1.toFixed(2)} hit@3=${all.hit3.toFixed(2)} MRR=${all.mrr.toFixed(2)}`)
        console.log(`[real ${name}] paraphrase hybrid hit@3=${hp.hit3.toFixed(2)} vs bm25 hit@3=${bp.hit3.toFixed(2)}`)
        expect(all.hit3, `failing: ${all.failed.join('; ')}`).toBeGreaterThanOrEqual(HIT3_MIN)
        expect(hp.hit3).toBeGreaterThanOrEqual(bp.hit3)
      }
    },
    300000,
  )
})
