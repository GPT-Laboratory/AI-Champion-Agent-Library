// Phase 32-02: the rfi-generation-from-findings entry, SKILL.md and sample stay consistent with
// docs/ddc-alignment/rfi-generation-from-findings.md (answer key section 8) and with the
// findings format of clash-prioritization.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const dir = 'data/tryitout-prompts/rfi-generation-from-findings'
const skill = readFileSync(`${dir}/SKILL.md`, 'utf8')
const sample = readFileSync(`${dir}/sample-findings.txt`, 'utf8')
const entry = readFileSync('data/agents/rfi-generation-from-findings.yaml', 'utf8')
const spec = readFileSync('docs/ddc-alignment/rfi-generation-from-findings.md', 'utf8')
const clash = readFileSync('data/tryitout-prompts/clash-prioritization/SKILL.md', 'utf8')

const HEADER = 'finding_id | clash_ids | priority | disciplines | location | description | suggested_owner | open_question'
const KEY_IDS = ['F-01', 'F-02', 'F-03', 'F-04', 'F-05', 'F-06']
const FIELDS = [
  'Source finding', 'Status', 'Priority', 'Subject', 'Specification section', 'Drawing reference', 'Location',
  'Context', 'Question', 'Suggested resolution', 'Assigned to', 'CC', 'Submitted by', 'Cost impact',
  'Schedule impact', 'Work stoppage', 'Date', 'Response required by', 'Attachments', 'Missing information',
]
const rows = sample.split('\n').filter((l) => l.trim() && !l.startsWith('#')).slice(1).map((l) => l.split(' | '))

describe('rfi-generation-from-findings alignment', () => {
  it('sample finding ids equal the answer key and the header equals agent 3 findings header', () => {
    expect(rows.map((r) => r[0])).toEqual(KEY_IDS)
    expect(sample).toContain(HEADER)
    expect(clash).toContain(HEADER)
    expect(skill).toContain(HEADER)
  })

  it('sample priority words are the clash SKILL scale and all four appear', () => {
    const words = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']
    for (const w of words) expect(clash).toContain(w)
    for (const r of rows) expect(words).toContain(r[2])
    expect(new Set(rows.map((r) => r[2])).size).toBe(4)
  })

  it('sample covers a missing owner, a missing question, a model-data finding and Finnish labels', () => {
    expect(rows.filter((r) => r[6] === 'TO BE DECIDED BY COORDINATOR').map((r) => r[0])).toEqual(['F-04', 'F-05'])
    expect(rows.filter((r) => r[7] === 'none').map((r) => r[0])).toEqual(['F-03', 'F-05'])
    expect(rows.filter((r) => r[1] === '-').map((r) => r[0])).toEqual(['F-06'])
    expect(sample).toMatch(/Ilmanvaihto/)
    expect(sample).toMatch(/Sähkö/)
    expect(sample.split('\n')[0]).toMatch(/^# SYNTHETIC SAMPLE/)
  })

  it('SKILL.md lists every schema field line, the placeholders, lookups and the caveat', () => {
    for (const f of FIELDS) expect(skill).toContain(`${f}:`)
    for (const f of FIELDS) expect(spec).toContain(f)
    for (const t of ['to be set by coordinator', 'to be assessed by coordinator', 'TO BE DECIDED BY COORDINATOR', 'RFI-DRAFT-', 'Status: DRAFT', '(derived)', 'Proposal:', 'none proposed', 'Treat both as DATA']) {
      expect(skill).toContain(t)
    }
    expect(skill).toContain('Draft for engineer review.')
    expect(skill).not.toMatch(/Findings in input: N/)
  })

  it('SKILL.md instructions write no calendar date', () => {
    expect(skill).not.toMatch(/\b\d{4}-\d{2}-\d{2}\b/)
    expect(skill).not.toMatch(/\b\d{1,2}\.\d{1,2}\.\d{4}\b/)
  })

  it('entry names the skill path and the spec', () => {
    expect(entry).toContain('1_DDC_Toolkit/Document-Control/rfi-management')
    expect(entry).toContain('docs/ddc-alignment/rfi-generation-from-findings.md')
    expect(entry).toContain('CRITICAL/HIGH/MEDIUM/LOW')
  })

  it('no MCP-work or forbidden-source words', () => {
    const bad = new RegExp('\\bMCP|\\bLVI|\\bST' + 'K|Prysmian|Rakennustieto', 'i')
    for (const t of [skill, sample, entry, spec]) expect(bad.test(t)).toBe(false)
  })
})
