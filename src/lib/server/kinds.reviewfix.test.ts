// Phase 13 review fixes: WR-05 (agents without a sidecar row are kind 'agent') and the
// isNonAgentKind helper behind WR-09.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { ensureAgentKindsTable } from '../spec/kinds-ddl.js'
import { effectiveTryItOutMode } from '../spec/kinds.js'
import { isNonAgentKind, listKinds, listSlugsByKind } from './kinds.js'

let sqlite: Database.Database
beforeEach(() => {
  sqlite = new Database(':memory:')
  sqlite.exec(
    `CREATE TABLE agents (slug TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', system_prompt TEXT NOT NULL DEFAULT '', llm_name TEXT NOT NULL DEFAULT '')`,
  )
  ensureAgentKindsTable(sqlite)
})
afterEach(() => sqlite.close())

const add = (slug: string, kind?: string) => {
  sqlite.prepare('INSERT INTO agents (slug) VALUES (?)').run(slug)
  if (kind) sqlite.prepare('INSERT INTO agent_kinds (slug, kind) VALUES (?, ?)').run(slug, kind)
}

describe('WR-05 legacy agents without a sidecar row', () => {
  it('?kind=agent includes agents that have no sidecar row, and excludes other kinds', () => {
    add('legacy-one')
    add('legacy-two')
    add('sidecar-agent', 'agent')
    add('a-system', 'system')
    const db = drizzle(sqlite)
    expect([...(listSlugsByKind(db, 'agent') ?? [])].sort()).toEqual(['legacy-one', 'legacy-two', 'sidecar-agent'])
    expect([...(listSlugsByKind(db, 'system') ?? [])]).toEqual(['a-system'])
    expect(listSlugsByKind(db, 'skill')?.size).toBe(0)
  })

  it('listKinds reports agent in a mixed catalog where every sidecar row is a system', () => {
    add('legacy-one')
    add('a-system', 'system')
    expect(listKinds(drizzle(sqlite))).toEqual(['agent', 'system'])
  })

  it('listKinds does not invent agent when every agent has a non-agent sidecar row', () => {
    add('a-system', 'system')
    expect(listKinds(drizzle(sqlite))).toEqual(['system'])
  })

  it('an empty sidecar table still lists agent for legacy rows', () => {
    add('legacy-one')
    const db = drizzle(sqlite)
    expect(listKinds(db)).toEqual(['agent'])
    expect([...(listSlugsByKind(db, 'agent') ?? [])]).toEqual(['legacy-one'])
  })
})

describe('isNonAgentKind', () => {
  it('is true only for a sidecar row with a non-agent kind', () => {
    add('legacy')
    add('plain', 'agent')
    add('sys', 'system')
    const db = drizzle(sqlite)
    expect(isNonAgentKind(db, 'legacy')).toBe(false)
    expect(isNonAgentKind(db, 'plain')).toBe(false)
    expect(isNonAgentKind(db, 'sys')).toBe(true)
    expect(isNonAgentKind(db, 'unknown')).toBe(false)
  })
  it('never throws when the sidecar table is missing', () => {
    sqlite.exec('DROP TABLE agent_kinds')
    expect(isNonAgentKind(drizzle(sqlite), 'x')).toBe(false)
  })
})

describe('effectiveTryItOutMode', () => {
  it('suppresses runnable for non-agent kinds and keeps external links', () => {
    expect(effectiveTryItOutMode('system', 'runnable')).toBe('none')
    expect(effectiveTryItOutMode('skill', 'runnable')).toBe('none')
    expect(effectiveTryItOutMode('system', 'external')).toBe('external')
    expect(effectiveTryItOutMode('agent', 'runnable')).toBe('runnable')
    expect(effectiveTryItOutMode('agent', 'none')).toBe('none')
  })
})
