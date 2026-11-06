// Phase 9 chaos: hung and failing container engine. Fake runtime + fake timers only.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('../tryItOutPrompts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../tryItOutPrompts')>()
  return {
    ...actual,
    loadPiSkill: vi.fn(async (slug: string) => ({
      basePrompt: 'BASE',
      skillMarkdown: `---\nname: ${slug}\ndescription: d\n---\nBODY`,
    })),
  }
})

type Fake = import('./runtimeFake').FakeRuntime
let tmpDir: string
let jobsMod: typeof import('../tryItOutJobs')
let piRunnerMod: typeof import('./piRunner')
let svcMod: typeof import('./service')
let fakeMod: typeof import('./runtimeFake')
let cfgMod: typeof import('./runnerConfig')
let proxy: typeof import('./llmProxy')
let rtMod: typeof import('./runtime')
let leaseMod: typeof import('./leaseManager')

const SLUG = 'demo-rfi-triage'

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'tryitout-chaos-engine-'))
  process.env.TRYITOUT_WORK_DIR = tmpDir
  jobsMod = await import('../tryItOutJobs')
  piRunnerMod = await import('./piRunner')
  svcMod = await import('./service')
  fakeMod = await import('./runtimeFake')
  cfgMod = await import('./runnerConfig')
  proxy = await import('./llmProxy')
  rtMod = await import('./runtime')
  leaseMod = await import('./leaseManager')
})

afterAll(async () => {
  delete process.env.TRYITOUT_WORK_DIR
  await rm(tmpDir, { recursive: true, force: true })
})

beforeEach(() => {
  jobsMod.__resetJobs()
  proxy.__resetProxy()
  vi.useFakeTimers()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  svcMod.__setTryItOutServiceForTests(null)
})

function setup(env: Record<string, string> = {}) {
  const runtime: Fake = fakeMod.createFakeRuntime()
  const config = cfgMod.parseRunnerConfig(env)
  const svc = svcMod.createTryItOutService({ runtime, config, instanceId: 't' })
  svcMod.__setTryItOutServiceForTests(svc)
  return { runtime, svc }
}

function newJob(session = 'anon:s1') {
  const job = jobsMod.createJob(SLUG, 'triage this', null, session)
  jobsMod.setStatus(job.jobId, 'running')
  return job
}

/** Records when a promise settles so tests can assert "not yet" and "now". */
function track<T>(p: Promise<T>) {
  const state = { done: false, value: undefined as T | undefined, error: undefined as unknown }
  p.then(
    (v) => {
      state.done = true
      state.value = v
    },
    (e) => {
      state.done = true
      state.error = e
    },
  )
  return state
}

describe('chaos: hung engine during warm-up', () => {
  it('createAndStart never resolves: caller gets a bounded error, reaper frees the slot, late create self-cleans', async () => {
    const { runtime, svc } = setup({ PI_RUNNER_MAX_CONTAINERS: '1' })
    const warmWait = svc.config.warmWaitMs
    const release = runtime.hang('createAndStart')
    const claim = track(svc.leases.claim('S1', SLUG))

    await vi.advanceTimersByTimeAsync(warmWait - 1)
    expect(claim.done).toBe(false)
    await vi.advanceTimersByTimeAsync(2)
    expect(claim.done).toBe(true)
    expect(claim.error).toMatchObject({ code: 'container_start_failed' })

    // Slot still held (warming) until the stall bound of 2x warmWaitMs.
    expect(svc.leases.snapshot()).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(warmWait) // now t = 2x warmWait + 1
    await svc.leases.reap()
    expect(svc.leases.snapshot()).toHaveLength(0)

    // The hung create finally answers: its container must be removed, not leaked.
    release()
    await vi.advanceTimersByTimeAsync(10)
    expect(runtime.containers()).toHaveLength(0)

    // And the freed cap slot is usable by another session.
    const other = await svc.leases.ensureWarm('S2', SLUG)
    expect(typeof other).not.toBe('string')
    expect(runtime.containers()).toHaveLength(1)
  })

  it('stage (putFiles) hangs during warm-up: bounded outcome, lease reaped, container removed on late answer', async () => {
    const { runtime, svc } = setup({ PI_RUNNER_MAX_CONTAINERS: '1' })
    const warmWait = svc.config.warmWaitMs
    const release = runtime.hang('putFiles')
    const claim = track(svc.leases.claim('S1', SLUG))
    await vi.advanceTimersByTimeAsync(warmWait + 1)
    expect(claim.done).toBe(true)
    expect(claim.error).toMatchObject({ code: 'container_start_failed' })
    expect(runtime.containers()).toHaveLength(1) // created, staging stuck

    await vi.advanceTimersByTimeAsync(warmWait)
    await svc.leases.reap()
    expect(svc.leases.snapshot()).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(10)
    expect(runtime.containers()).toHaveLength(0) // reaper removed the stuck container

    release() // late staging answer must not resurrect anything
    await vi.advanceTimersByTimeAsync(10)
    expect(svc.leases.snapshot()).toHaveLength(0)
    expect(runtime.containers()).toHaveLength(0)
  })
})

describe('chaos: hung engine during a job', () => {
  it('putFiles hangs while staging the job: job fails at ENGINE_CALL_TIMEOUT_MS and the lease is discarded', async () => {
    const { runtime, svc } = setup()
    const lease = await svc.leases.ensureWarm('anon:s1', SLUG)
    expect(typeof lease).not.toBe('string')
    runtime.hang('putFiles')
    const job = newJob()
    const run = track(piRunnerMod.runJobInContainer(job.jobId))

    await vi.advanceTimersByTimeAsync(piRunnerMod.ENGINE_CALL_TIMEOUT_MS - 1)
    expect(run.done).toBe(false)
    await vi.advanceTimersByTimeAsync(2)
    await vi.advanceTimersByTimeAsync(10)
    expect(run.done).toBe(true)
    const j = jobsMod.getJob(job.jobId)!
    expect(j.status).toBe('failed')
    expect(j.error).toBe('container engine error')
    expect(svc.leases.snapshot()).toHaveLength(0)
    expect(runtime.containers()).toHaveLength(0)
  })

  it('exec never resolves: settles at jobTimeoutMs + TIMEOUT_GRACE_MS, job failed, container discarded', async () => {
    const { runtime, svc } = setup({ PI_RUNNER_JOB_TIMEOUT_MS: '1000' })
    runtime.scriptExec((ctx) => (ctx.cmd[0] === 'timeout' ? new Promise<number | null>(() => {}) : 0))
    const job = newJob()
    const run = track(piRunnerMod.runJobInContainer(job.jobId))
    const bound = svc.config.jobTimeoutMs + piRunnerMod.TIMEOUT_GRACE_MS
    await vi.advanceTimersByTimeAsync(bound - 100)
    expect(run.done).toBe(false)
    await vi.advanceTimersByTimeAsync(200)
    expect(run.done).toBe(true)
    const j = jobsMod.getJob(job.jobId)!
    expect(j.status).toBe('failed')
    expect(j.error).toMatch(/^timeout after /)
    expect(svc.leases.snapshot()).toHaveLength(0)
    expect(runtime.containers()).toHaveLength(0)
  })

  it('cleanup exec hangs: settles at CLEANUP_TIMEOUT_MS and discards the lease (WR-02)', async () => {
    const { runtime, svc } = setup()
    runtime.scriptExec((ctx) => {
      if (ctx.cmd[0] === 'rm') return new Promise<number | null>(() => {})
      if (ctx.cmd[0] === 'timeout') return 1 // pi failed: no artifact, goes straight to cleanup
      return 0
    })
    const job = newJob()
    const run = track(piRunnerMod.runJobInContainer(job.jobId))
    await vi.advanceTimersByTimeAsync(piRunnerMod.CLEANUP_TIMEOUT_MS - 100)
    expect(run.done).toBe(false)
    await vi.advanceTimersByTimeAsync(200)
    expect(run.done).toBe(true)
    expect(jobsMod.getJob(job.jobId)!.status).toBe('failed')
    expect(svc.leases.snapshot()).toHaveLength(0)
    expect(runtime.containers()).toHaveLength(0)
  })

  it('getFiles hangs after a clean pi run: job fails at ENGINE_CALL_TIMEOUT_MS, lease discarded', async () => {
    const { runtime, svc } = setup()
    runtime.scriptExec((ctx) => {
      if (ctx.cmd[0] === 'timeout') {
        ctx.stdout(
          [
            { type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }], stopReason: 'stop' } },
            { type: 'agent_settled' },
          ]
            .map((r) => JSON.stringify(r))
            .join('\n') + '\n',
        )
      }
      return 0
    })
    runtime.hang('getFiles')
    const job = newJob()
    const run = track(piRunnerMod.runJobInContainer(job.jobId))
    await vi.advanceTimersByTimeAsync(piRunnerMod.ENGINE_CALL_TIMEOUT_MS + 100)
    expect(run.done).toBe(true)
    expect(jobsMod.getJob(job.jobId)!.status).toBe('failed')
    expect(svc.leases.snapshot()).toHaveLength(0)
  })
})

describe('chaos: failing eviction', () => {
  it('remove() hangs: discard settles at REMOVE_TIMEOUT_MS, lease terminal, cap slot free', async () => {
    const { runtime, svc } = setup({ PI_RUNNER_MAX_CONTAINERS: '1' })
    const l = await svc.leases.ensureWarm('S1', SLUG)
    if (typeof l === 'string') throw new Error(l)
    runtime.hang('remove')
    const discard = track(svc.leases.discard(l))
    expect(svc.leases.snapshot()).toHaveLength(0) // slot freed synchronously
    expect(l.state).toBe('evicting')
    await vi.advanceTimersByTimeAsync(leaseMod.REMOVE_TIMEOUT_MS - 1)
    expect(discard.done).toBe(false)
    await vi.advanceTimersByTimeAsync(2)
    expect(discard.done).toBe(true)
    expect(discard.error).toBeUndefined()
  })

  it('remove() rejects: lease still terminal, cap slot freed, no unhandled rejection', async () => {
    const { runtime, svc } = setup({ PI_RUNNER_MAX_CONTAINERS: '1' })
    const l = await svc.leases.ensureWarm('S1', SLUG)
    if (typeof l === 'string') throw new Error(l)
    runtime.failNext('remove', new rtMod.TryItOutRuntimeError('engine_unavailable', 'sock gone'))
    await svc.leases.discard(l)
    expect(svc.leases.snapshot()).toHaveLength(0)
    const next = await svc.leases.ensureWarm('S2', SLUG)
    expect(typeof next).not.toBe('string')
  })

  it('shutdown with a hung remove still returns within its cap', async () => {
    const { runtime, svc } = setup()
    await svc.leases.ensureWarm('S1', SLUG)
    runtime.hang('remove')
    const done = track(svc.leases.shutdown())
    await vi.advanceTimersByTimeAsync(3_001)
    expect(done.done).toBe(true)
  })
})

describe('chaos: engine unreachable at startup (WR-03)', () => {
  it('startTryItOutService returns, runs the reaper, and creation is refused until the guard succeeds', async () => {
    const { runtime, svc } = setup()
    const before = new Set(process.listeners('SIGTERM'))
    const beforeInt = new Set(process.listeners('SIGINT'))
    const down = new rtMod.TryItOutRuntimeError('engine_unavailable', 'engine down')
    for (let i = 0; i < 6; i++) runtime.failNext('ping', down)
    runtime.failNext('ensureNetwork', down)

    expect(() => svcMod.startTryItOutService()).not.toThrow()
    expect(vi.getTimerCount()).toBeGreaterThan(0) // reaper interval is armed
    await vi.advanceTimersByTimeAsync(5)

    // First create attempt hits the failing network guard and is refused: no container exists.
    await expect(svc.leases.claim('S1', SLUG)).rejects.toMatchObject({ code: 'engine_unavailable' })
    expect(runtime.containers()).toHaveLength(0)

    // Guard recovers on the next call (failed result is not cached).
    const { lease } = await svc.leases.claim('S1', SLUG)
    expect(lease.state).toBe('claimed')
    expect(runtime.containers()).toHaveLength(1)

    svc.leases.release(lease)
    await svc.leases.shutdown()
    await vi.advanceTimersByTimeAsync(60_000)
    for (const f of process.listeners('SIGTERM')) if (!before.has(f)) process.off('SIGTERM', f)
    for (const f of process.listeners('SIGINT')) if (!beforeInt.has(f)) process.off('SIGINT', f)
  })
})

describe('chaos: engine error text never reaches the visitor', () => {
  it('a runtime error with socket/image detail yields only the fixed message in job.error and events', async () => {
    const { runtime, svc } = setup()
    await svc.leases.ensureWarm('anon:s1', SLUG)
    runtime.failNext(
      'exec',
      new rtMod.TryItOutRuntimeError('exec_failed', 'no such image localhost/pi-runner at /run/user/1000/podman/podman.sock'),
    )
    const job = newJob()
    await piRunnerMod.runJobInContainer(job.jobId)
    const j = jobsMod.getJob(job.jobId)!
    expect(j.status).toBe('failed')
    expect(j.error).toBe('container engine error')
    const visible = JSON.stringify(j)
    expect(visible).not.toContain('podman.sock')
    expect(visible).not.toContain('pi-runner')
  })

  it('a key-like string in a plain error is redacted', async () => {
    const { runtime, svc } = setup()
    await svc.leases.ensureWarm('anon:s1', SLUG)
    runtime.failNext('exec', new Error('upstream said Bearer abcdefgh12345678 and sk-proj-ABCDEF123456'))
    const job = newJob()
    await piRunnerMod.runJobInContainer(job.jobId)
    const visible = JSON.stringify(jobsMod.getJob(job.jobId))
    expect(visible).not.toContain('abcdefgh12345678')
    expect(visible).not.toContain('sk-proj-ABCDEF123456')
  })
})
