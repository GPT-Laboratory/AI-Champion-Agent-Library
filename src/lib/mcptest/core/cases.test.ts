import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadCaseDir, parseCaseYaml, parseGoldenJsonl, parseRubricYaml } from './cases'

const CASE = `
id: T2-ACME-API
tier: 2
title: Acme catalog API
source: synthetic
auth: header
transport: stdio
provides_modalities: [spec, docs]
pass_thresholds:
  d2_pct: 85
scoring_notes: none
foo: ignored
x-upstream:
  dataset: acme
x-env:
  ACME_URL: base
x-binding: {}
x-identity:
  id: [item_id]
x-applies-to: [S]
x-strict: true
x-ceiling: 200
`

describe('parseCaseYaml', () => {
  it('parses source keys, ignores unknown, captures x- keys', () => {
    const r = parseCaseYaml(CASE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.id).toBe('T2-ACME-API')
    expect(r.value.tier).toBe(2)
    expect(r.value.provides_modalities).toEqual(['spec', 'docs'])
    expect(r.value.pass_thresholds).toEqual({ d2_pct: 85 })
    expect((r.value as Record<string, unknown>).foo).toBeUndefined()
    expect(Object.keys(r.value.x).sort()).toEqual(
      ['x-applies-to', 'x-binding', 'x-ceiling', 'x-env', 'x-identity', 'x-strict', 'x-upstream'].sort()
    )
    expect(r.value.x['x-ceiling']).toBe(200)
  })
  it.each([0, 5])('rejects tier %i', (t) => {
    expect(parseCaseYaml(`id: T9-ACME-API\ntier: ${t}\n`).ok).toBe(false)
  })
  it('rejects bad ids', () => {
    expect(parseCaseYaml('id: lower-case\ntier: 1\n').ok).toBe(false)
    expect(parseCaseYaml('id: AB\ntier: 1\n').ok).toBe(false)
  })
  it('reports yaml syntax errors with a line, without throwing', () => {
    const r = parseCaseYaml('id: T1-ACME-ONE\ntier: [1\n  bad: : :\n')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0].line).toBeGreaterThanOrEqual(1)
  })
  it('rejects oversize and non-mapping input', () => {
    expect(parseCaseYaml('a'.repeat(1024 * 1024 + 1)).ok).toBe(false)
    expect(parseCaseYaml('- a\n- b\n').ok).toBe(false)
  })
})

const GOLDEN = `# comment line

{"id":"c1","type":"tool_exists","tool_hint":"get|lookup","dimension":"D1"}

{"id":"c2","type":"call","tool":"get_by_id","args":{"id":"A1"},"expect":{"field_value":{"name":"Widget"},"field_present":"price","fields_present":["a","b"],"no_error":true},"dimension":"D2","extra":1}
{"id":"c3","type":"call","tool_hint":"get","args":{"id":"nope"},"expect":{"clean_not_found":true,"max_items":5,"max_fields":12,"no_leak":true,"status_category":"4xx","empty_with_message":false},"inject":{"fault":"status","status":429,"times":2},"repeat":3,"check_kind":"bad_input"}
{"id":"c4","type":"auth","tool_hint":"get"}
`

describe('parseGoldenJsonl', () => {
  it('skips blanks and comments and accepts all types and additive fields', () => {
    const r = parseGoldenJsonl(GOLDEN)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.map((c) => c.id)).toEqual(['c1', 'c2', 'c3', 'c4'])
    expect(r.value[1].expect).toEqual({
      field_value: { name: 'Widget' },
      field_present: 'price',
      fields_present: ['a', 'b'],
      no_error: true
    })
    expect(r.value[2].expect?.clean_not_found).toBe(true)
    expect(r.value[2].expect?.max_items).toBe(5)
    expect(r.value[2].expect?.max_fields).toBe(12)
    expect(r.value[2].expect?.no_leak).toBe(true)
    expect(r.value[2].expect?.status_category).toBe('4xx')
    expect(r.value[2].expect?.empty_with_message).toBe(false)
    expect(r.value[2].repeat).toBe(3)
    expect(r.value[2].check_kind).toBe('bad_input')
    expect(r.value[2].inject).toEqual({ fault: 'status', status: 429, times: 2 })
    expect((r.value[1] as Record<string, unknown>).extra).toBeUndefined()
  })
  it('names the line for invalid JSON', () => {
    const r = parseGoldenJsonl('# c\n\n{"id":"a","type":"call"}\n{not json}\n')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.map((e) => e.line)).toEqual([4])
  })
  it('names the line for an unknown type', () => {
    const r = parseGoldenJsonl('{"id":"a","type":"bogus"}\n')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0].line).toBe(1)
  })
  it('rejects duplicate check ids', () => {
    const r = parseGoldenJsonl('{"id":"a","type":"call"}\n{"id":"a","type":"auth"}\n')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0].line).toBe(2)
  })
  it('rejects oversize input', () => {
    expect(parseGoldenJsonl('#' + 'a'.repeat(1024 * 1024 + 1)).ok).toBe(false)
  })
})

describe('parseRubricYaml', () => {
  it('parses D3 and D5 and renames checklist_per_arm', () => {
    const r = parseRubricYaml(`
D3:
  scale: 0-3
  criteria:
    - names follow contract
    - id: params
D5:
  - typed
  - tested
checklist_per_arm:
  - item one
`)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.D3?.criteria).toHaveLength(2)
    expect(r.value.D5?.criteria).toEqual(['typed', 'tested'])
    expect(r.value.checklist_per_subject).toEqual(['item one'])
  })
  it('accepts checklist_per_subject directly', () => {
    const r = parseRubricYaml('checklist_per_subject: [a]\n')
    expect(r.ok && r.value.checklist_per_subject).toEqual(['a'])
  })
  it('never throws on garbage', () => {
    expect(parseRubricYaml('::: [').ok).toBe(false)
  })
})

describe('loadCaseDir', () => {
  it('loads the three fixed files from a temp dir', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mcptest-cases-'))
    try {
      await writeFile(join(dir, 'case.yaml'), CASE)
      await writeFile(join(dir, 'golden.jsonl'), GOLDEN)
      await writeFile(join(dir, 'rubric.yaml'), 'D3:\n  criteria: [a]\n')
      const r = await loadCaseDir(dir)
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.value.golden).toHaveLength(4)
        expect(r.value.rubric?.D3?.criteria).toEqual(['a'])
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
  it('allows missing golden and rubric but not missing case.yaml', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mcptest-cases-'))
    try {
      const none = await loadCaseDir(dir)
      expect(none.ok).toBe(false)
      await writeFile(join(dir, 'case.yaml'), CASE)
      const some = await loadCaseDir(dir)
      expect(some.ok).toBe(true)
      if (some.ok) expect(some.value.golden).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
  it('does not throw for a nonexistent directory', async () => {
    const r = await loadCaseDir(join(tmpdir(), 'mcptest-does-not-exist-xyz'))
    expect(r.ok).toBe(false)
  })
})
