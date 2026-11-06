import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { writeScaleFixtures } from './generate-scale.js'

// Verbatim copy of the agents-table DDL in scripts/ingest.test.ts.
export const SCALE_CREATE_TABLE_SQL = `
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

export interface ScaleDb {
  dir: string
  dbPath: string
  dataDir: string
  cleanup: () => void
}

/** Creates a tmp dir with generated YAML fixtures and an empty agents-table SQLite DB. */
export function createScaleDb(count = 150, seed = 20260101): ScaleDb {
  const dir = mkdtempSync(join(tmpdir(), 'scale-db-'))
  const dataDir = join(dir, 'agents')
  const dbPath = join(dir, 'catalog.db')
  writeScaleFixtures(dataDir, count, seed)
  const db = new Database(dbPath)
  db.exec(SCALE_CREATE_TABLE_SQL)
  db.close()
  return { dir, dbPath, dataDir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}
