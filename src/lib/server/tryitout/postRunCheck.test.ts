import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { unzipSync } from 'fflate'
import {
  EBOM_CHECK_FILE,
  EBOM_XLSX_FILE,
  HELPER_CHECKS,
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
  it('ifc-ebom-compiler and the six helper agents have a check; other slugs and prototype names get nothing', () => {
    expect([...POST_RUN_CHECKS.keys()]).toEqual([
      SLUG,
      'warranty-register-check',
      'procurement-lead-time-check',
      'material-delivery-check',
      'bms-digital-twin',
      'carbon-epd-enrichment',
      'qto-normalization',
    ])
    for (const slug of ['demo-rfi-triage', 'clash-prioritization', 'constructor', '__proto__']) {
      expect(runPostRunCheck(slug, { task: 't', upload: SAMPLE, files: { 'result.md': enc(SLIP) } })).toEqual({ files: [], events: [], check: null })
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
    expect(r.status).toBe('match')
  })

  it('a readable result also gives ebom.xlsx: E-BOM lines joined by the tool, class rows, review items, the check', () => {
    const r = ebomJoinCheck({ task: 't', upload: SAMPLE, files: { 'result.md': enc(KEY) } })
    expect(r.attachments?.map((a) => a.name)).toEqual([EBOM_XLSX_FILE])
    const parts = unzipSync(r.attachments![0].bytes)
    const wb = dec(parts['xl/workbook.xml'])
    for (const n of ['E-BOM', 'Class rows', 'Review items', 'Check']) expect(wb).toContain(`name="${n}"`)
    const eb = dec(parts['xl/worksheets/sheet1.xml'])
    expect(eb).toContain('Staircase B apartments') // block title from the upload
    expect(eb).toContain('SYN Round duct 250')
    expect(eb).toContain('<v>3</v>') // E-01: 3.00 m billed on whole 3 m sticks
    expect(dec(parts['xl/worksheets/sheet2.xml'])).not.toContain('differs')
  })

  it('the reported E-12 slip is named in the summary and the findings', () => {
    const r = ebomJoinCheck({ task: 't', upload: SAMPLE_E12, files: { 'result.md': enc(SLIP) } })
    expect(r.summary).toBe(`helper check: 1 mismatch with the ebom-join helper (details in ${EBOM_CHECK_FILE})`)
    expect(r.findings).toEqual(['E-12: rule is "no-catalogue", helper says "multi-catalogue"'])
    expect(r.text).toContain('MISMATCHES WITH THE HELPER (1)')
    expect(r.status).toBe('differences')
    const sheet2 = dec(unzipSync(r.attachments![0].bytes)['xl/worksheets/sheet2.xml'])
    expect(sheet2).toContain('differs')
  })

  it('a result with a contract problem gets no spreadsheet (no lines can be joined)', () => {
    const broken = KEY.replace('| E-03 | IfcDuctFitting | bill | K1 | SYN Bend 100 | kpl | 1 | count |', '| E-03 | IfcDuctFitting | bill | K1 | SYN Bend 999 | kpl | 1 | count |')
    const r = ebomJoinCheck({ task: 't', upload: SAMPLE, files: { 'result.md': enc(broken) } })
    expect(r.status).toBe('differences')
    expect(r.attachments).toEqual([])
  })

  it('without an upload the task text is the input', () => {
    const r = ebomJoinCheck({ task: SAMPLE, upload: null, files: { 'result.md': enc(KEY) } })
    expect(r.findings).toEqual([])
    expect(r.text).toContain('Input: the task text (no file was uploaded).')
  })

  it('no table in the output, or an unreadable input, is reported, not thrown', () => {
    const none = ebomJoinCheck({ task: 't', upload: SAMPLE, files: { 'result.md': enc('sorry') } })
    expect(none.summary).toBe('helper check: no E-BOM class rows table in the output, nothing checked')
    expect(none.status).toBe('not-checked')
    const bad = ebomJoinCheck({ task: 'not an upload', upload: null, files: { 'result.md': enc(KEY) } })
    expect(bad.summary).toMatch(/^helper check: could not read the input or result \(bad-row: text before the first section: "not an upload"\)$/)
    expect(bad.findings).toEqual([])
    expect(bad.status).toBe('not-checked')
  })
})

describe('the six helper checks', () => {
  const sampleOf = (slug: string) => {
    const dir = join(process.cwd(), 'data/tryitout-prompts', slug)
    const yaml = readFileSync(join(dir, 'example.yaml'), 'utf8')
    const file = /^file:\s*(\S+)/m.exec(yaml)![1]
    return { input: readFileSync(join(dir, file), 'utf8'), key: readFileSync(join(dir, 'example-result.md'), 'utf8') }
  }

  it.each(HELPER_CHECKS.map(([slug, spec]) => [slug, spec.helper, spec.section]))(
    '%s: the saved key matches %s; one changed cell is a mismatch; no table is not checked',
    (slug, helper, section) => {
      const { input, key } = sampleOf(slug)
      const ok = runPostRunCheck(slug, { task: 't', upload: input, files: { 'result.md': enc(key) } })
      expect(ok.check).toEqual({ status: 'match', summary: `the ${section} table matches the ${helper} helper on every cell`, file: `${helper}-check.md` })
      expect(ok.files.map((f) => f.name)).toEqual([`${helper}-check.md`])
      expect(dec(ok.files[0].bytes)).toContain(`# ${helper} check`)

      // Change the first data cell after the id in the section's table.
      const lines = key.split('\n')
      const start = lines.findIndex((l) => l.trim().toLowerCase() === `## ${section}`.toLowerCase())
      const header = lines.findIndex((l, i) => i > start && l.startsWith('|'))
      const row = header + 2 // header, separator, first data row
      const cells = lines[row].split('|')
      cells[2] = ` ${cells[2].trim() === 'X' ? 'Y' : 'X'}ZZ `
      lines[row] = cells.join('|')
      const bad = runPostRunCheck(slug, { task: 't', upload: input, files: { 'result.md': enc(lines.join('\n')) } })
      expect(bad.check?.status).toBe('differences')
      expect(bad.check?.summary).toMatch(new RegExp(`^\\d+ mismatch(es)? with the ${helper} helper`))
      expect(bad.events.length).toBeGreaterThan(1)

      const none = runPostRunCheck(slug, { task: 't', upload: input, files: { 'result.md': enc('no table') } })
      expect(none.check?.status).toBe('not-checked')
    },
  )

  it('an unreadable input is not checked, and says why', () => {
    const r = runPostRunCheck('warranty-register-check', { task: 'hello', upload: null, files: { 'result.md': enc(sampleOf('warranty-register-check').key) } })
    expect(r.check?.status).toBe('not-checked')
    expect(r.check?.summary).toMatch(/^could not read the input or result/)
  })
})

describe('runPostRunCheck', () => {
  const many: PostRunCheck = () => ({
    file: 'c.md',
    text: 'report',
    summary: 'helper check: sum',
    status: 'differences',
    findings: Array.from({ length: MAX_FEED_FINDINGS + 3 }, (_, i) => `f${i}`),
    attachments: [{ name: 'c.xlsx', bytes: enc('sheet') }],
  })
  const checks = new Map([['x', many]])

  it('the report and attachments become extra files; the feed gets the summary and the first findings', () => {
    const r = runPostRunCheck('x', { task: 't', upload: null, files: { 'result.md': enc('r') } }, checks)
    expect(r.files.map((f) => f.name)).toEqual(['c.md', 'c.xlsx'])
    expect(dec(r.files[0].bytes)).toBe('report')
    expect(r.events).toEqual(['helper check: sum', ...Array.from({ length: MAX_FEED_FINDINGS }, (_, i) => `  f${i}`), '  … and 3 more in c.md'])
    expect(r.check).toEqual({ status: 'differences', summary: 'sum', file: 'c.md' })
  })

  it('never replaces an agent file, and never pushes the artifact over its file cap', () => {
    const taken = runPostRunCheck('x', { task: 't', upload: null, files: { 'c.md': enc('agent') } }, checks)
    expect(taken.files.map((f) => f.name)).toEqual(['c.xlsx'])
    expect(taken.events).toContain('helper check report not added to the download: the output already has a file named c.md')
    expect(taken.check?.file).toBeNull() // the badge never points at the agent's own c.md
    const full = Object.fromEntries(Array.from({ length: MAX_ARTIFACT_FILES }, (_, i) => [`f${i}.txt`, enc('x')]))
    const capped = runPostRunCheck('x', { task: 't', upload: null, files: full }, checks)
    expect(capped.files).toEqual([])
    expect(capped.events.at(-2)).toBe(`helper check report not added to the download: the output already has ${MAX_ARTIFACT_FILES} files`)
    expect(capped.events.at(-1)).toBe(`helper check file c.xlsx not added to the download: the output already has ${MAX_ARTIFACT_FILES} files`)
  })

  it('a check that throws gives one feed line, no file and a not-checked status', () => {
    const boom: PostRunCheck = () => {
      throw new Error('bug')
    }
    expect(runPostRunCheck('x', { task: 't', upload: null, files: {} }, new Map([['x', boom]]))).toEqual({
      files: [],
      events: ['helper check failed to run; the result is unchecked'],
      check: { status: 'not-checked', summary: 'the check failed to run; the result is unchecked', file: null },
    })
  })
})
