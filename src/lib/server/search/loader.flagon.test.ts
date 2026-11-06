// Phase 13: the flag-on singleton loader (real sqlite file, real ingest), exercised directly.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let dir: string
const saved = { flag: process.env.AGENT_KINDS, db: process.env.CATALOG_DB_PATH, emb: process.env.SEARCH_EMBEDDINGS }

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'loader-flagon-'))
  const dbPath = join(dir, 'c.db')
  const data = join(dir, 'data')
  cpSync('./fixtures/submissions/oracle-swarm', join(data, 'oracle-swarm'), { recursive: true })
  const d = new Database(dbPath)
  d.exec(`CREATE TABLE agents (slug TEXT PRIMARY KEY, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', system_prompt TEXT NOT NULL, llm_name TEXT NOT NULL, llm_temperature REAL, llm_max_tokens INTEGER, llm_top_p REAL, tool_names TEXT NOT NULL DEFAULT '[]', input_schema TEXT NOT NULL DEFAULT '[]', requires_human_approval INTEGER NOT NULL DEFAULT 0, category TEXT, github_url TEXT, customizable_fields TEXT, fixed_fields TEXT NOT NULL DEFAULT '[]', fixed_note TEXT, link_label TEXT, maturity_status TEXT NOT NULL DEFAULT 'experimental', tags TEXT NOT NULL DEFAULT '[]', spec_id TEXT, try_it_out_mode TEXT NOT NULL DEFAULT 'none', try_it_out_url TEXT, try_it_out_task_template TEXT, last_ingested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`)
  d.close()
  process.env.AGENT_KINDS = 'on'
  process.env.CATALOG_DB_PATH = dbPath
  process.env.SEARCH_EMBEDDINGS = 'off'
  const { ingest } = await import('../../../../scripts/ingest.js')
  const res = await ingest(data, dbPath, { embedder: null })
  expect(res.failed).toBe(0)
})

afterAll(() => {
  for (const [k, v] of [
    ['AGENT_KINDS', saved.flag],
    ['CATALOG_DB_PATH', saved.db],
    ['SEARCH_EMBEDDINGS', saved.emb],
  ] as const) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  rmSync(dir, { recursive: true, force: true })
})

describe('flag-on singleton loader against a real db', () => {
  it('search finds the system by a member name stored only in agent_kinds', async () => {
    const { search } = await import('./index.js')
    const kinds = new Database(process.env.CATALOG_DB_PATH!, { readonly: true })
    const row = kinds.prepare('SELECT members FROM agent_kinds').get() as { members: string }
    kinds.close()
    const name = (JSON.parse(row.members) as Array<{ name: string }>)[0].name
    const hit = await search(name)
    expect(hit.results.map((r) => r.slug)).toContain('example-support-swarm')
  })
})
