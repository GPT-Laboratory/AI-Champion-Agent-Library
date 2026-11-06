import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { existsSync, rmSync, mkdirSync, cpSync, copyFileSync } from 'node:fs'
import { ingest, ingestAll } from './ingest.js'
import { createFakeEmbedder } from '../src/lib/server/search/embedder.fake.js'
import { LOCAL_MCP_SERVER_SLUGS, LVI_AGENT_SLUG } from '../src/lib/localMcp/slugs.js'

const DB = './db/test-local-mcp.db'
const TMP = './db/test-local-mcp-dirs'
const MAIN = `${TMP}/agents`
const LOCAL = `${TMP}/agents-local`
const SLUGS: string[] = [...LOCAL_MCP_SERVER_SLUGS]

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

function freshDb(): void {
  const db = new Database(DB)
  db.exec(LEGACY_DDL)
  db.close()
}

function q<T>(sql: string): T[] {
  const db = new Database(DB)
  try {
    return db.prepare(sql).all() as T[]
  } finally {
    db.close()
  }
}

const saved: Record<string, string | undefined> = {}
beforeEach(() => {
  for (const k of ['AGENT_KINDS', 'LOCAL_MCP_AGENTS']) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
  for (const p of [DB, TMP]) if (existsSync(p)) rmSync(p, { recursive: true })
  mkdirSync(MAIN, { recursive: true })
  cpSync('./data/agents-local', LOCAL, { recursive: true })
  mkdirSync('./db', { recursive: true })
  freshDb()
})
afterEach(() => {
  for (const k of Object.keys(saved)) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  for (const p of [DB, TMP]) if (existsSync(p)) rmSync(p, { recursive: true })
})

const opts = () => ({ embedder: createFakeEmbedder(), localDir: LOCAL })

describe('ingestAll local-MCP second pass', () => {
  it('flag on + AGENT_KINDS on: the three entries ingest as mcp-server', async () => {
    process.env.AGENT_KINDS = 'on'
    process.env.LOCAL_MCP_AGENTS = 'on'
    await ingestAll(MAIN, DB, opts())
    const rows = q<{ slug: string; kind: string; extras: string | null }>(
      `SELECT slug, kind, extras FROM agent_kinds WHERE kind='mcp-server' ORDER BY slug`,
    )
    expect(rows.map((r) => r.slug).sort()).toEqual([...SLUGS].sort())
    for (const r of rows) expect(r.extras ?? '').not.toContain('<set locally>')
  })

  it('flag off: the local directory is not read', async () => {
    process.env.AGENT_KINDS = 'on'
    await ingestAll(MAIN, DB, opts())
    const slugs = q<{ slug: string }>('SELECT slug FROM agents').map((r) => r.slug)
    for (const s of SLUGS) expect(slugs).not.toContain(s)
  })

  it('flag off after a flag-on ingest: local slugs are purged, others untouched', async () => {
    copyFileSync('./data/agents/airo.yaml', `${MAIN}/keep.yaml`)
    process.env.AGENT_KINDS = 'on'
    process.env.LOCAL_MCP_AGENTS = 'on'
    await ingestAll(MAIN, DB, opts())
    const db = new Database(DB)
    db.prepare(
      `INSERT INTO agents (slug, title, system_prompt, llm_name) VALUES (?, 'x', 'p', 'm')`,
    ).run(LVI_AGENT_SLUG)
    db.close()
    const before = q<{ slug: string }>('SELECT slug FROM agents').map((r) => r.slug)
    expect(before).toContain(LVI_AGENT_SLUG)
    for (const s of SLUGS) expect(before).toContain(s)
    const keepBefore = q<{ slug: string }>('SELECT slug FROM agents').filter(
      (r) => !SLUGS.includes(r.slug) && r.slug !== LVI_AGENT_SLUG,
    )
    expect(keepBefore.length).toBeGreaterThan(0)

    process.env.LOCAL_MCP_AGENTS = 'off'
    await ingestAll(MAIN, DB, opts())
    const after = q<{ slug: string }>('SELECT slug FROM agents').map((r) => r.slug)
    for (const s of [...SLUGS, LVI_AGENT_SLUG]) expect(after).not.toContain(s)
    expect(after.sort()).toEqual(keepBefore.map((r) => r.slug).sort())
    expect(q('SELECT slug FROM agent_kinds').map((r) => (r as { slug: string }).slug)).not.toEqual(
      expect.arrayContaining(SLUGS),
    )
    expect(
      q<{ slug: string }>('SELECT slug FROM agent_embeddings').filter((r) => SLUGS.includes(r.slug)),
    ).toHaveLength(0)
  })

  it('flag off, fresh DB: purge is a no-op without error even when agent_kinds is missing', async () => {
    copyFileSync('./data/agents/airo.yaml', `${MAIN}/keep.yaml`)
    const res = await ingestAll(MAIN, DB, opts())
    expect(res.failed).toBe(0)
    expect(q<{ slug: string }>('SELECT slug FROM agents')).toHaveLength(1)
  })

  it('flag off result equals plain ingest (same row count)', async () => {
    copyFileSync('./data/agents/airo.yaml', `${MAIN}/keep.yaml`)
    const a = await ingestAll(MAIN, DB, opts())
    rmSync(DB)
    freshDb()
    const b = await ingest(MAIN, DB, { embedder: createFakeEmbedder() })
    expect(a).toEqual(b)
  })
})
