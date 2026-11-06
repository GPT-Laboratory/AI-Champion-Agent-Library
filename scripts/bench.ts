/**
 * Reproducible performance benchmark for ingest and search (exploration E2).
 *
 *   npm run bench                      # N = 150, 1000, 5000
 *   BENCH_SIZES=150,1000 npm run bench # custom sizes
 *   BENCH_JSON=out.json npm run bench  # also write raw results as JSON
 *
 * Everything runs against synthetic agents (scripts/fixtures/generate-scale.ts) in a
 * temp dir and temp SQLite DB; db/catalog.db and data/agents are never touched.
 * No network, no model download: embeddings are off or the deterministic fake embedder.
 * Not part of `npm run check`. Each size runs in its own child process so memory
 * numbers are not polluted by earlier sizes.
 */
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { cpus, totalmem, platform, release } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { createScaleDb } from './fixtures/scale-test-helpers.js'

const SELF = fileURLToPath(import.meta.url)

interface Stat { n: number; p50: number; p95: number; mean: number; max: number }
function stat(samples: number[]): Stat {
  const s = [...samples].sort((a, b) => a - b)
  const q = (p: number) => s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))]
  return { n: s.length, p50: q(0.5), p95: q(0.95), mean: s.reduce((a, b) => a + b, 0) / (s.length || 1), max: s[s.length - 1] ?? 0 }
}

const EMBEDDINGS_DDL = `CREATE TABLE IF NOT EXISTS agent_embeddings (
  slug TEXT PRIMARY KEY REFERENCES agents(slug) ON DELETE CASCADE,
  model TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  vector BLOB NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
)`

function freshDb(path: string): void {
  const d = new Database(path)
  d.exec(`CREATE TABLE agents (
  slug TEXT PRIMARY KEY, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', system_prompt TEXT NOT NULL,
  llm_name TEXT NOT NULL, llm_temperature REAL, llm_max_tokens INTEGER, llm_top_p REAL,
  tool_names TEXT NOT NULL DEFAULT '[]', input_schema TEXT NOT NULL DEFAULT '[]',
  requires_human_approval INTEGER NOT NULL DEFAULT 0, category TEXT, github_url TEXT, customizable_fields TEXT,
  fixed_fields TEXT NOT NULL DEFAULT '[]', fixed_note TEXT, link_label TEXT,
  maturity_status TEXT NOT NULL DEFAULT 'experimental', tags TEXT NOT NULL DEFAULT '[]', spec_id TEXT,
  try_it_out_mode TEXT NOT NULL DEFAULT 'none', try_it_out_url TEXT, try_it_out_task_template TEXT,
  last_ingested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')))`)
  d.exec(EMBEDDINGS_DDL)
  d.close()
}

const ms = <T>(fn: () => T): [T, number] => { const t = performance.now(); const r = fn(); return [r, performance.now() - t] }
const msAsync = async <T>(fn: () => Promise<T>): Promise<[T, number]> => { const t = performance.now(); const r = await fn(); return [r, performance.now() - t] }
const mb = (b: number) => Math.round((b / 1048576) * 10) / 10
function mem() {
  ;(globalThis as { gc?: () => void }).gc?.()
  const m = process.memoryUsage()
  return { heap: m.heapUsed, rss: m.rss, ext: m.external + m.arrayBuffers }
}
const memDelta = (a: ReturnType<typeof mem>, b: ReturnType<typeof mem>) => ({
  heapMB: mb(b.heap - a.heap), rssMB: mb(b.rss - a.rss), externalMB: mb(b.ext - a.ext),
})

async function child(N: number): Promise<void> {
  const reps = N >= 5000 ? 3 : N >= 1000 ? 5 : 10
  const log = console.log
  const quiet = <T>(fn: () => Promise<T>) => async () => {
    const w = console.warn, l = console.log
    console.warn = () => {}; console.log = () => {}
    try { return await fn() } finally { console.warn = w; console.log = l }
  }
  const out: Record<string, unknown> = { N, reps }
  const scale = createScaleDb(N)
  try {
    const { ingest } = await import('./ingest.js')
    const { createFakeEmbedder } = await import('../src/lib/server/search/embedder.fake.js')
    const fake = createFakeEmbedder()
    const dbOff = join(scale.dir, 'off.db')
    const dbFake = join(scale.dir, 'fake.db')
    freshDb(dbOff)
    freshDb(dbFake)

    // ---- ingest ----
    const ing: Record<string, unknown> = {}
    for (const [label, path, embedder] of [['off', dbOff, null], ['fake', dbFake, fake]] as const) {
      const m0 = mem()
      const [r1, t1] = await msAsync(quiet(() => ingest(scale.dataDir, path, { embedder })))
      const m1 = mem()
      await new Promise((r) => setTimeout(r, 5))
      const [r2, t2] = await msAsync(quiet(() => ingest(scale.dataDir, path, { embedder })))
      if (r1.succeeded !== N || r2.succeeded !== N) throw new Error(`ingest ${label}: ${JSON.stringify([r1, r2])}`)
      ing[label] = { firstMs: t1, reingestMs: t2, perAgentFirstMs: t1 / N, memFirst: memDelta(m0, m1) }
    }
    out.ingest = ing

    // ---- search index build ----
    const { createSearchService } = await import('../src/lib/server/search/index.js')
    const { buildBm25Index } = await import('../src/lib/server/search/bm25.js')
    const { buildSearchText, rowToSearchable } = await import('../src/lib/server/search/documents.js')
    const { drizzle } = await import('drizzle-orm/better-sqlite3')
    const schema = await import('../drizzle/schema.js')
    const { sql } = await import('drizzle-orm')
    const sqlite = new Database(dbFake, { readonly: true })
    const db = drizzle(sqlite)
    const loadAgents = () => {
      const rows = db.select().from(schema.agents).all()
      const max = rows.reduce((m, r) => (r.lastIngestedAt > m ? r.lastIngestedAt : m), '')
      return { rows, fingerprint: `${rows.length}:${max}` }
    }
    const loadVectors = () => db.select().from(schema.agentEmbeddings).all()
    const loadVectorFingerprint = () => {
      const r = db.select({ n: sql<number>`count(*)`, m: sql<string | null>`max(${schema.agentEmbeddings.updatedAt})` }).from(schema.agentEmbeddings).get()
      return `${r?.n ?? 0}:${r?.m ?? ''}`
    }

    const [loaded, loadMs] = ms(loadAgents)
    const [docs, docsMs] = ms(() => loaded.rows.map((r) => { const s = rowToSearchable(r); return { slug: s.slug, title: s.title, tags: s.tags, text: buildSearchText(s) } }))
    const mIdx0 = mem()
    const [bm, buildMs] = ms(() => buildBm25Index(docs))
    const mIdx1 = mem()
    void bm
    const [, vecLoadMs] = ms(loadVectors)
    out.indexBuild = { loadRowsMs: loadMs, buildDocsMs: docsMs, buildBm25Ms: buildMs, loadVectorsMs: vecLoadMs, mem: memDelta(mIdx0, mIdx1) }

    const { labeledQueries } = await import('../src/lib/server/search/fixtures/queries.js')
    const queries = labeledQueries.filter((q) => q.corpus === 'scale').map((q) => q.query)
    out.queryCount = queries.length

    const mkService = (embedder: typeof fake | null) =>
      createSearchService({ loadAgents, loadVectors, loadVectorFingerprint, getEmbedder: async () => embedder, embedTimeoutMs: 10_000, recheckMs: 1e12 })

    // Cold first query (includes index build via the service) and memory.
    const mSvc0 = mem()
    const bmSvc = mkService(null)
    const [, bmCold] = await msAsync(() => bmSvc.search(queries[0]))
    const mSvc1 = mem()
    const hySvc = mkService(fake)
    const [, hyCold] = await msAsync(() => hySvc.search(queries[0]))
    const mSvc2 = mem()
    out.cold = { bm25FirstQueryMs: bmCold, hybridFirstQueryMs: hyCold, memBm25Service: memDelta(mSvc0, mSvc1), memHybridExtra: memDelta(mSvc1, mSvc2) }

    // Query embedding cost alone (fake embedder).
    const embSamples: number[] = []
    for (let r = 0; r < reps; r++) for (const q of queries) { const [, t] = await msAsync(() => fake.embed([q])); embSamples.push(t) }
    out.fakeEmbedQueryMs = stat(embSamples)

    // Query latency
    const lat = async (svc: ReturnType<typeof mkService>, limit: number | undefined) => {
      const samples: number[] = []
      for (let r = 0; r < reps; r++) for (const q of queries) {
        const [, t] = await msAsync(() => svc.search(q, limit === undefined ? undefined : { limit }))
        samples.push(t)
      }
      return stat(samples)
    }
    out.query = {
      bm25_limit50: await lat(bmSvc, undefined),
      bm25_limitInfinity: await lat(bmSvc, Infinity),
      hybrid_limit50: await lat(hySvc, undefined),
      hybrid_limitInfinity: await lat(hySvc, Infinity),
    }

    // related()
    const slugs = loaded.rows.map((r) => r.slug)
    const nSample = Math.min(50, N)
    const sample = Array.from({ length: nSample }, (_, i) => slugs[Math.floor((i * N) / nSample)])
    const rel = async (svc: ReturnType<typeof mkService>) => {
      const samples: number[] = []
      for (let r = 0; r < Math.max(2, Math.floor(reps / 2)); r++) for (const s of sample) { const [, t] = await msAsync(() => svc.related(s)); samples.push(t) }
      return stat(samples)
    }
    out.related = { fallback: await rel(bmSvc), embedding: await rel(hySvc) }
    sqlite.close()

    // ---- catalog loader (real route load against the off-DB, search embeddings off) ----
    process.env.CATALOG_DB_PATH = dbOff
    process.env.SEARCH_EMBEDDINGS = 'off'
    const { load } = await import('../src/routes/catalog/+page.server.js')
    const run = async (qs: string) => (await (load as (e: unknown) => Promise<{ agents: unknown[]; total: number }>)({ url: new URL(`http://localhost/catalog${qs}`) }))
    const lastPage = Math.max(1, Math.ceil(N / 24))
    const scenarios: [string, string][] = [
      ['page1_nofilter', ''],
      ['lastPage_nofilter', `?page=${lastPage}`],
      ['filters_category+maturity_page2', '?category=mechanical&maturity=beta&page=2'],
      ['filter_llm', `?llm=${encodeURIComponent('gpt-4o')}`],
      ['query_bm25_page1', '?q=ductwork%20airflow'],
      ['query_bm25+category_page2', '?q=review%20compliance&category=compliance&page=2'],
    ]
    const cat: Record<string, unknown> = {}
    await run('') // warm: module load + prepared statements
    await run('?q=warm')
    for (const [name, qs] of scenarios) {
      const samples: number[] = []
      let total = -1
      for (let r = 0; r < reps; r++) { const [d, t] = await msAsync(() => run(qs)); samples.push(t); total = d.total }
      cat[name] = { ...stat(samples), total }
    }
    out.catalog = cat
    out.finalMem = mem()
  } finally {
    scale.cleanup()
  }
  log('BENCH_RESULT ' + JSON.stringify(out))
}

const f = (x: number) => (x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function report(results: any[]): string {
  const L: string[] = []
  const cols = results.map((r) => `N=${r.N}`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = (label: string, get: (r: any) => string) => L.push(`| ${label} | ${results.map(get).join(' | ')} |`)
  const head = (title: string) => { L.push('', `### ${title}`, '', `| metric | ${cols.join(' | ')} |`, `|---|${cols.map(() => '---:').join('|')}|`) }
  head('Ingest wall time (ms)')
  row('first, embeddings off', (r) => f(r.ingest.off.firstMs))
  row('re-ingest, embeddings off', (r) => f(r.ingest.off.reingestMs))
  row('first, fake embedder', (r) => f(r.ingest.fake.firstMs))
  row('re-ingest, fake embedder', (r) => f(r.ingest.fake.reingestMs))
  row('first off, per agent', (r) => f(r.ingest.off.perAgentFirstMs))
  head('Search index build (ms)')
  row('load rows from SQLite', (r) => f(r.indexBuild.loadRowsMs))
  row('build search documents', (r) => f(r.indexBuild.buildDocsMs))
  row('buildBm25Index', (r) => f(r.indexBuild.buildBm25Ms))
  row('load vectors (blobs)', (r) => f(r.indexBuild.loadVectorsMs))
  row('cold first query, BM25 service', (r) => f(r.cold.bm25FirstQueryMs))
  row('cold first query, hybrid service', (r) => f(r.cold.hybridFirstQueryMs))
  head('Query latency, ms p50 / p95 (labeled scale queries x repetitions)')
  for (const k of ['bm25_limit50', 'bm25_limitInfinity', 'hybrid_limit50', 'hybrid_limitInfinity'])
    row(k, (r) => `${f(r.query[k].p50)} / ${f(r.query[k].p95)}`)
  row('fake embed of one query alone', (r) => `${f(r.fakeEmbedQueryMs.p50)} / ${f(r.fakeEmbedQueryMs.p95)}`)
  head('related() latency, ms p50 / p95 (k=4)')
  row('fallback (no vectors)', (r) => `${f(r.related.fallback.p50)} / ${f(r.related.fallback.p95)}`)
  row('embedding (fake vectors)', (r) => `${f(r.related.embedding.p50)} / ${f(r.related.embedding.p95)}`)
  head('Catalog loader load(), ms p50 / p95 (search embeddings off)')
  for (const k of Object.keys(results[0].catalog)) row(k, (r) => `${f(r.catalog[k].p50)} / ${f(r.catalog[k].p95)}`)
  head('Memory deltas (MB, after forced GC)')
  row('ingest first (off): heap', (r) => String(r.ingest.off.memFirst.heapMB))
  row('ingest first (fake): heap', (r) => String(r.ingest.fake.memFirst.heapMB))
  row('BM25 index (docs given): heap', (r) => String(r.indexBuild.mem.heapMB))
  row('BM25 service incl. rows: heap', (r) => String(r.cold.memBm25Service.heapMB))
  row('hybrid vectors extra: heap', (r) => String(r.cold.memHybridExtra.heapMB))
  row('hybrid vectors extra: external', (r) => String(r.cold.memHybridExtra.externalMB))
  row('final RSS', (r) => String(mb(r.finalMem.rss)))
  return L.join('\n')
}

async function parent(): Promise<void> {
  const sizes = (process.env.BENCH_SIZES ?? '150,1000,5000').split(',').map((s) => Number(s.trim())).filter((n) => n > 0)
  const results: unknown[] = []
  for (const N of sizes) {
    console.error(`[bench] N=${N} ...`)
    const p = spawnSync(process.execPath, ['--expose-gc', '--import', 'tsx', SELF, '--child', String(N)], {
      encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, SEARCH_EMBEDDINGS: 'off' },
    })
    if (p.status !== 0) { console.error(p.stdout, p.stderr); throw new Error(`bench child N=${N} failed`) }
    const line = p.stdout.split('\n').find((l) => l.startsWith('BENCH_RESULT '))
    if (!line) throw new Error(`no result from child N=${N}: ${p.stdout}`)
    results.push(JSON.parse(line.slice('BENCH_RESULT '.length)))
  }
  const c = cpus()
  console.log(`machine: ${c[0]?.model} x${c.length}, ${mb(totalmem())} MB RAM, ${platform()} ${release()}, node ${process.version}`)
  console.log(report(results))
  if (process.env.BENCH_JSON) writeFileSync(process.env.BENCH_JSON, JSON.stringify(results, null, 2))
}

if (process.argv[2] === '--child') child(Number(process.argv[3])).catch((e) => { console.error(e); process.exit(1) })
else parent().catch((e) => { console.error(e); process.exit(1) })
