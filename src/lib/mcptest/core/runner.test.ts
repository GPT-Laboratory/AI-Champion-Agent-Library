import { beforeAll, describe, expect, it } from 'vitest'
import { serveStdio } from '../fake/fakeServer'
import type { MockHandle } from '../mock/spec'
import type { McpClient } from './client'
import { ReportSchema, type Report } from './report'
import { runSuite, type RunOptions } from './runner'
import { loadSuite, type SuiteCase } from './suite'
import { fakeSubject, listSubjects, resolveSubject, type RunnableSubject } from './subjects'
import type { CheckResult, MockView, PrepareResult, ToolCaller } from './types'

// Type tests: the structural copies declared in core/types.ts match the real client and mock handle.
const _caller: ToolCaller = {} as McpClient
const _view: MockView = {} as MockHandle
void _caller
void _view

let cases: Record<string, SuiteCase>
beforeAll(async () => {
  const s = await loadSuite()
  if (!s.ok) throw new Error(s.errors.join('\n'))
  cases = Object.fromEntries(s.cases.map((c) => [c.def.id, c]))
})

const base = (subject: RunnableSubject, list: SuiteCase[], over: Partial<RunOptions> = {}): RunOptions => ({
  subject,
  cases: list,
  runtime: 'fake',
  timeoutMs: 1500,
  runId: 'test-run',
  now: () => new Date('2026-01-01T00:00:00Z'),
  ...over
})
const stateOf = (r: Report, id: string) => r.cases.find((c) => c.caseId === id)?.state
const strip = (r: Report) => ({ ...r, run: { ...r.run, generatedAt: '' }, timings: null })
const withSubject = (over: Partial<RunnableSubject>, variant = 'good'): RunnableSubject => ({ ...fakeSubject(variant), ...over })

describe('subjects', () => {
  it('registry: fake variants and generator subjects; unknown resolves to null', () => {
    const ids = listSubjects().map((s) => s.id)
    expect(ids).toContain('fake:good')
    expect(ids).toContain('generator:openapi')
    expect(resolveSubject('fake:nope')).toBeNull()
    expect(resolveSubject('nothing')).toBeNull()
    expect(resolveSubject('fake:good')?.kind).toBe('fake')
  })
})

describe('runSuite end to end', () => {
  it('good passes T1-STD-CATALOG with gate pass and validates', async () => {
    const r = await runSuite(base(fakeSubject('good'), [cases['T1-STD-CATALOG']]))
    expect(ReportSchema.safeParse(r).success).toBe(true)
    expect(stateOf(r, 'T1-STD-CATALOG')).toBe('PASS')
    expect(r.summary.gate).toBe('pass')
    expect(r.subject.kind).toBe('fake')
    expect(r.subject.toolNames).toContain('lookup_item')
  })

  it('is deterministic apart from generatedAt and timings', async () => {
    const run = () => runSuite(base(fakeSubject('good'), [cases['T1-STD-CATALOG'], cases['T3-PROFILE-CONTRACT']], { now: () => new Date() }))
    const [a, b] = [await run(), await run()]
    expect(strip(a)).toEqual(strip(b))
  })
})

describe('resolution order and states', () => {
  const one = (s: RunnableSubject, id: string, over: Partial<RunOptions> = {}) => runSuite(base(s, [cases[id]], over))

  it('UNAVAILABLE and INSTALL_FAILED come before anything else', async () => {
    expect(stateOf(await one(withSubject({ status: 'unavailable' }), 'T1-STD-CATALOG'), 'T1-STD-CATALOG')).toBe('UNAVAILABLE')
    expect(stateOf(await one(withSubject({ status: 'install_failed' }), 'T1-STD-CATALOG'), 'T1-STD-CATALOG')).toBe('INSTALL_FAILED')
  })
  it('NA_MODALITY for x-applies-to and for a modality mismatch', async () => {
    expect(stateOf(await one(fakeSubject('good'), 'T4-PARTIAL-SPEC'), 'T4-PARTIAL-SPEC')).toBe('NA_MODALITY')
    expect(stateOf(await one(withSubject({ modality: 'docs' }), 'T1-STD-CATALOG'), 'T1-STD-CATALOG')).toBe('NA_MODALITY')
  })
  it('SKIPPED_FIXTURE when a needed fixture is missing', async () => {
    const bare = { ...cases['T3-RT-DOCS'], fixtureFiles: [] }
    const r = await runSuite(base(fakeSubject('good'), [bare]))
    expect(stateOf(r, 'T3-RT-DOCS')).toBe('SKIPPED_FIXTURE')
  })
  it('GEN_FAILED from prepare status and from a throwing prepare; serve rejection is ERROR', async () => {
    const failed = withSubject({ prepare: async () => ({ status: 'GEN_FAILED', error: 'no pipeline' }) })
    expect(stateOf(await one(failed, 'T1-STD-CATALOG'), 'T1-STD-CATALOG')).toBe('GEN_FAILED')
    const thrower = withSubject({
      prepare: async () => {
        throw new Error('boom')
      }
    })
    const r = await one(thrower, 'T1-STD-CATALOG')
    expect(stateOf(r, 'T1-STD-CATALOG')).toBe('GEN_FAILED')
    expect(r.cases[0].stateReason).toContain('boom')
    const rejecting = withSubject({
      prepare: async () => ({ status: 'PASS', launch: { kind: 'inproc', serve: async () => Promise.reject(new Error('serve died')) } })
    })
    const e = await one(rejecting, 'T1-STD-CATALOG')
    expect(stateOf(e, 'T1-STD-CATALOG')).toBe('ERROR')
    expect(ReportSchema.safeParse(e).success).toBe(true)
  })
  it('NA_TRANSPORT for an http case and a stdio-only subject', async () => {
    const stdioOnly = withSubject({ transports: ['stdio'], startHttp: undefined })
    expect(stateOf(await one(stdioOnly, 'T2-CATALOG-HTTP'), 'T2-CATALOG-HTTP')).toBe('NA_TRANSPORT')
  })
  it('PENDING_HUMAN: x-requires real-runtime on a fake subject; nothing is prepared or spawned', async () => {
    let prepared = 0
    const spy = withSubject({
      prepare: async () => {
        prepared++
        return { status: 'PASS' }
      }
    })
    const r = await one(spy, 'T2-CATALOG-DUMP')
    expect(stateOf(r, 'T2-CATALOG-DUMP')).toBe('PENDING_HUMAN')
    expect(prepared).toBe(0)
    expect(r.pendingHuman.some((p) => p.id === 'T2-CATALOG-DUMP')).toBe(true)
  })
  it('PENDING_HUMAN: stdio launch without allowStdioExec, extra checks and flags still counted', async () => {
    let spawned = 0
    const extra: CheckResult[] = [
      { id: 'generates', kind: 'generator_side', dimension: 'D1', status: 'FAIL', boundBy: 'none', reason: 'x', flags: [{ id: 'SILENT_GUESS', severity: 'warning', detail: 'guess' }] }
    ]
    const gen: RunnableSubject = {
      ...fakeSubject('good'),
      id: 'generator:spy',
      kind: 'generator',
      modality: 'spec',
      transports: ['stdio'],
      prepare: async (): Promise<PrepareResult> => {
        spawned++
        return { status: 'PASS', launch: { kind: 'stdio', command: 'definitely-not-installed', args: [], cwd: '/' }, extraChecks: extra }
      }
    }
    const r = await one(gen, 'T1-STD-CATALOG')
    expect(stateOf(r, 'T1-STD-CATALOG')).toBe('PENDING_HUMAN')
    expect(spawned).toBe(1)
    expect(r.cases[0].flags.map((f) => f.id)).toEqual(['SILENT_GUESS'])
    expect(r.summary.flags.warnings).toBe(1)
    expect(r.summary.score.casesRun).toBe(0)
  })
  it('a prepare with extraChecks and no launch is scored on those alone', async () => {
    const mk = (status: CheckResult['status']): CheckResult[] => [{ id: 'gap_reported', kind: 'generator_side', dimension: 'D2', status, boundBy: 'none', reason: 'r' }]
    const gen = (status: CheckResult['status']): RunnableSubject => ({
      ...fakeSubject('good'),
      kind: 'generator',
      prepare: async () => ({ status: 'PASS', extraChecks: mk(status) })
    })
    const partial: SuiteCase = { ...cases['T4-PARTIAL-SPEC'], x: { ...cases['T4-PARTIAL-SPEC'].x, appliesTo: ['generator'] } }
    expect(stateOf(await runSuite(base(gen('PASS'), [partial])), 'T4-PARTIAL-SPEC')).toBe('PASS')
    expect(stateOf(await runSuite(base(gen('FAIL'), [partial])), 'T4-PARTIAL-SPEC')).toBe('FAIL')
  })
})

describe('environment, mocks and options', () => {
  it('subject env holds only the configured names, never process.env; mocks are closed afterwards', async () => {
    process.env.ACME_SHOULD_NOT_LEAK = 'x'
    const seen: Record<string, string>[] = []
    const spy = withSubject({
      prepare: async () => ({
        status: 'PASS',
        launch: {
          kind: 'inproc',
          serve: (r, w, env) => {
            seen.push({ ...env })
            return serveStdio(r as never, w as never, { variant: 'good', env, stderr: { write: () => {} } })
          }
        }
      })
    })
    const r = await runSuite(base(spy, [cases['T2-CATALOG-API'], cases['T3-COMPOSITE'], cases['T1-STD-CATALOG']]))
    delete process.env.ACME_SHOULD_NOT_LEAK
    expect(r.cases.length).toBe(3)
    const keySets = new Set(seen.map((e) => Object.keys(e).sort().join(',')))
    expect([...keySets].sort()).toEqual(['ACME_BASE_URL', 'ACME_BASE_URL,ACME_BASE_URL_B', 'ACME_API_KEY,ACME_BASE_URL'].sort())
    const canaryEnv = seen.find((e) => e.ACME_API_KEY)
    expect(canaryEnv?.ACME_API_KEY).toMatch(/^canary-[0-9a-f]{16}$/)
    expect(JSON.stringify(r)).not.toContain(canaryEnv?.ACME_API_KEY as string)
    const url = seen[0].ACME_BASE_URL
    await expect(fetch(`${url}/health`)).rejects.toThrow()
  })

  it('reruns default to 1 and clamp to 1..3; progress is monotonic and ends at total', async () => {
    const t1 = [cases['T1-STD-CATALOG']]
    expect((await runSuite(base(fakeSubject('good'), t1))).run.reruns).toBe(1)
    expect((await runSuite(base(fakeSubject('good'), t1, { reruns: 0 }))).run.reruns).toBe(1)
    const seen: number[] = []
    const r = await runSuite(base(fakeSubject('good'), t1, { reruns: 9, onProgress: (p) => seen.push(p.done) }))
    expect(r.run.reruns).toBe(3)
    expect(r.cases[0].reruns).toHaveLength(3)
    expect(r.cases[0].dims.D6.reproducibility).toEqual({ reruns: 3, equivalent: true })
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1])
    expect(seen[seen.length - 1]).toBe(3)
  })

  it('an aborted signal stops the remaining cells and the verdict is INCOMPLETE', async () => {
    const ac = new AbortController()
    const r = await runSuite(
      base(fakeSubject('good'), [cases['T1-STD-CATALOG'], cases['T3-PROFILE-CONTRACT'], cases['T3-RT-DOCS']], {
        signal: ac.signal,
        onProgress: (p) => {
          if (p.done >= 1) ac.abort()
        }
      })
    )
    expect(r.summary.verdict).toBe('INCOMPLETE')
    expect(r.cases.filter((c) => c.stateReason?.includes('aborted')).length).toBeGreaterThan(0)
    expect(ReportSchema.safeParse(r).success).toBe(true)
  })
})

describe('check dispatch', () => {
  const t1 = () => cases['T1-STD-CATALOG']
  const withGolden = (golden: SuiteCase['golden']): SuiteCase => ({ ...t1(), golden })

  it('inject lines reach the mock before the call', async () => {
    const line = { id: 'search_ok', type: 'call' as const, tool_hint: '^search_items$', args: { query: 'pump' }, expect: { no_error: true }, dimension: 'D2' as const }
    const clean = await runSuite(base(fakeSubject('good'), [withGolden([line])]))
    expect(clean.cases[0].checks[0].status).toBe('PASS')
    const injected = await runSuite(
      base(fakeSubject('good'), [withGolden([{ ...line, inject: { route: '/items', fault: 'status', status: 503, times: 99 } }])])
    )
    expect(injected.cases[0].checks[0].status).toBe('FAIL')
  })

  it('tool_exists and a per-subject binding override for a behaviour check', async () => {
    const lines: SuiteCase['golden'] = [
      { id: 'te', type: 'tool_exists', tool_hint: '^nothing_like_this$', dimension: 'D1' },
      { id: 'bh', type: 'call', check_kind: 'derived_filter', tool_hint: '^zzz_none$', dimension: 'D2' }
    ]
    const sc: SuiteCase = { ...cases['T2-CATALOG-API'], golden: lines }
    const none = await runSuite(base(fakeSubject('good'), [sc]))
    const byId = (r: Report, id: string) => r.cases[0].checks.find((c) => c.id === id)
    expect(byId(none, 'te')?.status).toBe('FAIL')
    expect(byId(none, 'derived_filter')).toMatchObject({ status: 'FAIL', reason: 'no tool' })
    const bound = withSubject({
      prepare: async (c, w) => ({
        ...(await fakeSubject('good').prepare(c, w)),
        binding: { derived_filter: { tool: 'find_items_by_attribute', args: { attribute: 'Colour', value: 'Red' } } }
      })
    })
    const r = await runSuite(base(bound, [sc]))
    expect(byId(r, 'derived_filter')).toMatchObject({ status: 'PASS', boundBy: 'explicit' })
  })

  it('auth lines relaunch the subject with a wrong key', async () => {
    const r = await runSuite(base(fakeSubject('good'), [{ ...cases['T2-CATALOG-API'], golden: cases['T2-CATALOG-API'].golden.filter((g) => g.type === 'auth') }]))
    expect(r.cases[0].checks.map((c) => [c.id, c.status])).toEqual([
      ['auth_failure', 'PASS'],
      ['auth_fail', 'PASS']
    ])
  })
})

describe('process-level faults (D1)', () => {
  const t1 = () => [cases['T1-STD-CATALOG']]
  it('crash-on-init: D1 false, case FAIL, report validates, no exception', async () => {
    const r = await runSuite(base(fakeSubject('crash-on-init'), t1()))
    expect(r.cases[0].dims.D1).toBe(false)
    expect(r.cases[0].state).toBe('FAIL')
    expect(ReportSchema.safeParse(r).success).toBe(true)
    expect(r.summary.gate).toBe('fail')
    expect(r.summary.score.value).toBeNull()
  })
  it('stdout-noise raises STDOUT_NOISE as a warning only', async () => {
    const r = await runSuite(base(fakeSubject('stdout-noise'), t1()))
    expect(r.cases[0].state).toBe('PASS')
    expect(r.cases[0].flags).toMatchObject([{ id: 'STDOUT_NOISE', severity: 'warning' }])
    expect(r.cases[0].findings.some((f) => f.kind === 'stdout_noise')).toBe(true)
  })
  it('unknown-protocol records a finding only; old-protocol is clean', async () => {
    const u = await runSuite(base(fakeSubject('unknown-protocol'), t1()))
    expect(u.cases[0].state).toBe('PASS')
    expect(u.cases[0].findings.some((f) => f.kind === 'unknown_protocol_version')).toBe(true)
    expect((await runSuite(base(fakeSubject('old-protocol'), t1()))).cases[0].state).toBe('PASS')
  })
})
