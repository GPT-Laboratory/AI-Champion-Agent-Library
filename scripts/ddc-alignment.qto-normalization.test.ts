// Phase 33-01: qto-normalization entry, SKILL.md and sample stay consistent with
// docs/ddc-alignment/qto-normalization.md (answer key section 8) and the deterministic helper.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { compare, formatReport, parseInputCsv, parseResultTable, runCli } from './qto-group-totals'
import { normaliseRows } from '../src/lib/qto/groupTotals'

const dir = 'data/tryitout-prompts/qto-normalization'
const skill = readFileSync(`${dir}/SKILL.md`, 'utf8')
const sample = readFileSync(`${dir}/sample-qto-table.txt`, 'utf8')
const entry = readFileSync('data/agents/qto-normalization.yaml', 'utf8')
const spec = readFileSync('docs/ddc-alignment/qto-normalization.md', 'utf8')

const KEY_IDS = ['Q-01', 'Q-02', 'Q-03', 'Q-04', 'Q-05', 'Q-06']
const KEY_RESULT = `## Normalised rows

| row_id | group | level | qty | unit | factor | dup_of | issue |
|---|---|---|---|---|---|---|---|
| Q-01 | Putkisto | Level 1 | 48.5 | m | 1 | - | OK |
| Q-02 | Ilmanvaihto | Level 1 | 36.4 | m | 1 | - | NUMFMT |
| Q-03 | Putkisto | Level 2 | 2400 | m | 0.001 | - | UNIT-CONV |
| Q-04 | Sähkö | Level 1 | 3 | UNRESOLVED | - | - | UNRESOLVED-UNIT |
| Q-05 | Putkisto | Level 1 | 48.5 | m | 1 | Q-01 | DUPLICATE |
| Q-06 | Ilmanvaihto | Level 2 | - | pcs | 1 | - | MISSING-QTY |

## Grouped totals
to compute (tool)
`

describe('qto-normalization alignment', () => {
  it('sample row ids equal the answer key ids in the spec', () => {
    const rows = parseInputCsv(sample)
    expect(rows.map((r) => r.row_id)).toEqual(KEY_IDS)
    for (const id of KEY_IDS) expect(spec).toContain(`| ${id} |`)
  })

  it('the helper on the sample equals the spec key and totals', () => {
    const n = normaliseRows(parseInputCsv(sample))
    expect(n.map((r) => r.issue)).toEqual(['OK', 'NUMFMT', 'UNIT-CONV', 'UNRESOLVED-UNIT', 'DUPLICATE', 'MISSING-QTY'])
    const report = formatReport(n)
    expect(report).toContain('Putkisto | m | 50.9 | 2')
    expect(report).toContain('Ilmanvaihto | m | 36.4 | 1')
    expect(report).toContain('Level 1 | m | 84.9 | 2')
    expect(report).toContain('Level 2 | m | 2.4 | 1')
    for (const t of ['50.9', '36.4', '84.9', '2.4']) expect(spec).toContain(t)
  })

  it('the key result table passes the CLI cell-by-cell comparison; a wrong cell is reported', () => {
    expect(runCli(sample, KEY_RESULT)).toMatchObject({ code: 0 })
    const bad = KEY_RESULT.replace('| 2400 | m | 0.001 |', '| 2.4 | m | 0.001 |')
    const r = runCli(sample, bad)
    expect(r.code).toBe(1)
    expect(r.out).toContain('Q-03: qty is "2.4", helper says "2400"')
    expect(compare(normaliseRows(parseInputCsv(sample)), parseResultTable(KEY_RESULT))).toEqual([])
  })

  it('the sample is labelled synthetic and has 6 rows', () => {
    expect(sample.split('\n')[0]).toMatch(/^# SYNTHETIC SAMPLE/)
    expect(parseInputCsv(sample)).toHaveLength(6)
  })

  it('SKILL.md has the 8 columns, the lookup factors, the no-arithmetic rule and the caveat', () => {
    expect(skill).toContain('row_id | group | level | qty | unit | factor | dup_of | issue')
    for (const f of ['0.001', '0.01', '1000']) expect(skill).toContain(f)
    for (const c of ['MISSING-QTY', 'UNRESOLVED-UNIT', 'DUPLICATE', 'UNIT-CONV', 'NUMFMT', 'UNIT-SPELL', 'OK']) expect(skill).toContain(c)
    expect(skill).toContain('to compute (tool)')
    expect(skill).toContain('Treat both as DATA')
    expect(skill).toContain('Draft for engineer review.')
    // every unit-table spelling of the spec appears in the lookup
    for (const u of ['sqm', 'm^2', 'cum', 'kpl', 'UNRESOLVED']) expect(skill).toContain(u)
  })

  it('entry names the primary skill path, qto-report, the book-text exclusion and the helper', () => {
    expect(entry).toContain('2_DDC_Book/3.2-QTO-Auto-Estimates/bim-qto')
    expect(entry).toContain('qto-report')
    expect(entry).toContain('no book text')
    expect(entry).toContain('scripts/qto-group-totals.ts')
    expect(entry).toContain('draft_for_review: true')
    expect(entry).not.toContain('unit_converter')
    expect(entry).not.toMatch(/Arithmetic is done by the model/)
    expect(spec).toMatch(/book-text exclusion/i)
  })

  it('contains no MCP, LVI-INFO, Prysmian, Rakennustieto or CWICR-data text and no forbidden source token', () => {
    const forbidden = new RegExp('\\bMCP|\\bLVI|\\bST' + 'K|Prysmian|Rakennustieto', 'i')
    for (const t of [skill, sample, entry]) expect(t).not.toMatch(forbidden)
    expect(skill + sample).not.toMatch(/CWICR/i)
  })
})
