// The check of a scope-rule-drafter result (own design, deterministic, no I/O). Shared by the CLI
// (scripts/rule-check.ts) and the app's post-run check (src/lib/server/tryitout/postRunCheck.ts).
// The rules are the lines the user typed in the task box (ruleLines numbers them S-1, S-2, ...); an upload with a
// `## RULE TEXT` section supplies them instead.
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

/**
 * The rules of a block of typed text, in order: one per non-empty line, with a leading bullet (`-`, `*`, `•`, `1.`,
 * `1)`) or `S-<n>:` removed. `#` lines and a lead-in line ending with ":" ("Rules for this job:") are not rules.
 * The skill numbers them the same way, so the ids S-1, S-2, ... agree.
 */
export function ruleLines(text: string): Sentence[] {
  const out: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const t = raw
      .trim()
      .replace(/^(?:[-*•]|\d{1,3}[.)])\s+/, '')
      .replace(/^S-\d+:\s*/, '')
      .trim()
    if (t === '' || t.startsWith('#') || t.endsWith(':')) continue
    out.push(t)
  }
  return out.map((text, i) => ({ id: `S-${i + 1}`, text }))
}
export const NOT_TURNED_HEADING = 'Sentences not turned into a rule'

/**
 * The exclusion wordings of the skill's step 1 (SKILL.md lists the same): a note with one of them excludes something,
 * a note without one never does. Requirements ("must", "shall") have none.
 */
export const EXCLUSION_WORDINGS: readonly RegExp[] = [
  /\b(?:delivered|supplied|installed|provided|billed|furnished)\s+by\b/i,
  /\bcomes?\s+from\b/i,
  /\bbelongs?\s+to\b/i,
  /\bnot\s+(?:part\s+of|included\s+in|in)\s+(?:this|the|our)\s+(?:contract|scope|delivery)\b/i,
  /\b(?:outside|out\s+of)\s+(?:(?:this|the|our)\s+)?(?:contract|scope)\b/i,
  /\bexclud(?:e|es|ed|ing)\b/i,
]

export const hasExclusionWording = (note: string): boolean => EXCLUSION_WORDINGS.some((r) => r.test(note))

const normal = (s: string) => s.toLowerCase().replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * The skill's naming rule: the value appears in the note, compared without case, a hyphen read as a space, a leading
 * `SYN-` label ignored and a plural `s` accepted, as whole words. "Exhaust valves" names `Exhaust valve`, not
 * `IfcAirTerminal`.
 */
export function namesValue(note: string, value: string): boolean {
  const v = normal(value.replace(/^syn-/i, ''))
  if (v === '') return false
  const esc = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|[^a-z0-9])${esc}s?(?:[^a-z0-9]|$)`).test(normal(note))
}

export interface Sentence {
  id: string
  text: string
}

export interface Block {
  id: string
  tab: string
  title: string
}

export interface RuleData {
  columns: string[]
  elements: Record<string, string>[]
  /** The upload's BLOCKS (block_id, tab, title), if it has them: a block is named by its id, tab or title. */
  blocks: Block[]
}

export interface RuleInput extends RuleData {
  sentences: Sentence[]
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

/**
 * The rules and the element data. `text` is the upload (or, with no upload, the task text); `task` is the task text.
 * The rules come from a `## RULE TEXT` section of `text` if it has one, else from the task's lines, which needs an
 * upload (a task that is itself the data cannot also be the rules).
 */
/** The element data of an upload: ELEMENTS (required) and BLOCKS (optional). */
export function parseRuleData(text: string): RuleData {
  const s = sections(text)
  const el = s.get('ELEMENTS')
  if (!el || el.length === 0) throw new ParseError('no "## ELEMENTS" section with a header in the attached data')
  const columns = el[0].split(',').map((c) => c.trim())
  const absent = ELEMENT_COLS.filter((c) => !columns.includes(c))
  if (absent.length) throw new ParseError(`ELEMENTS lacks columns: ${absent.join(', ')}`)
  const elements = el.slice(1).map((l, n) => {
    const cells = l.split(',')
    if (cells.length !== columns.length) throw new ParseError(`ELEMENTS row ${n + 1} has ${cells.length} cells, expected ${columns.length}`)
    return Object.fromEntries(columns.map((c, i) => [c, cells[i].trim()]))
  })
  const bl = s.get('BLOCKS') ?? []
  const bh = (bl[0] ?? '').split(',').map((c) => c.trim())
  const blocks = bh.includes('block_id')
    ? bl.slice(1).map((l) => {
        const c = l.split(',').map((x) => x.trim())
        return { id: c[bh.indexOf('block_id')] ?? '', tab: c[bh.indexOf('tab')] ?? '', title: c[bh.indexOf('title')] ?? '' }
      })
    : []
  return { columns, elements, blocks }
}

/**
 * The rules and the element data. `text` is the upload (or, with no upload, the task text); `task` is the task text.
 * The rules come from a `## RULE TEXT` section of `text` if it has one, else from the task's lines, which needs an
 * upload (a task that is itself the data cannot also be the rules).
 */
export function parseRuleInput(text: string, task?: string): RuleInput {
  const data = parseRuleData(text)
  const s = sections(text)
  const ruleText = s.get('RULE TEXT')
  let sentences: Sentence[]
  if (ruleText) sentences = ruleLines(ruleText.join('\n'))
  else if (task !== undefined && task !== text) sentences = ruleLines(task)
  else throw new ParseError('no rules: type them in the task box, one per line, and attach the E-BOM data as the file')
  if (sentences.length === 0) throw new ParseError('no rules: the task box has no rule line')
  const existingIds = (s.get('RULES') ?? []).map((l) => RULE.exec(l)?.[1] ?? l.split(':').slice(0, 2).join(':'))
  return { ...data, sentences, existingIds }
}

// ------------------------------------------------------------------ the values a rule may name

/** The ELEMENTS columns a note can name. Lengths, geometry readings and the geometry family are not things a scope note
 *  is written about (and "bend" would otherwise name both a type and a family). */
export const VALUE_COLUMNS = ['ifc_class', 'type_name', 'system', 'size_mm', 'loc_block'] as const
export const VALUES_HEADING = 'VALUES'

export interface NamedValue {
  field: string
  value: string
}

/** Every value of VALUE_COLUMNS that a note names (the skill's naming rule); a block also by its tab or title. */
export function namedValues(note: string, data: RuleData): NamedValue[] {
  const out: NamedValue[] = []
  for (const field of VALUE_COLUMNS) {
    for (const value of distinctValues(data)[field] ?? []) {
      const block = field === 'loc_block' ? data.blocks.find((b) => b.id === value) : undefined
      const names = [value, ...(block ? [block.tab, block.title].filter(Boolean) : [])]
      if (names.some((n) => namesValue(note, n))) out.push({ field, value })
    }
  }
  return out
}

/** The `## VALUES` section the tool step writes: per column, the values a rule may name, blocks with tab and title. */
export function valuesSection(data: RuleData): string {
  const values = distinctValues(data)
  const lines = VALUE_COLUMNS.map((f) => {
    const vs = (values[f] ?? []).map((v) => {
      const b = f === 'loc_block' ? data.blocks.find((x) => x.id === v) : undefined
      return b ? `${v} (${[b.tab, b.title].filter(Boolean).join(', ')})` : v
    })
    return `${f}: ${vs.join(' | ') || '(none)'}`
  })
  return [`## ${VALUES_HEADING}`, '# Written by a tool before the run: the only values a rule may name, per ELEMENTS column. A block is named by its id, tab or title.', ...lines].join('\n')
}

/**
 * The tool step in front of scope-rule-drafter (src/lib/server/tryitout/preRunStep.ts): the upload with its
 * `## VALUES` section (re)written, so the model picks values from a list instead of reading them out of CSV rows.
 * Null when the upload has no readable ELEMENTS.
 */
export function prepareRuleUpload(text: string): { text: string; note: string } | null {
  // Drop a VALUES section the upload brought along: it is rewritten, never trusted.
  const kept: string[] = []
  let skipping = false
  for (const l of text.replace(/\r\n?/g, '\n').split('\n')) {
    const h = /^##\s/.test(l.trim()) ? l.trim().replace(/^##\s+/, '').trim().toUpperCase() : null
    if (h !== null) skipping = h === VALUES_HEADING
    if (!skipping) kept.push(l)
  }
  let data: RuleData
  try {
    data = parseRuleData(kept.join('\n'))
  } catch (e) {
    if (e instanceof ParseError) return null
    throw e
  }
  while (kept.length && kept[kept.length - 1].trim() === '') kept.pop()
  const counts = VALUE_COLUMNS.map((f) => `${(distinctValues(data)[f] ?? []).length} ${f}`).join(', ')
  return { text: `${kept.join('\n')}\n${valuesSection(data)}\n`, note: `tool step: the values a rule may name listed for the model (${counts})` }
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
export function distinctValues(input: RuleData): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const c of input.columns) out[c] = [...new Set(input.elements.map((e) => e[c]).filter((v) => v !== ''))]
  return out
}

export function checkRuleResult(inputText: string, resultText?: string, task?: string): RuleCheck {
  let input: RuleInput
  try {
    input = parseRuleInput(inputText, task)
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
  const noteOf = new Map(input.sentences.map((x) => [x.id, x.text]))
  for (const r of result.mapping) {
    const s = r.sentence
    const note = noteOf.get(s) ?? ''
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
      // The two parts of the skill a tool can check on the wording: an exclusion wording, and the value named.
      if (note && !hasExclusionWording(note)) problems.push(`${s}: made a rule, but the note has no exclusion wording (a requirement or remark is not-an-exclusion)`)
      if (note && rule) {
        const named = namedValues(note, input)
        if (!named.some((n) => n.field === rule.field && n.value === rule.value)) problems.push(`${s}: the note does not name "${rule.value}"; a rule's value must appear in its note`)
        else if (named.length > 1) problems.push(`${s}: the note names more than one value (${named.map((n) => `${n.field} = ${n.value}`).join(', ')}); a rule on one of them excludes more than the note says`)
      }
    } else {
      if (r.rule !== '-' || r.field !== '-' || r.value !== '-') problems.push(`${s}: a not-a-rule row must have "-" in rule, field and value`)
      if (!(REASONS as readonly string[]).includes(r.reason)) problems.push(`${s}: reason "${r.reason}" is not one of ${REASONS.join(', ')}`)
      else if (r.reason === 'not-an-exclusion' && hasExclusionWording(note)) problems.push(`${s}: the note has an exclusion wording, so it is not not-an-exclusion`)
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
export function runCli(inputText: string, resultText?: string, task?: string): { code: number; out: string } {
  const r = checkRuleResult(inputText, resultText, task)
  return { code: r.code, out: r.out }
}
