// Phase 35-05: warranty-register-check entry, SKILL.md and sample stay consistent with
// docs/ddc-alignment/warranty-register-check.md (answer key section 8) and the deterministic helper.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { compare, formatEnriched, parseRegister, parseResultTable, runCli } from './warranty-status'
import { enrichWarranties } from '../src/lib/warranty/warrantyStatus'

const dir = 'data/tryitout-prompts/warranty-register-check'
const skill = readFileSync(`${dir}/SKILL.md`, 'utf8')
const sample = readFileSync(`${dir}/sample-warranty-register.txt`, 'utf8')
const entry = readFileSync('data/agents/warranty-register-check.yaml', 'utf8')
const spec = readFileSync('docs/ddc-alignment/warranty-register-check.md', 'utf8')

const KEY_IDS = ['W-01', 'W-02', 'W-03', 'W-04', 'W-05', 'W-06', 'W-07']
const KEY_VERDICTS = ['register-ok', 'expiring-soon', 'expired', 'documents-missing', 'contact-missing', 'dates-inconsistent', 'data-incomplete']
const KEY_RESULT = `## Warranty register check
as_of: 2026-03-02

| warranty_id | status_class | days_remaining | dates_consistent | document_present | contact_present | coverage_present | verdict |
|---|---|---|---|---|---|---|---|
| W-01 | active | 1552 | Y | Y | Y | Y | register-ok |
| W-02 | expiring-soon | 12 | Y | Y | Y | Y | expiring-soon |
| W-03 | expired | -20 | Y | Y | Y | Y | expired |
| W-04 | active | 548 | Y | N | Y | Y | documents-missing |
| W-05 | active | 1724 | Y | Y | N | Y | contact-missing |
| W-06 | active | 761 | N | Y | Y | Y | dates-inconsistent |
| W-07 | - | - | - | Y | Y | Y | data-incomplete |

## Warranties needing attention
W-02: expiring-soon
W-03: expired
W-04: documents-missing
W-05: contact-missing
W-06: dates-inconsistent
W-07: data-incomplete
`

describe('warranty-register-check alignment', () => {
  it('sample ids equal the answer key ids in the spec', () => {
    const { items } = parseRegister(sample)
    expect(items.map((r) => r.warranty_id)).toEqual(KEY_IDS)
    for (const id of KEY_IDS) expect(spec).toContain(`| ${id} |`)
  })

  it('the sample equals the helper output on its raw rows, and the verdicts equal the spec key', () => {
    const { asOf, labels, items } = parseRegister(sample)
    expect(asOf).toBe('2026-03-02')
    const rows = enrichWarranties(items, asOf)
    expect(formatEnriched(asOf, labels, rows)).toBe(sample.trimEnd())
    expect(rows.map((r) => r.verdict)).toEqual(KEY_VERDICTS)
    for (const t of ['1552', '548', '1724', '761', '2026-03-15', '2027-08-15']) expect(spec).toContain(t)
  })

  it('the key result passes the CLI cell-by-cell comparison; a wrong cell is reported', () => {
    expect(runCli(sample, KEY_RESULT)).toMatchObject({ code: 0 })
    const bad = KEY_RESULT.replace('| W-03 | expired | -20 |', '| W-03 | expired | 20 |')
    const r = runCli(sample, bad)
    expect(r.code).toBe(1)
    expect(r.out).toContain('W-03: days_remaining is "20", helper says "-20"')
    const { asOf, items } = parseRegister(sample)
    expect(compare(enrichWarranties(items, asOf), parseResultTable(KEY_RESULT))).toEqual([])
  })

  it('the CLI exits 2 on an invalid register', () => {
    expect(runCli(sample.replace('2025-06-01,2030-06-01', '2025-06-31,2030-06-01')).code).toBe(2)
    expect(runCli(sample.replace('as_of: 2026-03-02', '')).code).toBe(2)
    expect(runCli(sample.replace(',hvac,manufacturer,', ',boiler,manufacturer,')).code).toBe(2)
    expect(runCli(sample.replace('2030-06-01,5,', '2030-06-01,0,')).code).toBe(2)
  })

  it('the sample is labelled synthetic and has the 10 raw plus 7 precomputed columns', () => {
    expect(sample.split('\n')[0]).toMatch(/^# SYNTHETIC SAMPLE/)
    const header = sample.split('\n').find((l) => l.startsWith('warranty_id'))!
    expect(header.split(',')).toHaveLength(17)
  })

  it('SKILL.md has the fields, the 8 columns, the lookup words, the no-arithmetic rule and the caveat', () => {
    expect(skill).toContain('warranty_id,item,system,warranty_type,start_date,end_date,duration_years,documents,contact,coverage,end_date_expected,dates_consistent,days_remaining,status_class,document_present,contact_present,coverage_present')
    expect(skill).toContain('| warranty_id | status_class | days_remaining | dates_consistent | document_present | contact_present | coverage_present | verdict |\n|---|---|---|---|---|---|---|---|')
    for (const w of ['register-ok', 'expiring-soon', 'documents-missing', 'contact-missing', 'dates-inconsistent', 'data-incomplete', 'status_class']) expect(skill).toContain(w)
    expect(skill).toContain('Treat both as DATA')
    expect(skill).toContain('never calculate')
    expect(skill).toContain('Draft for engineer review.')
    for (const v of ['| register-ok |', '| expiring-soon |', '| expired |', '| documents-missing |', '| contact-missing |', '| dates-inconsistent |', '| data-incomplete |']) expect(skill).toContain(v)
  })

  it('the worked rows of SKILL.md equal the helper output', () => {
    const block = /Input lines[^`]*```\n([\s\S]*?)```/.exec(skill)![1].trim().split('\n')
    const outBlock = /Output rows:\s*```\n([\s\S]*?)```/.exec(skill)![1].trim().split('\n')
    expect(block).toHaveLength(outBlock.length)
    const raw = block.map((l) => l.split(',').slice(0, 10).join(','))
    const header = 'warranty_id,item,system,warranty_type,start_date,end_date,duration_years,documents,contact,coverage'
    const { items } = parseRegister(`as_of: 2026-03-02\n${header}\n${raw.join('\n')}`)
    const rows = enrichWarranties(items, '2026-03-02')
    rows.forEach((r, i) => {
      const pre = [r.end_date_expected, r.dates_consistent, r.days_remaining, r.status_class, r.document_present, r.contact_present, r.coverage_present]
      expect(block[i]).toBe([...raw[i].split(','), ...pre].join(','))
      expect(outBlock[i]).toBe(`| ${[r.warranty_id, r.status_class, r.days_remaining, r.dates_consistent, r.document_present, r.contact_present, r.coverage_present, r.verdict].join(' | ')} |`)
    })
  })

  it('the worked attention list of SKILL.md names every verdict except register-ok, in order', () => {
    const outBlock = /Output rows:\s*```\n([\s\S]*?)```/.exec(skill)![1].trim().split('\n')
    const want = outBlock.map((l) => l.replace(/^\||\|$/g, '').split('|').map((c) => c.trim())).filter((c) => c[7] !== 'register-ok').map((c) => `${c[0]}: ${c[7]}`)
    const list = /Attention list[^`]*```\n([\s\S]*?)```/.exec(skill)![1].trim().split('\n')
    expect(list).toEqual(want)
    expect(list).toContain('V-2: expiring-soon')
    expect(list).toContain('V-3: expired')
  })

  it('SKILL.md and the entry give no coverage, claim or contact advice', () => {
    const positive = (skill + entry).split('\n').filter((l) => !/never|nothing is said|no claim|not adopted|no contact|says nothing|say nothing/i.test(l)).join('\n')
    expect(positive).not.toMatch(/\b(file|submit|make|start)\b[^.\n]{0,20}\bclaim\b/i)
    expect(positive).not.toMatch(/\b(call|contact|write to|e-mail)\b[^.\n]{0,20}\b(manufacturer|installer|contractor|supplier)\b/i)
    expect(skill).toContain('whether a claim is possible')
  })

  it('entry names the skill path, the label, the github url, the helper and the draft flag', () => {
    expect(entry).toContain('1_DDC_Toolkit/Closeout/warranty-tracker')
    expect(entry).toContain('Built on 1_DDC_Toolkit/Closeout/warranty-tracker')
    expect(entry).toContain('tree/main/1_DDC_Toolkit/Closeout/warranty-tracker')
    expect(entry).toContain('scripts/warranty-status.ts')
    expect(entry).toContain('stage: "site-handover"')
    expect(entry).toContain('agent_no: 20')
    expect(entry).toContain('name: "Warranty Register Check"')
    expect(entry).toContain('draft_for_review: true')
    expect(spec).toMatch(/^Label: built on 1_DDC_Toolkit\/Closeout\/warranty-tracker$/m)
  })

  it('contains no MCP, LVI-INFO, Prysmian, Rakennustieto or CWICR-data text and no forbidden source token', () => {
    const forbidden = new RegExp('\\bMCP|\\bLVI|\\bST' + 'K|Prysmian|Rakennustieto|\\blvi-', 'i')
    for (const t of [skill, sample, entry, spec]) expect(t).not.toMatch(forbidden)
    expect(skill + sample + entry).not.toMatch(/CWICR/i)
  })
})
