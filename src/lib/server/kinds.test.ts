import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { getTableConfig } from 'drizzle-orm/sqlite-core'
import { agentKinds } from '../../../drizzle/schema.js'
import { ensureAgentKindsTable } from '../spec/kinds-ddl.js'
import { loadKindInfo } from './kinds.js'

const LEGACY_SQL = `
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

let sqlite: Database.Database

beforeEach(() => {
  sqlite = new Database(':memory:')
  sqlite.exec(LEGACY_SQL)
})
afterEach(() => sqlite.close())

const cols = (t: string) =>
  (sqlite.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map(c => c.name)

describe('ensureAgentKindsTable', () => {
  it('creates the table idempotently without touching agents', () => {
    const before = sqlite.prepare('PRAGMA table_info(agents)').all()
    ensureAgentKindsTable(sqlite)
    ensureAgentKindsTable(sqlite)
    expect(sqlite.prepare('PRAGMA table_info(agents)').all()).toEqual(before)
    expect(cols('agent_kinds').length).toBeGreaterThan(0)
  })

  it('matches the drizzle table columns', () => {
    ensureAgentKindsTable(sqlite)
    const drizzleCols = getTableConfig(agentKinds).columns.map(c => c.name).sort()
    expect(cols('agent_kinds').sort()).toEqual(drizzleCols)
  })
})

describe('loadKindInfo', () => {
  it('returns empty map when table is missing', () => {
    const db = drizzle(sqlite)
    expect(loadKindInfo(db, ['a']).size).toBe(0)
  })

  it('returns empty map for empty slugs', () => {
    ensureAgentKindsTable(sqlite)
    expect(loadKindInfo(drizzle(sqlite), []).size).toBe(0)
  })

  it('returns rows present, chunking large lists', () => {
    ensureAgentKindsTable(sqlite)
    sqlite
      .prepare("INSERT INTO agents (slug,title,system_prompt,llm_name) VALUES ('a','A','p','m')")
      .run()
    sqlite
      .prepare("INSERT INTO agent_kinds (slug,kind,framework,members) VALUES ('a','system','crewai','[{\"ref\":\"x\",\"name\":\"X\",\"role\":\"worker\"}]')")
      .run()
    const slugs = ['a', ...Array.from({ length: 1200 }, (_, i) => `missing-${i}`)]
    const m = loadKindInfo(drizzle(sqlite), slugs)
    expect(m.size).toBe(1)
    expect(m.get('a')?.kind).toBe('system')
    expect(m.get('a')?.framework).toBe('crewai')
    expect(m.get('a')?.members[0].name).toBe('X')
  })
})
