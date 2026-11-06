// Phase 13 flag-off regression proof: with AGENT_KINDS unset, '0' or 'off' the legacy behaviour is
// byte-identical to the golden snapshot, even when multi-format submissions sit next to legacy data.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync, readFileSync, readdirSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { getTableConfig } from 'drizzle-orm/sqlite-core'
import { ingest } from './ingest.js'
import { agents } from '../drizzle/schema.js'
import { detectFormat, normalize } from '../src/lib/spec/index.js'
import { buildSearchText, contentHash, recordToSearchable } from '../src/lib/server/search/documents.js'
import { agentKindsEnabled } from '../src/lib/flags.js'

const golden = JSON.parse(readFileSync('./scripts/__golden__/flag-off.json', 'utf8'))

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

let tmp: string
let saved: string | undefined

beforeEach(() => {
  saved = process.env.AGENT_KINDS
  tmp = mkdtempSync(join(tmpdir(), 'flagreg-'))
})
afterEach(() => {
  if (saved === undefined) delete process.env.AGENT_KINDS
  else process.env.AGENT_KINDS = saved
  rmSync(tmp, { recursive: true, force: true })
})

const OFF_VALUES: Array<string | undefined> = [undefined, '0', 'off']

describe.each(OFF_VALUES)('flag-off invariants (AGENT_KINDS=%s)', (value) => {
  const setFlag = () => {
    if (value === undefined) delete process.env.AGENT_KINDS
    else process.env.AGENT_KINDS = value
  }

  it('flag reads as off', () => {
    setFlag()
    expect(agentKindsEnabled()).toBe(false)
  })

  it('legacy dir plus copied multi-format submissions: golden rows, no sidecar table, new formats rejected', async () => {
    setFlag()
    const dir = join(tmp, 'data')
    cpSync('./data/agents', dir, { recursive: true, filter: (s) => !s.endsWith('fixtures') && !s.includes('/fixtures/') })
    // Multi-format submissions as sub-folders and as top-level files.
    cpSync('./fixtures/submissions', join(dir, 'submissions'), { recursive: true })
    cpSync('./fixtures/submissions/oracle-swarm/swarm.yaml', join(dir, 'swarm.yaml'))

    const dbPath = join(tmp, 'c.db')
    const d = new Database(dbPath)
    d.exec(LEGACY_DDL)
    d.close()
    const result = await ingest(dir, dbPath, { embedder: null })
    // Sub-directories are never scanned when the flag is off; only the swarm file fails.
    expect(result).toEqual({ succeeded: golden.ingest.top.result.succeeded, failed: 1 })

    const db = new Database(dbPath)
    const rows = (db.prepare('SELECT * FROM agents ORDER BY slug').all() as Array<Record<string, unknown>>).map((r) => {
      const { last_ingested_at: _t, ...rest } = r
      void _t
      return rest
    })
    const cols = (db.prepare('PRAGMA table_info(agents)').all() as { name: string }[]).map((c) => c.name)
    const sidecar = db.prepare(`SELECT name FROM sqlite_master WHERE name = 'agent_kinds'`).all()
    db.close()
    expect(rows).toEqual(golden.ingest.top.rows)
    expect(cols).toEqual(golden.agentsColumns.afterIngest)
    expect(sidecar).toHaveLength(0)
  })

  it('search text and hashes equal the golden for every legacy slug', () => {
    setFlag()
    const dir = './data/agents'
    let n = 0
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.yaml')).sort()) {
      try {
        const raw = parseYaml(readFileSync(join(dir, f), 'utf8'))
        const rec = normalize(detectFormat(raw), raw)
        const text = buildSearchText(recordToSearchable(rec))
        expect(golden.searchText[rec.slug]).toEqual({ text, hash: contentHash('golden-model', text) })
        n++
      } catch (e) {
        if ((e as Error).name === 'AssertionError') throw e
      }
    }
    expect(n).toBe(Object.keys(golden.searchText).length)
  })

  it('drizzle agents columns are unchanged and detectFormat still rejects systems', () => {
    setFlag()
    expect(getTableConfig(agents).columns.map((c) => c.name).sort()).toEqual(golden.agentsColumns.drizzle)
    expect(() => detectFormat({ component_type: 'Swarm' })).toThrow(golden.unrecognizedErrors.componentTypeSwarm)
    expect(() => detectFormat({ type: 'Swarm' })).toThrow(/Unrecognized/)
  })
})
