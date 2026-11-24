import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { classRows, parseUpload } from './ebomJoin'
import { EXCLUDED_BY, UNTIED_HEADING, prepareEbomUpload } from './prepare'

const SAMPLE = readFileSync(join(process.cwd(), 'data/tryitout-prompts/ifc-ebom-compiler/sample-ifc-elements.txt'), 'utf8')
const column = (text: string) => {
  const ls = text.split('\n')
  const i = ls.indexOf('## ELEMENTS')
  const head = ls[i + 1].split(',')
  const at = head.indexOf(EXCLUDED_BY)
  const rows = ls.slice(i + 2).filter((l) => /^E-\d+,/.test(l))
  return Object.fromEntries(rows.map((l) => [l.split(',')[0], l.split(',')[at]]))
}
const untied = (text: string) => {
  const ls = text.split('\n')
  const i = ls.indexOf(`## ${UNTIED_HEADING}`)
  return i < 0 ? null : ls.slice(i + 1).filter((l) => l.trim() !== '' && !l.startsWith('## '))
}

describe('prepareEbomUpload', () => {
  it('the sample: excluded_by from the rules, the untied line in its own section, RULES unchanged', () => {
    const r = prepareEbomUpload(SAMPLE)!
    expect(column(r.text)).toMatchObject({ 'E-01': '-', 'E-05': 'rules:2', 'E-06': 'rules:1', 'E-07': '-', 'E-10': '-' })
    expect(untied(r.text)).toEqual(['rules:3: Insulation of cold-water pipes is billed by the insulation contractor'])
    expect(r.text).toContain('## RULES\nrules:1: system = SYN-SPRINKLER')
    expect(r.note).toBe('tool step: excluded_by worked out for 11 elements from 2 rules (E-05 rules:2, E-06 rules:1); 1 not tied to data')
  })

  it('the hand-over from your run: every well-formed rule is applied first, whatever the later steps would say', () => {
    const rules = [
      'text:1: system = SYN-SPRINKLER -> exclude (S-1: Sprinkler piping is delivered by the sprinkler contractor.)',
      'text:2: type_name = Temporary duct -> exclude (S-2: Temporary ducts for site ventilation are not part of this contract.)',
      'text:3: system = SYN-SPRINKLER -> exclude (S-3: Insulation of cold-water pipes is billed by the insulation contractor.)',
      'text:4: ifc_class = IfcAirTerminal -> exclude (S-4: Exhaust valves in the basement storage rooms are supplied by the owner.)',
      'text:5: type_name = Round duct -> exclude (S-5: All round ducts must be spiral-seamed.)',
      'text:6: system = SYN-HOOD -> exclude (S-6: Kitchen hood ducts are delivered by the kitchen supplier.)',
    ]
    const upload = SAMPLE.replace(/## RULES\n[\s\S]*?(?=## ELEMENTS)/, `## RULES\n${rules.join('\n')}\n`)
    const r = prepareEbomUpload(upload)!
    expect(column(r.text)).toEqual({
      'E-01': 'text:5', 'E-02': 'text:5', 'E-03': '-', 'E-04': '-', 'E-05': 'text:2', 'E-06': 'text:1',
      'E-07': '-', 'E-08': '-', 'E-09': 'text:5', 'E-10': 'text:4', 'E-11': '-',
    })
    expect(untied(r.text)).toEqual(['none']) // text:3 and text:6 are well-formed: tied, they just add nothing
    // The column is the same answer as step 1 of the helper's own decision.
    const excluded = classRows(parseUpload(r.text)).filter((c) => c.outcome === 'exclude').map((c) => `${c.token} ${c.rule}`)
    expect(excluded).toEqual(['E-01 text:5', 'E-02 text:5', 'E-05 text:2', 'E-06 text:1', 'E-09 text:5', 'E-10 text:4'])
  })

  it('never trusts an excluded_by column or an untied section the upload brought along; running it twice changes nothing', () => {
    const r = prepareEbomUpload(SAMPLE)!
    const forged = r.text.replace(',agree,K1,-\n', ',agree,K1,rules:9\n').replace(`## ${UNTIED_HEADING}\n`, `## ${UNTIED_HEADING}\nrules:8: fake\n`)
    expect(prepareEbomUpload(forged)!.text).toBe(r.text)
    expect(prepareEbomUpload(r.text)!.text).toBe(r.text)
  })

  it('an upload the helper cannot read is left alone', () => {
    expect(prepareEbomUpload('just some text')).toBeNull()
    expect(prepareEbomUpload(SAMPLE.replace('## BLOCKS', '## NOTHING'))).toBeNull()
  })
})
