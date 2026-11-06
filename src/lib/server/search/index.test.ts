import { describe, it, expect, vi } from 'vitest'
import { createSearchService, type AgentRowForSearch } from './index.js'
import { createFakeEmbedder } from './embedder.fake.js'
import { buildSearchText, contentHash, rowToSearchable } from './documents.js'
import { vectorToBlob } from './embedder.js'

const rows: AgentRowForSearch[] = [
  { slug: 'sql-helper', title: 'SQL Helper', summary: 'Writes sql queries', category: 'data', tags: '["sql"]', toolNames: '[]' },
  { slug: 'hvac', title: 'HVAC Sizer', summary: 'Sizes heating systems', category: 'mep', tags: '["hvac"]', toolNames: '[]' },
]

async function vectorsFor(model: string) {
  const e = createFakeEmbedder()
  const out: { model: string; slug: string; vector: Buffer; contentHash: string }[] = []
  for (const r of rows) {
    const text = buildSearchText(rowToSearchable(r))
    const [v] = await e.embed([text])
    out.push({ model, slug: r.slug, vector: vectorToBlob(v), contentHash: contentHash(model, text) })
  }
  return out
}

function make(over: Partial<Parameters<typeof createSearchService>[0]> = {}) {
  const loadAgents = vi.fn(() => ({ rows, fingerprint: 'a' }))
  const svc = createSearchService({
    loadAgents,
    loadVectors: () => [],
    getEmbedder: async () => null,
    ...over,
  })
  return { svc, loadAgents }
}

describe('createSearchService', () => {
  it('returns bm25 results without an embedder', async () => {
    const { svc } = make()
    const r = await svc.search('sql')
    expect(r.mode).toBe('bm25')
    expect(r.results[0].slug).toBe('sql-helper')
  })

  it('uses hybrid when vectors match the embedder model', async () => {
    const vecs = await vectorsFor('fake-hash')
    const { svc } = make({ getEmbedder: async () => createFakeEmbedder(), loadVectors: () => vecs })
    expect((await svc.search('sql')).mode).toBe('hybrid')
  })

  it('ignores vectors from a stale model', async () => {
    const vecs = await vectorsFor('old-model')
    const { svc } = make({ getEmbedder: async () => createFakeEmbedder(), loadVectors: () => vecs })
    expect((await svc.search('sql')).mode).toBe('bm25')
  })

  it('does not wait for a never-resolving embedder', async () => {
    const { svc } = make({ getEmbedder: () => new Promise(() => {}), embedTimeoutMs: 20 })
    const start = Date.now()
    const r = await svc.search('sql')
    expect(Date.now() - start).toBeLessThan(1000)
    expect(r.mode).toBe('bm25')
    expect(r.results.length).toBeGreaterThan(0)
  })

  it('falls back when the embedder rejects', async () => {
    const { svc } = make({
      getEmbedder: async () => {
        throw new Error('boom')
      },
    })
    expect((await svc.search('sql')).mode).toBe('bm25')
  })

  it('returns empty for blank q without touching loaders', async () => {
    const { svc, loadAgents } = make()
    expect(await svc.search('   ')).toEqual({ results: [], mode: 'bm25' })
    expect(loadAgents).not.toHaveBeenCalled()
  })

  it('rebuilds on fingerprint change, at most every recheckMs', async () => {
    let t = 0
    let fp = 'a'
    const loadAgents = vi.fn(() => ({ rows, fingerprint: fp }))
    const svc = createSearchService({
      loadAgents,
      loadVectors: () => [],
      getEmbedder: async () => null,
      now: () => t,
      recheckMs: 1000,
    })
    await svc.search('sql')
    await svc.search('sql')
    expect(loadAgents).toHaveBeenCalledTimes(1)
    t = 1500
    fp = 'b'
    await svc.search('sql')
    expect(loadAgents).toHaveBeenCalledTimes(2)
  })

  it('honours opts.limit: default top 50, Infinity returns every match (CR-01)', async () => {
    const many: AgentRowForSearch[] = Array.from({ length: 120 }, (_, i) => ({
      slug: `agent-${String(i).padStart(3, '0')}`,
      title: `Reporting agent ${i}`,
      summary: 'Builds reporting',
      category: 'data',
      tags: '[]',
      toolNames: '[]',
    }))
    const { svc } = make({ loadAgents: () => ({ rows: many, fingerprint: 'many' }) })
    expect((await svc.search('reporting')).results).toHaveLength(50)
    expect((await svc.search('reporting', { limit: 10 })).results).toHaveLength(10)
    expect((await svc.search('reporting', { limit: Infinity })).results).toHaveLength(120)
  })

  it('does not cache a failed embedder forever: retries with backoff and recovers (WR-02)', async () => {
    let t = 0
    let attempts = 0
    const vecs = await vectorsFor('fake-hash')
    const getEmbedder = vi.fn(async () => {
      attempts++
      return attempts < 3 ? null : createFakeEmbedder()
    })
    const { svc } = make({
      getEmbedder,
      loadVectors: () => vecs,
      now: () => t,
      recheckMs: 1e9,
      embedderRetryMs: 1000,
      embedderRetryMaxMs: 8000,
    })
    expect((await svc.search('sql')).mode).toBe('bm25') // attempt 1 fails
    expect(getEmbedder).toHaveBeenCalledTimes(1)

    t = 500 // still inside the backoff window: no new attempt
    expect((await svc.search('sql')).mode).toBe('bm25')
    expect(getEmbedder).toHaveBeenCalledTimes(1)

    t = 1000 // first backoff elapsed -> attempt 2 (fails, backoff doubles to 2000)
    expect((await svc.search('sql')).mode).toBe('bm25')
    expect(getEmbedder).toHaveBeenCalledTimes(2)
    t = 2500
    expect((await svc.search('sql')).mode).toBe('bm25')
    expect(getEmbedder).toHaveBeenCalledTimes(2)

    t = 3000 // second backoff elapsed -> attempt 3 succeeds
    expect((await svc.search('sql')).mode).toBe('hybrid')
    expect(getEmbedder).toHaveBeenCalledTimes(3)

    t = 99999 // loaded embedder is memoised
    await svc.search('hvac')
    expect(getEmbedder).toHaveBeenCalledTimes(3)
  })

  it('retries after a rejecting getEmbedder too, and backoff is capped (WR-02)', async () => {
    let t = 0
    const getEmbedder = vi.fn(async () => {
      throw new Error('network')
    })
    const { svc } = make({ getEmbedder, now: () => t, embedderRetryMs: 100, embedderRetryMaxMs: 300, recheckMs: 1e9 })
    await svc.search('sql') // fail 1 -> next at 100
    t = 100
    await svc.search('sql') // fail 2 -> next at 300
    t = 300
    await svc.search('sql') // fail 3 -> 400 capped to 300 -> next at 600
    t = 599
    await svc.search('sql')
    expect(getEmbedder).toHaveBeenCalledTimes(3)
    t = 600
    await svc.search('sql')
    expect(getEmbedder).toHaveBeenCalledTimes(4)
  })

  it('reloads vectors when the embeddings fingerprint changes without an agents change (WR-01)', async () => {
    let t = 0
    let stored: Awaited<ReturnType<typeof vectorsFor>> = [] // ingest has not written embeddings yet
    let vfp = '0:'
    const loadVectors = vi.fn(() => stored)
    const { svc } = make({
      getEmbedder: async () => createFakeEmbedder(),
      loadVectors,
      loadVectorFingerprint: () => vfp,
      now: () => t,
      recheckMs: 1000,
    })
    expect((await svc.search('sql')).mode).toBe('bm25') // empty vector set: BM25 only
    // Ingest finishes writing embeddings; the agents fingerprint ('a') is unchanged.
    stored = await vectorsFor('fake-hash')
    vfp = '2:2026-01-01T00:00:01Z'
    t = 1500
    expect((await svc.search('sql')).mode).toBe('hybrid')
  })

  it('does not re-read vectors while the embeddings fingerprint is unchanged (WR-01)', async () => {
    let t = 0
    const vecs = await vectorsFor('fake-hash')
    const loadVectors = vi.fn(() => vecs)
    const { svc } = make({
      getEmbedder: async () => createFakeEmbedder(),
      loadVectors,
      loadVectorFingerprint: () => 'same',
      now: () => t,
      recheckMs: 1000,
    })
    await svc.search('sql')
    t = 5000
    await svc.search('sql')
    await svc.search('hvac')
    expect(loadVectors).toHaveBeenCalledTimes(1)
  })

  it('ignores vectors whose content hash no longer matches the text (WR-04)', async () => {
    const vecs = await vectorsFor('fake-hash')
    const stale = vecs.map((v) => ({ ...v, contentHash: 'outdated' }))
    const { svc } = make({ getEmbedder: async () => createFakeEmbedder(), loadVectors: () => stale })
    expect((await svc.search('sql')).mode).toBe('bm25') // nothing trustworthy -> BM25 only
  })

  it('keeps matching vectors and drops only the mismatched ones (WR-04)', async () => {
    const vecs = await vectorsFor('fake-hash')
    const mixed = [vecs[0], { ...vecs[1], contentHash: 'outdated' }]
    const { svc } = make({ getEmbedder: async () => createFakeEmbedder(), loadVectors: () => mixed })
    const r = await svc.search('heating')
    // The valid sql-helper vector keeps hybrid mode on; hvac's vector was dropped but BM25 still finds it.
    expect(r.mode).toBe('hybrid')
    expect(r.results.map((x) => x.slug)).toContain('hvac')
  })

  it('skips malformed or wrong-size vector blobs instead of failing the whole load (IN-05)', async () => {
    const vecs = await vectorsFor('fake-hash')
    const bad = [
      { ...vecs[0], vector: Buffer.from([1, 2, 3]) }, // byteLength % 4 !== 0 -> RangeError
      { ...vecs[1], vector: vectorToBlob(new Float32Array(8)) }, // wrong dimension
    ]
    const loadVectors = vi.fn(() => bad)
    const { svc } = make({ getEmbedder: async () => createFakeEmbedder(), loadVectors })
    const r = await svc.search('sql')
    expect(r.mode).toBe('bm25')
    expect(r.results[0].slug).toBe('sql-helper')
    await svc.search('sql')
    expect(loadVectors).toHaveBeenCalledTimes(1) // cached, not re-parsed per query
  })

  it('times out a hung embed() call and falls back to bm25 (WR-08)', async () => {
    const vecs = await vectorsFor('fake-hash')
    const embedder = { id: 'fake-hash', embed: vi.fn(() => new Promise<Float32Array[]>(() => {})) }
    const { svc } = make({ getEmbedder: async () => embedder, loadVectors: () => vecs, embedTimeoutMs: 30 })
    const start = Date.now()
    const r = await svc.search('sql')
    expect(Date.now() - start).toBeLessThan(1000)
    expect(embedder.embed).toHaveBeenCalledTimes(1)
    expect(r.mode).toBe('bm25')
    expect(r.results[0].slug).toBe('sql-helper')
  })

  it('treats a rejecting embed() as bm25 (WR-08)', async () => {
    const vecs = await vectorsFor('fake-hash')
    const embedder = { id: 'fake-hash', embed: vi.fn(async () => { throw new Error('onnx') }) }
    const { svc } = make({ getEmbedder: async () => embedder, loadVectors: () => vecs })
    expect((await svc.search('sql')).mode).toBe('bm25')
  })

  it('caps concurrent embeddings: extra queries skip the semantic leg, slot frees on settle (WR-08)', async () => {
    const vecs = await vectorsFor('fake-hash')
    const fake = createFakeEmbedder()
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => { release = r })
    const embed = vi.fn(async (texts: string[]) => {
      await gate
      return fake.embed(texts)
    })
    const { svc } = make({
      getEmbedder: async () => ({ id: 'fake-hash', embed }),
      loadVectors: () => vecs,
      embedTimeoutMs: 200,
      maxConcurrentEmbeds: 2,
    })
    const pending = [svc.search('sql'), svc.search('hvac'), svc.search('heating'), svc.search('queries')]
    // Let the first two run into the gate; the other two must not start an inference.
    await new Promise((r) => setTimeout(r, 20))
    expect(embed).toHaveBeenCalledTimes(2)
    release()
    const out = await Promise.all(pending)
    expect(out.map((o) => o.mode)).toEqual(['hybrid', 'hybrid', 'bm25', 'bm25'])
    // Slots were released when the inferences settled.
    expect((await svc.search('sql')).mode).toBe('hybrid')
  })

  it('caps the query length inside the service, not only in the routes (WR-08)', async () => {
    const vecs = await vectorsFor('fake-hash')
    const fake = createFakeEmbedder()
    const seen: string[] = []
    const embedder = {
      id: 'fake-hash',
      embed: async (texts: string[]) => {
        seen.push(...texts)
        return fake.embed(texts)
      },
    }
    const { svc } = make({ getEmbedder: async () => embedder, loadVectors: () => vecs })
    const r = await svc.search(`sql ${'x'.repeat(5000)}`)
    expect(seen).toHaveLength(1)
    expect(seen[0].length).toBeLessThanOrEqual(200)
    expect(seen[0].startsWith('sql x')).toBe(true)
    expect(r.mode).toBe('hybrid')
  })

  it('requests the embedder once', async () => {
    const getEmbedder = vi.fn(async () => createFakeEmbedder())
    const { svc } = make({ getEmbedder })
    await svc.search('sql')
    await svc.search('hvac')
    expect(getEmbedder).toHaveBeenCalledTimes(1)
  })
})

describe('createSearchService.related', () => {
  const rel: AgentRowForSearch[] = [
    { slug: 'a', title: 'A', summary: 'alpha sql queries', category: 'data', tags: '["sql","db"]', toolNames: '[]' },
    { slug: 'b', title: 'B', summary: 'beta sql queries', category: 'data', tags: '["sql","db"]', toolNames: '[]' },
    { slug: 'c', title: 'C', summary: 'gamma heating', category: 'mep', tags: '["hvac"]', toolNames: '[]' },
  ]
  async function relVectors(model: string, hashSuffix = '') {
    const e = createFakeEmbedder()
    const out: { model: string; slug: string; vector: Buffer; contentHash: string }[] = []
    for (const r of rel) {
      const text = buildSearchText(rowToSearchable(r))
      const [v] = await e.embed([text])
      out.push({ model, slug: r.slug, vector: vectorToBlob(v), contentHash: contentHash(model, text + hashSuffix) })
    }
    return out
  }
  function makeRel(over: Partial<Parameters<typeof createSearchService>[0]> = {}) {
    return createSearchService({
      loadAgents: () => ({ rows: rel, fingerprint: 'r' }),
      loadVectors: () => [],
      getEmbedder: async () => null,
      ...over,
    })
  }

  it('uses embeddings when vectors are valid', async () => {
    const vecs = await relVectors('fake-hash')
    const r = await makeRel({ getEmbedder: async () => createFakeEmbedder(), loadVectors: () => vecs }).related('a')
    expect(r[0].slug).toBe('b')
    expect(r[0].via).toBe('embedding')
  })

  it('falls back without an embedder', async () => {
    const r = await makeRel().related('a')
    expect(r.map((x) => x.slug)).toEqual(['b'])
    expect(r[0].via).toBe('fallback')
  })

  it('falls back when the stored content hash is stale', async () => {
    const vecs = await relVectors('fake-hash', ' stale')
    const r = await makeRel({ getEmbedder: async () => createFakeEmbedder(), loadVectors: () => vecs }).related('a')
    expect(r.every((x) => x.via === 'fallback')).toBe(true)
  })

  it('returns [] for an unknown slug and does not hang on a stuck embedder', async () => {
    expect(await makeRel().related('nope')).toEqual([])
    const r = await makeRel({ getEmbedder: () => new Promise(() => {}), embedTimeoutMs: 20 }).related('a')
    expect(r.map((x) => x.slug)).toEqual(['b'])
  })

  it('never throws when loaders fail', async () => {
    const svc = makeRel({
      loadAgents: () => {
        throw new Error('db down')
      },
    })
    expect(await svc.related('a')).toEqual([])
  })
})

