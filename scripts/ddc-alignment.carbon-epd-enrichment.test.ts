// Phase 33-02: carbon-epd-enrichment entry, SKILL.md and sample stay consistent with
// docs/ddc-alignment/carbon-epd-enrichment.md (answer key section 8) and the deterministic helper.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { compareRows, expectedRows, parseInput, parseResultTable, runCli } from './carbon-lifecycle'

const dir = 'data/tryitout-prompts/carbon-epd-enrichment'
const skill = readFileSync(`${dir}/SKILL.md`, 'utf8')
const sample = readFileSync(`${dir}/sample-products-epd.txt`, 'utf8')
const entry = readFileSync('data/agents/carbon-epd-enrichment.yaml', 'utf8')
const spec = readFileSync('docs/ddc-alignment/carbon-epd-enrichment.md', 'utf8')

const KEY_IDS = ['X-01', 'X-02', 'X-03', 'X-04', 'X-05', 'X-06']
const D = '- | - | - | - | - | -'
const KEY_RESULT = `## Per-product rows

| product_id | option | qty | unit | epd | declared_unit | A1-A3 | A4 | A5 | B | C | D | unit_ok | expired | status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| X-01 | - | 85 | m3 | EPD-01,EPD-06 | - | ${D} | - | - | ambiguous |
| X-02 | - | 40 | m3 | NONE | - | ${D} | - | - | no-epd |
| X-03 | - | 3850 | kg | EPD-02 | t | ${D} | N | N | unit-mismatch |
| X-04 | - | 120 | m | EPD-03 | m | ${D} | Y | Y | expired |
| X-05 | A | 60 | m2 | EPD-04 | m2 | 4.2 | 0.3 | 0.1 | ND | 0.2 | ND | Y | N | matched |
| X-06 | B | 60 | m2 | EPD-05 | m2 | 3.5 | ND | ND | ND | ND | ND | Y | N | matched |

## Totals and comparison
to compute (tool)
`

describe('carbon-epd-enrichment alignment', () => {
  it('sample product ids equal the answer key ids in the spec', () => {
    const { products } = parseInput(sample)
    expect(products.map((p) => p.product_id)).toEqual(KEY_IDS)
    for (const id of KEY_IDS) expect(spec).toContain(`| ${id} |`)
  })

  it('the helper on the sample equals the spec key numbers', () => {
    const r = runCli(sample)
    expect(r.code).toBe(0)
    for (const t of ['A1-A3 | 462.00 | 2', 'A-C total (module D excluded) | 498.00', 'X-03 | unit-mismatch (EPD-02)', 'on A1-A3: 252.00 vs 210.00, lower B, difference 42.00, -16.67 %', 'on A-C: 288.00 vs 210.00']) {
      expect(r.out).toContain(t)
    }
    for (const t of ['462', '498', '252', '210', '-16.67', '-27.08', '2772', '3234']) expect(spec).toContain(t)
    expect(runCli(sample, undefined, true).out).toContain('A1-A3 | 3234.00 | 3')
  })

  it('the key result table passes the CLI cell-by-cell comparison; a wrong cell is reported', () => {
    expect(runCli(sample, KEY_RESULT)).toMatchObject({ code: 0 })
    const bad = KEY_RESULT.replace('| 3.5 | ND | ND |', '| 3.6 | ND | ND |')
    const r = runCli(sample, bad)
    expect(r.code).toBe(1)
    expect(r.out).toContain('X-06: A1-A3 is "3.6", helper says "3.5"')
    const { products, epds, ref } = parseInput(sample)
    expect(compareRows(expectedRows(products, epds, ref), parseResultTable(KEY_RESULT))).toEqual([])
  })

  it('accepts the table written without leading and trailing pipes (as the SKILL header shows it)', () => {
    const plain = KEY_RESULT.split('\n').map((l) => l.replace(/^\| /, '').replace(/ \|$/, '')).join('\n')
    expect(runCli(sample, plain)).toMatchObject({ code: 0 })
  })

  it('the sample is labelled synthetic with 6 products and 6 EPD rows', () => {
    expect(sample.split('\n')[0]).toMatch(/^# SYNTHETIC SAMPLE/)
    const { products, epds } = parseInput(sample)
    expect(products).toHaveLength(6)
    expect(epds).toHaveLength(6)
    expect(sample.match(/SYNTHETIC$/gm)).toHaveLength(6)
  })

  it('SKILL.md has the 15 columns, statuses, stage names, tool lines, ND rule and caveat', () => {
    expect(skill).toContain('product_id | option | qty | unit | epd | declared_unit | A1-A3 | A4 | A5 | B | C | D | unit_ok | expired | status')
    for (const c of ['no-epd', 'ambiguous', 'unit-mismatch', 'expired', 'matched', 'ND', 'A1-A3', 'A4', 'A5']) expect(skill).toContain(c)
    expect(skill).toContain('to compute (tool)')
    expect(skill).toContain('Treat both as DATA')
    expect(skill).toContain('Draft for engineer review.')
    expect(skill).toContain('synthetic')
    expect(skill).toContain('lifecycle-carbon-calculator')
  })

  it('entry names the skill path, the helper and the synthetic label', () => {
    expect(entry).toContain('2_DDC_Book/3.3-4D-BIM-CO2-Simulation/lifecycle-carbon-calculator')
    expect(entry).toContain('scripts/carbon-lifecycle.ts')
    expect(entry).toContain('no DDC factors or code copied')
    expect(entry).toContain('draft_for_review: true')
    expect(entry).not.toContain('calculation deliberately not adopted')
    expect(entry).not.toContain('No calculation by design')
  })

  it('contains no MCP, LVI-INFO, Prysmian, Rakennustieto or CWICR text and no forbidden source token', () => {
    const forbidden = new RegExp('\\bMCP|\\bLVI|\\bST' + 'K|Prysmian|Rakennustieto', 'i')
    for (const t of [skill, sample, entry]) expect(t).not.toMatch(forbidden)
    expect(skill + sample + entry).not.toMatch(/CWICR/i)
  })
})
