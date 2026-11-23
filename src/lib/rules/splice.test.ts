import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseUpload } from '$lib/ebom/ebomJoin'
import { rulesBlockOf, spliceRules } from './splice'

const DIR = join(process.cwd(), 'data/tryitout-prompts/scope-rule-drafter')
const SAMPLE = readFileSync(join(DIR, 'sample-scope-rules.txt'), 'utf8')
const KEY = readFileSync(join(DIR, 'example-result.md'), 'utf8')
const LINES = rulesBlockOf(KEY)
const section = (t: string, name: string) => {
  const ls = t.split('\n')
  const i = ls.indexOf(`## ${name}`)
  if (i < 0) return null
  const end = ls.findIndex((l, j) => j > i && l.startsWith('## '))
  return ls.slice(i + 1, end < 0 ? undefined : end).filter((l) => l.trim() !== '')
}

describe('rulesBlockOf', () => {
  it('the rule lines of a result; "none", fences and table rows are not rules', () => {
    expect(LINES).toEqual([
      'text:1: system = SYN-SPRINKLER -> exclude (S-1: Sprinkler piping is delivered by the sprinkler contractor.)',
      'text:2: type_name = Temporary duct -> exclude (S-2: Temporary ducts for site ventilation are not part of this contract.)',
    ])
    expect(rulesBlockOf('## RULES\nnone\n## X\na')).toEqual([])
    expect(rulesBlockOf('## RULES\n```\nr:1: a = b -> exclude (c)\n```')).toEqual(['r:1: a = b -> exclude (c)'])
    expect(rulesBlockOf('no rules section')).toEqual([])
  })
})

describe('spliceRules', () => {
  it('no RULES in the upload: a RULES section before ELEMENTS; RULE TEXT removed; the compiler reads it', () => {
    const out = spliceRules(SAMPLE, LINES)
    expect(section(out, 'RULE TEXT')).toBeNull()
    expect(section(out, 'RULES')).toEqual(LINES)
    expect(out.indexOf('## RULES')).toBeLessThan(out.indexOf('## ELEMENTS'))
    expect(out.startsWith('# SYNTHETIC SAMPLE')).toBe(true)
    const u = parseUpload(out)
    expect(u.rules.map((r) => [r.id, r.field, r.value])).toEqual([
      ['text:1', 'system', 'SYN-SPRINKLER'],
      ['text:2', 'type_name', 'Temporary duct'],
    ])
    expect(u.untiedRules).toEqual([])
  })

  it('add keeps the upload\'s own rules and replaces an earlier hand-over\'s text: rules; replace drops them all', () => {
    const own = SAMPLE.replace('## ELEMENTS', '## RULES\nrules:1: system = EXHAUST-2 -> exclude (own)\ntext:1: system = OLD -> exclude (earlier hand-over)\n## ELEMENTS')
    expect(section(spliceRules(own, LINES, 'add'), 'RULES')).toEqual(['rules:1: system = EXHAUST-2 -> exclude (own)', ...LINES])
    expect(section(spliceRules(own, LINES, 'replace'), 'RULES')).toEqual(LINES)
  })

  it('RULES as the last section, and an upload without ELEMENTS', () => {
    expect(section(spliceRules('## ELEMENTS\na\n## RULES\nrules:1: x = y -> exclude (z)', ['text:1: x = q -> exclude (S-1: s)']), 'RULES')).toEqual([
      'rules:1: x = y -> exclude (z)',
      'text:1: x = q -> exclude (S-1: s)',
    ])
    expect(spliceRules('## RULE TEXT\nS-1: s', ['text:1: a = b -> exclude (S-1: s)'])).toBe('## RULES\ntext:1: a = b -> exclude (S-1: s)')
  })
})
