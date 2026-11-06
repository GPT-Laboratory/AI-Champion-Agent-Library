import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import Database from 'better-sqlite3'
import { ingest } from '../../../../scripts/ingest.js'
import { createScaleDb, type ScaleDb } from '../../../../scripts/fixtures/scale-test-helpers.js'
import { createFakeEmbedder } from './embedder.fake.js'

// Exercises the real singleton loaders (agents, vectors, vector fingerprint) against a tmp DB.
const EMBEDDINGS_DDL = `
CREATE TABLE IF NOT EXISTS agent_embeddings (
  slug TEXT PRIMARY KEY,
  model TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  vector BLOB NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
)`

let scale: ScaleDb
let prevEnv: string | undefined
let search: (typeof import('./index.js'))['search']

beforeAll(async () => {
  scale = createScaleDb(20)
  const db = new Database(scale.dbPath)
  db.exec(EMBEDDINGS_DDL)
  db.close()
  await ingest(scale.dataDir, scale.dbPath, { embedder: createFakeEmbedder() })
  prevEnv = process.env.CATALOG_DB_PATH
  process.env.CATALOG_DB_PATH = scale.dbPath
  vi.resetModules()
  search = (await import('./index.js')).search
}, 60000)

afterAll(() => {
  if (prevEnv === undefined) delete process.env.CATALOG_DB_PATH
  else process.env.CATALOG_DB_PATH = prevEnv
  scale?.cleanup()
})

describe('search() against a real SQLite DB', () => {
  it('loads agents plus the embeddings fingerprint and ranks (SEARCH_EMBEDDINGS=off -> bm25)', async () => {
    const r = await search('hvac')
    expect(r.mode).toBe('bm25')
    expect(r.results.length).toBeGreaterThan(0)
  })

  it('honours opts.limit against the real index', async () => {
    const some = await search('review', { limit: 3 })
    const all = await search('review', { limit: Infinity })
    expect(some.results.length).toBeLessThanOrEqual(3)
    expect(all.results.length).toBeGreaterThanOrEqual(some.results.length)
  })
})
