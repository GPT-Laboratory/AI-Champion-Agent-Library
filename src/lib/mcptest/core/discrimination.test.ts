// Discrimination proof (SC-2): the real runner over the fake variants. Good scores full with no flags; every
// flawed variant fails the checks listed in its VARIANTS.mustFail and raises its flags; blockers force BLOCKED.
// Fake variants are scorer fixtures, never tested real servers.
// Golden: UPDATE_GOLDEN=1 npx vitest run src/lib/mcptest/core/discrimination.test.ts (then read the diff).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { VARIANTS, variantIds } from '../fake/variants'
import { ReportSchema, type Report } from './report'
import { runSuite } from './runner'
import { FLAG_SEVERITY } from './scoring'
import { loadSuite, type SuiteCase } from './suite'
import { fakeSubject } from './subjects'

const LONG = 120_000
const BEHAVIOUR = [
  'lookup_by_id', 'lookup_by_alt_key', 'partition_filter', 'derived_filter', 'projection',
  'pagesize_clamp', 'pagination_ceiling', 'bad_input', 'empty_vs_error', 'auth_fail'
]
/** Variants whose single flaw must fail exactly one generic behaviour check. */
const EXACTLY_ONE = ['no-derived-tool', 'no-clamp', 'raw-passthrough', 'bare-empty', 'no-auth-message']
/** Flag-only variants: the case that raises their flag, run next to the T2 case so the score stays high. */
const FLAG_CASE: Record<string, string> = { WRITE_TOOL: 'T4-SEC-SECRETS', SECRET_ECHO: 'T4-SEC-SECRETS' }
const GOLDEN_URL = new URL('./__golden__/report-good-t1.json', import.meta.url)

let suite: SuiteCase[]
const runs = new Map<string, Promise<Report>>()

beforeAll(async () => {
  const s = await loadSuite()
  if (!s.ok) throw new Error(s.errors.join('\n'))
  suite = s.cases
})

const byId = (id: string) => suite.find((c) => c.def.id === id) as SuiteCase
/** no-clamp and mirror forward oversize pages: the mock must not turn that into a clean 500 (15-04 note). */
const noCeiling = (c: SuiteCase): SuiteCase =>
  c.x.upstream ? { ...c, x: { ...c.x, upstream: { ...c.x.upstream, a: { ...c.x.upstream.a, ceiling: null } } } } : c

function caseIdsFor(variant: string): string[] {
  const v = VARIANTS[variant]
  const ids = new Set<string>(['T1-STD-CATALOG'])
  for (const c of suite) {
    const kinds = c.golden.map((g) => g.check_kind).filter(Boolean) as string[]
    if (kinds.some((k) => v.mustFail.includes(k))) ids.add(c.def.id)
  }
  for (const f of v.flags) if (FLAG_CASE[f]) ids.add(FLAG_CASE[f])
  if (v.flags.some((f) => FLAG_SEVERITY[f] === 'blocker')) ids.add('T2-CATALOG-API')
  if (variant === 'mirror' || variant === 'no-clamp') ids.add('T2-CATALOG-API')
  return [...ids]
}

function runVariant(variant: string): Promise<Report> {
  let p = runs.get(variant)
  if (!p) {
    const fix = variant === 'no-clamp' || variant === 'mirror'
    const list = caseIdsFor(variant).map((id) => (fix ? noCeiling(byId(id)) : byId(id)))
    p = runSuite({
      subject: fakeSubject(variant),
      cases: list,
      runtime: 'fake',
      timeoutMs: variant === 'hang' ? 400 : 3000,
      runId: `disc-${variant}`
    })
    runs.set(variant, p)
  }
  return p
}

const allChecks = (r: Report) => r.cases.flatMap((c) => c.checks.map((k) => ({ ...k, caseId: c.caseId })))
const failedKinds = (r: Report) => new Set(allChecks(r).filter((k) => k.status === 'FAIL').map((k) => k.kind))
const flagsOf = (r: Report) => r.cases.flatMap((c) => c.flags)

describe('good variant', () => {
  it(
    'scores full over every fake-applicable case with no flags',
    async () => {
      const r = await runSuite({ subject: fakeSubject('good'), cases: suite, runtime: 'fake', timeoutMs: 3000, runId: 'disc-good-all' })
      expect(ReportSchema.safeParse(r).success).toBe(true)
      for (const c of r.cases) {
        if (c.caseId === 'T2-CATALOG-DUMP') expect(c.state).toBe('PENDING_HUMAN')
        else if (c.caseId === 'T4-PARTIAL-SPEC') expect(c.state).toBe('NA_MODALITY')
        else expect({ id: c.caseId, state: c.state }).toEqual({ id: c.caseId, state: 'PASS' })
        for (const k of c.checks) expect({ id: k.id, ok: k.status === 'PASS' || k.status === 'NA' }).toEqual({ id: k.id, ok: true })
      }
      expect(r.summary.gate).toBe('pass')
      expect(r.summary.score.value).toBe(100)
      expect(flagsOf(r)).toEqual([])
      expect(allChecks(r).filter((k) => k.reason.toLowerCase().startsWith('leak'))).toEqual([])
      // Pending and NA cases are excluded from the score but counted in applicability: 7 applicable, 6 ran.
      expect(r.summary.score.casesApplicable).toBe(7)
      expect(r.summary.score.casesRun).toBe(6)
      // DRAFT-15-08-f: 15-06 never lets a pending case produce PASS (incomplete coverage), so the verdict is FAIL here.
      expect(r.summary.verdict).toBe('FAIL')
    },
    LONG
  )

  it(
    'verdict is PASS when every applicable case ran',
    async () => {
      const list = suite.filter((c) => c.def.id !== 'T2-CATALOG-DUMP')
      const r = await runSuite({ subject: fakeSubject('good'), cases: list, runtime: 'fake', timeoutMs: 3000, runId: 'disc-good-full' })
      expect(r.summary.verdict).toBe('PASS')
      expect(r.summary.score).toMatchObject({ value: 100, casesRun: 6, casesApplicable: 6 })
      expect(r.summary.flags).toEqual({ blockers: 0, warnings: 0 })
    },
    LONG
  )
})

describe('variant x expected failures', () => {
  const flawed = variantIds().filter((v) => v !== 'good')

  it.concurrent.each(flawed)(
    '%s fails what VARIANTS says and raises its flags',
    async (variant) => {
      const def = VARIANTS[variant]
      const r = await runVariant(variant)
      expect(ReportSchema.safeParse(r).success).toBe(true)
      const failed = failedKinds(r)
      for (const kind of def.mustFail) {
        if (kind === 'D1') {
          const t1 = r.cases.find((c) => c.caseId === 'T1-STD-CATALOG')
          expect(t1?.dims.D1).toBe(false)
          expect(t1?.state).toBe('FAIL')
        } else expect({ variant, kind, failed: failed.has(kind) }).toEqual({ variant, kind, failed: true })
      }
      const raised = flagsOf(r)
      for (const f of def.flags) {
        const hit = raised.find((x) => x.id === f)
        expect({ variant, flag: f, raised: !!hit }).toEqual({ variant, flag: f, raised: true })
        expect(hit?.severity).toBe(FLAG_SEVERITY[f])
      }
      // Blockers force BLOCKED whatever the score; warning-only variants never do.
      const blockers = def.flags.filter((f) => FLAG_SEVERITY[f] === 'blocker')
      if (blockers.length > 0) expect(r.summary.verdict).toBe('BLOCKED')
      else expect(r.summary.verdict).not.toBe('BLOCKED')
    },
    LONG
  )

  it.concurrent.each(EXACTLY_ONE)(
    '%s fails exactly its one generic behaviour check',
    async (variant) => {
      const r = await runVariant(variant)
      const t2 = r.cases.find((c) => c.caseId === 'T2-CATALOG-API')
      const failing = (t2?.checks ?? []).filter((k) => BEHAVIOUR.includes(k.kind) && k.status === 'FAIL').map((k) => k.kind)
      expect(failing).toEqual(VARIANTS[variant].mustFail)
      // Nothing outside the T2 case is affected.
      expect(r.cases.filter((c) => c.caseId !== 'T2-CATALOG-API').every((c) => c.state === 'PASS')).toBe(true)
    },
    LONG
  )

  it.concurrent(
    'hallucinated-endpoint scores D3 = 0; huge-payload and no-trunc-signal fail large_response',
    async () => {
      const h = await runVariant('hallucinated-endpoint')
      expect(h.cases.find((c) => c.caseId === 'T3-RT-DOCS')?.dims.D3.score).toBe(0)
      for (const v of ['huge-payload', 'no-trunc-signal']) {
        const r = await runVariant(v)
        const lr = allChecks(r).find((k) => k.kind === 'large_response')
        expect(lr?.status).toBe('FAIL')
        expect(r.cases.find((c) => c.caseId === 'T3-LARGE-RESP')?.state).toBe('FAIL')
      }
    },
    LONG
  )

  it.concurrent(
    'blocker variants stay BLOCKED even when the raw score is as high as good (secret-echo, write-tool, confident-wrong)',
    async () => {
      for (const v of ['secret-echo', 'write-tool', 'confident-wrong']) {
        const r = await runVariant(v)
        expect(r.summary.verdict).toBe('BLOCKED')
        expect(r.summary.score.value).toBe(100)
      }
    },
    LONG
  )

  it.concurrent(
    'warning-only variants keep a non-BLOCKED verdict',
    async () => {
      for (const v of ['no-retry', 'bad-code-accept']) {
        const r = await runVariant(v)
        expect(r.summary.flags.blockers).toBe(0)
        expect(r.summary.flags.warnings).toBeGreaterThan(0)
        expect(r.summary.verdict).not.toBe('BLOCKED')
      }
    },
    LONG
  )
})

describe('calibration and gate', () => {
  it(
    'score(good) > score(partial profile = no-clamp) > score(mirror) on T2-CATALOG-API',
    async () => {
      const t2 = (r: Report) => r.cases.find((c) => c.caseId === 'T2-CATALOG-API')
      const good = await runSuite({ subject: fakeSubject('good'), cases: [byId('T1-STD-CATALOG'), byId('T2-CATALOG-API')], runtime: 'fake', timeoutMs: 3000 })
      const partial = await runVariant('no-clamp')
      const mirror = await runVariant('mirror')
      const pct = (r: Report) => {
        const c = t2(r)
        const scored = (c?.checks ?? []).filter((k) => k.status !== 'NA')
        return (scored.filter((k) => k.status === 'PASS').length / scored.length) * 100
      }
      expect(pct(good)).toBeGreaterThan(pct(partial))
      expect(pct(partial)).toBeGreaterThan(pct(mirror))
      expect(good.summary.score.value).toBeGreaterThan(partial.summary.score.value as number)
      expect(partial.summary.score.value as number).toBeGreaterThan(mirror.summary.score.value as number)
    },
    LONG
  )

  it(
    'a failing Tier 1 case gives gate fail, score null and verdict DISQUALIFIED',
    async () => {
      const strict: SuiteCase = {
        ...byId('T1-STD-CATALOG'),
        golden: [...byId('T1-STD-CATALOG').golden, { id: 'extra_fail', type: 'call', tool_hint: '^lookup_item$', args: { id: 'ACM-000001' }, expect: { field_value: { id: 'NOPE-1' } }, dimension: 'D2' }]
      }
      const r = await runSuite({ subject: fakeSubject('good'), cases: [strict, byId('T2-CATALOG-API')], runtime: 'fake', timeoutMs: 3000 })
      expect(r.summary.gate).toBe('fail')
      expect(r.summary.score.value).toBeNull()
      expect(r.summary.verdict).toBe('DISQUALIFIED')
      expect(r.cases.find((c) => c.caseId === 'T2-CATALOG-API')?.state).toBe('PASS') // still shown informationally
    },
    LONG
  )

  it(
    'process-level variants are D1 failures or findings, never a scorer crash',
    async () => {
      for (const v of ['crash-on-init', 'hang']) {
        const r = await runVariant(v)
        expect(ReportSchema.safeParse(r).success).toBe(true)
        expect(r.cases[0].dims.D1).toBe(false)
        expect(r.cases[0].state).toBe('FAIL')
        expect(r.summary.score.value).toBeNull()
      }
      const noise = await runVariant('stdout-noise')
      expect(flagsOf(noise).map((f) => f.id)).toContain('STDOUT_NOISE')
      expect(noise.cases[0].state).toBe('PASS')
      const old = await runVariant('old-protocol')
      expect(old.cases[0].state).toBe('PASS')
      const unknown = await runVariant('unknown-protocol')
      expect(unknown.cases[0].findings.some((f) => f.kind === 'unknown_protocol_version')).toBe(true)
      expect(unknown.cases[0].state).toBe('PASS')
    },
    LONG
  )
})

describe('golden report', () => {
  it(
    'good x T1-STD-CATALOG matches report-good-t1.json (UPDATE_GOLDEN=1 rewrites)',
    async () => {
      const r = await runSuite({
        subject: fakeSubject('good'),
        cases: [byId('T1-STD-CATALOG')],
        runtime: 'fake',
        runId: 'golden-run',
        now: () => new Date('2026-01-01T00:00:00Z'),
        platformVersion: '0.1.0'
      })
      const stripped: Record<string, unknown> = { ...r, run: { ...r.run } }
      delete (stripped.run as Record<string, unknown>).generatedAt
      delete stripped.timings
      const text = JSON.stringify(stripped, null, 2) + '\n'
      expect(text).not.toMatch(/127\.0\.0\.1|canary-|\d{4}-\d\d-\d\dT/)
      const path = fileURLToPath(GOLDEN_URL)
      if (process.env.UPDATE_GOLDEN === '1') {
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, text)
      }
      expect(text).toBe(readFileSync(path, 'utf8'))
    },
    LONG
  )
})
