import { describe, expect, it } from 'vitest'
import { loadScaleCorpus } from './fixtures/corpus.js'
import { createFakeEmbedder } from './embedder.fake.js'
import { buildSearchText } from './documents.js'
import { relatedAgents, type RelatedInput } from './related.js'

const corpus = loadScaleCorpus()
const inputs: RelatedInput[] = corpus.searchables.map((s) => ({
  slug: s.slug,
  category: s.category,
  tags: s.tags,
  toolNames: s.toolNames,
}))

function meanPrecision(vectors?: Map<string, Float32Array>, list = inputs): number {
  let sum = 0
  for (const a of inputs) {
    const r = relatedAgents(a.slug, list, vectors)
    expect(r.length).toBeLessThanOrEqual(4)
    expect(r.map((x) => x.slug)).not.toContain(a.slug)
    sum += r.filter((x) => corpus.topicOf(x.slug) === corpus.topicOf(a.slug)).length / 4
  }
  return sum / inputs.length
}

async function embedAll(): Promise<Map<string, Float32Array>> {
  const vecs = await createFakeEmbedder().embed(corpus.searchables.map(buildSearchText))
  return new Map(corpus.searchables.map((s, i) => [s.slug, vecs[i]]))
}

describe('related agents precision@4 on the scale corpus', () => {
  it('fallback path', () => {
    const p = meanPrecision()
    expect(p).toBeGreaterThanOrEqual(0.9)
  })
  it('fake-embedding path', async () => {
    // Measured precision@4 = 1.0 on the 150-agent scale corpus (fallback, fake embedding and
    // mixed all 1.0); threshold = floor(1.0*10)/10 - 0.05.
    const p = meanPrecision(await embedAll())
    expect(p).toBeGreaterThanOrEqual(0.95)
  })
  it('mixed path (every 5th vector dropped)', async () => {
    const all = await embedAll()
    const mixed = new Map([...all].filter((_, i) => i % 5 !== 0))
    const p = meanPrecision(mixed)
    expect(p).toBeGreaterThanOrEqual(0.8)
  })
  it('is deterministic under input reversal', async () => {
    const vectors = await embedAll()
    for (const a of inputs.slice(0, 20)) {
      expect(relatedAgents(a.slug, [...inputs].reverse(), vectors)).toEqual(
        relatedAgents(a.slug, inputs, vectors),
      )
    }
  })
})
