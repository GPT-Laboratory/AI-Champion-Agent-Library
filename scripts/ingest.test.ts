import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ingest, EMBED_BATCH_SIZE } from './ingest.js'
import Database from 'better-sqlite3'
import { existsSync, rmSync, mkdtempSync, cpSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFakeEmbedder } from '../src/lib/server/search/embedder.fake.js'
import type { Embedder } from '../src/lib/server/search/embedder.js'
import { writeScaleFixtures } from './fixtures/generate-scale.js'

const TEST_DB = './db/test-catalog.db'
const FIXTURES_DIR = './data/agents/fixtures'

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS agents (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  system_prompt TEXT NOT NULL,
  llm_name TEXT NOT NULL,
  llm_temperature REAL,
  llm_max_tokens INTEGER,
  llm_top_p REAL,
  tool_names TEXT NOT NULL DEFAULT '[]',
  input_schema TEXT NOT NULL DEFAULT '[]',
  requires_human_approval INTEGER NOT NULL DEFAULT 0,
  category TEXT,
  github_url TEXT,
  customizable_fields TEXT,
  fixed_fields TEXT NOT NULL DEFAULT '[]',
  fixed_note TEXT,
  link_label TEXT,
  maturity_status TEXT NOT NULL DEFAULT 'experimental',
  tags TEXT NOT NULL DEFAULT '[]',
  spec_id TEXT,
  try_it_out_mode TEXT NOT NULL DEFAULT 'none',
  try_it_out_url TEXT,
  try_it_out_task_template TEXT,
  last_ingested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE TABLE IF NOT EXISTS agent_embeddings (
  slug TEXT PRIMARY KEY,
  model TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  vector BLOB NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
)
`

beforeEach(() => {
  if (existsSync(TEST_DB)) {
    rmSync(TEST_DB)
  }
  // Pre-create the table so the ingest script can run without drizzle-kit push
  const db = new Database(TEST_DB)
  db.exec(CREATE_TABLE_SQL)
  db.close()
})

afterEach(() => {
  if (existsSync(TEST_DB)) {
    rmSync(TEST_DB)
  }
})

describe('ingest', () => {
  it('ingests valid fixtures and skips malformed', async () => {
    const result = await ingest(FIXTURES_DIR, TEST_DB)
    const db = new Database(TEST_DB)
    const count = (db.prepare('SELECT count(*) as n FROM agents').get() as { n: number }).n
    db.close()
    expect(result.succeeded).toBe(2)
    expect(result.failed).toBe(1)
    expect(count).toBe(2)
  })

  it('is idempotent — re-running produces same row count', async () => {
    await ingest(FIXTURES_DIR, TEST_DB)
    await ingest(FIXTURES_DIR, TEST_DB)
    const db = new Database(TEST_DB)
    const count = (db.prepare('SELECT count(*) as n FROM agents').get() as { n: number }).n
    db.close()
    expect(count).toBe(2)
  })

  it('updates last_ingested_at on re-run', async () => {
    await ingest(FIXTURES_DIR, TEST_DB)
    const db1 = new Database(TEST_DB)
    const row1 = db1.prepare(`SELECT last_ingested_at FROM agents WHERE slug = 'customer-support-triager'`).get() as { last_ingested_at: string }
    db1.close()
    const ts1 = row1.last_ingested_at

    // Wait 50ms to ensure timestamp difference
    await new Promise(resolve => setTimeout(resolve, 50))

    await ingest(FIXTURES_DIR, TEST_DB)
    const db2 = new Database(TEST_DB)
    const row2 = db2.prepare(`SELECT last_ingested_at FROM agents WHERE slug = 'customer-support-triager'`).get() as { last_ingested_at: string }
    db2.close()
    const ts2 = row2.last_ingested_at

    expect(ts2 > ts1).toBe(true)
  })

  it('populates fields correctly from valid fixture', async () => {
    await ingest(FIXTURES_DIR, TEST_DB)
    const db = new Database(TEST_DB)
    const row = db.prepare(`SELECT * FROM agents WHERE slug = 'customer-support-triager'`).get() as Record<string, unknown>
    db.close()

    expect(row.title).toBe('Customer Support Triager')
    expect(row.category).toBe('customer-support')
    expect(row.llm_name).toBe('gpt-4o')
    expect(row.requires_human_approval).toBe(0)
    expect(JSON.parse(row.tool_names as string).length).toBe(2)
    expect(JSON.parse(row.input_schema as string).length).toBe(2)
  })

  it('fresh insert defaults try_it_out columns to safe values', async () => {
    await ingest(FIXTURES_DIR, TEST_DB)
    const db = new Database(TEST_DB)
    const row = db.prepare(`SELECT try_it_out_mode, try_it_out_url, try_it_out_task_template FROM agents WHERE slug = 'customer-support-triager'`).get() as Record<string, unknown>
    db.close()

    expect(row.try_it_out_mode).toBe('none')
    expect(row.try_it_out_url).toBeNull()
    expect(row.try_it_out_task_template).toBeNull()
  })

  it('re-ingesting never clobbers a manually-set try_it_out value, but still refreshes other columns', async () => {
    await ingest(FIXTURES_DIR, TEST_DB)

    const dbBefore = new Database(TEST_DB)
    dbBefore
      .prepare(`UPDATE agents SET try_it_out_mode = 'external', try_it_out_url = 'https://example.com/try/x' WHERE slug = 'customer-support-triager'`)
      .run()
    const rowBefore = dbBefore.prepare(`SELECT last_ingested_at FROM agents WHERE slug = 'customer-support-triager'`).get() as { last_ingested_at: string }
    dbBefore.close()
    const tsBefore = rowBefore.last_ingested_at

    // Wait 50ms to ensure timestamp difference
    await new Promise(resolve => setTimeout(resolve, 50))

    await ingest(FIXTURES_DIR, TEST_DB)

    const dbAfter = new Database(TEST_DB)
    const rowAfter = dbAfter.prepare(`SELECT try_it_out_mode, try_it_out_url, last_ingested_at FROM agents WHERE slug = 'customer-support-triager'`).get() as Record<string, unknown>
    dbAfter.close()

    expect(rowAfter.try_it_out_mode).toBe('external')
    expect(rowAfter.try_it_out_url).toBe('https://example.com/try/x')
    expect(rowAfter.last_ingested_at as string > tsBefore).toBe(true)
  })
})

describe('embeddings', () => {
  function spied(): { embedder: Embedder; calls: string[][] } {
    const fake = createFakeEmbedder()
    const calls: string[][] = []
    const embed = vi.fn(async (texts: string[]) => {
      calls.push(texts)
      return fake.embed(texts)
    })
    return { embedder: { id: fake.id, embed }, calls }
  }

  function rows() {
    const db = new Database(TEST_DB)
    const r = db.prepare('SELECT slug, model, length(vector) as n FROM agent_embeddings ORDER BY slug').all() as {
      slug: string
      model: string
      n: number
    }[]
    db.close()
    return r
  }

  it('writes one embedding row per succeeded agent', async () => {
    const { embedder } = spied()
    const res = await ingest(FIXTURES_DIR, TEST_DB, { embedder })
    expect(res).toEqual({ succeeded: 2, failed: 1 })
    const r = rows()
    expect(r.length).toBe(2)
    for (const row of r) {
      expect(row.model).toBe('fake-hash')
      expect(row.n).toBe(384 * 4)
    }
  })

  it('skips unchanged text on re-ingest and re-embeds only changed text', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'ingest-emb-'))
    try {
      cpSync(FIXTURES_DIR, tmp, { recursive: true })
      const { embedder, calls } = spied()
      await ingest(tmp, TEST_DB, { embedder })
      expect(calls.length).toBe(1)
      expect(calls[0].length).toBe(2)

      await ingest(tmp, TEST_DB, { embedder })
      expect(calls.length).toBe(1)

      const f = join(tmp, 'valid-agent.yaml')
      writeFileSync(f, readFileSync(f, 'utf-8').replace('Routes incoming', 'Dispatches incoming'))
      await ingest(tmp, TEST_DB, { embedder })
      expect(calls.length).toBe(2)
      expect(calls[1].length).toBe(1)
      expect(calls[1][0]).toContain('Dispatches incoming')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('deletes embeddings whose slug is absent from agents', async () => {
    const { embedder } = spied()
    await ingest(FIXTURES_DIR, TEST_DB, { embedder })
    const db = new Database(TEST_DB)
    db.prepare(
      `INSERT INTO agent_embeddings (slug, model, content_hash, vector) VALUES ('ghost', 'fake-hash', 'x', x'00')`,
    ).run()
    db.close()
    await ingest(FIXTURES_DIR, TEST_DB, { embedder })
    expect(rows().map(r => r.slug)).not.toContain('ghost')
    expect(rows().length).toBe(2)
  })

  it('null embedder: no rows, same counts, no throw', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await ingest(FIXTURES_DIR, TEST_DB, { embedder: null })
    warn.mockRestore()
    expect(res).toEqual({ succeeded: 2, failed: 1 })
    expect(rows().length).toBe(0)
  })

  it('default (SEARCH_EMBEDDINGS=off) writes no embeddings', async () => {
    await ingest(FIXTURES_DIR, TEST_DB)
    expect(rows().length).toBe(0)
  })

  it('DB without agent_embeddings table skips embedding and warns to run db:push (IN-01)', async () => {
    const db = new Database(TEST_DB)
    db.exec('DROP TABLE agent_embeddings')
    db.close()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { embedder, calls } = spied()
    const res = await ingest(FIXTURES_DIR, TEST_DB, { embedder })
    expect(res.succeeded).toBe(2)
    expect(calls.length).toBe(0)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('run db:push'))
    warn.mockRestore()
  })

  it('closes the SQLite handle when ingest throws (IN-02)', async () => {
    const close = vi.spyOn(Database.prototype, 'close')
    try {
      await expect(ingest('./data/does-not-exist', TEST_DB)).rejects.toThrow()
      expect(close).toHaveBeenCalledTimes(1)
    } finally {
      close.mockRestore()
    }
  })

  it('embeds in bounded batches, one transaction per batch (WR-09)', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'ingest-batch-'))
    try {
      writeScaleFixtures(tmp, 40)
      const { embedder, calls } = spied()
      const res = await ingest(tmp, TEST_DB, { embedder })
      expect(res.succeeded).toBe(40)
      expect(calls.length).toBe(Math.ceil(40 / EMBED_BATCH_SIZE))
      for (const c of calls) expect(c.length).toBeLessThanOrEqual(EMBED_BATCH_SIZE)
      expect(calls.flat().length).toBe(40)
      expect(rows().length).toBe(40)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('rejects a batch whose vector count does not match the texts (WR-09)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fake = createFakeEmbedder()
    const embedder: Embedder = {
      id: fake.id,
      embed: async (texts: string[]) => (await fake.embed(texts)).slice(0, texts.length - 1),
    }
    const res = await ingest(FIXTURES_DIR, TEST_DB, { embedder })
    expect(res).toEqual({ succeeded: 2, failed: 1 })
    expect(rows().length).toBe(0)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('batch skipped'))
    warn.mockRestore()
  })

  it('stores only vectors of the right dimension; the rest are retried next ingest (WR-09)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fake = createFakeEmbedder()
    const embedder: Embedder = {
      id: fake.id,
      embed: async (texts: string[]) => {
        const v = await fake.embed(texts)
        v[0] = new Float32Array(8) // wrong dimension for the first text
        return v
      },
    }
    const res = await ingest(FIXTURES_DIR, TEST_DB, { embedder })
    expect(res).toEqual({ succeeded: 2, failed: 1 })
    expect(rows().length).toBe(1)
    expect(rows()[0].n).toBe(384 * 4)
    warn.mockRestore()

    const { embedder: good, calls } = spied()
    await ingest(FIXTURES_DIR, TEST_DB, { embedder: good })
    expect(calls.flat().length).toBe(1) // only the missing one is re-embedded
    expect(rows().length).toBe(2)
  })

  it('does not throw on an undefined or non-finite vector (WR-09)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fake = createFakeEmbedder()
    const embedder: Embedder = {
      id: fake.id,
      embed: async (texts: string[]) => {
        const v = await fake.embed(texts)
        v[0] = undefined as unknown as Float32Array
        v[1] = new Float32Array(384).fill(NaN)
        return v
      },
    }
    const res = await ingest(FIXTURES_DIR, TEST_DB, { embedder })
    expect(res).toEqual({ succeeded: 2, failed: 1 })
    expect(rows().length).toBe(0)
    warn.mockRestore()
  })

  it('a failing batch does not stop later batches (WR-09)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const tmp = mkdtempSync(join(tmpdir(), 'ingest-batchfail-'))
    try {
      writeScaleFixtures(tmp, EMBED_BATCH_SIZE * 2 + 1)
      const fake = createFakeEmbedder()
      let n = 0
      const embedder: Embedder = {
        id: fake.id,
        embed: async (texts: string[]) => {
          if (++n === 2) throw new Error('oom')
          return fake.embed(texts)
        },
      }
      await ingest(tmp, TEST_DB, { embedder })
      expect(n).toBe(3)
      expect(rows().length).toBe(EMBED_BATCH_SIZE + 1)
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('oom'))
    } finally {
      rmSync(tmp, { recursive: true, force: true })
      warn.mockRestore()
    }
  })

  it('writes a batch atomically: a failing row rolls back the whole batch (WR-09)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const db = new Database(TEST_DB)
    db.exec(
      `CREATE TRIGGER fail_one BEFORE INSERT ON agent_embeddings WHEN NEW.slug = 'minimal-agent' BEGIN SELECT RAISE(ABORT, 'boom'); END`,
    )
    db.close()
    const { embedder } = spied()
    const res = await ingest(FIXTURES_DIR, TEST_DB, { embedder })
    expect(res).toEqual({ succeeded: 2, failed: 1 })
    expect(rows()).toEqual([]) // the valid sibling in the same batch was rolled back too
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('writing embeddings failed'))
    warn.mockRestore()
  })
})

