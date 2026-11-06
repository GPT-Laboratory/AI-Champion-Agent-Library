// Golden snapshot of flag-off (AGENT_KINDS unset) behaviour. Captured BEFORE Phase 13 changes.
// Regenerate only deliberately: UPDATE_GOLDEN=1 npx vitest run scripts/flag-off.golden.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { getTableConfig } from 'drizzle-orm/sqlite-core'
import { ingest } from './ingest.js'
import { agents } from '../drizzle/schema.js'
import { detectFormat, normalize } from '../src/lib/spec/index.js'
import {
  buildSearchText,
  contentHash,
  recordToSearchable,
} from '../src/lib/server/search/documents.js'

const GOLDEN = './scripts/__golden__/flag-off.json'

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

let tmp: string
let savedFlag: string | undefined

beforeEach(() => {
  savedFlag = process.env.AGENT_KINDS
  delete process.env.AGENT_KINDS
  tmp = mkdtempSync(join(tmpdir(), 'golden-'))
})

afterEach(() => {
  if (savedFlag === undefined) delete process.env.AGENT_KINDS
  else process.env.AGENT_KINDS = savedFlag
  rmSync(tmp, { recursive: true, force: true })
})

type Row = Record<string, unknown>

async function ingestRows(dir: string, name: string) {
  const dbPath = join(tmp, name)
  const db = new Database(dbPath)
  db.exec(CREATE_TABLE_SQL)
  db.close()
  const result = await ingest(dir, dbPath, { embedder: null })
  const d = new Database(dbPath)
  const rows = (d.prepare('SELECT * FROM agents ORDER BY slug').all() as Row[]).map(r => {
    const { last_ingested_at: _t, ...rest } = r
    void _t
    return rest
  })
  const cols = (d.prepare('PRAGMA table_info(agents)').all() as { name: string }[]).map(c => c.name)
  d.close()
  return { result: JSON.parse(JSON.stringify(result)), rows, cols }
}

function thrown(fn: () => unknown): string {
  try {
    fn()
    return 'NO ERROR'
  } catch (e) {
    return (e as Error).message
  }
}

async function buildSnapshot() {
  const top = await ingestRows('./data/agents', 'top.db')
  const fix = await ingestRows('./data/agents/fixtures', 'fix.db')

  const normalized: Record<string, unknown> = {}
  for (const f of ['valid-agent', 'minimal-agent']) {
    const raw = parseYaml(readFileSync(`./data/agents/fixtures/${f}.yaml`, 'utf8'))
    const { lastIngestedAt: _t, ...rec } = normalize(detectFormat(raw), raw) as unknown as Row
    void _t
    normalized[f] = rec
  }

  const searchText: Record<string, { text: string; hash: string }> = {}
  const dir = './data/agents'
  for (const f of readdirSync(dir).filter(x => x.endsWith('.yaml')).sort()) {
    try {
      const raw = parseYaml(readFileSync(join(dir, f), 'utf8'))
      const rec = normalize(detectFormat(raw), raw)
      const text = buildSearchText(recordToSearchable(rec))
      searchText[rec.slug] = { text, hash: contentHash('golden-model', text) }
    } catch {
      /* non-agent yaml: skipped, same as ingest */
    }
  }

  return {
    ingest: { top, fixtures: fix },
    normalized,
    searchText,
    agentsColumns: {
      drizzle: getTableConfig(agents).columns.map(c => c.name).sort(),
      afterIngest: top.cols,
    },
    unrecognizedErrors: {
      componentTypeSwarm: thrown(() => detectFormat({ component_type: 'Swarm' })),
      typeSwarm: thrown(() => detectFormat({ type: 'Swarm' })),
    },
  }
}

describe('flag-off golden', () => {
  it('matches the frozen snapshot', async () => {
    const snap = JSON.stringify(await buildSnapshot(), null, 2) + '\n'
    if (process.env.UPDATE_GOLDEN === '1') {
      mkdirSync(dirname(GOLDEN), { recursive: true })
      writeFileSync(GOLDEN, snap)
      return
    }
    expect(existsSync(GOLDEN)).toBe(true)
    expect(snap).toBe(readFileSync(GOLDEN, 'utf8'))
  })
})
