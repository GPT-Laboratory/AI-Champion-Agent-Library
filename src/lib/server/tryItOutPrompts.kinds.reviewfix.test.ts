// Phase 13 review fix WR-09: the Try It Out prompt loaders refuse non-agent kinds (flag on),
// so the suppression is not merely presentational.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('./db', async () => {
  const Database = (await import('better-sqlite3')).default
  const { drizzle } = await import('drizzle-orm/better-sqlite3')
  const schema = await import('../../../drizzle/schema.js')
  const { LEGACY_DDL } = await import('../../../scripts/ingest.reviewfix.testkit.js')
  const { ensureAgentKindsTable } = await import('../spec/kinds-ddl.js')
  const sqlite = new Database(':memory:')
  sqlite.exec(LEGACY_DDL)
  ensureAgentKindsTable(sqlite)
  return { db: drizzle(sqlite), agents: schema.agents, sqlite }
})

import { loadPiSkill, loadPromptFor } from './tryItOutPrompts'

let prevFlag: string | undefined
let sqlite: import('better-sqlite3').Database

beforeEach(async () => {
  prevFlag = process.env.AGENT_KINDS
  sqlite = ((await import('./db')) as unknown as { sqlite: import('better-sqlite3').Database }).sqlite
  sqlite.exec('DELETE FROM agent_kinds; DELETE FROM agents;')
  const add = sqlite.prepare("INSERT INTO agents (slug, title, system_prompt, llm_name) VALUES (?, ?, 'prompt', 'm')")
  for (const s of ['the-system', 'the-agent', 'legacy-agent']) add.run(s, s)
  sqlite.prepare("INSERT INTO agent_kinds (slug, kind) VALUES ('the-system', 'system'), ('the-agent', 'agent')").run()
})
afterEach(() => {
  if (prevFlag === undefined) delete process.env.AGENT_KINDS
  else process.env.AGENT_KINDS = prevFlag
})

describe.each([
  ['loadPromptFor', loadPromptFor],
  ['loadPiSkill', loadPiSkill],
] as const)('%s with AGENT_KINDS on', (_n, load) => {
  it('refuses a slug whose sidecar kind is not agent', async () => {
    process.env.AGENT_KINDS = 'on'
    await expect(load('the-system')).rejects.toThrow(/not an agent kind/)
  })

  it('lets agents (sidecar or legacy) through to the normal checks', async () => {
    process.env.AGENT_KINDS = 'on'
    // No SKILL.md exists for these slugs, so the NEXT check fails: proof the kind guard passed.
    await expect(load('the-agent')).rejects.toThrow(/missing skill file/)
    await expect(load('legacy-agent')).rejects.toThrow(/missing skill file/)
  })

  it('flag off: the kind is not consulted', async () => {
    delete process.env.AGENT_KINDS
    await expect(load('the-system')).rejects.toThrow(/missing skill file/)
  })
})
