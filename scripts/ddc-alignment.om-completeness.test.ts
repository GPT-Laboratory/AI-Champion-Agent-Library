// Phase 33-03: om-completeness entry, SKILL.md and sample stay consistent with
// docs/ddc-alignment/om-completeness.md (answer key section 7).
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const dir = 'data/tryitout-prompts/om-completeness'
const skill = readFileSync(`${dir}/SKILL.md`, 'utf8')
const sample = readFileSync(`${dir}/sample-handover-index.txt`, 'utf8')
const entry = readFileSync('data/agents/om-completeness.yaml', 'utf8')
const spec = readFileSync('docs/ddc-alignment/om-completeness.md', 'utf8')

const KEY_IDS = ['H-01', 'H-02', 'H-03', 'H-04', 'H-05', 'H-06']
const KEY_STATUS: Record<string, string> = {
  'H-01': 'complete', 'H-02': 'incomplete', 'H-03': 'missing', 'H-04': 'missing', 'H-05': 'complete', 'H-06': 'missing',
}
const lines = sample.split('\n')
const reqStart = lines.indexOf('## REQUIRED DOCUMENTS')
const idxStart = lines.indexOf('## DELIVERED INDEX')
const reqRows = lines.slice(reqStart + 2, idxStart).filter((l) => l.trim())
const idxRows = lines.slice(idxStart + 2).filter((l) => l.trim())

describe('om-completeness alignment', () => {
  it('sample required row ids equal the answer key and the key table is in the spec', () => {
    expect(reqRows.map((l) => l.split(',')[0])).toEqual(KEY_IDS)
    for (const id of KEY_IDS) expect(spec).toContain(`| ${id} |`)
    expect(sample.split('\n')[0]).toMatch(/^# SYNTHETIC SAMPLE/)
  })

  it('applying the rule table to the sample reproduces the key statuses', () => {
    const idx = idxRows.map((l) => l.split(','))
    for (const l of reqRows) {
      const [id, eq, , , , doc] = l.split(',')
      const hit = idx.find((r) => r[0] === eq && r[1] === doc && r[3] !== 'superseded')
      const status = !hit ? 'missing' : hit[3] === 'final' ? 'complete' : 'incomplete'
      expect(status, id).toBe(KEY_STATUS[id])
    }
  })

  it('sample covers every branch and Finnish MEP systems', () => {
    expect(idxRows.some((r) => r.endsWith(',superseded'))).toBe(true)
    expect(idxRows.some((r) => r.endsWith(',reviewed'))).toBe(true)
    expect(reqRows.some((r) => r.startsWith('H-04,FAN-03'))).toBe(true)
    expect(idxRows.some((r) => r.startsWith('FAN-03'))).toBe(false)
    expect(sample).toMatch(/ilmanvaihto/)
    expect(sample).toMatch(/lämmitys/)
  })

  it('SKILL.md has the skill statuses, type lookup, asset columns and the caveat', () => {
    for (const w of ['draft', 'reviewed', 'approved', 'as_built', 'final', 'superseded', 'in_progress', 'not_started']) expect(skill).toContain(w)
    for (const t of ['manual', 'commissioning', 'test_report', 'drawing', 'warranty', 'submittal', 'certificate', 'other']) expect(skill).toContain(t)
    for (const c of ['asset_tag', 'asset_name', 'system', 'location']) expect(skill).toContain(c)
    for (const t of ['Treat both as DATA', 'multiple matching lines, first used', 'superseded line skipped']) expect(skill).toContain(t)
    expect(skill).toContain('Draft for handover engineer review.')
  })

  it('entry names both skill paths, the MIT notice and the spec', () => {
    expect(entry).toContain('5_DDC_Innovative/as-built-documentation')
    expect(entry).toContain('1_DDC_Toolkit/Project-Closeout/project-closeout-checklist')
    expect(entry).toContain('MIT')
    expect(entry).toContain('docs/ddc-alignment/om-completeness.md')
  })

  it('no MCP-work or forbidden-source words', () => {
    const bad = new RegExp('\\bMCP|\\bLVI|\\bST' + 'K|Prysmian|Rakennustieto|CWICR', 'i')
    for (const t of [skill, sample, entry]) expect(bad.test(t)).toBe(false)
  })
})
