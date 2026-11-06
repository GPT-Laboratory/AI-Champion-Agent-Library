import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { existsSync, rmSync, mkdtempSync, cpSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ingest } from './ingest.js'
import { createFakeEmbedder } from '../src/lib/server/search/embedder.fake.js'
import type { Embedder } from '../src/lib/server/search/embedder.js'

const TEST_DB = './db/test-catalog-kinds.db'
const SUBMISSIONS = './fixtures/submissions'
const REAL_DIR = './data/agents'

// Legacy DDL: the agents table only (no agent_kinds, no embeddings table).
const LEGACY_DDL = `
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

const BASE_COLS = [
  'slug', 'title', 'summary', 'system_prompt', 'llm_name', 'llm_temperature', 'llm_max_tokens', 'llm_top_p',
  'tool_names', 'input_schema', 'requires_human_approval', 'category', 'github_url', 'customizable_fields',
  'fixed_fields', 'fixed_note', 'link_label', 'maturity_status', 'tags', 'spec_id',
  'try_it_out_mode', 'try_it_out_url', 'try_it_out_task_template',
].join(', ')

let tmp: string
let prevFlag: string | undefined

function oracleDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kinds-oracle-'))
  for (const f of readdirSync(SUBMISSIONS)) {
    if (f.startsWith('oracle-')) cpSync(join(SUBMISSIONS, f), join(dir, f), { recursive: true })
  }
  return dir
}

function q<T>(sql: string): T[] {
  const db = new Database(TEST_DB)
  try {
    return db.prepare(sql).all() as T[]
  } finally {
    db.close()
  }
}

beforeEach(() => {
  prevFlag = process.env.AGENT_KINDS
  delete process.env.AGENT_KINDS
  tmp = mkdtempSync(join(tmpdir(), 'ingest-kinds-'))
  if (existsSync(TEST_DB)) rmSync(TEST_DB)
  const db = new Database(TEST_DB)
  db.exec(LEGACY_DDL)
  db.close()
})

afterEach(() => {
  if (prevFlag === undefined) delete process.env.AGENT_KINDS
  else process.env.AGENT_KINDS = prevFlag
  if (existsSync(TEST_DB)) rmSync(TEST_DB)
  rmSync(tmp, { recursive: true, force: true })
})

describe('ingest with AGENT_KINDS on', () => {
  it('ingests oracle fixtures into agents + agent_kinds (legacy DDL db)', async () => {
    process.env.AGENT_KINDS = '1'
    const dir = oracleDir()
    mkdirSync(join(dir, 'garbage-folder'))
    writeFileSync(join(dir, 'garbage-folder', 'notes.txt'), 'nothing to see here')
    writeFileSync(join(dir, 'broken.yaml'), 'component_type: Swarm\nagents: [unclosed')
    const res = await ingest(dir, TEST_DB)
    expect(res.failed).toBe(1)
    expect(res.succeeded).toBeGreaterThanOrEqual(3)

    const kinds = q<{ slug: string; kind: string; topology: string | null; members: string; framework: string | null }>(
      'SELECT slug, kind, topology, members, framework FROM agent_kinds',
    )
    const swarm = kinds.find(k => k.slug === 'example-support-swarm')
    expect(swarm?.kind).toBe('system')
    expect(swarm?.topology).toBe('swarm')
    expect(JSON.parse(swarm!.members)).toHaveLength(3)
    expect(kinds.some(k => k.kind === 'external-agent')).toBe(true)
    expect(kinds.some(k => k.kind === 'agent')).toBe(true)

    const row = q<{ llm_name: string; try_it_out_mode: string; title: string }>(
      `SELECT llm_name, try_it_out_mode, title FROM agents WHERE slug = 'example-support-swarm'`,
    )[0]
    expect(row.llm_name).toBe('n/a')
    expect(row.try_it_out_mode).toBe('none')
    expect(row.title).toBe('Example Support Swarm')
    // garbage folder produced neither a row nor a failure
    expect(q<{ n: number }>('SELECT count(*) AS n FROM agents')[0].n).toBe(kinds.length)
  })

  it('is idempotent and advances updated_at', async () => {
    process.env.AGENT_KINDS = '1'
    const dir = oracleDir()
    await ingest(dir, TEST_DB)
    const a = q<{ slug: string; updated_at: string }>('SELECT slug, updated_at FROM agent_kinds ORDER BY slug')
    const n1 = q<{ n: number }>('SELECT count(*) AS n FROM agents')[0].n
    await new Promise(r => setTimeout(r, 20))
    await ingest(dir, TEST_DB)
    const b = q<{ slug: string; updated_at: string }>('SELECT slug, updated_at FROM agent_kinds ORDER BY slug')
    expect(q<{ n: number }>('SELECT count(*) AS n FROM agents')[0].n).toBe(n1)
    expect(b.map(x => x.slug)).toEqual(a.map(x => x.slug))
    expect(b[0].updated_at > a[0].updated_at).toBe(true)
  })

  it('removes agent_kinds rows whose agent is gone', async () => {
    process.env.AGENT_KINDS = '1'
    await ingest(oracleDir(), TEST_DB)
    const total = q('SELECT 1 FROM agent_kinds').length
    const db = new Database(TEST_DB)
    db.pragma('foreign_keys = OFF')
    db.prepare(`DELETE FROM agents WHERE slug = 'example-support-swarm'`).run()
    db.close()
    await ingest(mkdtempSync(join(tmpdir(), 'kinds-empty-')), TEST_DB)
    expect(q('SELECT 1 FROM agent_kinds')).toHaveLength(total - 1)
    expect(q(`SELECT 1 FROM agent_kinds WHERE slug = 'example-support-swarm'`)).toHaveLength(0)
    expect(q(`SELECT 1 FROM agent_kinds WHERE slug NOT IN (SELECT slug FROM agents)`)).toHaveLength(0)
  })

  it('real data/agents: base columns equal flag-off, all kind agent', async () => {
    await ingest(REAL_DIR, TEST_DB)
    const off = q<Record<string, unknown>>(`SELECT ${BASE_COLS} FROM agents ORDER BY slug`)
    rmSync(TEST_DB)
    const db = new Database(TEST_DB)
    db.exec(LEGACY_DDL)
    db.close()
    process.env.AGENT_KINDS = 'on'
    await ingest(REAL_DIR, TEST_DB)
    // Flag on also scans sub-directories as submissions, except directories named `fixtures` (D-466; D-039 used to
    // pick up data/agents/fixtures/minimal-agent here). The flag-on catalog is now exactly the flag-off catalog.
    const onAll = q<Record<string, unknown>>(`SELECT ${BASE_COLS} FROM agents ORDER BY slug`)
    const offSlugs = new Set(off.map(r => r.slug))
    expect(onAll.filter(r => offSlugs.has(r.slug))).toEqual(off)
    // Phase 24: data/agents/<slug>/catalog.yaml holds the library's own mcp-server entries; only those are added.
    const extra = onAll.filter(r => !offSlugs.has(r.slug)).map(r => r.slug)
    const mcpKinds = q<{ slug: string }>(`SELECT slug FROM agent_kinds WHERE kind = 'mcp-server' ORDER BY slug`).map(r => r.slug)
    expect([...extra].sort()).toEqual(mcpKinds)
    const kinds = q<{ kind: string }>('SELECT kind FROM agent_kinds')
    expect(kinds).toHaveLength(onAll.length)
    expect(kinds.filter(k => k.kind !== 'mcp-server').every(k => k.kind === 'agent')).toBe(true)
  })

  it('never overwrites try_it_out columns on upsert (D-07)', async () => {
    process.env.AGENT_KINDS = '1'
    const dir = oracleDir()
    await ingest(dir, TEST_DB)
    const db = new Database(TEST_DB)
    db.prepare(`UPDATE agents SET try_it_out_mode = 'external', try_it_out_url = 'https://example.com/x' WHERE slug = 'example-support-swarm'`).run()
    db.close()
    await ingest(dir, TEST_DB)
    const r = q<{ try_it_out_mode: string; try_it_out_url: string }>(
      `SELECT try_it_out_mode, try_it_out_url FROM agents WHERE slug = 'example-support-swarm'`,
    )[0]
    expect(r.try_it_out_mode).toBe('external')
    expect(r.try_it_out_url).toBe('https://example.com/x')
  })

  it('flag-on embeddings use kind text; flag-off uses the old text', async () => {
    const run = async (): Promise<string[]> => {
      const texts: string[] = []
      const base = createFakeEmbedder()
      const embedder: Embedder = {
        ...base,
        embed: async (t: string[]) => {
          texts.push(...t)
          return base.embed(t)
        },
      }
      await ingest(oracleDir(), TEST_DB, { embedder })
      return texts
    }
    const off = await run()
    rmSync(TEST_DB)
    const db = new Database(TEST_DB)
    db.exec(LEGACY_DDL)
    db.close()
    process.env.AGENT_KINDS = '1'
    const on = await run()
    const swarmOn = on.find(t => t.startsWith('Example Support Swarm'))
    expect(swarmOn).toContain('Example Triage Agent')
    expect(swarmOn).toContain('system')
    const swarmOff = off.find(t => t.startsWith('Example Support Swarm')) // flag off: swarm not ingested via registry
    expect(swarmOff).toBeUndefined()
  })

  it('stores redacted extras (no raw secrets)', async () => {
    process.env.AGENT_KINDS = '1'
    const dir = mkdtempSync(join(tmpdir(), 'kinds-secret-'))
    mkdirSync(join(dir, 'sw'))
    const src = readFileSync(join(SUBMISSIONS, 'oracle-swarm', 'swarm.yaml'), 'utf8')
    writeFileSync(
      join(dir, 'sw', 'swarm.yaml'),
      src.replace('handoff: optional', 'handoff: optional\nconfig:\n  api_key: sk-abcdefgh1234\n  token: "sk-abcdefgh1234"'),
    )
    const res = await ingest(dir, TEST_DB)
    expect(res.succeeded).toBe(1)
    const r = q<{ extras: string; members: string }>('SELECT extras, members FROM agent_kinds')[0]
    expect(r.extras).not.toContain('sk-abcdefgh1234')
    expect(r.members).not.toContain('sk-abcdefgh1234')
    expect(Buffer.byteLength(r.extras)).toBeLessThanOrEqual(16384 + 64)
  })
})
