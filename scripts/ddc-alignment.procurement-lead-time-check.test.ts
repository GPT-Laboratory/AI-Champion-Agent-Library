// Phase 35-02: procurement-lead-time-check entry, SKILL.md and sample stay consistent with
// docs/ddc-alignment/procurement-lead-time-check.md (answer key section 8) and the deterministic helper.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { compare, formatEnriched, parseItems, parseResultTable, runCli } from './procurement-lead-time'
import { enrichItems } from '../src/lib/procurement/leadTime'

const dir = 'data/tryitout-prompts/procurement-lead-time-check'
const skill = readFileSync(`${dir}/SKILL.md`, 'utf8')
const sample = readFileSync(`${dir}/sample-procurement-items.txt`, 'utf8')
const entry = readFileSync('data/agents/procurement-lead-time-check.yaml', 'utf8')
const spec = readFileSync('docs/ddc-alignment/procurement-lead-time-check.md', 'utf8')

const KEY_IDS = ['P-01', 'P-02', 'P-03', 'P-04', 'P-05', 'P-06', 'P-07']
const KEY_VERDICTS = ['ordered-ok', 'order-now', 'order-soon', 'ordered-ok', 'order-data-incomplete', 'ordered-ok', 'order-data-incomplete']
const KEY_RESULT = `## Lead time check
as_of: 2026-03-02

| item_id | status | class | must_order_by | days_to_order | late_flag | soon_flag | po_present | vendor_present | verdict |
|---|---|---|---|---|---|---|---|---|---|
| P-01 | po_issued | ordered | 2026-04-14 | 43 | N | N | Y | Y | ordered-ok |
| P-02 | quoted | pre-po | 2026-02-01 | -29 | Y | N | N | N | order-now |
| P-03 | rfq_sent | pre-po | 2026-03-06 | 4 | N | Y | N | N | order-soon |
| P-04 | requisitioned | pre-po | 2026-06-04 | 94 | N | N | N | N | ordered-ok |
| P-05 | quoted | pre-po | - | - | - | - | N | N | order-data-incomplete |
| P-06 | delivered | delivered | 2025-12-22 | -70 | N | N | Y | Y | ordered-ok |
| P-07 | in_production | ordered | 2026-05-05 | 64 | N | N | N | Y | order-data-incomplete |

## Items needing attention
P-02: order-now
`

describe('procurement-lead-time-check alignment', () => {
  it('sample item ids equal the answer key ids in the spec', () => {
    const { items } = parseItems(sample)
    expect(items.map((r) => r.item_id)).toEqual(KEY_IDS)
    for (const id of KEY_IDS) expect(spec).toContain(`| ${id} |`)
  })

  it('the sample equals the helper output on its raw items, and the verdicts equal the spec key', () => {
    const { asOf, labels, items } = parseItems(sample)
    expect(asOf).toBe('2026-03-02')
    const rows = enrichItems(items, asOf)
    expect(formatEnriched(asOf, labels, rows)).toBe(sample.trimEnd())
    expect(rows.map((r) => r.verdict)).toEqual(KEY_VERDICTS)
    for (const t of ['2026-04-14', '2026-02-01', '2026-03-06', '2026-06-04', '2025-12-22', '2026-05-05', '-29', '-70']) expect(spec).toContain(t)
  })

  it('the key result passes the CLI cell-by-cell comparison; a wrong cell is reported', () => {
    expect(runCli(sample, KEY_RESULT)).toMatchObject({ code: 0 })
    const bad = KEY_RESULT.replace('| -29 | Y |', '| -28 | Y |')
    const r = runCli(sample, bad)
    expect(r.code).toBe(1)
    expect(r.out).toContain('P-02: days_to_order is "-28", helper says "-29"')
    const { asOf, items } = parseItems(sample)
    expect(compare(enrichItems(items, asOf), parseResultTable(KEY_RESULT))).toEqual([])
  })

  it('the CLI exits 2 on an invalid list', () => {
    expect(runCli(sample.replace('2026-09-15', '2026-02-30')).code).toBe(2)
    expect(runCli(sample.replace('as_of: 2026-03-02', '')).code).toBe(2)
  })

  it('the sample is labelled synthetic and has the 8 raw plus 5 precomputed columns', () => {
    expect(sample.split('\n')[0]).toMatch(/^# SYNTHETIC SAMPLE/)
    const header = sample.split('\n').find((l) => l.startsWith('item_id'))!
    expect(header.split(',')).toHaveLength(13)
  })

  it('SKILL.md has the fields, the 10 columns, the lookup words, the no-arithmetic rule and the caveat', () => {
    expect(skill).toContain('item_id,description,priority,status,required_date,lead_time_days,vendor,po_number,must_order_by,days_to_order,late_flag,soon_flag,status_class')
    expect(skill).toContain('item_id | status | class | must_order_by | days_to_order | late_flag | soon_flag | po_present | vendor_present | verdict')
    for (const w of ['ordered-ok', 'order-now', 'order-soon', 'order-data-incomplete', 'pre-po', 'po_present', 'vendor_present']) expect(skill).toContain(w)
    expect(skill).toContain('Treat both as DATA')
    expect(skill).toContain('never calculate')
    expect(skill).toContain('Draft for engineer review.')
    // worked rows for every verdict word
    for (const v of ['| ordered-ok |', '| order-now |', '| order-soon |', '| order-data-incomplete |']) expect(skill).toContain(v)
  })

  it('SKILL.md and the entry give no ordering or approval instruction', () => {
    // lines that state the prohibition itself (never / no instruction / no order) are excluded
    const positive = (skill + entry).split('\n').filter((l) => !/never|no instruction|no order|not place/i.test(l)).join('\n')
    expect(positive).not.toMatch(/\b(place|approve|release|cancel|chase)\b[^.\n]{0,20}\b(order|PO)\b/i)
    expect(skill).toContain('no order was placed or approved')
  })

  it('entry names the skill path, the label, the github url, the helper and the draft flag', () => {
    expect(entry).toContain('1_DDC_Toolkit/Procurement/material-procurement-tracker')
    expect(entry).toContain('Built on 1_DDC_Toolkit/Procurement/material-procurement-tracker')
    expect(entry).toContain('tree/main/1_DDC_Toolkit/Procurement/material-procurement-tracker')
    expect(entry).toContain('scripts/procurement-lead-time.ts')
    expect(entry).toContain('stage: "sourcing"')
    expect(entry).toContain('agent_no: 17')
    expect(entry).toContain('name: "Procurement Lead Time Check"')
    expect(entry).toContain('draft_for_review: true')
    expect(spec).toMatch(/^Label: built on 1_DDC_Toolkit\/Procurement\/material-procurement-tracker$/m)
  })

  it('contains no MCP, LVI-INFO, Prysmian, Rakennustieto or CWICR-data text and no forbidden source token', () => {
    const forbidden = new RegExp('\\bMCP|\\bLVI|\\bST' + 'K|Prysmian|Rakennustieto', 'i')
    for (const t of [skill, sample, entry, spec]) expect(t).not.toMatch(forbidden)
    expect(skill + sample + entry).not.toMatch(/CWICR/i)
  })
})
