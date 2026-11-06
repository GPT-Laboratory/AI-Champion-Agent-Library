import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { existsSync, rmSync, readFileSync, readdirSync } from 'node:fs'
import { validateSubmissionPath } from './validate-submission.js'
import { ingest } from './ingest.js'
import { createFakeEmbedder } from '../src/lib/server/search/embedder.fake.js'

const SLUGS = ['stk-mcp', 'stk-catalog-mcp', 'lvi-info-mcp']
const REAL_DIR = './data/agents'
const LOCAL_DIR = './data/agents-local'
const DB_ON = './db/test-mcp-entries-on.db'
const DB_OFF = './db/test-mcp-entries-off.db'

const LEGACY_DDL = `
CREATE TABLE IF NOT EXISTS agents (
  slug TEXT PRIMARY KEY, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', system_prompt TEXT NOT NULL,
  llm_name TEXT NOT NULL, llm_temperature REAL, llm_max_tokens INTEGER, llm_top_p REAL,
  tool_names TEXT NOT NULL DEFAULT '[]', input_schema TEXT NOT NULL DEFAULT '[]',
  requires_human_approval INTEGER NOT NULL DEFAULT 0, category TEXT, github_url TEXT, customizable_fields TEXT,
  fixed_fields TEXT NOT NULL DEFAULT '[]', fixed_note TEXT, link_label TEXT,
  maturity_status TEXT NOT NULL DEFAULT 'experimental', tags TEXT NOT NULL DEFAULT '[]', spec_id TEXT,
  try_it_out_mode TEXT NOT NULL DEFAULT 'none', try_it_out_url TEXT, try_it_out_task_template TEXT,
  last_ingested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE TABLE IF NOT EXISTS agent_embeddings (
  slug TEXT PRIMARY KEY, model TEXT NOT NULL, content_hash TEXT NOT NULL, vector BLOB NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
)
`

function freshDb(path: string): void {
  if (existsSync(path)) rmSync(path)
  const db = new Database(path)
  db.exec(LEGACY_DDL)
  db.close()
}
function q<T>(path: string, sql: string): T[] {
  const db = new Database(path)
  try {
    return db.prepare(sql).all() as T[]
  } finally {
    db.close()
  }
}

let prevFlag: string | undefined
beforeEach(() => {
  prevFlag = process.env.AGENT_KINDS
  delete process.env.AGENT_KINDS
  freshDb(DB_ON)
  freshDb(DB_OFF)
})
afterEach(() => {
  if (prevFlag === undefined) delete process.env.AGENT_KINDS
  else process.env.AGENT_KINDS = prevFlag
  for (const p of [DB_ON, DB_OFF]) if (existsSync(p)) rmSync(p)
})

describe('mcp-server entries in data/agents-local', () => {
  it.each(SLUGS)('%s validates as catalog-manifest / mcp-server / ingestible', (slug) => {
    const r = validateSubmissionPath(`${LOCAL_DIR}/${slug}`)
    expect(r.items).toHaveLength(1)
    expect(r.items[0]).toMatchObject({ format: 'catalog-manifest', kind: 'mcp-server', status: 'ingestible' })
    expect(JSON.stringify(r)).not.toMatch(/sk-[A-Za-z0-9_-]{8,}/)
  })

  it.each(SLUGS)('%s carries env variable names only, no real values', (slug) => {
    const text = readFileSync(`${LOCAL_DIR}/${slug}/catalog.yaml`, 'utf8')
    for (const line of text.split('\n').filter((l) => /^ {2}[A-Z_]+:/.test(l))) {
      expect(line).toContain('"<set locally>"')
    }
  })

  it('flag on: ingest records the three entries as kind mcp-server with framework', async () => {
    process.env.AGENT_KINDS = 'on'
    await ingest(REAL_DIR, DB_ON, { embedder: createFakeEmbedder() })
    await ingest(LOCAL_DIR, DB_ON, { embedder: createFakeEmbedder() })
    const rows = q<{ slug: string; kind: string; framework: string | null; extras: string | null }>(
      DB_ON,
      `SELECT slug, kind, framework, extras FROM agent_kinds WHERE kind = 'mcp-server' ORDER BY slug`,
    )
    expect(rows.map((r) => r.slug).sort()).toEqual([...SLUGS].sort())
    expect(rows.find((r) => r.slug === 'stk-mcp')?.framework).toBe('fastmcp')
    expect(rows.find((r) => r.slug === 'stk-catalog-mcp')?.framework).toBe('json-rpc')
    for (const r of rows) expect(r.extras ?? '').not.toContain('<set locally>')
  })

  it('flag off: the three entries are absent and the existing agents still ingest', async () => {
    const res = await ingest(REAL_DIR, DB_OFF, { embedder: createFakeEmbedder() })
    expect(res.failed).toBe(0)
    const slugs = q<{ slug: string }>(DB_OFF, 'SELECT slug FROM agents').map((r) => r.slug)
    for (const s of SLUGS) expect(slugs).not.toContain(s)
    expect(slugs).toContain('airo')
    // Derived from data/agents so adding a catalog agent needs no edit here: top-level agent YAMLs (the mcp-server entries live in data/agents-local, so nothing in data/agents is a subdirectory entry).
    const agentYamls = readdirSync(REAL_DIR).filter((f) => f.endsWith('.yaml')).length
    expect(slugs).toHaveLength(agentYamls)
  })
})
