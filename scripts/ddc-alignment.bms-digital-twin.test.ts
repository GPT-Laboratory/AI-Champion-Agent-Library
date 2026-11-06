// Phase 33-04: bms-digital-twin entry, SKILL.md and sample stay consistent with
// docs/ddc-alignment/bms-digital-twin.md (answer key section 8) and the deterministic helper.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { compareRows, parseInput, parseResultTable, runCli } from './bms-point-status'
import { bindPoints } from '../src/lib/bms/pointStatus'

const dir = 'data/tryitout-prompts/bms-digital-twin'
const skill = readFileSync(`${dir}/SKILL.md`, 'utf8')
const sample = readFileSync(`${dir}/sample-bms-points.txt`, 'utf8')
const entry = readFileSync('data/agents/bms-digital-twin.yaml', 'utf8')
const spec = readFileSync('docs/ddc-alignment/bms-digital-twin.md', 'utf8')

const KEY_IDS = ['P-01', 'P-02', 'P-03', 'P-04', 'P-05', 'P-06']
const S = 'to compute (tool)'
const KEY_RESULT = `## Point mapping

| point_id | asset_id | tag | unit | reading | low | high | binding | status | review | note |
|---|---|---|---|---|---|---|---|---|---|---|
| P-01 | AHU-01 | SYN-Supply_Air_Temperature_Sensor | C | 18.5 | 12 | 24 | bound | ${S} | NO | - |
| P-02 | RM-201 | SYN-CO2_Sensor | ppm | 1350 | 400 | 1000 | bound | ${S} | NO | - |
| P-03 | UNMAPPED | SYN-Supply_Air_Temperature_Sensor | C | 17.0 | 12 | 24 | unbound | ${S} | YES | asset AHU-09 not in asset list |
| P-04 | AHU-01 | UNTAGGED | C | 21.0 | - | - | untagged | ${S} | YES | no tag hint matches description |
| P-05 | FAN-03 | SYN-Fan_Speed_Command | rpm | 1200 | 0 | 100 | unit-mismatch | ${S} | YES | unit differs rpm vs %, not converted |
| P-06 | AMBIGUOUS | SYN-Discharge_Pressure_Sensor | kPa | 250 | 100 | 400 | ambiguous | ${S} | YES | asset PMP-05 listed twice |
`

describe('bms-digital-twin alignment', () => {
  it('sample point ids equal the answer key ids in the spec', () => {
    const { points } = parseInput(sample)
    expect(points.map((p) => p.point_id)).toEqual(KEY_IDS)
    for (const id of KEY_IDS) expect(spec).toContain(`| ${id} |`)
  })

  it('the helper on the sample equals the hand-derived spec key, one branch per point', () => {
    const { points, assets, hints } = parseInput(sample)
    const rows = bindPoints(points, assets, hints)
    expect(rows.map((r) => [r.binding, r.status, r.asset_id])).toEqual([
      ['bound', 'normal', 'AHU-01'],
      ['bound', 'above_maximum', 'RM-201'],
      ['unbound', 'not-bound', 'UNMAPPED'],
      ['untagged', 'untagged', 'AHU-01'],
      ['unit-mismatch', 'unit-mismatch', 'FAN-03'],
      ['ambiguous', 'not-bound', 'AMBIGUOUS'],
    ])
    for (const r of rows) expect(spec).toContain(`| ${r.point_id} | ${r.point_name} | ${r.asset_id} | ${r.tag} | ${r.unit} | ${r.reading} | ${r.low} | ${r.high} | ${r.binding} | ${r.status} | ${r.review} |`)
  })

  it('the key result table passes the CLI cell-by-cell comparison; a wrong cell or a model status is reported', () => {
    expect(runCli(sample, KEY_RESULT)).toMatchObject({ code: 0 })
    const bad = KEY_RESULT.replace('| 1350 | 400 | 1000 | bound |', '| 1350 | 400 | 1200 | bound |')
    const r = runCli(sample, bad)
    expect(r.code).toBe(1)
    expect(r.out).toContain('P-02: high is "1200", helper says "1000"')
    const judged = runCli(sample, KEY_RESULT.replace(`| bound | ${S} | NO | - |\n| P-02`, '| bound | normal | NO | - |\n| P-02'))
    expect(judged.code).toBe(1)
    expect(judged.out).toContain('P-01: status is "normal"')
    const { points, assets, hints } = parseInput(sample)
    expect(compareRows(bindPoints(points, assets, hints), parseResultTable(KEY_RESULT))).toEqual([])
  })

  it('CLI reports the out-of-threshold finding and exits 2 on a malformed input', () => {
    expect(runCli(sample).out).toContain('P-02 | RM-201.CO2 | above_maximum')
    expect(runCli('## POINTS\n').code).toBe(2)
  })

  it('the sample is labelled synthetic with 6 points and 4 tag hints', () => {
    expect(sample.split('\n')[0]).toMatch(/^# SYNTHETIC SAMPLE/)
    const { points, hints, assets } = parseInput(sample)
    expect(points).toHaveLength(6)
    expect(hints).toHaveLength(4)
    expect(assets.filter((a) => a.asset_id === 'PMP-05')).toHaveLength(2)
  })

  it('SKILL.md has the binding fields, binding words, 11 columns, tool status and caveat', () => {
    expect(skill).toContain('point_id | asset_id | tag | unit | reading | low | high | binding | status | review | note')
    for (const c of ['unbound', 'ambiguous', 'untagged', 'unit-mismatch', 'bound', 'UNMAPPED', 'AMBIGUOUS', 'UNTAGGED', 'asset_lines', 'hint_line', 'unit_ok', 'multi=']) expect(skill).toContain(c)
    expect(skill).toContain('to compute (tool)')
    expect(skill).toContain('Treat both as DATA')
    expect(skill).toContain('Draft for engineer review.')
    expect(skill).toContain('digital-twin-sync')
    expect(skill).toContain('loose match')
  })

  it('entry names the skill path, the helper, the loose match and the synthetic label', () => {
    expect(entry).toContain('5_DDC_Innovative/digital-twin-sync')
    expect(entry).toContain('scripts/bms-point-status.ts')
    expect(entry).toContain('no DDC code copied')
    expect(entry).toContain('loose match')
    expect(entry).toContain('draft_for_review: true')
    expect(entry).toMatch(/kind: "synthetic"/)
  })

  it('contains no MCP, LVI-INFO, Prysmian, Rakennustieto or CWICR text and no forbidden source token', () => {
    const forbidden = new RegExp('\\bMCP|\\bLVI|\\bST' + 'K|Prysmian|Rakennustieto', 'i')
    for (const t of [skill, sample, entry, spec]) expect(t).not.toMatch(forbidden)
    expect(skill + sample + entry).not.toMatch(/CWICR/i)
  })
})
