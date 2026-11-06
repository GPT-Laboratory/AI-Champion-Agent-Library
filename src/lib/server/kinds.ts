// Tolerant reader of the agent_kinds sidecar. Never throws; empty Map when the table is missing.
// Must not import db.ts (it opens the DB at import); callers pass the drizzle db.
import { eq, inArray, notInArray } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { agentKinds, agents } from '../../../drizzle/schema.js'
import { parseKindInfoRow, type KindInfo } from '../spec/kinds.js'

const CHUNK = 500

export function loadKindInfo(
  db: BetterSQLite3Database<Record<string, unknown>>,
  slugs: string[]
): Map<string, KindInfo> {
  const out = new Map<string, KindInfo>()
  if (slugs.length === 0) return out
  try {
    for (let i = 0; i < slugs.length; i += CHUNK) {
      const chunk = slugs.slice(i, i + CHUNK)
      const rows = db.select().from(agentKinds).where(inArray(agentKinds.slug, chunk)).all()
      for (const r of rows) out.set(r.slug, parseKindInfoRow(r))
    }
    return out
  } catch {
    return new Map()
  }
}

type Db = BetterSQLite3Database<Record<string, unknown>>

/** Slugs of agents that have no sidecar row. By contract such an agent is kind 'agent' (WR-05). */
function slugsWithoutSidecar(db: Db, limit?: number): string[] {
  try {
    const q = db
      .select({ slug: agents.slug })
      .from(agents)
      .where(notInArray(agents.slug, db.select({ slug: agentKinds.slug }).from(agentKinds)))
    return (limit ? q.limit(limit) : q).all().map((r) => r.slug)
  } catch {
    return []
  }
}

/**
 * Slugs whose kind equals `kind`; null when the sidecar table is missing or the query fails.
 * Agents with no sidecar row (ingested before the flag was turned on) count as kind 'agent'.
 */
export function listSlugsByKind(db: Db, kind: string): Set<string> | null {
  try {
    const rows = db.select({ slug: agentKinds.slug }).from(agentKinds).where(eq(agentKinds.kind, kind)).all()
    const out = new Set(rows.map((r) => r.slug))
    if (kind === 'agent') for (const s of slugsWithoutSidecar(db)) out.add(s)
    return out
  } catch {
    return null
  }
}

/** Distinct kinds present (sidecar rows, plus 'agent' for agents without one); [] on any error. */
export function listKinds(db: Db): string[] {
  try {
    const kinds = new Set(
      db
        .selectDistinct({ kind: agentKinds.kind })
        .from(agentKinds)
        .all()
        .map((r) => r.kind),
    )
    if (!kinds.has('agent') && slugsWithoutSidecar(db, 1).length > 0) kinds.add('agent')
    return [...kinds].sort()
  } catch {
    return []
  }
}

/**
 * True when the sidecar marks `slug` as a non-agent kind (system, skill, mcp-server, ...).
 * A missing row or table means a plain agent. Never throws. Flag-on callers only (WR-09).
 */
export function isNonAgentKind(db: Db, slug: string): boolean {
  try {
    const row = db.select({ kind: agentKinds.kind }).from(agentKinds).where(eq(agentKinds.slug, slug)).get()
    return !!row && row.kind !== 'agent'
  } catch {
    return false
  }
}
