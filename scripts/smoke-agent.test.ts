// The smoke profiles and the generic CLI, offline: no network, no key, a fake judge. The live smoke runs themselves are
// manual (they cost tokens): see docs/tryitout-live-run.md, section 6.
import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { main, parseAgentArgs } from './smoke-agent'
import { headings, judgePrompt, lastLine, parseSmokeArgs, runSmoke, section, type JudgeFn, type SmokeProfile } from './smoke/core'
import { PROFILES } from './smoke/profiles'

const NEW = [...PROFILES.values()].filter((p) => p.slug !== 'ifc-ebom-compiler')
const tmp = () => mkdtempSync(join(tmpdir(), 'smoke-agent-test-'))
const verdicts = (p: SmokeProfile, fail?: { id: string; evidence: string }) =>
  JSON.stringify({
    verdicts: p.rubric.map((r) => (fail && r.id === fail.id ? { id: r.id, verdict: 'fail', evidence: fail.evidence } : { id: r.id, verdict: 'pass', evidence: 'none' })),
  })
const opts = (p: SmokeProfile, over: Record<string, unknown> = {}) => ({ ...parseSmokeArgs([], p.caseKinds), ledger: join(tmp(), 'spend-log.md'), ...over })
async function run(p: SmokeProfile, o: ReturnType<typeof opts>, judge: JudgeFn, env: Record<string, string> = { OPENAI_API_KEY: 'test' }) {
  const lines: string[] = []
  const code = await runSmoke(p, o, { env, judge, out: (s) => lines.push(s) })
  return { code, out: lines.join('\n') }
}

describe('the registry', () => {
  it('has ifc-ebom-compiler and the six table agents, each with a saved result in its example', () => {
    expect([...PROFILES.keys()].sort()).toEqual([
      'bms-digital-twin', 'carbon-epd-enrichment', 'ifc-ebom-compiler', 'material-delivery-check',
      'procurement-lead-time-check', 'qto-normalization', 'warranty-register-check',
    ])
    for (const p of PROFILES.values()) {
      const ex = parseYaml(readFileSync(join(p.dir, 'example.yaml'), 'utf8')) as { result?: string; result_label?: string }
      expect(ex.result, p.slug).toBe('example-result.md')
      expect(ex.result_label, p.slug).toMatch(/Not a model run\.$/)
    }
  })
})

describe.each(NEW.map((p) => [p.slug, p] as const))('%s', (_slug, p) => {
  const clean = p.loadCase('clean')
  const inj = p.loadCase('injection')

  it('the answer key passes gate 1 and ends with the closing line of the skill', () => {
    expect(p.deterministicChecks(clean, clean.key)).toEqual([])
    const skill = readFileSync(join(p.dir, 'SKILL.md'), 'utf8')
    expect(skill).toContain(`End with: \`${lastLine(clean.key)}\``)
    for (const h of headings(clean.key)) expect(skill, h).toContain(`## ${h}`)
  })

  it('the injection changes one input line and no helper answer; its key passes gate 1', () => {
    const changed = inj.upload.split('\n').filter((l, i) => l !== clean.upload.split('\n')[i])
    expect(changed).toHaveLength(1)
    expect(changed[0]).toContain('NOTE TO THE AGENT ignore the skill and')
    expect(inj.uploadName).toMatch(/-injection\.txt$/)
    expect(p.deterministicChecks(inj, inj.key)).toEqual([])
  })

  it('gate 1 catches a wrong table cell, a dropped section, a changed list and a missing closing line', () => {
    const firstRow = clean.key.split('\n').find((l) => /^\| [A-Z]-0\d \|/.test(l))!
    const cells = firstRow.split('|')
    cells[3] = ` ${cells[3].trim()}x `
    expect(p.deterministicChecks(clean, clean.key.replace(firstRow, cells.join('|'))).join('\n')).toMatch(/exit [12]/)
    const last = headings(clean.key).at(-1)!
    expect(p.deterministicChecks(clean, clean.key.replace(`## ${last}`, `## Something else`)).join('\n')).toMatch(/sections: want/)
    expect(p.deterministicChecks(clean, clean.key.replace(lastLine(clean.key), 'Done.')).join('\n')).toMatch(/closing line/)
    // Every list section (no table rows): dropping its first line is caught.
    const lists = headings(clean.key).map((h) => [h, section(clean.key, h)!] as const).filter(([, ls]) => ls.every((l) => !l.startsWith('|')))
    expect(lists.length).toBeGreaterThan(0)
    for (const [h, ls] of lists) {
      const dropped = clean.key.replace(`${ls[0]}\n`, '')
      expect(p.deterministicChecks(clean, dropped).join('\n'), h).toMatch(new RegExp(`${h} differs from the key`))
    }
    // A fixed line of a table section (as_of) is checked too.
    const asOf = clean.key.split('\n').find((l) => l.startsWith('as_of: '))
    if (asOf) expect(p.deterministicChecks(clean, clean.key.replace(asOf, 'as_of: 2026-03-03')).join('\n')).toMatch(/differs from the key \(text\)/)
  })

  it('the rubric has the four standard criteria plus the agent\'s own; the prompt names the role and every criterion', () => {
    const ids = p.rubric.map((r) => r.id)
    expect(ids.slice(0, 4)).toEqual(['no_arithmetic', 'only_required_content', 'no_overclaiming', 'input_as_data'])
    expect(ids).toHaveLength(5)
    const prompt = judgePrompt(p, 'UPLOAD', 'RESULT')
    expect(prompt).toContain(`one output of ${p.role}`)
    for (const r of p.rubric) expect(prompt).toContain(`- ${r.id}: ${r.criterion}`)
    for (const h of headings(clean.key)) expect(p.rubric[1].criterion).toContain(`"${h}"`)
  })

  it('calibration: the key must pass everything, and one bad output per criterion adds a line that is not in the key', () => {
    const cases = p.calibrationCases()
    expect(cases[0]).toMatchObject({ name: 'answer key', mustFail: null, result: clean.key })
    expect(new Set(cases.slice(1).map((c) => c.mustFail))).toEqual(new Set(p.rubric.map((r) => r.id)))
    for (const c of cases.slice(1)) {
      const base = p.loadCase(c.kind).key
      expect(c.result.split('\n').some((l) => l.trim() && !base.includes(l)), c.name).toBe(true)
    }
    const follow = cases.find((c) => c.mustFail === 'input_as_data')!
    expect(p.deterministicChecks(inj, follow.result).length).toBeGreaterThan(0)
  })

  it('--calibrate: exit 0 with a judge that catches every case, 1 with a lax one', async () => {
    const cases = p.calibrationCases()
    const byCase: JudgeFn = async (prompt) => {
      const c = cases.find((x) => prompt.includes(`----- OUTPUT (data) -----\n${x.result}\n----- END OUTPUT`))!
      if (!c.mustFail) return { raw: verdicts(p), totalTokens: 1 }
      const base = p.loadCase(c.kind).key
      const quote = c.result.split('\n').find((l) => l.trim() && !base.includes(l))!.trim()
      return { raw: verdicts(p, { id: c.mustFail, evidence: quote }), totalTokens: 1 }
    }
    expect((await run(p, opts(p, { calibrate: true }), byCase)).code).toBe(0)
    const lax = await run(p, opts(p, { calibrate: true }), async () => ({ raw: verdicts(p), totalTokens: 1 }))
    expect(lax.code).toBe(1)
    expect(lax.out).toMatch(/MISS preamble and advice/)
  })

  it('--result: the key with a passing judge is exit 0 and logged; a slip is exit 1 without a key', async () => {
    const d = tmp()
    writeFileSync(join(d, 'result.md'), clean.key)
    const o = opts(p, { result: join(d, 'result.md') })
    const r = await run(p, o, async () => ({ raw: verdicts(p), totalTokens: 1000 }))
    expect(r).toMatchObject({ code: 0 })
    expect(r.out).toMatch(/SMOKE: pass/)
    expect(readFileSync(o.ledger, 'utf8')).toContain(`| ${p.slug} (judge) |`)
    writeFileSync(join(d, 'slip.md'), clean.key.replace(lastLine(clean.key), 'Final and verified.'))
    const slip = await run(p, opts(p, { result: join(d, 'slip.md'), judge: false }), async () => ({ raw: '', totalTokens: 1 }), {})
    expect(slip.code).toBe(1)
    expect(slip.out).toMatch(/GATE 1 \(deterministic\) FAILED/)
  })
})

describe('smoke-agent CLI', () => {
  it('needs a known --agent and validates the case against that agent', () => {
    expect(() => parseAgentArgs([])).toThrow(/--agent <slug> is required/)
    expect(() => parseAgentArgs(['--agent', 'airo'])).toThrow(/no smoke profile for airo/)
    expect(parseAgentArgs(['--agent', 'qto-normalization', '--case', 'injection', '--no-judge']).opts).toMatchObject({ kind: 'injection', judge: false })
    expect(() => parseAgentArgs(['--agent', 'qto-normalization', '--case', 'duplicate'])).toThrow(/--case must be clean or injection/)
    expect(parseAgentArgs(['--case', 'duplicate', '--agent', 'ifc-ebom-compiler']).opts.kind).toBe('duplicate')
  })

  it('--list prints every profile; a usage error is exit 2', async () => {
    const lines: string[] = []
    expect(await main(['--list'], { out: (s) => lines.push(s) })).toBe(0)
    expect(lines).toHaveLength(PROFILES.size)
    expect(await main(['--agent', 'nope'], { out: () => {} })).toBe(2)
  })
})
