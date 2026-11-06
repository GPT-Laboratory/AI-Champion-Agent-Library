// Single source of truth for the text used by BOTH BM25 and embeddings.
// Relative imports only; must not import db.ts (it opens the DB at import).
import { createHash } from 'node:crypto'
import type { AgentRecord } from '../../spec/types.js'
import type { KindInfo } from '../../spec/kinds.js'

export interface Searchable {
  slug: string
  title: string
  summary: string
  category: string | null
  tags: string[]
  toolNames: string[]
  /** Optional, flag-on only (AGENT_KINDS): appended to the text when set. */
  kind?: string
  framework?: string | null
  memberNames?: string[]
}

export function buildSearchText(a: Searchable): string {
  const parts = [
    a.title,
    a.summary,
    a.category ?? '',
    a.tags.join(' '),
    a.toolNames.map(t => t.replace(/_/g, ' ')).join(' '),
  ]
  if (a.kind && a.kind !== 'agent') parts.push(a.kind)
  if (a.framework) parts.push(a.framework)
  if (a.memberNames && a.memberNames.length > 0) parts.push(a.memberNames.join(' '))
  return parts.map(p => p.trim()).filter(p => p.length > 0).join('. ')
}

export function contentHash(modelId: string, text: string): string {
  return createHash('sha256').update(modelId).update('\u0000').update(text).digest('hex')
}

function parseList(json: string): string[] {
  try {
    const v = JSON.parse(json)
    return Array.isArray(v) ? v.map(String) : []
  } catch {
    return []
  }
}

export function rowToSearchable(row: {
  slug: string
  title: string
  summary: string
  category: string | null
  tags: string
  toolNames: string
}): Searchable {
  return {
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    category: row.category,
    tags: parseList(row.tags),
    toolNames: parseList(row.toolNames),
  }
}

export function recordToSearchable(r: AgentRecord): Searchable {
  return {
    slug: r.slug,
    title: r.title,
    summary: r.summary,
    category: r.category,
    tags: [...r.tags],
    toolNames: [...r.toolNames],
  }
}

export function recordToSearchableWithKind(r: AgentRecord, info: KindInfo): Searchable {
  return {
    ...recordToSearchable(r),
    kind: info.kind,
    framework: info.framework,
    memberNames: info.members.map(m => m.name),
  }
}

export function rowToSearchableWithKind(
  row: Parameters<typeof rowToSearchable>[0],
  info: KindInfo | undefined,
): Searchable {
  const base = rowToSearchable(row)
  if (!info) return base
  return { ...base, kind: info.kind, framework: info.framework, memberNames: info.members.map(m => m.name) }
}
