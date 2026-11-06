// tabular-catalog adapter: header / schema / dictionary TEXT only. Rows are never ingested.
//
// Input format (one text block):
//   line 1            column codes, separated by comma, semicolon or tab
//   [sample rows]     0 to 5 lines used only to infer a type; values are never stored
//   # dictionary      then `code,label[,type[,description]]` lines
//   # options         then `key=value` lines: skip_rows=N, identifier=<code>, entity=<name>, name=<title>
// `skip_rows=N` skips N lines after the header (label/unit rows below a code row).
// More than 5 data rows is rejected (gap `rows-rejected`): a real catalog must not be pasted in.
// The generated server reads the real file at run time from <NAME>_DATA_PATH.
import { gap } from '../diagnostics.js'
import { snake, serverSlug } from '../plan.js'
import type { Field, FieldType, Gap, GenerateOptions, InputAdapter, ParseResult, RawInput, SourceModel } from '../types.js'

const MAX_SAMPLE_ROWS = 5
const MAX_COLUMNS = 200
const CODE_RE = /^[A-Za-z][A-Za-z0-9_ -]{0,63}$/
const SAFE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const ID_RE = /^(id|code|sku|number|no)$|_id$|_no$/i

function splitLine(line: string, delim: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else quoted = false
      } else cur += ch
    } else if (ch === '"') quoted = true
    else if (ch === delim) {
      out.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  out.push(cur.trim())
  return out
}

function pickDelimiter(line: string): string {
  let best = ','
  let bestN = 0
  for (const d of [',', ';', '\t']) {
    const n = line.split(d).length - 1
    if (n > bestN) {
      best = d
      bestN = n
    }
  }
  return best
}

function firstLine(text: string): string {
  for (const l of text.replace(/^﻿/, '').split(/\r?\n/)) if (l.trim() !== '') return l
  return ''
}

function toType(raw: string | undefined): FieldType | undefined {
  const t = (raw ?? '').trim().toLowerCase()
  if (['string', 'text', 'str', 'char', 'varchar', 'date'].includes(t)) return 'string'
  if (['integer', 'int', 'long'].includes(t)) return 'integer'
  if (['number', 'float', 'double', 'decimal', 'numeric', 'real'].includes(t)) return 'number'
  if (['boolean', 'bool'].includes(t)) return 'boolean'
  return undefined
}

/** Infer a type from sample values; the values themselves are dropped immediately. */
function inferType(values: string[]): FieldType | undefined {
  const v = values.filter((x) => x !== '')
  if (v.length === 0) return undefined
  if (v.every((x) => /^-?\d+$/.test(x))) return 'integer'
  if (v.every((x) => /^-?\d+([.,]\d+)?$/.test(x))) return 'number'
  if (v.every((x) => /^(true|false)$/i.test(x))) return 'boolean'
  return 'string'
}

const firstLabel = (s: string) => s.split(/\s\/\s|\|/)[0].trim().slice(0, 80)

export const tabularCatalogAdapter: InputAdapter = {
  id: 'tabular-catalog',
  label: 'Tabular catalog (header and dictionary text)',
  detect(input: RawInput): number {
    const text = typeof input.text === 'string' ? input.text : ''
    if (/create\s+table/i.test(text) || /openapi\s*[:"]/i.test(text) || /swagger\s*[:"]/i.test(text)) return 0
    const head = firstLine(text)
    if (head.trim().startsWith('{') || head.trim().startsWith('#')) return 0
    const cells = splitLine(head, pickDelimiter(head))
    if (cells.length < 3) return 0
    return cells.every((c) => CODE_RE.test(c)) ? 0.6 : 0
  },
  parse(input: RawInput, options?: GenerateOptions): ParseResult {
    try {
      return parseTabular(input, options)
    } catch {
      return { rejected: [gap('adapter-failed', 'The tabular input could not be parsed.', { severity: 'error' })] }
    }
  },
}

function parseTabular(input: RawInput, options?: GenerateOptions): ParseResult {
  const text = (typeof input.text === 'string' ? input.text : '').replace(/^﻿/, '')
  const lines = text.split(/\r?\n/)
  const gaps: Gap[] = []
  const reject = (g: Gap): ParseResult => ({ rejected: [...gaps, g] })

  // Split into header block, dictionary block and options block.
  const dataLines: string[] = []
  const dictLines: string[] = []
  const optLines: string[] = []
  let section: 'data' | 'dict' | 'opt' = 'data'
  for (const raw of lines) {
    const line = raw.trim()
    if (line === '') continue
    const m = /^#\s*(dictionary|options)\s*$/i.exec(line)
    if (m) {
      section = m[1].toLowerCase() === 'dictionary' ? 'dict' : 'opt'
      continue
    }
    if (section === 'data') dataLines.push(raw)
    else if (section === 'dict') dictLines.push(raw)
    else optLines.push(line)
  }
  if (dataLines.length === 0) return reject(gap('no-header', 'No header line with column codes was found.', { severity: 'error' }))

  const opts: Record<string, string> = {}
  for (const l of optLines) {
    const m = /^([a-z_]+)\s*=\s*(.*)$/i.exec(l)
    if (m) opts[m[1].toLowerCase()] = m[2].trim()
  }
  const skip = /^\d{1,3}$/.test(opts.skip_rows ?? '') ? Number(opts.skip_rows) : 0

  const delim = pickDelimiter(dataLines[0])
  if (delim !== ',') {
    gaps.push(gap('delimiter-detected', `The header uses a ${delim === '\t' ? 'tab' : 'semicolon'} delimiter; the generated server reads the data file with the same delimiter.`, { severity: 'info' }))
  }
  const codes = splitLine(dataLines[0], delim)
  if (codes.length < 1 || codes.length > MAX_COLUMNS) return reject(gap('invalid-header', `The header must have 1 to ${MAX_COLUMNS} column codes.`, { severity: 'error' }))

  const bad = codes.filter((c) => !CODE_RE.test(c))
  if (bad.length > 0) {
    return reject(gap('invalid-column', `${bad.length} column code(s) do not match the allowed pattern (a letter, then letters, digits, space, underscore or hyphen, at most 64 characters).`, { severity: 'error', path: bad[0].slice(0, 40) }))
  }
  const seen = new Set<string>()
  for (const c of codes) {
    if (seen.has(c)) return reject(gap('duplicate-column', 'The header repeats a column code; columns must be unique.', { severity: 'error', path: c }))
    seen.add(c)
  }

  // Rows: skipped label/unit rows first, then at most MAX_SAMPLE_ROWS sample rows.
  const rows = dataLines.slice(1 + skip)
  if (rows.length > MAX_SAMPLE_ROWS) {
    return reject(gap('rows-rejected', `The input has ${rows.length} data rows; at most ${MAX_SAMPLE_ROWS} sample rows are accepted. Provide the header and dictionary only: row data is never ingested.`, { severity: 'error' }))
  }
  const sample: string[][] = rows.map((r) => splitLine(r, delim))

  // Dictionary: code -> label/type/description.
  const dict = new Map<string, { label: string; type?: string; description?: string }>()
  for (const l of dictLines) {
    const cells = splitLine(l, delim === '\t' || delim === ';' ? delim : ',')
    if (cells.length < 2) continue
    if (cells[0].toLowerCase() === 'code' && cells[1].toLowerCase() === 'label') continue
    dict.set(cells[0], { label: cells[1], type: cells[2], description: cells[3] })
  }
  for (const code of dict.keys()) {
    if (!seen.has(code)) gaps.push(gap('dictionary-orphan', 'A dictionary entry names a code that is not in the header and was ignored.', { path: code.slice(0, 40) }))
  }

  // Normalised names. Codes that are already safe names are kept as written, because the
  // generated server reads CSV columns by this exact name.
  const names = codes.map((c) => (SAFE_NAME.test(c) ? c : snake(c)))
  const unique = new Set<string>()
  for (let i = 0; i < names.length; i++) {
    if (unique.has(names[i].toLowerCase())) {
      return reject(gap('column-collision', 'Two column codes normalise to the same name; rename one in the source.', { severity: 'error', path: codes[i] }))
    }
    unique.add(names[i].toLowerCase())
    if (names[i] !== codes[i]) {
      gaps.push(gap('column-renamed', `Column code was normalised to ${names[i]}; the data file header must use that name.`, { severity: 'info', path: codes[i] }))
    }
  }

  // Identifier: explicit option, else a column whose code or label looks like one.
  let identCode: string | undefined
  if (opts.identifier !== undefined) {
    if (seen.has(opts.identifier)) identCode = opts.identifier
    else gaps.push(gap('identifier-unknown', 'The identifier option names a code that is not in the header and was ignored.', { path: opts.identifier.slice(0, 40) }))
  }
  if (identCode === undefined) {
    identCode = codes.find((c) => ID_RE.test(c)) ?? codes.find((c) => ID_RE.test((dict.get(c)?.label ?? '').trim()))
  }
  if (identCode === undefined) {
    gaps.push(gap('no-identifier', 'No identifier column was found; only the query tool is generated (no lookup). Set identifier=<code> to choose one.'))
  }

  const fields: Field[] = codes.map((code, i) => {
    const d = dict.get(code)
    if (!d && dict.size > 0) gaps.push(gap('missing-label', 'A header code has no dictionary entry; the code is used as its label.', { severity: 'info', path: code }))
    let type: FieldType = 'string'
    if (code !== identCode) {
      const declared = toType(d?.type)
      if (d?.type && declared === undefined) gaps.push(gap('unknown-type', 'A dictionary type was not recognised; string was used.', { severity: 'info', path: code }))
      type = declared ?? inferType(sample.map((r) => r[i] ?? '')) ?? 'string'
    }
    const label = d?.label ? firstLabel(d.label) || code : code
    const f: Field = { name: names[i], type, label }
    const desc = [`Column code: ${code}`, d?.description ? d.description.slice(0, 160) : ''].filter(Boolean).join('. ')
    f.description = desc
    if (code === identCode) f.identifier = true
    if (/(^|[_ -])name$|^name([_ -]|$)|title/i.test(code) || /(^|\s)name$/i.test(label)) f.nameLike = true
    if (/class|category|group|kind|status/i.test(`${code} ${label}`)) f.classLike = true
    return f
  })

  const name = (options?.serverName?.trim() || opts.name || '').trim() || 'Catalog'
  const entityName = snake(opts.entity ?? 'item')
  const model: SourceModel = {
    name,
    backend: { kind: 'dataset', datasetPathEnv: `${serverSlug({ name } as SourceModel).toUpperCase()}_DATA_PATH`, ...(delim !== ',' ? { delimiter: delim } : {}) },
    auth: { scheme: 'none' },
    entities: [
      {
        id: entityName,
        label: entityName.replace(/_/g, ' '),
        fields,
        identifierFields: identCode === undefined ? [] : [names[codes.indexOf(identCode)]],
        nested: [],
      },
    ],
    operations: [],
    limits: { maxPageSize: 50, maxResponseItems: 200, ...(options?.limits ?? {}) },
    gaps,
    writeOperationsDropped: [],
  }
  return { model, gaps }
}
