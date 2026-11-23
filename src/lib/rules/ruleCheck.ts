// The check of a scope-rule-drafter result (own design, deterministic, no I/O). Shared by the CLI
// (scripts/rule-check.ts) and the app's post-run check (src/lib/server/tryitout/postRunCheck.ts).
// - Without a result: the sentences and, per ELEMENTS column, the distinct values a rule may name.
// - With a result: the `## RULES` lines against the grammar ifc-ebom-compiler reads (RULE in src/lib/ebom/ebomJoin.ts)
//   and the data (field is a column, value occurs in it), the `## Sentence mapping` table against the sentences, the
//   list of sentences not turned into a rule, and a dry run: which elements each rule would exclude, with the same
//   matching as the E-BOM class step (exact cell equality, the first matching rule wins).
// The check proves a result is well-formed and tied to the data; whether a sentence was read correctly is the answer
// key's and the LLM judge's job.
import { ELEMENT_COLS, RULE } from '../ebom/ebomJoin'

export class ParseError extends Error {}

export const MAPPING_COLS = ['sentence', 'outcome', 'rule', 'field', 'value', 'reason'] as const
export const OUTCOMES = ['rule', 'not-a-rule'] as const
export const REASONS = ['no-field-value', 'more-than-one-condition', 'not-about-elements', 'not-an-exclusion'] as const
export const SENTENCE = /^(S-\d+):\s*(.+)$/
export const NOT_TURNED_HEADING = 'Sentences not turned into a rule'

export interface Sentence {
  id: string
  text: string
}

export interface RuleInput {
  sentences: Sentence[]
  columns: string[]
  elements: Record<string, string>[]
  /** Ids of the rules the upload already has (its own `## RULES`). */
  existingIds: string[]
}

export interface MappingRow {
  sentence: string
  outcome: string
  rule: string
  field: string
  value: string
  reason: string
}

export interface RuleResult {
  rules: string[]
  mapping: MappingRow[]
  notTurned: string[] | null
}

export interface DryRunRow {
  rule: string
  field: string
  value: string
  excludes: string[]
}

export interface RuleCheck {
  /** 0 valid, 1 problems found, 2 the input or result could not be read. */
  code: 0 | 1 | 2
  out: string
  problems: string[]
  dryRun: DryRunRow[]
}

/** `## NAME` sections (names upper-cased), lines trimmed, blank lines and `#` labels dropped. */
function sections(text: string, keepCase = false): Map<string, string[]> {
  const out = new Map<string, string[]>()
  let cur: string[] | null = null
  for (const raw of text.split(/\r?\n/)) {
    const t = raw.trim()
    if (/^##\s/.test(t)) {
      const name = t.replace(/^##\s+/, '').trim()
      cur = []
      out.set(keepCase ? name : name.toUpperCase(), cur)
    } else if (t !== '' && !/^#(\s|$)/.test(t) && cur) cur.push(t)
  }
  return out
}

export function parseRuleInput(text: string): RuleInput {
  const s = sections(text)
  const ruleText = s.get('RULE TEXT')
  const el = s.get('ELEMENTS')
  if (!ruleText) throw new ParseError('no "## RULE TEXT" section')
  if (!el || el.length === 0) throw new ParseError('no "## ELEMENTS" section with a header')
  const columns = el[0].split(',').map((c) => c.trim())
  const absent = ELEMENT_COLS.filter((c) => !columns.includes(c))
  if (absent.length) throw new ParseError(`ELEMENTS lacks columns: ${absent.join(', ')}`)
  const elements = el.slice(1).map((l, n) => {
    const cells = l.split(',')
    if (cells.length !== columns.length) throw new ParseError(`ELEMENTS row ${n + 1} has ${cells.length} cells, expected ${columns.length}`)
    return Object.fromEntries(columns.map((c, i) => [c, cells[i].trim()]))
  })
  const sentences: Sentence[] = []
  for (const l of ruleText) {
    const m = SENTENCE.exec(l)
    if (!m) throw new ParseError(`RULE TEXT line is not "S-<n>: <sentence>": "${l.slice(0, 60)}"`)
    if (sentences.some((x) => x.id === m[1])) throw new ParseError(`RULE TEXT: ${m[1]} appears twice`)
    sentences.push({ id: m[1], text: m[2].trim() })
  }
  if (sentences.length === 0) throw new ParseError('RULE TEXT has no sentence')
  const existingIds = (s.get('RULES') ?? []).map((l) => RULE.exec(l)?.[1] ?? l.split(':').slice(0, 2).join(':'))
  return { sentences, columns, elements, existingIds }
}

export function parseRuleResult(text: string): RuleResult {
  const s = sections(text, true)
  const find = (name: string) => [...s.entries()].find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1]
  const rules = find('RULES')
  if (!rules) throw new ParseError('no `## RULES` section in the result')
  const table = find('Sentence mapping')
  if (!table) throw new ParseError('no `## Sentence mapping` section in the result')
  let head: string[] | null = null
  const mapping: MappingRow[] = []
  for (const l of table) {
    if (!l.startsWith('|')) continue
    const cells = l.replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue
    if (!head) {
      head = cells
      continue
    }
    mapping.push(Object.fromEntries(MAPPING_COLS.map((c) => [c, cells[head!.indexOf(c)] ?? ''])) as unknown as MappingRow)
  }
  if (!head) throw new ParseError('no table found under `## Sentence mapping`')
  const missing = MAPPING_COLS.filter((c) => !head!.includes(c))
  if (missing.length) throw new ParseError(`mapping table lacks columns: ${missing.join(', ')}`)
  // The closing line is not part of the list; the list ends at the first line that is not "S-n: ..." or "none".
  const listed = find(NOT_TURNED_HEADING)
  let notTurned: string[] | null = null
  if (listed) {
    notTurned = []
    for (const l of listed) {
      if (l === 'none' || SENTENCE.test(l)) notTurned.push(l)
      else break
    }
  }
  return { rules: rules.filter((l) => !l.startsWith('|') && l !== 'none'), mapping, notTurned }
}

const table = (cols: string[], rows: string[][]): string =>
  [`| ${cols.join(' | ')} |`, `|${cols.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n')

/** Distinct values per ELEMENTS column (input order), for the helper's report without a result. */
export function distinctValues(input: RuleInput): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const c of input.columns) out[c] = [...new Set(input.elements.map((e) => e[c]).filter((v) => v !== ''))]
  return out
}

export function checkRuleResult(inputText: string, resultText?: string): RuleCheck {
  let input: RuleInput
  try {
    input = parseRuleInput(inputText)
  } catch (e) {
    if (e instanceof ParseError) return { code: 2, out: `error: ${e.message}`, problems: [], dryRun: [] }
    throw e
  }
  if (resultText === undefined) {
    const values = distinctValues(input)
    const out = [
      '## Sentences',
      ...input.sentences.map((x) => `${x.id}: ${x.text}`),
      '',
      '## Values a rule may name (ELEMENTS column: distinct values)',
      ...input.columns.filter((c) => c !== 'token').map((c) => `${c}: ${values[c].join(' | ') || '(empty)'}`),
    ]
    return { code: 0, out: out.join('\n'), problems: [], dryRun: [] }
  }
  let result: RuleResult
  try {
    result = parseRuleResult(resultText)
  } catch (e) {
    if (e instanceof ParseError) return { code: 2, out: `error: ${e.message}`, problems: [], dryRun: [] }
    throw e
  }

  const problems: string[] = []
  const parsed: { id: string; field: string; value: string; reason: string }[] = []
  result.rules.forEach((line, i) => {
    const m = RULE.exec(line)
    if (!m) return void problems.push(`rule line ${i + 1} is not "<id>: <field> = <value> -> exclude (<reason>)": "${line.slice(0, 80)}"`)
    const [, id, field, value, reason] = m
    if (id !== `text:${i + 1}`) problems.push(`rule line ${i + 1}: id is "${id}", expected "text:${i + 1}" (numbered in order)`)
    if (input.existingIds.includes(id)) problems.push(`${id}: the upload already has a rule with this id`)
    if (!input.columns.includes(field) || !(ELEMENT_COLS as readonly string[]).includes(field)) problems.push(`${id}: field "${field}" is not an ELEMENTS column`)
    else if (!input.elements.some((e) => e[field] === value)) problems.push(`${id}: no element has ${field} = "${value}" (the rule matches nothing)`)
    const ref = /^(S-\d+):/.exec(reason)?.[1]
    if (!ref) problems.push(`${id}: the reason must start with the sentence id, e.g. "(S-1: ...)"`)
    parsed.push({ id, field, value, reason })
  })
  const ids = parsed.map((r) => r.id)
  for (const id of new Set(ids)) if (ids.filter((x) => x === id).length > 1) problems.push(`${id}: appears more than once`)

  const want = input.sentences.map((x) => x.id)
  const got = result.mapping.map((r) => r.sentence)
  if (got.join(',') !== want.join(',')) problems.push(`mapping rows are ${got.join(', ') || 'none'}; expected one per sentence in input order: ${want.join(', ')}`)
  const used = new Map<string, string>()
  for (const r of result.mapping) {
    const s = r.sentence
    if (!(OUTCOMES as readonly string[]).includes(r.outcome)) {
      problems.push(`${s}: outcome "${r.outcome}" is not rule or not-a-rule`)
      continue
    }
    if (r.outcome === 'rule') {
      const rule = parsed.find((p) => p.id === r.rule)
      if (!rule) problems.push(`${s}: rule "${r.rule}" is not a line of ## RULES`)
      else {
        if (rule.field !== r.field || rule.value !== r.value) problems.push(`${s}: field and value "${r.field} = ${r.value}" differ from ${r.rule} ("${rule.field} = ${rule.value}")`)
        if (!rule.reason.startsWith(`${s}:`)) problems.push(`${s}: ${r.rule}'s reason does not start with "${s}:"`)
        if (used.has(r.rule)) problems.push(`${s}: ${r.rule} is already the rule of ${used.get(r.rule)}`)
        used.set(r.rule, s)
      }
      if (r.reason !== '-') problems.push(`${s}: a rule row must have reason "-", not "${r.reason}"`)
    } else {
      if (r.rule !== '-' || r.field !== '-' || r.value !== '-') problems.push(`${s}: a not-a-rule row must have "-" in rule, field and value`)
      if (!(REASONS as readonly string[]).includes(r.reason)) problems.push(`${s}: reason "${r.reason}" is not one of ${REASONS.join(', ')}`)
    }
  }
  for (const p of parsed) if (!used.has(p.id)) problems.push(`${p.id}: no mapping row names this rule`)

  const notRule = result.mapping.filter((r) => r.outcome === 'not-a-rule').map((r) => {
    const t = input.sentences.find((x) => x.id === r.sentence)
    return t ? `${t.id}: ${t.text}` : `${r.sentence}: ?`
  })
  const expectList = notRule.length ? notRule : ['none']
  if (result.notTurned === null) problems.push(`no \`## ${NOT_TURNED_HEADING}\` section`)
  else if (result.notTurned.join('\n') !== expectList.join('\n')) {
    problems.push(`"${NOT_TURNED_HEADING}" must list the not-a-rule sentences copied exactly, in order (${notRule.length ? notRule.map((x) => x.split(':')[0]).join(', ') : 'none'})`)
  }

  // Dry run, with the class step's matching: exact equality, the first matching rule wins.
  const valid = parsed.filter((p) => input.columns.includes(p.field))
  const dryRun: DryRunRow[] = valid.map((p) => ({ rule: p.id, field: p.field, value: p.value, excludes: [] }))
  for (const e of input.elements) {
    const hit = valid.findIndex((p) => e[p.field] === p.value)
    if (hit >= 0) dryRun[hit].excludes.push(e.token)
  }

  const out = [
    problems.length ? `MISMATCHES (${problems.length})\n${problems.join('\n')}` : 'result: every rule is valid and tied to the data; every sentence is mapped once',
    '',
    '## Dry run (which elements each rule would exclude)',
    dryRun.length ? table(['rule', 'field', 'value', 'excludes'], dryRun.map((d) => [d.rule, d.field, d.value, d.excludes.join(', ') || 'nothing'])) : 'no rules',
  ]
  return { code: problems.length ? 1 : 0, out: out.join('\n'), problems, dryRun }
}

/** One line for the badge: "2 rules, all valid: text:1 excludes E-06; text:2 excludes E-05". */
export function dryRunSummary(rows: DryRunRow[]): string {
  if (rows.length === 0) return 'no rules; every sentence is explained'
  const parts = rows.map((d) => `${d.rule} excludes ${d.excludes.join(', ') || 'nothing'}`)
  return `${rows.length} ${rows.length === 1 ? 'rule' : 'rules'}, all valid: ${parts.join('; ')}`
}

/** CLI shape shared with the other helpers (exit 0 valid, 1 problems listed after MISMATCHES (n), 2 unreadable). */
export function runCli(inputText: string, resultText?: string): { code: number; out: string } {
  const r = checkRuleResult(inputText, resultText)
  return { code: r.code, out: r.out }
}
