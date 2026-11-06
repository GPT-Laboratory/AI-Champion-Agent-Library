// Review fixes WR-03 and WR-08: active runs survive the TTL sweep, MCPTEST_JOB_TIMEOUT_MS is honoured, and a run
// has an overall deadline (abort signal first, then a hard fail) so it cannot hold the single-flight slot.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRunStore } from './jobs'

const hoisted = vi.hoisted(() => ({
  runSuite: vi.fn(),
  runInContainer: vi.fn()
}))
vi.mock('$lib/mcptest/core/runner', async (orig) => ({ ...(await orig<typeof import('$lib/mcptest/core/runner')>()), runSuite: hoisted.runSuite }))
vi.mock('./containerRun', async (orig) => ({ ...(await orig<typeof import('./containerRun')>()), runInContainer: hoisted.runInContainer }))

import { DEFAULT_JOB_TIMEOUT_MS, executeRun, jobTimeoutMs } from './service'

function mk() {
  const clock = { t: 1_000_000 }
  const store = createRunStore({ ttlMs: 1000, maxRuns: 50, now: () => clock.t })
  return { store, clock }
}

beforeEach(() => {
  hoisted.runSuite.mockReset()
  hoisted.runInContainer.mockReset()
})

describe('TTL eviction keeps active runs (WR-03)', () => {
  it('a running run older than the TTL is still there and still holds the slot', () => {
    const { store, clock } = mk()
    const r = store.createRun('s')
    store.setStatus(r.id, 'running')
    clock.t += 10_000
    expect(store.getRun(r.id)).not.toBeNull()
    expect(store.activeCount()).toBe(1)
    expect(store.tryAcquire('other')).toBe(false)
  })

  it('a queued run is kept too, and a finished run past the TTL is evicted', () => {
    const { store, clock } = mk()
    const r = store.createRun('s')
    clock.t += 10_000
    expect(store.getRun(r.id)).not.toBeNull()
    store.setStatus(r.id, 'done')
    expect(store.getRun(r.id)).toBeNull() // finished and past the TTL: the next sweep removes it
  })
})

describe('job timeout (WR-08)', () => {
  it('jobTimeoutMs reads MCPTEST_JOB_TIMEOUT_MS and falls back to the default', () => {
    expect(jobTimeoutMs({ MCPTEST_JOB_TIMEOUT_MS: '45000' })).toBe(45000)
    expect(jobTimeoutMs({})).toBe(DEFAULT_JOB_TIMEOUT_MS)
    expect(jobTimeoutMs({ MCPTEST_JOB_TIMEOUT_MS: 'soon' })).toBe(DEFAULT_JOB_TIMEOUT_MS)
  })

  it('container mode passes the configured timeout to runInContainer', async () => {
    hoisted.runInContainer.mockResolvedValue({ ok: false, code: 'timeout', message: 'the container run timed out' })
    const { store } = mk()
    const r = store.createRun('s')
    await executeRun(r.id, { subject: 'fake:good', cases: ['T1-STD-CATALOG'] }, { store, env: { MCP_TESTER_RUNTIME: 'container', MCPTEST_JOB_TIMEOUT_MS: '45000' }, runtimeFactory: () => ({}) as never })
    expect(hoisted.runInContainer).toHaveBeenCalledTimes(1)
    expect(hoisted.runInContainer.mock.calls[0][3]).toMatchObject({ timeoutMs: 45000 })
    expect(store.getRun(r.id)?.status).toBe('failed')
  })

  it('container mode defaults to the runner-config budget', async () => {
    hoisted.runInContainer.mockResolvedValue({ ok: false, code: 'timeout', message: 'x' })
    const { store } = mk()
    const r = store.createRun('s')
    await executeRun(r.id, { subject: 'fake:good', cases: ['T1-STD-CATALOG'] }, { store, env: { MCP_TESTER_RUNTIME: 'container' }, runtimeFactory: () => ({}) as never })
    expect(hoisted.runInContainer.mock.calls[0][3]).toMatchObject({ timeoutMs: DEFAULT_JOB_TIMEOUT_MS })
  })
})

describe('overall deadline for in-process runs (WR-03)', () => {
  it('aborts the signal passed to runSuite at the budget; the INCOMPLETE report is kept', async () => {
    let seen: AbortSignal | undefined
    hoisted.runSuite.mockImplementation(
      (o: { signal: AbortSignal }) =>
        new Promise((resolve) => {
          seen = o.signal
          o.signal.addEventListener('abort', () => resolve({ summary: { verdict: 'INCOMPLETE' } }))
        })
    )
    const { store } = mk()
    const r = store.createRun('s')
    const t0 = Date.now()
    await executeRun(r.id, { subject: 'fake:good', cases: ['T1-STD-CATALOG'] }, { store, env: { MCPTEST_JOB_TIMEOUT_MS: '1000' } })
    expect(Date.now() - t0).toBeGreaterThanOrEqual(900)
    expect(seen?.aborted).toBe(true)
    expect(store.getRun(r.id)?.status).toBe('done')
    expect(store.getRun(r.id)?.report).toContain('INCOMPLETE')
  }, 15_000)

  it('fails the run after the hard grace when the work ignores the signal, and drops its late result', async () => {
    let finish: (v: unknown) => void = () => {}
    hoisted.runSuite.mockImplementation(() => new Promise((resolve) => (finish = resolve)))
    const { store } = mk()
    const r = store.createRun('s')
    await executeRun(r.id, { subject: 'fake:good', cases: ['T1-STD-CATALOG'] }, { store, env: { MCPTEST_JOB_TIMEOUT_MS: '1000' }, hardGraceMs: 50 })
    const rec = store.getRun(r.id)
    expect(rec?.status).toBe('failed')
    expect(rec?.error).toMatch(/time limit/)
    expect(store.activeCount()).toBe(0)
    finish({ summary: { verdict: 'PASS' } })
    await new Promise((res) => setTimeout(res, 20))
    expect(store.getRun(r.id)?.status).toBe('failed')
    expect(store.getRun(r.id)?.report).toBeNull()
  }, 15_000)

  it('a run that finishes in time is untouched and its timers are cleared', async () => {
    hoisted.runSuite.mockResolvedValue({ summary: { verdict: 'PASS' } })
    const { store } = mk()
    const r = store.createRun('s')
    await executeRun(r.id, { subject: 'fake:good', cases: ['T1-STD-CATALOG'] }, { store, env: { MCPTEST_JOB_TIMEOUT_MS: '1000' } })
    expect(store.getRun(r.id)?.status).toBe('done')
  })
})
