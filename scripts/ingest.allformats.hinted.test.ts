// Phase 13: flag-on ingest over every synthetic submission in fixtures/submissions.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { existsSync, rmSync, mkdtempSync, cpSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ingest } from './ingest.js'

const TEST_DB = './db/test-catalog-allformats.db'
const SUBMISSIONS = './fixtures/submissions'
const GOLDEN = './scripts/__golden__/flag-off.json'

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

type KindRow = {
  slug: string
  kind: string
  framework: string | null
  topology: string | null
  members: string
  extras: string | null
}

let prevFlag: string | undefined
let work: string

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
  process.env.AGENT_KINDS = 'on'
  work = mkdtempSync(join(tmpdir(), 'allformats-'))
  cpSync(SUBMISSIONS, work, { recursive: true })
  if (existsSync(TEST_DB)) rmSync(TEST_DB)
  const db = new Database(TEST_DB)
  db.exec(LEGACY_DDL)
  db.close()
})

afterEach(() => {
  if (prevFlag === undefined) delete process.env.AGENT_KINDS
  else process.env.AGENT_KINDS = prevFlag
  if (existsSync(TEST_DB)) rmSync(TEST_DB)
  rmSync(work, { recursive: true, force: true })
})

const EXPECTED: Array<[string, string, string | null, string | null, number]> = [
  ['crewai-yaml', 'system', 'crewai', 'pipeline', 2],
  ['example-remote-agent', 'external-agent', 'oracle-agentspec', null, 0],
  ['example-report-flow', 'system', 'oracle-agentspec', 'pipeline', 2],
  ['example-research-crew', 'system', 'crewai', 'pipeline', 2],
  ['example-research-graph', 'system', 'langgraph', 'graph', 3],
  ['example-review-team', 'system', 'oracle-agentspec', 'manager-workers', 3],
  ['example-reviewer', 'agent', 'claude-subagent', null, 0],
  ['example-single-agent', 'agent', 'oracle-agentspec', null, 0],
  ['example-support-swarm', 'system', 'oracle-agentspec', 'swarm', 3],
  ['example-weather-mcp', 'mcp-server', null, null, 0],
  ['io-github-example-acme-catalog-server', 'mcp-server', 'mcp', null, 0],
  ['langgraph', 'system', 'langgraph', null, 0],
  ['skill-example', 'skill', 'agent-skills', null, 0],
]

const snapshot = () =>
  q<KindRow>('SELECT * FROM agent_kinds ORDER BY slug').map(r => [r.slug, r.kind, r.framework, r.topology, JSON.parse(r.members).length])

describe('flag-on ingest of all fixtures/submissions', () => {
  it('ingests every folder with the expected kind, framework, topology and member count', async () => {
    const res = await ingest(work, TEST_DB, { embedder: null })
    expect(res).toEqual({ succeeded: 13, failed: 0 })
    expect(snapshot()).toEqual(EXPECTED)
    expect(q<{ n: number }>('SELECT count(*) AS n FROM agents')[0].n).toBe(13)
    const mgr = JSON.parse(q<KindRow>(`SELECT * FROM agent_kinds WHERE slug = 'example-review-team'`)[0].members) as Array<{ role?: string }>
    expect(mgr.filter(m => m.role === 'manager')).toHaveLength(1)
  })

  it('is idempotent on re-run', async () => {
    await ingest(work, TEST_DB, { embedder: null })
    const before = snapshot()
    const res = await ingest(work, TEST_DB, { embedder: null })
    expect(res.failed).toBe(0)
    expect(snapshot()).toEqual(before)
    expect(q<{ n: number }>('SELECT count(*) AS n FROM agents')[0].n).toBe(13)
  })

  it('stores no secrets and keeps every extras blob within 16 KiB', async () => {
    const dir = join(work, 'secret-manifest')
    mkdirSync(dir)
    writeFileSync(
      join(dir, 'catalog.yaml'),
      [
        'name: Secret Probe',
        'kind: mcp-server',
        'summary: Synthetic manifest carrying fake secrets.',
        'category: Testing',
        'api_key: sk-FAKEFAKEFAKEFAKEFAKEFAKE1234',
        'notes: token sk-ABCDEFGHIJKLMNOPQRSTUV123456 inline',
        'mcp:',
        '  env:',
        '    API_TOKEN: sk-ZZZZZZZZZZZZZZZZZZZZZZZZZZ',
        '',
      ].join('\n'),
    )
    const res = await ingest(work, TEST_DB, { embedder: null })
    expect(res.failed).toBe(0)
    const all = q<{ slug: string; extras: string | null }>('SELECT slug, extras FROM agent_kinds')
    expect(all.length).toBe(14)
    for (const r of all) {
      expect(r.extras ?? '').not.toMatch(/sk-[A-Za-z0-9]{8,}/)
      expect(Buffer.byteLength(r.extras ?? '')).toBeLessThanOrEqual(16384)
    }
    // The base agents row must be clean too.
    const rows = JSON.stringify(q<Record<string, unknown>>('SELECT * FROM agents'))
    expect(rows).not.toMatch(/sk-[A-Za-z0-9]{8,}/)
  })

  it('reports slug collisions as failed instead of throwing', async () => {
    cpSync(join(work, 'oracle-swarm'), join(work, 'oracle-swarm-copy'), { recursive: true })
    const res = await ingest(work, TEST_DB, { embedder: null })
    expect(res.failed).toBe(1)
    expect(res.succeeded).toBe(13)
    expect(q<{ n: number }>('SELECT count(*) AS n FROM agent_kinds')[0].n).toBe(13)
  })

  it('flag on with legacy-only data: base agents rows equal the flag-off golden rows', async () => {
    const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')).ingest.top.rows as Array<Record<string, unknown>>
    const legacy = mkdtempSync(join(tmpdir(), 'allformats-legacy-'))
    try {
      cpSync('./data/agents', legacy, { recursive: true, filter: s => !s.endsWith('fixtures') && !s.includes('/fixtures/') && !existsSync(join(s, 'catalog.yaml')) && !/data\/agents\/[^/]+\/catalog\.yaml$/.test(s) })
      const res = await ingest(legacy, TEST_DB, { embedder: null })
      expect(res.failed).toBe(0)
      const rows = q<Record<string, unknown>>('SELECT * FROM agents ORDER BY slug').map(r => {
        const { last_ingested_at: _t, ...rest } = r
        void _t
        return rest
      })
      expect(rows).toEqual(golden)
      expect(q<{ kind: string }>('SELECT kind FROM agent_kinds').every(k => k.kind === 'agent')).toBe(true)
    } finally {
      rmSync(legacy, { recursive: true, force: true })
    }
  })
})
