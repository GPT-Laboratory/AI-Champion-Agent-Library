import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  EBOM_CHECK_FILE,
  MAX_FEED_FINDINGS,
  POST_RUN_CHECKS,
  ebomJoinCheck,
  findEbomResult,
  runPostRunCheck,
  type PostRunCheck,
} from './postRunCheck'
import { MAX_ARTIFACT_FILES } from './artifact'

const DIR = join(process.cwd(), 'data/tryitout-prompts/ifc-ebom-compiler')
const SAMPLE = readFileSync(join(DIR, 'sample-ifc-elements.txt'), 'utf8')
const KEY = readFileSync(join(DIR, 'example-result.md'), 'utf8')
const SAMPLE_E12 = `${SAMPLE.trimEnd()}\nE-12,IfcDuctFitting,Tee,EXHAUST-2,250,tee,,0.640,agree,K1\n`
const E11_ROW = '| E-11 | IfcPipeSegment | review | K3 | - | - | - | zero-qty |'
const SLIP = KEY.replace(E11_ROW, `${E11_ROW}\n| E-12 | IfcDuctFitting | review | K1 | - | - | - | no-catalogue |`)

const enc = (s: string) => new TextEncoder().encode(s)
const dec = (b: Uint8Array) => new TextDecoder().decode(b)
const SLUG = 'ifc-ebom-compiler'

describe('registry', () => {
  it('only ifc-ebom-compiler has a check; other slugs and prototype names get nothing', () => {
    expect([...POST_RUN_CHECKS.keys()]).toEqual([SLUG])
    for (const slug of ['demo-rfi-triage', 'clash-prioritization', 'constructor', '__proto__']) {
      expect(runPostRunCheck(slug, { task: 't', upload: SAMPLE, files: { 'result.md': enc(SLIP) } })).toEqual({ file: null, events: [] })
    }
  })
})

describe('findEbomResult', () => {
  it('prefers result.md, else any .md or .txt with the table, else null', () => {
    expect(findEbomResult({ 'a.md': enc(KEY), 'result.md': enc(KEY) })).toBe('result.md')
    expect(findEbomResult({ 'notes.md': enc('# notes'), 'result.txt': enc(KEY) })).toBe('result.txt')
    expect(findEbomResult({ 'result.md': enc('prose only'), 'out/draft.md': enc(KEY) })).toBe('out/draft.md')
    expect(findEbomResult({ 'result.md': enc('prose'), 'table.csv': enc(KEY) })).toBeNull()
  })
})

describe('ebomJoinCheck', () => {
  it('clean result: one summary line, no findings, the report names the file checked', () => {
    const r = ebomJoinCheck({ task: 't', upload: SAMPLE, files: { 'result.md': enc(KEY) } })
    expect(r.summary).toBe('helper check: the class rows match the ebom-join helper on every cell')
    expect(r.findings).toEqual([])
    expect(r.file).toBe(EBOM_CHECK_FILE)
    expect(r.text).toContain('Result checked: result.md.')
    expect(r.text).toContain('Input: the uploaded file.')
    expect(r.text).toContain('result table matches the helper on every cell')
  })

  it('the reported E-12 slip is named in the summary and the findings', () => {
    const r = ebomJoinCheck({ task: 't', upload: SAMPLE_E12, files: { 'result.md': enc(SLIP) } })
    expect(r.summary).toBe(`helper check: 1 mismatch with the ebom-join helper (details in ${EBOM_CHECK_FILE})`)
    expect(r.findings).toEqual(['E-12: rule is "no-catalogue", helper says "multi-catalogue"'])
    expect(r.text).toContain('MISMATCHES WITH THE HELPER (1)')
  })

  it('without an upload the task text is the input', () => {
    const r = ebomJoinCheck({ task: SAMPLE, upload: null, files: { 'result.md': enc(KEY) } })
    expect(r.findings).toEqual([])
    expect(r.text).toContain('Input: the task text (no file was uploaded).')
  })

  it('no table in the output, or an unreadable input, is reported, not thrown', () => {
    expect(ebomJoinCheck({ task: 't', upload: SAMPLE, files: { 'result.md': enc('sorry') } }).summary).toBe(
      'helper check: no E-BOM class rows table in the output, nothing checked',
    )
    const bad = ebomJoinCheck({ task: 'not an upload', upload: null, files: { 'result.md': enc(KEY) } })
    expect(bad.summary).toMatch(/^helper check: could not read the input or result \(bad-row: text before the first section: "not an upload"\)$/)
    expect(bad.findings).toEqual([])
  })
})

describe('runPostRunCheck', () => {
  const many: PostRunCheck = () => ({
    file: 'c.md',
    text: 'report',
    summary: 'sum',
    findings: Array.from({ length: MAX_FEED_FINDINGS + 3 }, (_, i) => `f${i}`),
  })
  const checks = new Map([['x', many]])

  it('the report becomes one extra file; the feed gets the summary and the first findings', () => {
    const r = runPostRunCheck('x', { task: 't', upload: null, files: { 'result.md': enc('r') } }, checks)
    expect(r.file?.name).toBe('c.md')
    expect(dec(r.file!.bytes)).toBe('report')
    expect(r.events).toEqual(['sum', ...Array.from({ length: MAX_FEED_FINDINGS }, (_, i) => `  f${i}`), '  … and 3 more in c.md'])
  })

  it('never replaces an agent file, and never pushes the artifact over its file cap', () => {
    const taken = runPostRunCheck('x', { task: 't', upload: null, files: { 'c.md': enc('agent') } }, checks)
    expect(taken.file).toBeNull()
    expect(taken.events.at(-1)).toBe('helper check report not added to the download: the output already has a file named c.md')
    const full = Object.fromEntries(Array.from({ length: MAX_ARTIFACT_FILES }, (_, i) => [`f${i}.txt`, enc('x')]))
    const capped = runPostRunCheck('x', { task: 't', upload: null, files: full }, checks)
    expect(capped.file).toBeNull()
    expect(capped.events.at(-1)).toBe(`helper check report not added to the download: the output already has ${MAX_ARTIFACT_FILES} files`)
  })

  it('a check that throws gives one feed line and no file', () => {
    const boom: PostRunCheck = () => {
      throw new Error('bug')
    }
    expect(runPostRunCheck('x', { task: 't', upload: null, files: {} }, new Map([['x', boom]]))).toEqual({
      file: null,
      events: ['helper check failed to run; the result is unchecked'],
    })
  })
})
