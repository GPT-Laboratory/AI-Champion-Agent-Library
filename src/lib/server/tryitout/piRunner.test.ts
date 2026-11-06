import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unzipSync, strFromU8 } from 'fflate'
import { readFile } from 'node:fs/promises'

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
let runJobInContainer: typeof import('./piRunner').runJobInContainer
let svcMod: typeof import('./service')
let fakeMod: typeof import('./runtimeFake')
let cfgMod: typeof import('./runnerConfig')
let proxy: typeof import('./llmProxy')
let fx: typeof import('./piFixtures')
let cleanupTimeoutMs = 0

const SLUG = 'demo-rfi-triage'

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'tryitout-pirunner-test-'))
  process.env.TRYITOUT_WORK_DIR = tmpDir
  jobsMod = await import('../tryItOutJobs')
  ;({ runJobInContainer } = await import('./piRunner'))
  svcMod = await import('./service')
  fakeMod = await import('./runtimeFake')
  cfgMod = await import('./runnerConfig')
  proxy = await import('./llmProxy')
  fx = await import('./piFixtures')
  cleanupTimeoutMs = (await import('./piRunner')).CLEANUP_TIMEOUT_MS + 10
})

afterAll(async () => {
  delete process.env.TRYITOUT_WORK_DIR
  await rm(tmpDir, { recursive: true, force: true })
})

beforeEach(() => {
  jobsMod.__resetJobs()
  proxy.__resetProxy()
})

afterEach(() => {
  vi.useRealTimers()
  svcMod.__setTryItOutServiceForTests(null)
})

function setup(env: Record<string, string> = {}) {
  const runtime: Fake = fakeMod.createFakeRuntime()
  const config = cfgMod.parseRunnerConfig(env)
  const svc = svcMod.createTryItOutService({ runtime, config, instanceId: 't' })
  svcMod.__setTryItOutServiceForTests(svc)
  return { runtime, svc }
}

type Script = (ctx: Parameters<Parameters<Fake['scriptExec']>[0]>[0]) => number | null | Promise<number | null>

function scriptPi(runtime: Fake, onPi: Script, calls: string[][] = []) {
  runtime.scriptExec((ctx) => {
    calls.push(ctx.cmd)
    if (ctx.cmd[0] === 'timeout') return onPi(ctx)
    if (ctx.cmd[0] === 'rm') {
      for (const k of [...ctx.files.keys()]) if (k.startsWith(ctx.cmd[2])) ctx.files.delete(k)
    }
    return 0
  })
  return calls
}

function newJob(session = 'anon:s1') {
  const job = jobsMod.createJob(SLUG, 'triage this', null, session)
  jobsMod.setStatus(job.jobId, 'running')
  return job
}

const enc = new TextEncoder()
function writeOut(ctx: Parameters<Script>[0], name: string, text: string) {
  ctx.files.set(`${ctx.workingDir}/output/${name}`, enc.encode(text))
}

describe('runJobInContainer failure modes', () => {
  it('model error with exit 0 fails with the model error and writes no artifact', async () => {
    const { runtime } = setup()
    scriptPi(runtime, (ctx) => {
      ctx.stdout(fx.PI_MODEL_ERROR_STREAM)
      return 0
    })
    const job = newJob()
    await runJobInContainer(job.jobId)
    const j = jobsMod.getJob(job.jobId)!
    expect(j.status).toBe('failed')
    expect(j.error).toBe('401 invalid token')
    await expect(readFile(jobsMod.artifactZipPath(job.jobId))).rejects.toThrow()
  })

  it('model error: retry failure stream reports the final error', async () => {
    const { runtime } = setup()
    scriptPi(runtime, (ctx) => {
      ctx.stdout(fx.PI_RETRY_FAILURE_STREAM)
      return 0
    })
    const job = newJob()
    await runJobInContainer(job.jobId)
    expect(jobsMod.getJob(job.jobId)!.error).toBe('rate limited after 3 attempts')
  })

  it('non-zero exit does not expose the stderr tail to the job (WR-06)', async () => {
    const { runtime } = setup()
    scriptPi(runtime, (ctx) => {
      ctx.stderr('fatal: x')
      return 1
    })
    const job = newJob()
    await runJobInContainer(job.jobId)
    const j = jobsMod.getJob(job.jobId)!
    expect(j.status).toBe('failed')
    expect(j.error).toBe('pi exited with code 1')
    expect(j.error).not.toContain('fatal: x')
  })

  it('engine errors are replaced by a generic message and never carry socket/image detail (WR-06)', async () => {
    const { runtime, svc } = setup()
    scriptPi(runtime, () => 0)
    await svc.leases.ensureWarm('anon:s1', SLUG)
    const { TryItOutRuntimeError } = await import('./runtime')
    runtime.failNext(
      'putFiles',
      new TryItOutRuntimeError('container_start_failed', 'image pi-runner not found at /run/user/1000/podman/podman.sock'),
    )
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const job = newJob()
    await runJobInContainer(job.jobId)
    const j = jobsMod.getJob(job.jobId)!
    expect(j.status).toBe('failed')
    expect(j.error).toBe('container engine error')
    expect(errSpy.mock.calls.flat().join(' ')).toContain('podman.sock')
    errSpy.mockRestore()
  })

  it('timeout (exit 137 after the limit) fails with a timeout message and discards the container', async () => {
    const { runtime, svc } = setup({ PI_RUNNER_JOB_TIMEOUT_MS: '1000' })
    expect(svc.config.jobTimeoutMs).toBe(1000)
    scriptPi(runtime, async () => {
      await new Promise((r) => setTimeout(r, svc.config.jobTimeoutMs + 20))
      return 137
    })
    const job = newJob()
    await runJobInContainer(job.jobId)
    const j = jobsMod.getJob(job.jobId)!
    expect(j.status).toBe('failed')
    expect(j.error).toMatch(/^timeout after /)
    expect(runtime.containers()).toHaveLength(0)
    expect(svc.leases.snapshot()).toHaveLength(0)
  })

  it('timeout: a hung exec stream is cut by the app-side timer, which discards the container', async () => {
    vi.useFakeTimers()
    const { runtime, svc } = setup({ PI_RUNNER_JOB_TIMEOUT_MS: '1000' })
    scriptPi(runtime, () => new Promise<number | null>(() => {}))
    const job = newJob()
    const run = runJobInContainer(job.jobId)
    await vi.advanceTimersByTimeAsync(10)
    await vi.advanceTimersByTimeAsync(svc.config.jobTimeoutMs + 6000)
    await run
    const j = jobsMod.getJob(job.jobId)!
    expect(j.status).toBe('failed')
    expect(j.error).toMatch(/^timeout after /)
    expect(runtime.containers()).toHaveLength(0)
  })

  it('budget exceeded fails with the budget message', async () => {
    const { runtime } = setup()
    scriptPi(runtime, (ctx) => {
      // Burn the per-job request budget through the usage record directly.
      const usage = proxy.getJobUsage(ctx.workingDir.split('/').pop()!)
      expect(usage).not.toBeNull()
      usage!.budgetExceeded = true
      usage!.requests = 7
      usage!.totalTokens = 1234
      ctx.stdout(fx.PI_MODEL_ERROR_STREAM)
      return 0
    })
    const job = newJob()
    await runJobInContainer(job.jobId)
    const j = jobsMod.getJob(job.jobId)!
    expect(j.status).toBe('failed')
    expect(j.error).toContain('budget')
    expect(j.error).toBe('job token budget exceeded (1234 tokens, 7 requests)')
  })

  it('empty output with final assistant text succeeds with result.txt', async () => {
    const { runtime } = setup()
    scriptPi(runtime, (ctx) => {
      ctx.stdout(
        [
          { type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'Answer' }], stopReason: 'stop' } },
          { type: 'agent_settled' },
        ]
          .map((r) => JSON.stringify(r))
          .join('\n') + '\n',
      )
      return 0
    })
    const job = newJob()
    await runJobInContainer(job.jobId)
    const j = jobsMod.getJob(job.jobId)!
    expect(j.status).toBe('succeeded')
    const entries = unzipSync(new Uint8Array(await readFile(jobsMod.artifactZipPath(job.jobId))))
    expect(strFromU8(entries['result.txt'])).toBe('Answer')
  })

  it('empty output and no assistant text fails', async () => {
    const { runtime } = setup()
    scriptPi(runtime, (ctx) => {
      ctx.stdout(JSON.stringify({ type: 'agent_settled' }) + '\n')
      return 0
    })
    const job = newJob()
    await runJobInContainer(job.jobId)
    const j = jobsMod.getJob(job.jobId)!
    expect(j.status).toBe('failed')
    expect(j.error).toBe('agent finished without producing output')
  })

  it('getFiles output_invalid fails with that message and releases the lease', async () => {
    const { runtime, svc } = setup()
    scriptPi(runtime, (ctx) => {
      ctx.stdout(fx.PI_SUCCESS_STREAM)
      return 0
    })
    runtime.failNext(
      'getFiles',
      new (await import('./runtime')).TryItOutRuntimeError('output_invalid', 'output exceeds 1 files'),
    )
    const job = newJob()
    await runJobInContainer(job.jobId)
    const j = jobsMod.getJob(job.jobId)!
    expect(j.status).toBe('failed')
    expect(j.error).toBe('output exceeds 1 files')
    expect(svc.leases.snapshot()[0].state).toBe('idle')
  })

  it('putFiles failure after claim fails the job, discards the lease and does not rethrow', async () => {
    const { runtime, svc } = setup()
    scriptPi(runtime, () => 0)
    // Warm staging also uses putFiles; let it pass, then fail the job staging call.
    await svc.leases.ensureWarm('anon:s1', SLUG)
    runtime.failNext('putFiles', new Error('disk full'))
    const job = newJob()
    await expect(runJobInContainer(job.jobId)).resolves.toBeUndefined()
    const j = jobsMod.getJob(job.jobId)!
    expect(j.status).toBe('failed')
    expect(j.error).toBe('disk full')
    expect(svc.leases.snapshot()).toHaveLength(0)
  })
})

describe('runJobInContainer cleanup and reuse', () => {
  it('cleanup: removes /work/<jobId>, returns the lease to idle, and reuses the container for the next job', async () => {
    const { runtime, svc } = setup()
    const calls = scriptPi(runtime, (ctx) => {
      writeOut(ctx, 'result.txt', 'ok')
      ctx.stdout(fx.PI_SUCCESS_STREAM)
      return 0
    })
    const a = newJob()
    await runJobInContainer(a.jobId)
    expect(jobsMod.getJob(a.jobId)!.status).toBe('succeeded')
    expect(calls).toContainEqual(['rm', '-rf', `/work/${a.jobId}`])
    expect(svc.leases.snapshot()[0].state).toBe('idle')
    const firstContainer = runtime.containers()[0]

    const b = newJob()
    await runJobInContainer(b.jobId)
    expect(jobsMod.getJob(b.jobId)!.status).toBe('succeeded')
    expect(runtime.containers()).toEqual([firstContainer])
    expect(jobsMod.getJob(b.jobId)!.events.some((e) => e.summary === 'using warm container')).toBe(true)
    expect([...runtime.filesOf(firstContainer).keys()].filter((k) => k.startsWith('/work/'))).toEqual([])
  })

  it('WR-02: a hung cleanup exec times out, keeps the recorded result and discards the lease', async () => {
    vi.useFakeTimers()
    let rmStarted = false
    const { runtime, svc } = setup()
    runtime.scriptExec((ctx) => {
      if (ctx.cmd[0] === 'timeout') {
        writeOut(ctx, 'result.txt', 'ok')
        ctx.stdout(fx.PI_SUCCESS_STREAM)
        return 0
      }
      if (ctx.cmd[0] === 'rm') {
        rmStarted = true
        return new Promise<number | null>(() => {}) // engine stalls
      }
      return 0
    })
    const job = newJob()
    let done = false
    const run = runJobInContainer(job.jobId).then(() => {
      done = true
    })
    await vi.waitFor(() => expect(rmStarted).toBe(true))
    expect(done).toBe(false) // waiting on the stalled cleanup
    await vi.advanceTimersByTimeAsync(cleanupTimeoutMs)
    await run
    expect(jobsMod.getJob(job.jobId)!.status).toBe('succeeded')
    expect(svc.leases.snapshot()).toHaveLength(0) // discarded, not stuck in running
    expect(runtime.containers()).toHaveLength(0)
  })

  it('WR-02: a failing cleanup exec discards the lease instead of releasing it', async () => {
    const { runtime, svc } = setup()
    runtime.scriptExec((ctx) => {
      if (ctx.cmd[0] === 'timeout') {
        writeOut(ctx, 'result.txt', 'ok')
        ctx.stdout(fx.PI_SUCCESS_STREAM)
        return 0
      }
      if (ctx.cmd[0] === 'rm') throw new Error('engine hiccup')
      return 0
    })
    const job = newJob()
    await runJobInContainer(job.jobId)
    expect(jobsMod.getJob(job.jobId)!.status).toBe('succeeded')
    expect(svc.leases.snapshot()).toHaveLength(0)
  })

  it('reuse: a second job while the first runs fails with session_busy', async () => {
    const { runtime } = setup()
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => (release = r))
    scriptPi(runtime, async (ctx) => {
      writeOut(ctx, 'result.txt', 'ok')
      ctx.stdout(fx.PI_SUCCESS_STREAM)
      await gate
      return 0
    })
    const a = newJob()
    const running = runJobInContainer(a.jobId)
    await vi.waitFor(() => expect(jobsMod.getJob(a.jobId)!.events.some((e) => e.summary === 'starting pi…')).toBe(true))
    const b = newJob()
    await expect(runJobInContainer(b.jobId)).rejects.toMatchObject({ code: 'session_busy' })
    release()
    await running
    expect(jobsMod.getJob(a.jobId)!.status).toBe('succeeded')
  })
})
