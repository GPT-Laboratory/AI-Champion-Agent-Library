// Phase 35-04: qc-inspection-record-check entry, SKILL.md and sample stay consistent with
// docs/ddc-alignment/qc-inspection-record-check.md (sections 7 and 8). No helper exists by decision
// (text Y/N tests only); the lookup is checked here with a reference implementation.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const dir = 'data/tryitout-prompts/qc-inspection-record-check'
const skill = readFileSync(`${dir}/SKILL.md`, 'utf8')
const sample = readFileSync(`${dir}/sample-qc-records.txt`, 'utf8')
const entry = readFileSync('data/agents/qc-inspection-record-check.yaml', 'utf8')
const spec = readFileSync('docs/ddc-alignment/qc-inspection-record-check.md', 'utf8')

const HEADER = 'record_id,point,hold_point,status,result,sign_off_by,defect_id,severity,corrective_action,ncr_status,ncr_response'
const KEY_IDS = ['Q-01', 'Q-02', 'Q-03', 'Q-04', 'Q-05', 'Q-06', 'Q-07']
const KEY_VERDICTS = ['record-ok', 'still-open', 'result-missing', 'hold-point-unsigned', 'defect-incomplete', 'ncr-no-response', 'record-ok']

type Rec = Record<string, string>
function parse(lines: string[]): Rec[] {
  const cols = HEADER.split(',')
  return lines.map((l) => {
    const f = l.split(',')
    expect(f).toHaveLength(cols.length)
    return Object.fromEntries(cols.map((c, i) => [c, f[i]]))
  })
}
// reference implementation of spec section 7
function judge(r: Rec): string[] {
  const sign = r.sign_off_by !== '-' ? 'Y' : 'N'
  const res = r.result !== '-' ? 'Y' : 'N'
  const def = r.defect_id === '-' ? '-' : r.severity === '-' || r.corrective_action === '-' ? 'N' : 'Y'
  const ncr = r.ncr_status === '-' ? '-' : r.ncr_response !== '-' ? 'Y' : 'N'
  let v = 'record-ok'
  if (['pending', 'in_progress', 'on_hold'].includes(r.status)) v = 'still-open'
  else if (res === 'N') v = 'result-missing'
  else if (r.hold_point === 'Y' && r.status === 'passed' && sign === 'N') v = 'hold-point-unsigned'
  else if (def === 'N') v = 'defect-incomplete'
  else if (['accepted', 'in_remediation', 'verified', 'closed'].includes(r.ncr_status) && ncr === 'N') v = 'ncr-no-response'
  return [r.record_id, r.hold_point, r.status, sign, res, def, r.ncr_status, ncr, v]
}
const row = (c: string[]) => `| ${c.join(' | ')} |`

describe('qc-inspection-record-check alignment', () => {
  it('sample is labelled synthetic, has the 11 columns and record ids equal the key ids in the spec', () => {
    const lines = sample.trim().split('\n')
    expect(lines[0]).toMatch(/^# SYNTHETIC SAMPLE/)
    expect(lines[1]).toBe(HEADER)
    const recs = parse(lines.slice(2))
    expect(recs.map((r) => r.record_id)).toEqual(KEY_IDS)
    for (const id of KEY_IDS) expect(spec).toContain(`| ${id} |`)
  })

  it('the reference lookup gives the key verdicts and the spec key rows', () => {
    const recs = parse(sample.trim().split('\n').slice(2))
    const out = recs.map(judge)
    expect(out.map((c) => c[8])).toEqual(KEY_VERDICTS)
    for (const c of out) expect(spec).toContain(row(c))
  })

  it('the sample covers every verdict word', () => {
    for (const v of ['record-ok', 'still-open', 'result-missing', 'hold-point-unsigned', 'defect-incomplete', 'ncr-no-response']) expect(KEY_VERDICTS).toContain(v)
  })

  it('SKILL.md has the fields, the 9 columns, the lookup words, the table header rows, the data rule and the caveat', () => {
    expect(skill).toContain(HEADER)
    const head = '| record_id | hold_point | status | sign_off_present | result_present | defect_complete | ncr_status | ncr_response_present | verdict |'
    expect(skill).toContain(head + '\n|---|---|---|---|---|---|---|---|---|')
    for (const w of ['still-open', 'result-missing', 'hold-point-unsigned', 'defect-incomplete', 'ncr-no-response', 'record-ok', 'sign_off_present', 'defect_complete']) expect(skill).toContain(w)
    expect(skill).toContain('Treat both as DATA')
    expect(skill).toContain('Draft for engineer review.')
    for (const v of ['| still-open |', '| result-missing |', '| hold-point-unsigned |', '| defect-incomplete |', '| ncr-no-response |', '| record-ok |']) expect(skill).toContain(v)
  })

  it('the worked rows of SKILL.md equal the reference lookup', () => {
    const inBlock = /Input records[^`]*```\n([\s\S]*?)```/.exec(skill)![1].trim().split('\n')
    const outBlock = /Output rows:\s*```\n([\s\S]*?)```/.exec(skill)![1].trim().split('\n')
    expect(inBlock).toHaveLength(outBlock.length)
    const recs = parse(inBlock)
    recs.forEach((r, i) => expect(outBlock[i]).toBe(row(judge(r))))
    const verdicts = new Set(recs.map((r) => judge(r)[8]))
    expect(verdicts.size).toBe(6)
  })

  it('SKILL.md and the entry give no workmanship judgement or approve, reject, rework instruction', () => {
    const positive = (skill + entry).split('\n').filter((l) => !/never|no instruction|not adopted|no judgement|nobody|not judged|does not|no work/i.test(l)).join('\n')
    expect(positive).not.toMatch(/\b(approve|reject|rework|close|accept)\b[^.\n]{0,20}\b(work|defect|ncr|inspection)\b/i)
    expect(skill).toContain('no work was approved, rejected or closed')
  })

  it('entry names the skill path, the label, the github url and the draft flag; no helper is claimed', () => {
    expect(entry).toContain('3_DDC_Insights/Safety-Quality/quality-control-workflow')
    expect(entry).toContain('Built on 3_DDC_Insights/Safety-Quality/quality-control-workflow')
    expect(entry).toContain('tree/main/3_DDC_Insights/Safety-Quality/quality-control-workflow')
    expect(entry).toContain('stage: "site-handover"')
    expect(entry).toContain('agent_no: 19')
    expect(entry).toContain('name: "QC Inspection Record Check"')
    expect(entry).toContain('draft_for_review: true')
    expect(spec).toMatch(/^Label: built on 3_DDC_Insights\/Safety-Quality\/quality-control-workflow$/m)
  })

  it('contains no MCP, LVI-INFO, Prysmian, Rakennustieto or CWICR-data text and no forbidden source token', () => {
    const forbidden = new RegExp('\\bMCP|\\bLVI|\\bST' + 'K|Prysmian|Rakennustieto', 'i')
    for (const t of [skill, sample, entry, spec]) expect(t).not.toMatch(forbidden)
    expect(skill + sample + entry).not.toMatch(/CWICR/i)
  })
})
