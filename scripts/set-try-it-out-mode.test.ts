import { describe, it, expect, afterEach } from 'vitest'
import { ingest } from './ingest.js'
import { setTryItOutMode } from './set-try-it-out-mode.js'
import Database from 'better-sqlite3'
import { existsSync, rmSync } from 'node:fs'

const TEST_DB = './db/test-set-try-it-out-mode.db'
const DATA_DIR = './data/agents'

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
)
`

function cleanup() {
  for (const suffix of ['', '-wal', '-shm']) {
    const path = `${TEST_DB}${suffix}`
    if (existsSync(path)) {
      rmSync(path)
    }
  }
}

afterEach(() => {
  cleanup()
})

describe('setTryItOutMode', () => {
  it('sets etim-classification-repair and qto-normalization to runnable', async () => {
    cleanup()
    const db = new Database(TEST_DB)
    db.exec(CREATE_TABLE_SQL)
    db.close()

    await ingest(DATA_DIR, TEST_DB)

    const results = setTryItOutMode(TEST_DB)
    expect(results).toEqual(
      expect.arrayContaining([
        { slug: 'etim-classification-repair', mode: 'runnable', changes: 1 },
        { slug: 'qto-normalization', mode: 'runnable', changes: 1 },
      ])
    )

    const verifyDb = new Database(TEST_DB)
    const rows = verifyDb
      .prepare(
        `SELECT slug, try_it_out_mode AS mode, try_it_out_url AS url, try_it_out_task_template AS taskTemplate
         FROM agents WHERE slug IN ('etim-classification-repair', 'qto-normalization')`
      )
      .all() as Array<{ slug: string; mode: string; url: string | null; taskTemplate: string | null }>
    verifyDb.close()

    const bySlug = Object.fromEntries(rows.map(r => [r.slug, r]))
    expect(bySlug['etim-classification-repair'].mode).toBe('runnable')
    expect(bySlug['etim-classification-repair'].url).toBeNull()
    expect(bySlug['etim-classification-repair'].taskTemplate).toBeNull()
    expect(bySlug['qto-normalization'].mode).toBe('runnable')
    expect(bySlug['qto-normalization'].url).toBeNull()
    expect(bySlug['qto-normalization'].taskTemplate).toBeNull()
  })

  it('throws if a targeted slug does not exist in the DB', async () => {
    cleanup()
    const db = new Database(TEST_DB)
    db.exec(CREATE_TABLE_SQL)
    db.close()

    // No ingest run — the agents table is empty, so targeted slugs are missing.
    expect(() => setTryItOutMode(TEST_DB)).toThrow(/no row matched slug 'etim-classification-repair'/)
  })

  it('is idempotent — running twice leaves the same end state', async () => {
    cleanup()
    const db = new Database(TEST_DB)
    db.exec(CREATE_TABLE_SQL)
    db.close()

    await ingest(DATA_DIR, TEST_DB)

    setTryItOutMode(TEST_DB)
    setTryItOutMode(TEST_DB)

    const verifyDb = new Database(TEST_DB)
    const rows = verifyDb
      .prepare(
        `SELECT slug, try_it_out_mode AS mode FROM agents WHERE slug IN ('etim-classification-repair', 'qto-normalization')`
      )
      .all() as Array<{ slug: string; mode: string }>
    verifyDb.close()

    const bySlug = Object.fromEntries(rows.map(r => [r.slug, r.mode]))
    expect(bySlug['etim-classification-repair']).toBe('runnable')
    expect(bySlug['qto-normalization']).toBe('runnable')
  })

  it('re-ingesting after the mode flip does not reset try_it_out_mode back to none (Phase 5 no-clobber guarantee)', async () => {
    cleanup()
    const db = new Database(TEST_DB)
    db.exec(CREATE_TABLE_SQL)
    db.close()

    await ingest(DATA_DIR, TEST_DB)
    setTryItOutMode(TEST_DB)

    // Re-run ingest against the same DB — this must NOT clobber the mode we just set.
    await ingest(DATA_DIR, TEST_DB)

    const verifyDb = new Database(TEST_DB)
    const row = verifyDb
      .prepare(`SELECT try_it_out_mode AS mode FROM agents WHERE slug = 'etim-classification-repair'`)
      .get() as { mode: string }
    verifyDb.close()

    expect(row.mode).toBe('runnable')
  })
})
