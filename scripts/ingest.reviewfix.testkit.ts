// Shared helpers for the Phase 13 review-fix ingest tests (not a test file itself).
import Database from 'better-sqlite3'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

export const LEGACY_DDL = `
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

export function freshDb(path: string): void {
  if (existsSync(path)) rmSync(path)
  const db = new Database(path)
  db.exec(LEGACY_DDL)
  db.close()
}

export function query<T>(path: string, sql: string, ...params: unknown[]): T[] {
  const db = new Database(path)
  try {
    return db.prepare(sql).all(...params) as T[]
  } finally {
    db.close()
  }
}

export function exec(path: string, sql: string, ...params: unknown[]): void {
  const db = new Database(path)
  try {
    db.prepare(sql).run(...params)
  } finally {
    db.close()
  }
}

export function tmpDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

/** Write files (relative path -> text) under dir, creating folders. */
export function put(dir: string, files: Record<string, string>): void {
  for (const [rel, text] of Object.entries(files)) {
    const abs = join(dir, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, text)
  }
}
