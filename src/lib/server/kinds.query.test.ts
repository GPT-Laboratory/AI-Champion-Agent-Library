import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { ensureAgentKindsTable } from '../spec/kinds-ddl.js'
import { listSlugsByKind, listKinds } from './kinds.js'

let sqlite: Database.Database
beforeEach(() => {
  sqlite = new Database(':memory:')
})
afterEach(() => sqlite.close())

describe('listSlugsByKind / listKinds', () => {
  it('tolerate a missing table', () => {
    const db = drizzle(sqlite)
    expect(listSlugsByKind(db, 'system')).toBeNull()
    expect(listKinds(db)).toEqual([])
  })

  it('return slugs and distinct kinds', () => {
    sqlite.exec(
      `CREATE TABLE agents (slug TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', system_prompt TEXT NOT NULL DEFAULT '', llm_name TEXT NOT NULL DEFAULT '')`
    )
    ensureAgentKindsTable(sqlite)
    for (const s of ['a', 'b', 'c']) sqlite.prepare('INSERT INTO agents (slug) VALUES (?)').run(s)
    sqlite.exec(`INSERT INTO agent_kinds (slug,kind) VALUES ('a','agent'),('b','system'),('c','system')`)
    const db = drizzle(sqlite)
    expect([...(listSlugsByKind(db, 'system') ?? [])].sort()).toEqual(['b', 'c'])
    expect(listSlugsByKind(db, 'skill')?.size).toBe(0)
    expect(listKinds(db)).toEqual(['agent', 'system'])
  })
})
