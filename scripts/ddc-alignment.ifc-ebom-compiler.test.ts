// ifc-ebom-compiler: the catalog entry, SKILL.md, the sample and the deterministic helper stay consistent with each
// other. Own design (no DDC skill, so no docs/ddc-alignment spec): the answer key for the sample lives in this file.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { parse as parseYaml } from 'yaml'
import { parseResultTable, runCli } from './ebom-join'
import { REVIEW_TEXT, classRows, joinLines, parseUpload, reviewItems, type ClassRow } from '../src/lib/ebom/ebomJoin'
import { slugify } from '../src/lib/spec/types'

const SLUG = 'ifc-ebom-compiler'
const dir = `data/tryitout-prompts/${SLUG}`
const skill = readFileSync(`${dir}/SKILL.md`, 'utf8')
const sample = readFileSync(`${dir}/sample-ifc-elements.txt`, 'utf8')
const entryText = readFileSync(`data/agents/${SLUG}.yaml`, 'utf8')
const entry = parseYaml(entryText)

const ELEMENTS_HEADER = 'token,ifc_class,type_name,system,size_mm,geom_family,stated_length_m,geom_centreline_m,geom_check,loc_block'
const CATALOGUE_HEADER = 'name,unit,ifc_class,geom_family,size_mm,discipline'
const BLOCKS_HEADER = 'block_id,discipline,tab,title'
const ROWS_HEADER = '| token | ifc_class | outcome | block | designation | unit | qty | rule |\n|---|---|---|---|---|---|---|---|'
const REVIEW_HEADER = '| where | members | kind | what |\n|---|---|---|---|'
const TOTALS_LINE = 'Metres and pieces per block and designation, and stick rounding: to compute (tool).'
const CLOSING_LINE = 'Draft for estimator review. Synthetic input; element facts were read from the model by the pipeline, designations come only from the supplied catalogue, and totals are computed by a tool, not by this agent.'

// Answer key for the sample: the output SKILL.md asks for, written out by hand.
const KEY_RESULT = `## E-BOM class rows
${ROWS_HEADER}
| E-01 | IfcDuctSegment | bill | K1 | SYN Round duct 250 | m | 3.00 | stated |
| E-02 | IfcDuctSegment | bill | K2 | SYN Round duct 100 | m | 2.275 | measured:geom |
| E-03 | IfcDuctFitting | bill | K1 | SYN Bend 100 | kpl | 1 | count |
| E-04 | IfcDuctFitting | review | K1 | - | - | - | multi-catalogue |
| E-05 | IfcDuctSegment | exclude | K2 | - | - | - | rules:2 |
| E-06 | IfcPipeSegment | exclude | K3 | - | - | - | rules:1 |
| E-07 | IfcPipeSegment | review | K3 | - | - | - | zero-qty |
| E-08 | IfcPipeSegment | review | K3 | - | - | - | length-unsettled |
| E-09 | IfcDuctSegment | review | K1 | - | - | - | no-catalogue |
| E-10 | IfcAirTerminal | review | K4 | - | - | - | loc-review |
| E-11 | IfcPipeSegment | review | K3 | - | - | - | zero-qty |

## Review items
${REVIEW_HEADER}
| K1 | 1 | unsettled | E-04: two or more catalogue names fit |
| K3 | 1 | bad_data | E-07: zero or negative length |
| K3 | 1 | estimate | E-08: no stated length and the geometry readings do not agree |
| K1 | 1 | unsettled | E-09: no catalogue name for this class, family and size |
| class | 1 | unsettled | E-10: block not settled by the location step |
| K3 | 1 | bad_data | E-11: zero or negative length |

## Rules not tied to data
rules:3: Insulation of cold-water pipes is billed by the insulation contractor

## Totals
${TOTALS_LINE}

${CLOSING_LINE}
`

const KEY_STEPS = [7, 9, 5, 4, 1, 1, 8, 10, 3, 2, 6] // E-01 .. E-11

/** The helper's rows, review items and untied rules in the SKILL.md output format (without the closing line). */
function render(rows: ClassRow[], untied: string[]): string {
  const review = reviewItems(rows)
  return [
    '## E-BOM class rows',
    ROWS_HEADER,
    ...rows.map((r) => `| ${[r.token, r.ifc_class, r.outcome, r.block, r.designation, r.unit, r.qty, r.rule].join(' | ')} |`),
    '',
    '## Review items',
    ...(review.length ? [REVIEW_HEADER, ...review.map((i) => `| ${i.where} | ${i.members} | ${i.kind} | ${i.what} |`)] : ['none']),
    '',
    '## Rules not tied to data',
    untied.length ? untied.join('\n') : 'none',
    '',
    '## Totals',
    TOTALS_LINE,
  ].join('\n')
}

/** The first fenced block after a line that starts with `label` in SKILL.md. */
function fencedAfter(label: string): string {
  const m = new RegExp(`^${label}[^\\n]*\\n+\`\`\`\\n([\\s\\S]*?)\\n\`\`\``, 'm').exec(skill)
  if (!m) throw new Error(`no fenced block after "${label}" in SKILL.md`)
  return m[1]
}

describe('ifc-ebom-compiler alignment', () => {
  it('the helper reproduces the answer key on the sample, and every step of the table is used', () => {
    const u = parseUpload(sample)
    const rows = classRows(u)
    expect(`${render(rows, u.untiedRules)}\n\n${CLOSING_LINE}\n`).toBe(KEY_RESULT)
    expect(rows.map((r) => r.step)).toEqual(KEY_STEPS)
    expect([...new Set(KEY_STEPS)].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('the key passes the CLI check; a wrong cell or an invented name is reported', () => {
    expect(runCli(sample, KEY_RESULT)).toMatchObject({ code: 0 })
    const wrongQty = runCli(sample, KEY_RESULT.replace('| m | 2.275 | measured:geom |', '| m | 2.3 | measured:geom |'))
    expect(wrongQty.code).toBe(1)
    expect(wrongQty.out).toContain('E-02: qty is "2.3", helper says "2.275"')
    const invented = runCli(sample, KEY_RESULT.replace('| SYN Bend 100 | kpl |', '| SYN Bend 100 long | kpl |'))
    expect(invented.code).toBe(1)
    expect(invented.out).toContain('E-03: designation "SYN Bend 100 long" is not in the catalogue')
    const dropped = runCli(sample, KEY_RESULT.replace(/\| E-08 \|[^\n]*\n/, ''))
    expect(dropped.out).toContain('E-08: no outcome')
  })

  it('the join of the key gives the sample totals with 3 m sticks', () => {
    expect(joinLines(parseResultTable(KEY_RESULT), '3')).toEqual([
      { block: 'K1', designation: 'SYN Bend 100', unit: 'kpl', measured: '1', billed: '1', elements: 1, stick_rounded: false },
      { block: 'K1', designation: 'SYN Round duct 250', unit: 'm', measured: '3', billed: '3', elements: 1, stick_rounded: true },
      { block: 'K2', designation: 'SYN Round duct 100', unit: 'm', measured: '2.275', billed: '3', elements: 1, stick_rounded: true },
    ])
  })

  it('the CLI exits 2 on an invalid upload', () => {
    expect(runCli(sample.replace('## ELEMENTS', '## ITEMS')).code).toBe(2)
    expect(runCli(sample.replace(',2.275,agree,K2', ',2,275,agree,K2')).code).toBe(2)
    expect(runCli(sample.replace(',2.950,none,K3', ',2.950,maybe,K3')).code).toBe(2)
    expect(runCli(sample.replace('SYN Copper pipe 15,m,', 'SYN Copper pipe 15,mm,')).code).toBe(2)
  })

  it('the SKILL.md worked rows are what the helper gives on the worked input (the skill agrees with itself)', () => {
    const u = parseUpload(fencedAfter('Input:'))
    expect(render(classRows(u), u.untiedRules)).toBe(fencedAfter('Output:'))
  })

  it('the sample is labelled synthetic, uses invented designations and differs from the worked rows', () => {
    expect(sample.split('\n')[0]).toMatch(/^# SYNTHETIC SAMPLE/)
    const u = parseUpload(sample)
    for (const c of u.catalogue) expect(c.name).toMatch(/^SYN /)
    const worked = parseUpload(fencedAfter('Input:'))
    const workedTokens = new Set(worked.elements.map((e) => e.token))
    for (const e of u.elements) expect(workedTokens.has(e.token)).toBe(false)
  })

  it('SKILL.md has the section headers, the output tables, the fixed texts, the closing line and the hard rules', () => {
    expect(skill).toMatch(new RegExp(`^---\\nname: ${SLUG}\\n`))
    for (const h of [BLOCKS_HEADER, CATALOGUE_HEADER, ELEMENTS_HEADER, '## BLOCKS', '## CATALOGUE', '## RULES', '## ELEMENTS']) expect(skill).toContain(h)
    for (const t of [ROWS_HEADER, REVIEW_HEADER, TOTALS_LINE, CLOSING_LINE]) expect(skill).toContain(t)
    for (const [rule, text] of Object.entries(REVIEW_TEXT)) {
      expect(skill).toContain(`\`${rule}\``)
      expect(skill).toContain(text)
    }
    for (const w of ['unsettled', 'bad_data', 'estimate', 'measured:geom', 'stated', 'count', 'output/result.md']) expect(skill).toContain(w)
    expect(skill).toMatch(/never add, subtract, multiply, round or count/i)
    expect(skill).toMatch(/never invent a designation/i)
    expect(skill).toMatch(/never choose between two catalogue names/i)
  })

  it('the entry matches the skill: slug, form, tool, helper and template fields', () => {
    expect(slugify(entry.name)).toBe(SLUG) // ingest derives the slug from the name
    expect(entry.id).toBe(`aic-${SLUG}-001`)
    const m = entry.metadata
    expect([m.stage, m.agent_no, m.draft_for_review, m.sample_data.kind, m.attribution]).toEqual(['design', 2, true, 'synthetic', 'no DDC basis (own design)'])
    expect(m.input_schema).toHaveLength(1)
    expect(m.input_schema[0]).toMatchObject({ key: 'input_text', type: 'textarea', required: true })
    for (const h of [BLOCKS_HEADER, CATALOGUE_HEADER, ELEMENTS_HEADER]) expect(m.input_schema[0].placeholder).toContain(h)
    expect(entry.tools.map((t: { name: string }) => t.name)).toEqual(['ebom_join'])
    for (const p of ['src/lib/ebom/ebomJoin.ts', 'scripts/ebom-join.ts']) {
      expect(entry.tools[0].description).toContain(p)
      expect(m.gaps.join('\n')).toContain(p)
    }
    expect(m.data_sources.join('\n')).toContain(dir)
    expect(entry.human_in_the_loop).toBe(true)
  })
})
