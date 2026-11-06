// src/lib/server/db.ts
// Server-only module — SvelteKit enforces that src/lib/server/ cannot be imported client-side.
import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { agents, agentEmbeddings } from '../../../drizzle/schema.js'

const DB_PATH = process.env.CATALOG_DB_PATH ?? './db/catalog.db'

// E6 (D-403): a fresh checkout has no ./db directory; without it better-sqlite3 throws at import
// and every route (even /health) answers 500. Create it; missing tables are handled by the loads.
try {
  if (DB_PATH !== ':memory:') mkdirSync(dirname(DB_PATH), { recursive: true })
} catch {
  // let Database() report the real problem
}
const sqlite = new Database(DB_PATH)
sqlite.pragma('journal_mode = WAL')

export const db = drizzle(sqlite)
export { agents, agentEmbeddings }
