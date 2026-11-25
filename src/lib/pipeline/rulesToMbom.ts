// The tool steps of the pipeline "Plain-language rules -> E-BOM -> M-BOM" (data/pipelines/rules-to-mbom,
// docs/pipelines.md). Client-safe, pure, no I/O. Each hand-over between two agents is one of these functions, so the
// page and the tests run the same code and no model ever decides a hand-over:
// - rules -> E-BOM upload: the Scope Rule Drafter's `## RULES` lines spliced into the E-BOM data (src/lib/rules/splice.ts);
// - E-BOM -> sourcing input: the IFC EBOM Compiler's class rows checked against the contract and joined into E-BOM
//   lines by the ebom-join helper (src/lib/ebom/ebomJoin.ts), mapped to product class, size and material, and put in
//   front of the catalog excerpt in the format product-sourcing-mbom reads.
import { EbomError, checkOutcomes, joinLines, parseUpload, type Line } from '../ebom/ebomJoin'
import { ParseError, parseResultTable } from '../ebom/ebomCheck'
import { rulesBlockOf, spliceRules, type SpliceMode } from '../rules/splice'

/** What to do with the rules the E-BOM data already has: add the new ones, replace them, or use only those. */
export type RulesChoice = SpliceMode | 'mine'

const heading = (l: string): string | null => (/^##\s/.test(l.trim()) ? l.trim().replace(/^##\s+/, '').trim().toUpperCase() : null)

/** The rule lines the E-BOM data already has (its `## RULES` section), labels and blank lines left out. */
export function existingRules(data: string): string[] {
  const out: string[] = []
  let inRules = false
  for (const l of data.split(/\r?\n/)) {
    const h = heading(l)
    if (h !== null) {
      inRules = h === 'RULES'
      continue
    }
    const t = l.trim()
    if (inRules && t !== '' && t !== 'none' && !t.startsWith('#')) out.push(t)
  }
  return out
}

/** The rule lines of a Scope Rule Drafter result, as the gate shows them for editing. */
export const rulesOfResult = rulesBlockOf

/** Step 1 -> 2: the E-BOM agent's upload. With 'mine' the data goes on unchanged (the rule step was skipped). */
export function ebomUpload(data: string, rules: string[], choice: RulesChoice): string {
  if (choice === 'mine') return data
  return spliceRules(data, rules.map((r) => r.trim()).filter(Boolean), choice)
}

/** A CSV block of a pipeline data file: `#` lines are labels, the first other line is the header. */
export function readCsv(text: string): { labels: string[]; header: string[]; rows: Record<string, string>[] } {
  const labels: string[] = []
  let header: string[] | null = null
  const rows: Record<string, string>[] = []
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim()
    if (l === '') continue
    if (l.startsWith('#')) {
      labels.push(l)
      continue
    }
    const cells = l.split(',').map((c) => c.trim())
    if (!header) header = cells
    else rows.push(Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ''])))
  }
  return { labels, header: header ?? [], rows }
}

export interface SourcingLine {
  line_id: string
  block: string
  designation: string
  req_class: string
  req_dn: string
  req_material: string
  qty: string
  unit: string
  /** The E-BOM line the tool joined: measured quantity and whether metres were rounded up to whole sticks. */
  measured: string
  stickRounded: boolean
}

export interface SourcingHandOver {
  /** The sourcing agent's upload (`## E-BOM` and `## CATALOG EXCERPT`), or '' when there is nothing to hand over. */
  text: string
  lines: SourcingLine[]
  /** Designations of billed E-BOM lines the mapping has no entry for; they are not handed over. */
  unmapped: string[]
  /** Why nothing can be handed over (unreadable input or result, contract problems, no billed line). */
  problems: string[]
}

/** The E-BOM units in the words the sourcing agent's catalog uses. */
const UNIT: Record<string, string> = { m: 'm', kpl: 'pcs' }

/**
 * Step 2 -> 3: the sourcing agent's upload from the E-BOM agent's result. The class rows must meet the contract
 * (checkOutcomes); the lines are those of the ebom-join tool (block x designation, metres rounded up to whole sticks).
 */
export function sourcingInput(ebomUploadText: string, ebomResult: string, mappingCsv: string, catalogCsv: string, stickM = '3'): SourcingHandOver {
  const none = (problems: string[]): SourcingHandOver => ({ text: '', lines: [], unmapped: [], problems })
  let lines: Line[]
  try {
    const upload = parseUpload(ebomUploadText)
    const rows = parseResultTable(ebomResult)
    const problems = checkOutcomes(upload, rows)
    if (problems.length) return none(problems.map((p) => `E-BOM class rows: ${p}`))
    lines = joinLines(rows, stickM)
  } catch (e) {
    if (e instanceof ParseError || e instanceof EbomError) return none([`cannot read the E-BOM input or result: ${e.message}`])
    throw e
  }
  const mapping = new Map(readCsv(mappingCsv).rows.map((r) => [r.designation, r]))
  const unmapped: string[] = []
  const out: SourcingLine[] = []
  for (const l of lines) {
    const m = mapping.get(l.designation)
    if (!m) {
      if (!unmapped.includes(l.designation)) unmapped.push(l.designation)
      continue
    }
    out.push({
      line_id: `EB-${String(out.length + 1).padStart(2, '0')}`,
      block: l.block,
      designation: l.designation,
      req_class: m.req_class,
      req_dn: m.req_dn,
      req_material: m.req_material,
      qty: l.billed,
      unit: UNIT[l.unit] ?? l.unit,
      measured: l.measured,
      stickRounded: l.stick_rounded,
    })
  }
  if (out.length === 0) {
    return { ...none(lines.length ? ['no billed E-BOM line has a product mapping'] : ['the E-BOM has no billed line to source']), unmapped }
  }
  const catalog = readCsv(catalogCsv)
  const text = [
    '# SYNTHETIC SAMPLE - E-BOM lines handed over by the pipeline: one line per block and designation, joined by the ebom-join tool from the approved E-BOM class rows (metres rounded up to whole sticks), mapped to product class, size and material',
    ...catalog.labels,
    '## E-BOM',
    'line_id,description,req_class,req_dn,req_material,qty,unit',
    ...out.map((l) => [l.line_id, `${l.designation} in ${l.block}`, l.req_class, l.req_dn, l.req_material, l.qty, l.unit].join(',')),
    '## CATALOG EXCERPT',
    catalog.header.join(','),
    ...catalog.rows.map((r) => catalog.header.map((h) => r[h]).join(',')),
  ].join('\n')
  return { text: `${text}\n`, lines: out, unmapped, problems: [] }
}
