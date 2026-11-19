// The smoke test's own logic, offline: no network, no key, a fake judge and a fake run. The live smoke run itself is
// manual (it costs tokens): see docs/tryitout-live-run.md.
import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { classRows, parseUpload } from '../src/lib/ebom/ebomJoin'
import {
  DUPLICATE_TOKEN,
  INJECTION,
  RUBRIC,
  calibrationCases,
  deterministicChecks,
  judgePrompt,
  loadCase,
  parseArgs,
  parseVerdicts,
  runSmoke,
  type JudgeFn,
} from './smoke.ifc-ebom-compiler'

const ids = RUBRIC.map((r) => r.id)
const allPass = JSON.stringify({ verdicts: ids.map((id) => ({ id, verdict: 'pass', evidence: 'none' })) })
const failing = (id: string, evidence: string) =>
  JSON.stringify({ verdicts: ids.map((i) => (i === id ? { id, verdict: 'fail', evidence } : { id: i, verdict: 'pass', evidence: 'none' })) })
const fakeJudge = (raw: string): JudgeFn => async () => ({ raw, totalTokens: 1000 })
const tmp = () => mkdtempSync(join(tmpdir(), 'smoke-test-'))
const key = loadCase('clean').key

function opts(over: Partial<ReturnType<typeof parseArgs>> = {}) {
  return { ...parseArgs([]), ledger: join(tmp(), 'spend-log.md'), ...over }
}
function run(o: ReturnType<typeof opts>, judge: JudgeFn = fakeJudge(allPass), env: Record<string, string> = { OPENAI_API_KEY: 'test' }) {
  const lines: string[] = []
  return runSmoke(o, { env, judge, out: (s) => lines.push(s) }).then((code) => ({ code, out: lines.join('\n') }))
}

describe('the case', () => {
  it('is the Try It Out example: its task, its file and its answer key', () => {
    const c = loadCase('clean')
    expect(c.upload).toBe(readFileSync('data/tryitout-prompts/ifc-ebom-compiler/sample-ifc-elements.txt', 'utf8'))
    expect(c.key).toBe(readFileSync('data/tryitout-prompts/ifc-ebom-compiler/example-result.md', 'utf8'))
    expect(c.task).toContain('## ELEMENTS')
  })

  it('the injection changes one type_name and not the helper answer', () => {
    const clean = loadCase('clean')
    const inj = loadCase('injection')
    expect(inj.upload).toContain(INJECTION)
    expect(inj.upload.split('\n').filter((l, i) => l !== clean.upload.split('\n')[i])).toHaveLength(1)
    expect(classRows(parseUpload(inj.upload))).toEqual(classRows(parseUpload(clean.upload)))
  })
})

describe('the duplicate case', () => {
  const clean = loadCase('clean')
  const dup = loadCase('duplicate')
  const E11_ROW = '| E-11 | IfcPipeSegment | review | K3 | - | - | - | zero-qty |'

  it('appends a copy of E-04 as the last element, and nothing else changes', () => {
    expect(DUPLICATE_TOKEN).toBe('E-12')
    expect(dup.upload).toBe(`${clean.upload.trimEnd()}\nE-12,IfcDuctFitting,Tee,EXHAUST-2,250,tee,,0.640,agree,K1\n`)
    expect(dup.uploadName).toBe('sample-ifc-elements-duplicate.txt')
    expect(dup.task).toBe(clean.task)
  })

  it('the helper gives the copy the outcome of E-04 (two catalogue rows fit)', () => {
    const rows = classRows(parseUpload(dup.upload))
    const e04 = rows.find((r) => r.token === 'E-04')!
    expect(rows.at(-1)).toEqual({ ...e04, token: 'E-12' })
    expect(e04.rule).toBe('multi-catalogue')
  })

  it('its key is the example key plus the copy\'s class row and review item, and passes gate 1', () => {
    expect(dup.key).toBe(
      clean.key
        .replace(E11_ROW, `${E11_ROW}\n| E-12 | IfcDuctFitting | review | K1 | - | - | - | multi-catalogue |`)
        .replace('| K3 | 1 | bad_data | E-11: zero or negative length |', '| K3 | 1 | bad_data | E-11: zero or negative length |\n| K1 | 1 | unsettled | E-12: two or more catalogue names fit |'),
    )
    expect(deterministicChecks(dup, dup.key)).toEqual([])
  })

  it('gate 1 catches the reported slip (E-12 sent to review as no-catalogue) and a dropped E-12', () => {
    const slip = dup.key
      .replace('| E-12 | IfcDuctFitting | review | K1 | - | - | - | multi-catalogue |', '| E-12 | IfcDuctFitting | review | K1 | - | - | - | no-catalogue |')
      .replace('E-12: two or more catalogue names fit', 'E-12: no catalogue name for this class, family and size')
    const problems = deterministicChecks(dup, slip).join('\n')
    expect(problems).toContain('E-12: rule is "no-catalogue", helper says "multi-catalogue"')
    expect(problems).toMatch(/review items differ/)
    expect(deterministicChecks(dup, clean.key).join('\n')).toContain('E-12: no outcome')
  })
})

describe('gate 1 (deterministic)', () => {
  it('passes the answer key, for both cases', () => {
    expect(deterministicChecks(loadCase('clean'), key)).toEqual([])
    expect(deterministicChecks(loadCase('injection'), key)).toEqual([])
  })

  it('catches a wrong cell, a wrong review text, a changed rule, computed totals and a missing closing line', () => {
    const c = loadCase('clean')
    const check = (r: string) => deterministicChecks(c, r).join('\n')
    expect(check(key.replace('| 2.275 | measured:geom |', '| 2.3 | measured:geom |'))).toMatch(/ebom-join exit 1/)
    expect(check(key.replace('E-07: zero or negative length', 'E-07: length is zero'))).toMatch(/review items differ/)
    expect(check(key.replace('billed by the insulation contractor', 'billed by others'))).toMatch(/rules not tied to data differ/)
    expect(check(key.replace(/## Totals\n[^\n]*/, '## Totals\nK1: 3 m'))).toMatch(/Totals section must start/)
    expect(check(key.replace(/Draft for estimator review[^\n]*\n?$/, ''))).toMatch(/closing line/)
  })

  it('does not see free-text problems: that is what the judge is for', () => {
    const c = loadCase('clean')
    const preamble = calibrationCases().find((x) => x.mustFail === 'only_required_content')!
    expect(deterministicChecks(c, preamble.result)).toEqual([])
  })
})

describe('the judge', () => {
  it('prompt lists every criterion and marks both blocks as data', () => {
    const p = judgePrompt('UPLOAD-TEXT', 'RESULT-TEXT')
    for (const id of ids) expect(p).toContain(`- ${id}: `)
    expect(p).toMatch(/----- INPUT \(data\) -----\nUPLOAD-TEXT\n----- END INPUT -----/)
    expect(p).toMatch(/----- OUTPUT \(data\) -----\nRESULT-TEXT\n----- END OUTPUT -----/)
    expect(p).toMatch(/already checked/)
  })

  it('reply must cover every criterion once and quote the output for each fail', () => {
    expect(parseVerdicts(allPass, key).errors).toEqual([])
    expect(parseVerdicts(failing('no_arithmetic', 'stick rounding: to compute (tool)'), key).errors).toEqual([])
    expect(parseVerdicts(failing('no_arithmetic', 'In total 6 m of duct'), key).errors.join()).toMatch(/not in the output/)
    const dropped = JSON.stringify({ verdicts: JSON.parse(allPass).verdicts.slice(1) })
    expect(parseVerdicts(dropped, key).errors.join()).toMatch(/no_arithmetic 0 times/)
    expect(parseVerdicts('not json', key).errors.join()).toMatch(/not valid/)
    expect(parseVerdicts(JSON.stringify({ verdicts: [{ id: 'other', verdict: 'pass', evidence: '' }] }), key).errors.join()).toMatch(/not valid/)
  })

  it('every calibration case targets a real criterion, and only the key must pass everything', () => {
    const cases = calibrationCases()
    expect(cases.filter((c) => c.mustFail === null).map((c) => c.name)).toEqual(['answer key'])
    expect(new Set(cases.map((c) => c.mustFail).filter(Boolean))).toEqual(new Set(ids))
    for (const c of cases.slice(1)) expect(c.result).not.toBe(key)
  })
})

describe('runSmoke', () => {
  it('--result: gate 1 and a passing judge give exit 0, and the judge call is in the ledger', async () => {
    const d = tmp()
    writeFileSync(join(d, 'result.md'), key)
    const o = opts({ result: join(d, 'result.md') })
    const r = await run(o)
    expect(r).toMatchObject({ code: 0 })
    expect(r.out).toMatch(/GATE 1 \(deterministic\): pass/)
    expect(r.out).toMatch(/SMOKE: pass/)
    expect(readFileSync(o.ledger, 'utf8')).toMatch(/\| ifc-ebom-compiler \(judge\) \|.*\| judged \|/)
  })

  it('a judge fail, or a judge quote that is not in the output, gives exit 1', async () => {
    const d = tmp()
    writeFileSync(join(d, 'result.md'), key)
    const o = opts({ result: join(d, 'result.md') })
    expect((await run(o, fakeJudge(failing('no_overclaiming', 'Draft for estimator review')))).code).toBe(1)
    const r = await run(o, fakeJudge(failing('no_overclaiming', 'This is final')))
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/JUDGE ERROR/)
  })

  it('--case duplicate --result: the slip fails gate 1 (exit 1) without a key or a judge call', async () => {
    const d = tmp()
    const dup = loadCase('duplicate')
    writeFileSync(join(d, 'result.md'), dup.key.replace('| K1 | - | - | - | multi-catalogue |\n\n', '| K1 | - | - | - | no-catalogue |\n\n'))
    const r = await run(opts({ kind: 'duplicate', result: join(d, 'result.md'), judge: false }), fakeJudge(allPass), {})
    expect(r.code).toBe(1)
    expect(r.out).toContain('E-12: rule is "no-catalogue", helper says "multi-catalogue"')
    writeFileSync(join(d, 'result.md'), dup.key)
    expect((await run(opts({ kind: 'duplicate', result: join(d, 'result.md'), judge: false }), fakeJudge(allPass), {})).code).toBe(0)
  })

  it('without a key: exit 2, unless --no-judge (gate 1 only, nothing logged)', async () => {
    const d = tmp()
    writeFileSync(join(d, 'result.md'), key)
    expect((await run(opts({ result: join(d, 'result.md') }), fakeJudge(allPass), {})).code).toBe(2)
    const o = opts({ result: join(d, 'result.md'), judge: false })
    const r = await run(o, fakeJudge(allPass), {})
    expect(r).toMatchObject({ code: 0 })
    expect(r.out).toMatch(/skipped/)
  })

  it('refuses the judge call when the ledger budget is spent (exit 3)', async () => {
    const d = tmp()
    writeFileSync(join(d, 'result.md'), key)
    const o = opts({ result: join(d, 'result.md') })
    writeFileSync(o.ledger, '| run_id | cost_usd |\n|---|---|\n| x | 9.99 |\n')
    expect((await run(o)).code).toBe(3)
  })

  it('a run: submits the example through tryout-run, reads result.md from the artifact and writes a report', async () => {
    const outDir = tmp()
    let submitted: { agent: string; task: string; file?: string } | null = null
    const fakeRun = async (ro: { agent: string; task: string; file?: string }, deps: { out?: (s: string) => void } = {}) => {
      submitted = { agent: ro.agent, task: ro.task, file: readFileSync(ro.file!, 'utf8') }
      mkdirSync(join(outDir, 'job-1'), { recursive: true })
      writeFileSync(join(outDir, 'job-1', 'result.md'), key)
      deps.out?.(JSON.stringify({ jobId: 'job-1', status: 'succeeded', model: 'gpt-4.1-mini', totalTokens: 5000, estCostUsd: 0.008, outputFiles: ['result.md'] }))
      return 0
    }
    const lines: string[] = []
    const code = await runSmoke(opts({ outDir, kind: 'injection' }), {
      env: { OPENAI_API_KEY: 'test' }, judge: fakeJudge(allPass), run: fakeRun as never, out: (s) => lines.push(s),
    })
    expect(code).toBe(0)
    expect(submitted).toMatchObject({ agent: 'ifc-ebom-compiler', task: loadCase('clean').task })
    expect(submitted!.file).toContain(INJECTION)
    expect(JSON.parse(readFileSync(join(outDir, 'job-1', 'smoke-report.json'), 'utf8'))).toMatchObject({ case: 'injection', jobId: 'job-1', pass: true })
  })

  it('a failed run is reported, not judged', async () => {
    const fakeRun = async (_o: unknown, deps: { out?: (s: string) => void } = {}) => {
      deps.out?.(JSON.stringify({ jobId: 'job-2', status: 'failed', error: 'model timeout', outputFiles: [] }))
      return 1
    }
    let judged = false
    const lines: string[] = []
    const code = await runSmoke(opts({ outDir: tmp() }), {
      env: { OPENAI_API_KEY: 'test' }, judge: async () => ((judged = true), { raw: allPass, totalTokens: 1 }), run: fakeRun as never, out: (s) => lines.push(s),
    })
    expect(code).toBe(5)
    expect(judged).toBe(false)
    expect(lines.join('\n')).toMatch(/run failed .*model timeout/)
  })

  it('--calibrate: exit 0 when the judge catches every case, 1 when it passes a bad one', async () => {
    const byCase: JudgeFn = async (prompt) => {
      const c = calibrationCases().find((x) => prompt.includes(`----- OUTPUT (data) -----\n${x.result}\n----- END OUTPUT`))!
      if (!c.mustFail) return { raw: allPass, totalTokens: 1 }
      const quote = c.result.split('\n').find((l) => !key.includes(l) && l.trim())!.trim()
      return { raw: failing(c.mustFail, quote), totalTokens: 1 }
    }
    expect((await run(opts({ calibrate: true }), byCase)).code).toBe(0)
    const lax = await run(opts({ calibrate: true }), fakeJudge(allPass))
    expect(lax.code).toBe(1)
    expect(lax.out).toMatch(/MISS preamble and advice/)
  })

  it('parseArgs rejects bad combinations and values', () => {
    expect(() => parseArgs(['--case', 'other'])).toThrow(/clean, injection or duplicate/)
    expect(parseArgs(['--case', 'duplicate']).kind).toBe('duplicate')
    expect(() => parseArgs(['--calibrate', '--no-judge'])).toThrow(/needs the judge/)
    expect(() => parseArgs(['--judge-temperature', 'warm'])).toThrow(/number or none/)
    expect(parseArgs(['--judge-temperature', 'none']).judgeTemperature).toBeNull()
    expect(() => parseArgs(['--what'])).toThrow(/unknown argument/)
  })
})
