// Server-only search service: lazy, refreshable BM25 index + optional semantic re-rank.
// Relative imports only; nothing is constructed at import time.
import { buildBm25Index, type Bm25Index } from './bm25.js'
import { hybridSearch } from './hybrid.js'
import { relatedAgents, type RelatedAgent, type RelatedInput } from './related.js'
import { sql } from 'drizzle-orm'
import { buildSearchText, contentHash, rowToSearchable, rowToSearchableWithKind } from './documents.js'
import { agentKindsEnabled } from '../../flags.js'
import { defaultKindInfo, type KindInfo } from '../../spec/kinds.js'
import { EMBEDDING_DIM, blobToVector, createTransformersEmbedder, type Embedder } from './embedder.js'

export type SearchMode = 'hybrid' | 'bm25'

export interface AgentRowForSearch {
  slug: string
  title: string
  summary: string
  category: string | null
  tags: string
  toolNames: string
  llmName?: string | null
  /** Flag-on only (AGENT_KINDS): attached by the loader from agent_kinds. */
  kind?: string
  framework?: string | null
  memberNames?: string[]
}

export interface SearchOptions {
  /** Max ranked results to return. Defaults to 50; pass Infinity to rank everything. */
  limit?: number
}

export interface SearchService {
  search(
    q: string,
    opts?: SearchOptions,
  ): Promise<{ results: { slug: string; score: number }[]; mode: SearchMode }>
  warmUp(): Promise<void>
  /** Up to k agents related to `slug` (embedding cosine when valid vectors exist, else tag/category fallback). Never throws. */
  related(slug: string, k?: number): Promise<RelatedAgent[]>
}

export interface SearchServiceDeps {
  loadAgents: () => { rows: AgentRowForSearch[]; fingerprint: string }
  loadVectors: () => { model: string; slug: string; vector: Buffer; contentHash: string }[]
  /**
   * Cheap fingerprint of the stored embeddings (e.g. `count:max(updated_at)`). When it
   * changes the in-memory vector cache is dropped, so vectors written after the agents
   * (ingest writes embeddings last) are picked up without a restart.
   */
  loadVectorFingerprint?: () => string
  getEmbedder: () => Promise<Embedder | null>
  embedTimeoutMs?: number
  /** Max query embeddings running at once; extra queries skip the semantic leg (BM25-only). Default 4. */
  maxConcurrentEmbeds?: number
  recheckMs?: number
  /** First retry delay after the embedder fails to load; doubles per failure up to embedderRetryMaxMs. */
  embedderRetryMs?: number
  embedderRetryMaxMs?: number
  now?: () => number
}

const TIMED_OUT = Symbol('timeout')

/** Longest query the service will rank or embed; callers need not (but may) cap it themselves. */
export const MAX_QUERY_CHARS = 200

function kindInfoOf(r: AgentRowForSearch): KindInfo {
  return {
    ...defaultKindInfo(),
    kind: r.kind as KindInfo['kind'],
    framework: r.framework ?? null,
    members: (r.memberNames ?? []).map((name) => ({ ref: name, name, role: 'participant', description: null, slug: null })),
  }
}

export function createSearchService(deps: SearchServiceDeps): SearchService {
  const embedTimeoutMs = deps.embedTimeoutMs ?? 1500
  const recheckMs = deps.recheckMs ?? 30000
  const maxConcurrentEmbeds = deps.maxConcurrentEmbeds ?? 4
  let inflightEmbeds = 0
  const now = deps.now ?? Date.now
  const embedderRetryMs = deps.embedderRetryMs ?? 60_000
  const embedderRetryMaxMs = deps.embedderRetryMaxMs ?? 15 * 60_000

  let bm25: Bm25Index | null = null
  let fingerprint: string | null = null
  let rowTexts = new Map<string, string>()
  let relatedInputs: RelatedInput[] = []
  let vectorFingerprint: string | null = null
  let lastCheck = -Infinity
  let vectorCache: { model: string; vectors: Map<string, Float32Array> } | null = null
  let embedderPromise: Promise<Embedder | null> | null = null
  let embedderFailures = 0
  let embedderRetryAt = -Infinity

  // A loaded embedder is memoised for the process lifetime. A failed load (null or
  // rejection, e.g. a transient download error) is NOT: it is retried with exponential
  // backoff so hybrid search can recover without a restart.
  function ensureEmbedder(): Promise<Embedder | null> {
    if (embedderPromise) return embedderPromise
    if (embedderFailures > 0 && now() < embedderRetryAt) return Promise.resolve(null)
    const attempt: Promise<Embedder | null> = Promise.resolve()
      .then(() => deps.getEmbedder())
      .catch(() => null)
      .then((e) => {
        if (e) {
          embedderFailures = 0
          return e
        }
        embedderFailures++
        embedderRetryAt = now() + Math.min(embedderRetryMs * 2 ** (embedderFailures - 1), embedderRetryMaxMs)
        embedderPromise = null
        return null
      })
    embedderPromise = attempt
    return attempt
  }

  function refresh(): Bm25Index {
    const t = now()
    if (bm25 && t - lastCheck < recheckMs) return bm25
    lastCheck = t
    const { rows, fingerprint: fp } = deps.loadAgents()
    const vfp = deps.loadVectorFingerprint?.() ?? ''
    if (vfp !== vectorFingerprint) {
      vectorFingerprint = vfp
      vectorCache = null
    }
    if (bm25 && fp === fingerprint) return bm25
    const docs = rows.map((r) => {
      const s = r.kind !== undefined ? rowToSearchableWithKind(r, kindInfoOf(r)) : rowToSearchable(r)
      return { slug: s.slug, title: s.title, tags: s.tags, text: buildSearchText(s) }
    })
    bm25 = buildBm25Index(docs)
    rowTexts = new Map(docs.map((d) => [d.slug, d.text]))
    relatedInputs = rows.map((r) => ({
      ...rowToSearchable(r),
      ...(r.llmName ? { llm: r.llmName } : {}),
      ...(r.kind !== undefined ? { kind: r.kind } : {}),
    }))
    fingerprint = fp
    vectorCache = null
    return bm25
  }

  function vectorsFor(model: string): Map<string, Float32Array> {
    if (vectorCache && vectorCache.model === model) return vectorCache.vectors
    const vectors = new Map<string, Float32Array>()
    for (const v of deps.loadVectors()) {
      if (v.model !== model) continue
      const text = rowTexts.get(v.slug)
      if (text === undefined) continue
      // Only trust a vector computed from the current text: otherwise BM25 (new text) and
      // the semantic ranking (old text) would silently disagree.
      if (v.contentHash !== contentHash(model, text)) continue
      try {
        const vec = blobToVector(v.vector)
        if (vec.length === EMBEDDING_DIM) vectors.set(v.slug, vec)
      } catch {
        // Malformed blob (byteLength not a multiple of 4): skip this row, keep the rest.
      }
    }
    vectorCache = { model, vectors }
    return vectors
  }

  async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMED_OUT), ms)
    })
    try {
      return await Promise.race([p, timeout])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  // Embed one query with a timeout and a concurrency cap. The slot is released when the
  // inference actually settles (not when we stop waiting), so a stuck inference cannot pile up.
  async function embedQuery(embedder: Embedder, query: string): Promise<Float32Array | null> {
    if (inflightEmbeds >= maxConcurrentEmbeds) return null
    inflightEmbeds++
    const work = Promise.resolve().then(() => embedder.embed([query]))
    const release = () => {
      inflightEmbeds--
    }
    work.then(release, release)
    const r = await withTimeout(work, embedTimeoutMs)
    return r === TIMED_OUT ? null : (r[0] ?? null)
  }

  return {
    async warmUp() {
      await ensureEmbedder()
    },
    async search(q: string, opts?: SearchOptions) {
      const query = q.trim().slice(0, MAX_QUERY_CHARS).trim()
      if (!query) return { results: [], mode: 'bm25' }
      const index = refresh()
      let queryVector: Float32Array | null = null
      let vectors = new Map<string, Float32Array>()
      try {
        const embedder = await withTimeout(ensureEmbedder(), embedTimeoutMs)
        if (embedder && embedder !== TIMED_OUT) {
          vectors = vectorsFor(embedder.id)
          if (vectors.size > 0) queryVector = await embedQuery(embedder, query)
        }
      } catch {
        queryVector = null
      }
      const { results, mode } = hybridSearch({ query, bm25: index, vectors, queryVector, limit: opts?.limit })
      return { results, mode }
    },
    async related(slug: string, k = 4) {
      try {
        refresh()
        let vectors: Map<string, Float32Array> | undefined
        try {
          const embedder = await withTimeout(ensureEmbedder(), embedTimeoutMs)
          if (embedder && embedder !== TIMED_OUT) vectors = vectorsFor(embedder.id)
        } catch {
          vectors = undefined
        }
        return relatedAgents(slug, relatedInputs, vectors && vectors.size > 0 ? vectors : undefined, k)
      } catch {
        return []
      }
    },
  }
}

type DbModule = typeof import('../db.js')

let singleton: SearchService | null = null
let cachedDb: DbModule | null = null

function dbModule(): DbModule {
  if (!cachedDb) throw new Error('search db not initialised')
  return cachedDb
}

// Loaded lazily (flag on only): a static import would pull drizzle schema into every consumer's mocks.
type KindsDeps = {
  loadKindInfo: typeof import('../kinds.js').loadKindInfo
  agentKinds: typeof import('../../../../drizzle/schema.js').agentKinds
}
let kindsDeps: KindsDeps | null = null
async function ensureKindsDeps(): Promise<void> {
  if (kindsDeps || !agentKindsEnabled()) return
  const [k, schema] = await Promise.all([import('../kinds.js'), import('../../../../drizzle/schema.js')])
  kindsDeps = { loadKindInfo: k.loadKindInfo, agentKinds: schema.agentKinds }
}

// Flag-on only: join agent_kinds (never throws; a missing table leaves rows kind-less).
function loadKindRows(
  db: DbModule['db'],
  rows: AgentRowForSearch[],
  fp: string,
): { rows: AgentRowForSearch[]; fingerprint: string } {
  if (!kindsDeps) return { rows, fingerprint: fp }
  const { loadKindInfo, agentKinds } = kindsDeps
  try {
    const infos = loadKindInfo(db, rows.map((r) => r.slug))
    const stamp = db
      .select({ n: sql<number>`count(*)`, m: sql<string | null>`max(${agentKinds.updatedAt})` })
      .from(agentKinds)
      .get()
    const withKinds = rows.map((r) => {
      const info = infos.get(r.slug)
      return info
        ? { ...r, kind: info.kind, framework: info.framework, memberNames: info.members.map((m) => m.name) }
        : r
    })
    return { rows: withKinds, fingerprint: `${fp}:k${stamp?.n ?? 0}:${stamp?.m ?? ''}` }
  } catch {
    return { rows, fingerprint: fp }
  }
}

function getSingleton(): SearchService {
  if (singleton) return singleton
  singleton = createSearchService({
    loadAgents() {
      const { db, agents } = dbModule()
      const rows = db.select().from(agents).all()
      const max = rows.reduce((m, r) => (r.lastIngestedAt > m ? r.lastIngestedAt : m), '')
      if (agentKindsEnabled()) return loadKindRows(db, rows, `${rows.length}:${max}`)
      return { rows, fingerprint: `${rows.length}:${max}` }
    },
    loadVectors() {
      const { db, agentEmbeddings } = dbModule()
      try {
        return db.select().from(agentEmbeddings).all()
      } catch {
        return [] // old DB without the agent_embeddings table
      }
    },
    loadVectorFingerprint() {
      const { db, agentEmbeddings } = dbModule()
      try {
        const r = db
          .select({
            n: sql<number>`count(*)`,
            m: sql<string | null>`max(${agentEmbeddings.updatedAt})`,
          })
          .from(agentEmbeddings)
          .get()
        return `${r?.n ?? 0}:${r?.m ?? ''}`
      } catch {
        return 'missing' // old DB without the agent_embeddings table
      }
    },
    getEmbedder: async () =>
      process.env.SEARCH_EMBEDDINGS === 'off' ? null : createTransformersEmbedder(),
  })
  return singleton
}

export async function search(q: string, opts?: SearchOptions): ReturnType<SearchService['search']> {
  if (!cachedDb) cachedDb = await import('../db.js')
  await ensureKindsDeps()
  return getSingleton().search(q, opts)
}

export async function related(slug: string, k?: number): Promise<RelatedAgent[]> {
  if (!cachedDb) cachedDb = await import('../db.js')
  await ensureKindsDeps()
  return getSingleton().related(slug, k)
}

export async function warmUp(): Promise<void> {
  if (process.env.SEARCH_EMBEDDINGS === 'off') return
  if (!cachedDb) cachedDb = await import('../db.js')
  await ensureKindsDeps()
  await getSingleton().warmUp()
}
