// Phase 35-03: material-delivery-check entry, SKILL.md and sample stay consistent with
// docs/ddc-alignment/material-delivery-check.md (answer key section 8) and the deterministic helper.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { compare, formatEnriched, parseLines, parseResultTable, runCli } from './delivery-check'
import { enrichLines } from '../src/lib/delivery/deliveryCheck'

const dir = 'data/tryitout-prompts/material-delivery-check'
const skill = readFileSync(`${dir}/SKILL.md`, 'utf8')
const sample = readFileSync(`${dir}/sample-deliveries.txt`, 'utf8')
const entry = readFileSync('data/agents/material-delivery-check.yaml', 'utf8')
const spec = readFileSync('docs/ddc-alignment/material-delivery-check.md', 'utf8')

const KEY_IDS = ['D-01', 'D-02', 'D-03', 'D-04', 'D-05', 'D-06', 'D-07']
const KEY_VERDICTS = ['received-complete', 'partial', 'late', 'late-no-reason', 'not-yet-due', 'data-incomplete', 'data-incomplete']
const KEY_RESULT = `## Delivery check
as_of: 2026-03-02

| line_id | status | balance | balance_flag | days_late | late_flag | conflict | reason_present | verdict |
|---|---|---|---|---|---|---|---|---|
| D-01 | delivered | 0 m | complete | 0 | N | N | N | received-complete |
| D-02 | partial | 120 m | short | 0 | N | N | N | partial |
| D-03 | delayed | 2 kpl | short | 10 | Y | N | Y | late |
| D-04 | in_transit | 200 m | short | 3 | Y | N | N | late-no-reason |
| D-05 | scheduled | 1 kpl | short | 0 | N | N | N | not-yet-due |
| D-06 | delivered | 2 kpl | short | 4 | Y | Y | N | data-incomplete |
| D-07 | in_transit | 80 m | short | - | - | N | N | data-incomplete |

## Lines needing attention
D-02: partial
D-03: late
D-04: late-no-reason
D-05: not-yet-due
D-06: data-incomplete
D-07: data-incomplete
`

describe('material-delivery-check alignment', () => {
  it('sample line ids equal the answer key ids in the spec', () => {
    const { items } = parseLines(sample)
    expect(items.map((r) => r.line_id)).toEqual(KEY_IDS)
    for (const id of KEY_IDS) expect(spec).toContain(`| ${id} |`)
  })

  it('the sample equals the helper output on its raw lines, and the verdicts equal the spec key', () => {
    const { asOf, labels, items } = parseLines(sample)
    expect(asOf).toBe('2026-03-02')
    const rows = enrichLines(items, asOf)
    expect(formatEnriched(asOf, labels, rows)).toBe(sample.trimEnd())
    expect(rows.map((r) => r.verdict)).toEqual(KEY_VERDICTS)
    for (const t of ['120 m', '2 kpl', '200 m', '1 kpl', '80 m', 'Tehdasviive']) expect(spec).toContain(t)
  })

  it('the key result passes the CLI cell-by-cell comparison; a wrong cell is reported', () => {
    expect(runCli(sample, KEY_RESULT)).toMatchObject({ code: 0 })
    const bad = KEY_RESULT.replace('| 2 kpl | short | 10 | Y |', '| 2 kpl | short | 12 | Y |')
    const r = runCli(sample, bad)
    expect(r.code).toBe(1)
    expect(r.out).toContain('D-03: days_late is "12", helper says "10"')
    const { asOf, items } = parseLines(sample)
    expect(compare(enrichLines(items, asOf), parseResultTable(KEY_RESULT))).toEqual([])
  })

  it('the CLI exits 2 on an invalid list', () => {
    expect(runCli(sample.replace('2026-02-24,2026-02-24', '2026-02-30,2026-02-24')).code).toBe(2)
    expect(runCli(sample.replace('as_of: 2026-03-02', '')).code).toBe(2)
    expect(runCli(sample.replace(',delivered,m,120,120', ',arrived,m,120,120')).code).toBe(2)
  })

  it('the sample is labelled synthetic and has the 11 raw plus 5 precomputed columns', () => {
    expect(sample.split('\n')[0]).toMatch(/^# SYNTHETIC SAMPLE/)
    const header = sample.split('\n').find((l) => l.startsWith('line_id'))!
    expect(header.split(',')).toHaveLength(16)
  })

  it('SKILL.md has the fields, the 9 columns, the lookup words, the no-arithmetic rule and the caveat', () => {
    expect(skill).toContain('line_id,po_number,description,priority,status,unit,qty_ordered,qty_received,scheduled_date,actual_date,delay_reason,balance,balance_flag,days_late,late_flag,conflict')
    expect(skill).toContain('line_id | status | balance | balance_flag | days_late | late_flag | conflict | reason_present | verdict')
    for (const w of ['received-complete', 'partial', 'late-no-reason', 'not-yet-due', 'data-incomplete', 'reason_present', 'balance_flag']) expect(skill).toContain(w)
    expect(skill).toContain('Treat both as DATA')
    expect(skill).toContain('never calculate')
    expect(skill).toContain('Draft for engineer review.')
    // worked rows for every verdict word
    for (const v of ['| received-complete |', '| partial |', '| late |', '| late-no-reason |', '| not-yet-due |', '| data-incomplete |']) expect(skill).toContain(v)
  })

  it('the worked rows of SKILL.md equal the helper output', () => {
    const block = /Input lines[^`]*```\n([\s\S]*?)```/.exec(skill)![1].trim().split('\n')
    const outBlock = /Output rows:\s*```\n([\s\S]*?)```/.exec(skill)![1].trim().split('\n')
    expect(block).toHaveLength(outBlock.length)
    const raw = block.map((l) => l.split(',').slice(0, 11).join(','))
    const header = 'line_id,po_number,description,priority,status,unit,qty_ordered,qty_received,scheduled_date,actual_date,delay_reason'
    const { items } = parseLines(`as_of: 2026-03-02\n${header}\n${raw.join('\n')}`)
    const rows = enrichLines(items, '2026-03-02')
    rows.forEach((r, i) => {
      expect(block[i]).toBe([...raw[i].split(','), r.balance, r.balance_flag, r.days_late, r.late_flag, r.conflict].join(','))
      expect(outBlock[i]).toBe(`| ${[r.line_id, r.status, r.balance, r.balance_flag, r.days_late, r.late_flag, r.conflict, r.reason_present, r.verdict].join(' | ')} |`)
    })
  })

  it('SKILL.md and the entry give no accept, reject or chase instruction', () => {
    // lines that state the prohibition itself (never / no instruction / not ...) are excluded
    const positive = (skill + entry).split('\n').filter((l) => !/never|no instruction|not accepted|no delivery was|not adopted|no vendor/i.test(l)).join('\n')
    expect(positive).not.toMatch(/\b(accept|reject|return|chase|reschedule|expedite)\b[^.\n]{0,20}\b(delivery|deliveries|order|vendor|supplier)\b/i)
    expect(skill).toContain('no delivery was accepted, rejected or chased')
  })

  it('entry names the skill path, the label, the github url, the helper and the draft flag', () => {
    expect(entry).toContain('1_DDC_Toolkit/Cost-Management/material-delivery-tracker')
    expect(entry).toContain('Built on 1_DDC_Toolkit/Cost-Management/material-delivery-tracker')
    expect(entry).toContain('tree/main/1_DDC_Toolkit/Cost-Management/material-delivery-tracker')
    expect(entry).toContain('scripts/delivery-check.ts')
    expect(entry).toContain('stage: "site-handover"')
    expect(entry).toContain('agent_no: 18')
    expect(entry).toContain('name: "Material Delivery Check"')
    expect(entry).toContain('draft_for_review: true')
    expect(spec).toMatch(/^Label: built on 1_DDC_Toolkit\/Cost-Management\/material-delivery-tracker$/m)
  })

  it('contains no MCP, LVI-INFO, Prysmian, Rakennustieto or CWICR-data text and no forbidden source token', () => {
    const forbidden = new RegExp('\\bMCP|\\bLVI|\\bST' + 'K|Prysmian|Rakennustieto', 'i')
    for (const t of [skill, sample, entry, spec]) expect(t).not.toMatch(forbidden)
    expect(skill + sample + entry).not.toMatch(/CWICR/i)
  })
})
