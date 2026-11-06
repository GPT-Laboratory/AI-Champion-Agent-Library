// prisma adapter (D-546..D-548): a hand-rolled reader for schema.prisma text. Models become tables
// (scalar fields become columns, relation fields become foreign keys), enums become allowed values,
// @id / @@id / @unique / @map / @@map are honoured. `datasource` and `generator` blocks are skipped
// entirely: nothing inside them is read, so a connection URL can never reach the model, the report
// or the generated code (the registry also rejects credential-bearing text before this runs).
// @default values are never read. Like sql-ddl, the generated backend is a read-only SQLite file.
import { gap } from '../diagnostics.js'
import type { FieldType, Gap, GenerateOptions, InputAdapter, ParseResult, RawInput } from '../types.js'
import { MAX_COLUMNS, MAX_TABLES, SAFE, buildSqlModel, makeGapSink, serverTitle, type Col, type Table } from './sql-common.js'
import { looksLikePrisma } from './sql-dialect.js'
import { matchParen, type ScanOpts } from './sql-scan.js'

const SO: ScanOpts = { brackets: false, backslash: true }
const MAX_ENUM_VALUES = 200
const MAX_ENUM_VALUE_LENGTH = 80
const MAX_LOGICAL_LINES = 50

const SCALARS: Record<string, { type: FieldType; composite?: boolean }> = {
  String: { type: 'string' },
  Boolean: { type: 'boolean' },
  Int: { type: 'integer' },
  BigInt: { type: 'integer' },
  Float: { type: 'number' },
  Decimal: { type: 'number' },
  DateTime: { type: 'string' },
  Json: { type: 'string', composite: true },
  Bytes: { type: 'string', composite: true },
}

const SQL_AT_LINE_START = /^[ \t]*create[ \t]+(?:\w+[ \t]+){0,3}?table\b/im

export const prismaAdapter: InputAdapter = {
  id: 'prisma',
  label: 'Prisma schema (schema.prisma)',
  detect(input: RawInput) {
    const t = typeof input.text === 'string' ? input.text : ''
    if (!looksLikePrisma(t)) return 0
    if (SQL_AT_LINE_START.test(t)) return 0.5 // SQL wins; the sql-ddl adapter reports the ambiguity
    return /^[ \t]*(?:datasource|generator)[ \t]+\w+[ \t]*\{/m.test(t) || /@id\b|@@id\b|@relation\b/.test(t) ? 0.95 : 0.8
  },
  parse(input: RawInput, options?: GenerateOptions): ParseResult {
    try {
      return parsePrisma(input, options)
    } catch {
      return { rejected: [gap('adapter-failed', 'The Prisma schema could not be parsed.', { severity: 'error' })] }
    }
  },
}

interface Block {
  kind: string
  name: string
  body: string
}

/** Index of the `}` that closes the `{` at `open` (string and comment aware), or -1. */
function closeBrace(s: string, open: number): number {
  let depth = 0
  let i = open
  while (i < s.length) {
    const c = s[i]
    if (c === '"') {
      i++
      while (i < s.length && s[i] !== '\n' && s[i] !== '"') i += s[i] === '\\' ? 2 : 1
      i++
      continue
    }
    if (c === '/' && s[i + 1] === '/') {
      while (i < s.length && s[i] !== '\n') i++
      continue
    }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return i
    }
    i++
  }
  return -1
}

function readBlocks(text: string, push: (g: Gap) => void): Block[] {
  const blocks: Block[] = []
  const head = /[ \t]*(model|view|type|enum|datasource|generator)[ \t]+([A-Za-z_]\w*)[ \t]*\{/y
  let pos = 0
  let junk = 0
  while (pos < text.length) {
    let nl = text.indexOf('\n', pos)
    if (nl < 0) nl = text.length
    head.lastIndex = pos
    const m = head.exec(text)
    if (m) {
      const open = pos + m[0].length - 1
      const close = closeBrace(text, open)
      if (close < 0) {
        push(gap('unterminated-block', `A ${m[1]} block is not closed; it and everything after it was skipped.`, { path: m[2].slice(0, 40) }))
        break
      }
      blocks.push({ kind: m[1], name: m[2], body: text.slice(open + 1, close) })
      pos = close + 1
      continue
    }
    const line = text.slice(pos, nl).trim()
    if (line !== '' && !line.startsWith('//')) junk++
    pos = nl + 1
  }
  if (junk > 0) push(gap('unsupported-syntax', `${junk} line${junk === 1 ? '' : 's'} outside any block could not be read and ${junk === 1 ? 'was' : 'were'} skipped.`, { severity: 'info' }))
  return blocks
}

/** Comment-free logical lines of a block body; a line whose parentheses are open continues on the next one. */
function logicalLines(body: string, push: (g: Gap) => void): string[] {
  const out: string[] = []
  let cur = ''
  let depth = 0
  let n = 0
  for (const raw of body.split('\n')) {
    const line = stripLineComment(raw).trim()
    if (line === '' && depth === 0) continue
    cur += (cur ? ' ' : '') + line
    n++
    depth += parenDepth(line)
    if (depth <= 0 || n >= MAX_LOGICAL_LINES) {
      if (depth > 0) push(gap('unsupported-syntax', 'A declaration with unbalanced parentheses was cut off.', { severity: 'info' }))
      out.push(cur)
      cur = ''
      depth = 0
      n = 0
    }
  }
  if (cur !== '') out.push(cur)
  return out
}

function stripLineComment(line: string): string {
  let i = 0
  while (i < line.length) {
    const c = line[i]
    if (c === '"') {
      i++
      while (i < line.length && line[i] !== '"') i += line[i] === '\\' ? 2 : 1
    } else if (c === '/' && line[i + 1] === '/') return line.slice(0, i)
    i++
  }
  return line
}

function parenDepth(line: string): number {
  let d = 0
  let i = 0
  while (i < line.length) {
    const c = line[i]
    if (c === '"') {
      i++
      while (i < line.length && line[i] !== '"') i += line[i] === '\\' ? 2 : 1
    } else if (c === '(') d++
    else if (c === ')') d--
    i++
  }
  return d
}

interface Attr {
  name: string
  args: string
}

/** `@name` and `@name(args)` attributes of a field or block line, outside strings. */
function readAttrs(s: string): Attr[] {
  const out: Attr[] = []
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (c === '"') {
      i++
      while (i < s.length && s[i] !== '"') i += s[i] === '\\' ? 2 : 1
      i++
      continue
    }
    if (c === '@') {
      let j = i + 1
      if (s[j] === '@') j++
      const m = /^[A-Za-z_][\w.]*/.exec(s.slice(j, j + 80))
      if (!m) {
        i = j
        continue
      }
      const name = s.slice(i, j + m[0].length)
      let k = j + m[0].length
      let args = ''
      if (s[k] === '(') {
        const close = matchParen(s, k, SO)
        if (close < 0) {
          out.push({ name, args: s.slice(k + 1) })
          break
        }
        args = s.slice(k + 1, close)
        k = close + 1
      }
      out.push({ name, args })
      i = k
      continue
    }
    i++
  }
  return out
}

const stringArg = (args: string): string | undefined => {
  const m = /^\s*(?:name\s*:\s*)?"((?:[^"\\]|\\.)*)"/.exec(args)
  return m ? m[1] : undefined
}
const namedList = (args: string, key: string): string[] | undefined => {
  const m = new RegExp(`(?:^|[\\s,(])${key}\\s*:\\s*\\[([^\\]]*)\\]`).exec(args)
  if (!m) return undefined
  const items = m[1].split(',').map((x) => x.trim()).filter((x) => x !== '')
  return items.every((x) => /^[A-Za-z_]\w*$/.test(x)) ? items : undefined
}
const firstList = (args: string): string[] | undefined => {
  const m = /^\s*\[([^\]]*)\]/.exec(args) ?? /(?:^|,)\s*fields\s*:\s*\[([^\]]*)\]/.exec(args)
  if (!m) return undefined
  const items = m[1].split(',').map((x) => x.trim()).filter((x) => x !== '')
  return items.every((x) => /^[A-Za-z_]\w*$/.test(x)) ? items : undefined
}

interface Parsed {
  model: string
  table: string
  fieldCol: Map<string, string>
  cols: Col[]
  pkFields: string[]
  uniqueSets: string[][]
  rels: { fields: string[]; refs: string[]; target: string }[]
}

function parsePrisma(input: RawInput, options?: GenerateOptions): ParseResult {
  const text = typeof input.text === 'string' ? input.text : ''
  const sink = makeGapSink()
  const { gaps, push } = sink
  push(gap('sqlite-backend-only', 'The generated sql server reads a read-only SQLite database file. This Prisma schema only describes the tables: provide a SQLite file with the same table and column names (after @map and @@map) for the server to open.', { severity: 'info' }))
  if (SQL_AT_LINE_START.test(text)) push(gap('ambiguous-input', 'The input also contains CREATE TABLE statements; it was read as a Prisma schema.', { severity: 'warn' }))

  const blocks = readBlocks(text, push)
  const config = blocks.filter((b) => b.kind === 'datasource' || b.kind === 'generator').length
  if (config > 0) push(gap('config-blocks-ignored', `${config} datasource or generator block${config === 1 ? '' : 's'} ignored; nothing inside ${config === 1 ? 'it was' : 'them was'} read or copied.`, { severity: 'info' }))
  for (const b of blocks) {
    if (b.kind === 'view' || b.kind === 'type') push(gap('unsupported-statement', `A ${b.kind} block is not supported and was ignored.`, { path: b.name.slice(0, 40) }))
  }

  const enums = new Map<string, string[]>()
  for (const b of blocks.filter((x) => x.kind === 'enum')) {
    const labels: string[] = []
    let bad = false
    for (const line of logicalLines(b.body, push)) {
      if (line.startsWith('@@')) continue
      const name = /^[A-Za-z_]\w*/.exec(line)?.[0]
      if (!name) {
        bad = true
        continue
      }
      const mapped = readAttrs(line.slice(name.length)).find((a) => a.name === '@map')
      const v = (mapped ? stringArg(mapped.args) : undefined) ?? name
      // eslint-disable-next-line no-control-regex
      if (v === '' || v.length > MAX_ENUM_VALUE_LENGTH || /[\u0000-\u001f\u007f]/.test(v)) bad = true
      else labels.push(v)
    }
    if (bad || labels.length === 0 || labels.length > MAX_ENUM_VALUES) push(gap('unsupported-type', 'An enum has values that cannot be read; fields of that type are exposed as text.', { path: b.name.slice(0, 40) }))
    else enums.set(b.name, labels)
  }

  const modelBlocks = blocks.filter((b) => b.kind === 'model')
  const modelNames = new Set(modelBlocks.map((b) => b.name))
  const parsed: Parsed[] = []
  let relationFields = 0
  for (const b of modelBlocks) {
    const p: Parsed = { model: b.name, table: b.name, fieldCol: new Map(), cols: [], pkFields: [], uniqueSets: [], rels: [] }
    let skip = false
    const uniqueFields = new Set<string>()
    const idFields: string[] = []
    for (const line of logicalLines(b.body, push)) {
      if (line.startsWith('@@')) {
        const a = readAttrs(line)[0]
        if (!a) continue
        if (a.name === '@@map') {
          const v = stringArg(a.args)
          if (v !== undefined) p.table = v
        } else if (a.name === '@@id') {
          const l = firstList(a.args)
          if (l) p.pkFields = l
          else push(gap('unparsable-constraint', 'A composite @@id could not be read.', { path: b.name.slice(0, 40) }))
        } else if (a.name === '@@unique') {
          const l = firstList(a.args)
          if (l) p.uniqueSets.push(l)
        } else if (a.name === '@@ignore') skip = true
        continue
      }
      const nm = /^([A-Za-z_]\w*)\s+(Unsupported\s*\(\s*"(?:[^"\\]|\\.)*"\s*\)|[A-Za-z_]\w*)(\?|\[\])?/.exec(line)
      if (!nm) {
        push(gap('unsupported-syntax', 'A field declaration was not recognised and was skipped.', { path: b.name.slice(0, 40) }))
        continue
      }
      const [whole, fname, ftype, mod] = nm
      const attrs = readAttrs(line.slice(whole.length))
      const has = (n: string) => attrs.some((a) => a.name === n)
      if (has('@ignore')) continue
      const isUnsupported = ftype.startsWith('Unsupported')
      const scalar = isUnsupported ? undefined : SCALARS[ftype]
      if (!scalar && !isUnsupported && !enums.has(ftype) && modelNames.has(ftype)) {
        relationFields++
        const rel = attrs.find((a) => a.name === '@relation')
        const fields = rel ? namedList(rel.args, 'fields') : undefined
        const refs = rel ? namedList(rel.args, 'references') : undefined
        if (fields && refs && fields.length === refs.length && mod !== '[]') p.rels.push({ fields, refs, target: ftype })
        continue
      }
      const mapAttr = attrs.find((a) => a.name === '@map')
      const col = (mapAttr ? stringArg(mapAttr.args) : undefined) ?? fname
      if (!SAFE.test(col)) {
        push(gap('unsafe-identifier', 'A field name has characters that cannot be used safely and the field was left out.', { path: `${b.name}.${fname}`.slice(0, 60) }))
        continue
      }
      let type: FieldType = 'string'
      let labels: string[] | undefined
      if (mod === '[]') push(gap('unsupported-type', 'A list field is not supported; the column is exposed as text.', { path: `${b.name}.${fname}` }))
      else if (isUnsupported) push(gap('unsupported-type', 'An Unsupported(...) type is not supported; the column is exposed as text.', { path: `${b.name}.${fname}` }))
      else if (scalar) {
        type = scalar.type
        if (scalar.composite) push(gap('unsupported-type', `The ${ftype} type is not supported; the column is exposed as text.`, { path: `${b.name}.${fname}` }))
      } else if (enums.has(ftype)) labels = enums.get(ftype)
      else push(gap('unknown-type', 'A field type was not recognised; string was used.', { severity: 'info', path: `${b.name}.${fname}` }))
      const c: Col = { name: col, type, pk: has('@id') }
      if (mod !== '?' && mod !== '[]') c.nullable = false
      if (has('@unique')) uniqueFields.add(fname)
      if (has('@id')) idFields.push(fname)
      if (labels) c.enum = labels
      p.fieldCol.set(fname, col)
      p.cols.push(c)
    }
    if (skip) {
      push(gap('unsupported-statement', 'A model marked @@ignore was left out.', { path: b.name.slice(0, 40) }))
      continue
    }
    for (const [i, f] of [...p.fieldCol.keys()].entries()) if (uniqueFields.has(f)) p.cols[i].unique = true
    if (p.pkFields.length === 0 && idFields.length > 0) p.pkFields = idFields
    for (const u of p.uniqueSets) {
      if (u.length === 1 && p.fieldCol.has(u[0])) p.cols.find((c) => c.name === p.fieldCol.get(u[0]))!.unique = true
    }
    parsed.push(p)
  }
  if (relationFields > 0) push(gap('relation-fields-skipped', `${relationFields} relation field${relationFields === 1 ? '' : 's'} (links to other models) ${relationFields === 1 ? 'is' : 'are'} not columns; foreign keys come from the scalar fields they use.`, { severity: 'info' }))

  const tables: Table[] = []
  for (const p of parsed) {
    if (tables.length >= MAX_TABLES) {
      push(gap('too-many-tables', `Only the first ${MAX_TABLES} tables are used.`, { severity: 'warn' }))
      break
    }
    if (!SAFE.test(p.table)) {
      push(gap('unsafe-identifier', 'A table name has characters that cannot be used safely and the table was skipped.', { path: p.table.slice(0, 40) }))
      continue
    }
    if (p.cols.length === 0 || p.cols.length > MAX_COLUMNS) {
      push(gap('unparsable-table', p.cols.length === 0 ? 'No column could be read; the table was skipped.' : `The table has more than ${MAX_COLUMNS} columns and was skipped.`, { path: p.table }))
      continue
    }
    const seen = new Set<string>()
    if (p.cols.some((c) => (seen.has(c.name.toLowerCase()) ? true : (seen.add(c.name.toLowerCase()), false)))) {
      push(gap('duplicate-column', 'Two fields map to the same column name; the table was skipped.', { path: p.table }))
      continue
    }
    if (tables.some((t) => t.name === p.table)) {
      push(gap('duplicate-table', 'A table is defined twice; the later definition was ignored.', { path: p.table }))
      continue
    }
    const pkCols = p.pkFields.map((f) => p.fieldCol.get(f))
    let pk: string[] = []
    if (p.pkFields.length > 0 && pkCols.every((c): c is string => c !== undefined)) pk = pkCols.filter((n, i, a) => a.indexOf(n) === i)
    else if (p.pkFields.length > 0) push(gap('unparsable-constraint', 'A primary key names a field that does not exist (or was left out); the table has no identifier.', { path: p.table }))
    for (const c of p.cols) c.pk = pk.includes(c.name)
    tables.push({ name: p.table, cols: p.cols, pk, fks: [] })
  }
  // Foreign keys: @relation(fields: [local], references: [remote]) on the owning side.
  const byModel = new Map(parsed.map((p) => [p.model, p]))
  for (const p of parsed) {
    const t = tables.find((x) => x.name === p.table)
    if (!t) continue
    for (const r of p.rels) {
      const target = byModel.get(r.target)
      if (!target) continue
      r.fields.forEach((f, i) => {
        const c = t.cols.find((x) => x.name === p.fieldCol.get(f))
        const remote = target.fieldCol.get(r.refs[i])
        if (c) {
          c.ref = { table: target.table, column: remote }
          t.fks.push({ column: c.name, table: target.table, ref: remote })
        }
      })
    }
  }
  sink.flush()
  if (tables.length === 0) return { rejected: [...gaps, gap('no-tables', 'No usable model was found in the Prisma schema.', { severity: 'error' })] }
  const model = buildSqlModel(tables, { name: serverTitle(options, input.filename), options, gaps, push, dropped: [] })
  return { model, gaps }
}
