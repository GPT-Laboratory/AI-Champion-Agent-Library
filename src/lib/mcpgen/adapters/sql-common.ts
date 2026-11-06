// Table model shared by the sql-ddl and prisma adapters, and the step that turns it into a
// SourceModel (entities, read-only SELECT operations, limits). Nothing here reads input text.
import { gap } from '../diagnostics.js'
import { serverSlug } from '../plan.js'
import type { Entity, Field, FieldType, Gap, GenerateOptions, Operation, SourceModel } from '../types.js'

export const SAFE = /^[A-Za-z_][A-Za-z0-9_]*$/
export const MAX_TABLES = 100
export const MAX_COLUMNS = 200
export const MAX_GAPS_PER_CODE = 25

export interface Col {
  name: string
  type: FieldType
  nullable?: boolean
  pk: boolean
  unique?: boolean
  enum?: string[]
  ref?: { table: string; column?: string }
}
export interface Table {
  name: string
  cols: Col[]
  pk: string[]
  fks: { column: string; table: string; ref?: string }[]
}

export const title = (s: string) => s.replace(/[_-]+/g, ' ').trim()

/** A gap sink that keeps at most MAX_GAPS_PER_CODE per code and reports the rest as one summary gap. */
export function makeGapSink(): { gaps: Gap[]; push: (g: Gap) => void; flush: () => void } {
  const gaps: Gap[] = []
  const counts = new Map<string, number>()
  return {
    gaps,
    push(g: Gap) {
      const n = (counts.get(g.code) ?? 0) + 1
      counts.set(g.code, n)
      if (n <= MAX_GAPS_PER_CODE) gaps.push(g)
    },
    flush() {
      for (const [code, n] of counts) if (n > MAX_GAPS_PER_CODE) gaps.push(gap('gaps-truncated', `${n - MAX_GAPS_PER_CODE} more ${code} diagnostics were omitted.`, { severity: 'info' }))
    },
  }
}

export function serverTitle(options: GenerateOptions | undefined, filename: string | undefined): string {
  return (options?.serverName?.trim() || (filename ? title(filename.replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '')) : '') || 'Schema')
    .split(' ')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ')
}

/** Entities and SELECT operations for the tables; the backend is always read-only SQLite (`<NAME>_DB_PATH`). */
export function buildSqlModel(
  tables: Table[],
  ctx: { name: string; options?: GenerateOptions; gaps: Gap[]; push: (g: Gap) => void; dropped: string[] },
): SourceModel {
  const { name, options, gaps, push } = ctx
  const slug = serverSlug({ name } as SourceModel).toUpperCase()
  const tableNames = new Set(tables.map((t) => t.name))
  const entities: Entity[] = []
  const operations: Operation[] = []
  const maxPage = options?.limits?.maxPageSize
  const pageMax = typeof maxPage === 'number' && Number.isInteger(maxPage) && maxPage >= 1 ? maxPage : 100
  if (!(typeof maxPage === 'number' && Number.isInteger(maxPage) && maxPage >= 1)) {
    push(gap('limit-default', `No page size is known from the schema; the default of ${pageMax} rows per call was used. Override it with options.limits.maxPageSize.`, { severity: 'info' }))
  }
  for (const t of tables) {
    const fields: Field[] = t.cols.map((c) => {
      const f: Field = { name: c.name, type: c.type }
      if (t.pk.includes(c.name)) f.identifier = true
      if (c.nullable === false) f.nullable = false
      if (c.enum && c.enum.length > 0) f.enum = [...c.enum]
      const notes: string[] = []
      if (c.ref) {
        notes.push(`References ${c.ref.table}.${c.ref.column ?? '?'}`)
        if (!tableNames.has(c.ref.table)) push(gap('fk-target-missing', 'A foreign key points to a table that is not in the input.', { severity: 'info', path: `${t.name}.${c.name}` }))
      }
      if (c.unique) notes.push('Unique.')
      if (notes.length > 0) f.description = notes.join(c.ref && c.unique ? '. ' : ' ')
      if (/name|title/i.test(c.name)) f.nameLike = true
      if (/status|type|category|segment|group|kind|class/i.test(c.name)) f.classLike = true
      return f
    })
    if (t.pk.length === 0) push(gap('no-identifier', 'The table has no primary key; only list and query access is generated, no lookup.', { path: t.name }))
    entities.push({ id: t.name, label: title(t.name), fields, identifierFields: [...t.pk], nested: [] })
    operations.push({
      id: `list_${t.name}`,
      kind: 'list',
      method: 'SELECT',
      entity: t.name,
      params: [
        { name: 'limit', in: 'query', type: 'integer', required: false, min: 1, max: pageMax },
        { name: 'offset', in: 'query', type: 'integer', required: false, min: 0 },
      ],
      pageParam: 'offset',
      pageSizeParam: 'limit',
      summary: `List rows of ${t.name}`,
    })
    if (t.pk.length > 0) {
      operations.push({
        id: `get_${t.name}`,
        kind: 'get',
        method: 'SELECT',
        entity: t.name,
        params: t.pk.map((k) => ({ name: k, in: 'column' as const, type: t.cols.find((c) => c.name === k)!.type, required: true })),
        summary: `Fetch one row of ${t.name} by primary key`,
      })
    }
  }
  return {
    name,
    backend: { kind: 'sql', dsnEnv: `${slug}_DB_PATH` },
    auth: { scheme: 'none' },
    entities,
    operations,
    limits: { maxPageSize: pageMax, maxResponseItems: 200, ...(options?.limits ?? {}) },
    gaps,
    writeOperationsDropped: [...ctx.dropped].sort(),
  }
}
