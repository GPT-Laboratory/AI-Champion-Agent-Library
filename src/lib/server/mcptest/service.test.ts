import { beforeAll, describe, expect, it, vi } from 'vitest'
import { loadSuite } from '$lib/mcptest/core/suite'
import { runSuite } from '$lib/mcptest/core/runner'
import { fakeSubject } from '$lib/mcptest/core/subjects'
import { DriverRequestSchema } from '$lib/mcptest/driverRequest'
import { createFakeRuntime } from '../tryitout/runtimeFake'
import type { StagedFile } from '../tryitout/runtime'
import { createRunStore } from './jobs'
import {
  __setExecutorForTests,
  allowedSubjectIds,
  containerModeSelected,
  executeRun,
  isAllowedSubject,
  isKnownCase,
  startRun
} from './service'

const tree: StagedFile[] = [{ path: 'src/lib/mcptest/driver.ts', content: '// driver' }]
const enc = new TextEncoder()
let reportJson = ''

beforeAll(async () => {
  const suite = await loadSuite()
  if (!suite.ok) throw new Error('suite')
  const r = await runSuite({
    subject: fakeSubject('good'),
    cases: suite.cases.filter((c) => c.def.id === 'T1-STD-CATALOG'),
    runtime: 'container'
  })
  reportJson = JSON.stringify(r)
}, 60_000)

describe('allowlists', () => {
  it('accepts only fake variants and generator samples', () => {
    const ids = allowedSubjectIds()
    expect(ids).toContain('fake:good')
    expect(ids.some((i) => i.startsWith('generator:'))).toBe(true)
    expect(ids.every((i) => i.startsWith('fake:') || i.startsWith('generator:'))).toBe(true)
    expect(isAllowedSubject('cmd:python server.py')).toBe(false)
    expect(isAllowedSubject('fake:no-such-variant')).toBe(false)
    expect(isAllowedSubject(7)).toBe(false)
    expect(isKnownCase('T1-STD-CATALOG')).toBe(true)
    expect(isKnownCase('T9-NOPE')).toBe(false)
  })

  it('container mode needs the explicit variable', () => {
    expect(containerModeSelected({})).toBe(false)
    expect(containerModeSelected({ MCP_TESTER_RUNTIME: 'fake' })).toBe(false)
    expect(containerModeSelected({ MCP_TESTER_RUNTIME: 'container' })).toBe(true)
  })
})

describe('executeRun in process (default)', () => {
  it('runs a fake subject and stores the report, honouring the case filter', async () => {
    const store = createRunStore()
    const run = store.createRun('s')
    const factory = vi.fn()
    await executeRun(run.id, { subject: 'fake:good', cases: ['T1-STD-CATALOG'] }, { store, env: {}, runtimeFactory: factory })
    expect(run.status).toBe('done')
    const report = JSON.parse(run.report!)
    expect(report.schema).toBe('mcptest-report/1')
    expect(report.cases.map((c: { caseId: string }) => c.caseId)).toEqual(['T1-STD-CATALOG'])
    expect(run.progress.done).toBe(run.progress.total)
    expect(run.events.length).toBeGreaterThan(0)
    expect(factory).not.toHaveBeenCalled()
  })

  it('scores a generator subject with PENDING_HUMAN server-side cells and never touches the runtime', async () => {
    const store = createRunStore()
    const run = store.createRun('s')
    const factory = vi.fn()
    await executeRun(run.id, { subject: 'generator:openapi', cases: ['T2-CATALOG-API'] }, { store, env: {}, runtimeFactory: factory })
    expect(run.status).toBe('done')
    const report = JSON.parse(run.report!)
    expect(JSON.stringify(report)).toContain('PENDING_HUMAN')
    expect(factory).not.toHaveBeenCalled()
  })

  it('fails a run with an unknown subject or no matching case, with a short message', async () => {
    const store = createRunStore()
    const a = store.createRun('s')
    await executeRun(a.id, { subject: 'fake:nope' }, { store, env: {} })
    expect(a.status).toBe('failed')
    expect(a.error).toBeTruthy()
    const b = store.createRun('s')
    await executeRun(b.id, { subject: 'fake:good', cases: ['NOPE'] }, { store, env: {} })
    expect(b.status).toBe('failed')
  })
})

describe('executeRun in container mode (fake runtime)', () => {
  it('runs a fake subject through the runtime and stores the report', async () => {
    const store = createRunStore()
    const run = store.createRun('s')
    const rt = createFakeRuntime()
    let req: unknown
    rt.scriptExec(({ files }) => {
      req = JSON.parse(Buffer.from(files.get('/work/in/request.json') as Uint8Array).toString('utf8'))
      files.set('/work/out/report.json', enc.encode(reportJson))
      return 0
    })
    await executeRun(
      run.id,
      { subject: 'fake:good', cases: ['T1-STD-CATALOG'], reruns: 2 },
      { store, env: { MCP_TESTER_RUNTIME: 'container' }, runtimeFactory: () => rt, driverTree: tree }
    )
    expect(run.status).toBe('done')
    expect(run.report).toBe(reportJson)
    expect(DriverRequestSchema.parse(req)).toEqual({
      v: 1,
      subject: { kind: 'fake', variant: 'good' },
      cases: ['T1-STD-CATALOG'],
      reruns: 2
    })
    expect(rt.containers()).toEqual([])
  })

  it('stages the generated package for a generator subject', async () => {
    const store = createRunStore()
    const run = store.createRun('s')
    const rt = createFakeRuntime()
    let req: ReturnType<typeof DriverRequestSchema.parse> | undefined
    let pkgFiles: string[] = []
    rt.scriptExec(({ files }) => {
      req = DriverRequestSchema.parse(JSON.parse(Buffer.from(files.get('/work/in/request.json') as Uint8Array).toString('utf8')))
      pkgFiles = [...files.keys()].filter((k) => k.startsWith('/work/pkg/'))
      files.set('/work/out/report.json', enc.encode(reportJson))
      return 0
    })
    await executeRun(
      run.id,
      { subject: 'generator:openapi', cases: ['T2-CATALOG-API', 'T4-PARTIAL-SPEC'] },
      { store, env: { MCP_TESTER_RUNTIME: 'container' }, runtimeFactory: () => rt, driverTree: tree }
    )
    expect(run.status).toBe('done')
    expect(req!.subject.kind).toBe('staged')
    expect(req!.cases).toEqual(['T2-CATALOG-API'])
    expect(pkgFiles.some((f) => f.endsWith('server.py'))).toBe(true)
  })

  it('records a failed run with a redacted short message when the engine is down', async () => {
    const store = createRunStore()
    const run = store.createRun('s')
    const rt = createFakeRuntime()
    rt.failNext('ensureNetwork', Object.assign(new Error('sock /run/user/1000/podman.sock'), { name: 'TryItOutRuntimeError', code: 'engine_unavailable' }))
    await executeRun(
      run.id,
      { subject: 'fake:good' },
      { store, env: { MCP_TESTER_RUNTIME: 'container' }, runtimeFactory: () => rt, driverTree: tree }
    )
    expect(run.status).toBe('failed')
    expect(run.error).toBe('container engine unavailable')
  })

  it('records a failed run when the runtime factory throws', async () => {
    const store = createRunStore()
    const run = store.createRun('s')
    await executeRun(
      run.id,
      { subject: 'fake:good' },
      {
        store,
        env: { MCP_TESTER_RUNTIME: 'container' },
        runtimeFactory: () => {
          throw new Error('no engine key sk-abcdef123456')
        },
        driverTree: tree
      }
    )
    expect(run.status).toBe('failed')
    expect(run.error).not.toContain('sk-abcdef123456')
  })
})

describe('startRun', () => {
  it('is fire-and-forget and records executor failures on the run', async () => {
    const store = createRunStore()
    const run = store.createRun('s')
    __setExecutorForTests(() => Promise.reject(new Error('executor exploded')))
    startRun(run.id, { subject: 'fake:good' }, store)
    await new Promise((r) => setTimeout(r, 10))
    expect(run.status).toBe('failed')
    __setExecutorForTests(null)
  })
})
