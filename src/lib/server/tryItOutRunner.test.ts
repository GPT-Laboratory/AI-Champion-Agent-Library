import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

// Hoisted so the vi.mock factory below (which itself is hoisted above all
// imports) can reference these.
const { mockCreate, OpenAICtorSpy } = vi.hoisted(() => {
  return { mockCreate: vi.fn(), OpenAICtorSpy: vi.fn() }
})

vi.mock('openai', () => {
  return {
    default: class MockOpenAI {
      responses = { create: mockCreate }
      constructor(...args: unknown[]) {
        OpenAICtorSpy(...args)
      }
    },
  }
})

vi.mock('./tryItOutPrompts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./tryItOutPrompts')>()
  return {
    ...actual,
    loadPromptFor: vi.fn(async (agentId: string) => ({
      basePrompt: `BASE PROMPT for ${agentId}`,
      skill: `SKILL TEXT for ${agentId}`,
    })),
  }
})

// These are populated in beforeAll, AFTER TRYITOUT_WORK_DIR is pointed at a
// throwaway tmpdir — tryItOutJobs.ts reads that env var once at module load,
// so the module must be imported (dynamically) only after the env var is set.
let tmpDir: string
let jobsMod: typeof import('./tryItOutJobs')
let promptsMod: typeof import('./tryItOutPrompts')
let runJob: typeof import('./tryItOutRunner').runJob
let runDirectLlmJob: typeof import('./tryItOutRunner').runJob
let svcMod: typeof import('./tryitout/service')
let rtMod: typeof import('./tryitout/runtime')
let fakeMod: typeof import('./tryitout/runtimeFake')
let cfgMod: typeof import('./tryitout/runnerConfig')

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'tryitout-runner-test-'))
  process.env.TRYITOUT_WORK_DIR = tmpDir
  delete process.env.OPENAI_API_KEY // prove import-without-key never throws

  jobsMod = await import('./tryItOutJobs')
  promptsMod = await import('./tryItOutPrompts')
  ;({ runJob, runDirectLlmJob } = await import('./tryItOutRunner'))
  svcMod = await import('./tryitout/service')
  rtMod = await import('./tryitout/runtime')
  fakeMod = await import('./tryitout/runtimeFake')
  cfgMod = await import('./tryitout/runnerConfig')
})

afterAll(async () => {
  delete process.env.TRYITOUT_WORK_DIR
  await rm(tmpDir, { recursive: true, force: true })
})

beforeEach(() => {
  jobsMod.__resetJobs()
})

afterEach(() => {
  vi.clearAllMocks()
})

async function writeInputFile(jobId: string, content: string): Promise<void> {
  const path = jobsMod.inputFilePath(jobId)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content, 'utf-8')
}

async function waitForEvent(jobId: string, summary: string, maxMs = 2000): Promise<void> {
  const start = Date.now()
  for (;;) {
    const job = jobsMod.getJob(jobId)
    if (job?.events.some((e) => e.summary === summary)) return
    if (Date.now() - start > maxMs) {
      throw new Error(`timed out waiting for event "${summary}" on job ${jobId}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

describe('module import / lazy client construction (SC-09)', () => {
  it('constructs the OpenAI client lazily — importing the module without OPENAI_API_KEY never throws and never constructs the client', () => {
    expect(typeof runDirectLlmJob).toBe('function')
    expect(OpenAICtorSpy).not.toHaveBeenCalled()
  })
})

describe('runJob happy path', () => {
  it('succeeds with an uploaded file: status ends succeeded, error is null, result.txt holds the mocked output_text', async () => {
    mockCreate.mockResolvedValueOnce({ output_text: 'triage result: high urgency, structural' })
    const job = jobsMod.createJob(
      'demo-rfi-triage',
      'triage this',
      new File(['ignored — runner reads from disk'], 'sample-rfi.txt')
    )
    await writeInputFile(job.jobId, 'RFI: beam clash with ductwork, urgent')

    await runDirectLlmJob(job.jobId)

    const updated = jobsMod.getJob(job.jobId)!
    expect(updated.status).toBe('succeeded')
    expect(updated.error).toBeNull()
    const output = await readFile(jobsMod.outputFilePath(job.jobId), 'utf-8')
    expect(output).toBe('triage result: high urgency, structural')
    const { unzipSync, strFromU8 } = await import('fflate')
    const zipped = unzipSync(new Uint8Array(await readFile(jobsMod.artifactZipPath(job.jobId))))
    expect(strFromU8(zipped['result.txt'])).toBe('triage result: high urgency, structural')
  })

  it('emits event summaries in order: reading input, calling model, writing output, agent settled', async () => {
    mockCreate.mockResolvedValueOnce({ output_text: 'result text' })
    const job = jobsMod.createJob('demo-rfi-triage', 'task', new File(['x'], 'in.txt'))
    await writeInputFile(job.jobId, 'input content')

    await runDirectLlmJob(job.jobId)

    const updated = jobsMod.getJob(job.jobId)!
    expect(updated.events.map((e) => e.summary)).toEqual([
      'reading input…',
      'calling model…',
      'writing output…',
      'agent settled (clean exit)',
    ])
  })

  it('every event has type "info" — no tool_start/tool_end (D-11/SC-05)', async () => {
    mockCreate.mockResolvedValueOnce({ output_text: 'result text' })
    const job = jobsMod.createJob('demo-rfi-triage', 'task', new File(['x'], 'in.txt'))
    await writeInputFile(job.jobId, 'input content')

    await runDirectLlmJob(job.jobId)

    const updated = jobsMod.getJob(job.jobId)!
    expect(updated.events.length).toBeGreaterThan(0)
    for (const event of updated.events) {
      expect(event.type).toBe('info')
    }
  })

  it('no-file fallback: uses task text as input, succeeds, and the first stage line does not claim a file was read', async () => {
    mockCreate.mockResolvedValueOnce({ output_text: 'result from task text' })
    const job = jobsMod.createJob('demo-rfi-triage', 'triage this task text directly', null)

    await runDirectLlmJob(job.jobId)

    const updated = jobsMod.getJob(job.jobId)!
    expect(updated.status).toBe('succeeded')
    expect(updated.events[0].summary).toBe('using task text as input…')
    expect(updated.events[0].summary).not.toMatch(/reading input/)
  })
})

describe('D-12: real-phase staged ordering', () => {
  it('the calling-model event exists in the store BEFORE the model call resolves; the writing-output event does not yet exist', async () => {
    const job = jobsMod.createJob('demo-rfi-triage', 'triage this task text', null)

    let resolveCreate!: (v: { output_text: string }) => void
    const pending = new Promise<{ output_text: string }>((resolve) => {
      resolveCreate = resolve
    })
    mockCreate.mockImplementationOnce(() => pending)

    const runPromise = runDirectLlmJob(job.jobId)

    await waitForEvent(job.jobId, 'calling model…')
    const midFlight = jobsMod.getJob(job.jobId)!
    expect(midFlight.status).toBe('running')
    expect(midFlight.events.some((e) => e.summary === 'calling model…')).toBe(true)
    expect(midFlight.events.some((e) => e.summary === 'writing output…')).toBe(false)

    resolveCreate({ output_text: 'settled output' })
    await runPromise

    const done = jobsMod.getJob(job.jobId)!
    expect(done.status).toBe('succeeded')
    expect(done.events.some((e) => e.summary === 'writing output…')).toBe(true)
  })
})

describe('runJob failure paths', () => {
  it('model error: status ends failed with the REAL error message, never a fabricated "pi exited" string', async () => {
    mockCreate.mockRejectedValueOnce(new Error('rate limit exceeded'))
    const job = jobsMod.createJob('demo-rfi-triage', 'task', null)

    await runDirectLlmJob(job.jobId)

    const updated = jobsMod.getJob(job.jobId)!
    expect(updated.status).toBe('failed')
    expect(updated.error).toBe('rate limit exceeded')
    expect(updated.error).not.toMatch(/pi exited/)
  })

  it('missing skill file: status ends failed with the loader\'s message naming the missing path', async () => {
    vi.mocked(promptsMod.loadPromptFor).mockRejectedValueOnce(
      new Error('missing skill file for agent demo-rfi-triage: /fake/data/tryitout-prompts/demo-rfi-triage/skill.md')
    )
    const job = jobsMod.createJob('demo-rfi-triage', 'task', null)

    await runDirectLlmJob(job.jobId)

    const updated = jobsMod.getJob(job.jobId)!
    expect(updated.status).toBe('failed')
    expect(updated.error).toMatch(/missing skill file/)
  })

  it('runJob never rethrows even on failure', async () => {
    mockCreate.mockRejectedValueOnce(new Error('boom'))
    const job = jobsMod.createJob('demo-rfi-triage', 'task', null)

    await expect(runDirectLlmJob(job.jobId)).resolves.toBeUndefined()
  })

  it('runJob on an unknown jobId resolves without throwing and mutates nothing', async () => {
    await expect(runDirectLlmJob('00000000-0000-0000-0000-000000000000')).resolves.toBeUndefined()
    expect(jobsMod.getJob('00000000-0000-0000-0000-000000000000')).toBeUndefined()
  })
})

describe('concurrency (A-1)', () => {
  it('two interleaved runJob calls for two different jobIds produce independent output files and event arrays', async () => {
    mockCreate.mockImplementation(async (args: { input: string }) => ({
      output_text: `output for: ${args.input.includes('JOB_A') ? 'A' : 'B'}`,
    }))

    const jobA = jobsMod.createJob('demo-rfi-triage', 'JOB_A task', null)
    const jobB = jobsMod.createJob('demo-rfi-triage', 'JOB_B task', null)

    await Promise.all([runDirectLlmJob(jobA.jobId), runDirectLlmJob(jobB.jobId)])

    const doneA = jobsMod.getJob(jobA.jobId)!
    const doneB = jobsMod.getJob(jobB.jobId)!
    expect(doneA.status).toBe('succeeded')
    expect(doneB.status).toBe('succeeded')

    const outputA = await readFile(jobsMod.outputFilePath(jobA.jobId), 'utf-8')
    const outputB = await readFile(jobsMod.outputFilePath(jobB.jobId), 'utf-8')
    expect(outputA).toContain('A')
    expect(outputB).toContain('B')
    expect(outputA).not.toBe(outputB)
    expect(jobsMod.outputFilePath(jobA.jobId)).not.toBe(jobsMod.outputFilePath(jobB.jobId))
  })
})


describe('dispatcher (D-14)', () => {
  const MSG: Record<string, string> = {
    engine_unavailable: 'engine down',
    container_start_failed: 'start failed',
    busy: 'all Try It Out slots are busy, try again shortly',
    session_busy: 'a job is already running in your session',
    exec_failed: 'exec failed',
    output_invalid: 'output invalid',
  }

  function install(code: string, env: Record<string, string> = {}) {
    const runtime = fakeMod.createFakeRuntime()
    const config = cfgMod.parseRunnerConfig(env)
    const svc = svcMod.createTryItOutService({ runtime, config, instanceId: 't' })
    svc.leases.claim = async () => {
      throw new rtMod.TryItOutRuntimeError(code as never, MSG[code])
    }
    svcMod.__setTryItOutServiceForTests(svc)
  }

  async function run(): Promise<ReturnType<typeof jobsMod.createJob>> {
    mockCreate.mockResolvedValue({ output_text: 'direct output' })
    const job = jobsMod.createJob('demo-rfi-triage', 'triage this', null)
    await expect(runJob(job.jobId)).resolves.toBeUndefined()
    return jobsMod.getJob(job.jobId)!
  }

  afterEach(() => {
    svcMod.__setTryItOutServiceForTests(null)
    vi.restoreAllMocks()
  })

  it('engine_unavailable falls back: warns once, notice precedes the model call, zip has result.txt', async () => {
    install('engine_unavailable')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const job = await run()
    expect(warn).toHaveBeenCalledTimes(1)
    const summaries = job.events.map((e) => e.summary)
    const notice = summaries.indexOf('container unavailable, falling back to direct model call')
    expect(notice).toBeGreaterThanOrEqual(0)
    expect(summaries.indexOf('calling model…')).toBeGreaterThan(notice)
    expect(job.status).toBe('succeeded')
    const { unzipSync } = await import('fflate')
    const entries = unzipSync(new Uint8Array(await readFile(jobsMod.artifactZipPath(job.jobId))))
    expect(Object.keys(entries)).toEqual(['result.txt'])
  })

  it('container_start_failed falls back the same way', async () => {
    install('container_start_failed')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const job = await run()
    expect(job.status).toBe('succeeded')
    expect(job.events.some((e) => e.summary.startsWith('container unavailable'))).toBe(true)
  })

  it('busy fails with the slots message and never calls OpenAI', async () => {
    install('busy')
    const job = await run()
    expect(job.status).toBe('failed')
    expect(job.error).toBe('all Try It Out slots are busy, try again shortly')
    expect(mockCreate).not.toHaveBeenCalled()
    expect(job.events.some((e) => e.summary.startsWith('container unavailable'))).toBe(false)
  })

  it('session_busy fails and never calls OpenAI', async () => {
    install('session_busy')
    const job = await run()
    expect(job.status).toBe('failed')
    expect(job.error).toBe('a job is already running in your session')
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('fallback disabled: engine_unavailable fails with the real cause', async () => {
    install('engine_unavailable', { PI_FALLBACK_ENABLED: 'false' })
    const job = await run()
    expect(job.status).toBe('failed')
    expect(job.error).toBe('container engine unavailable')
    expect(job.error).not.toContain('engine down')
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('WR-04: an invalid runner config fails the job instead of leaving it running', async () => {
    svcMod.__setTryItOutServiceForTests(null) // force getTryItOutService() to parse the env again
    process.env.PI_RUNNER_FS_MODE = 'foo'
    try {
      const job = jobsMod.createJob('demo-rfi-triage', 'triage this', null)
      await expect(runJob(job.jobId)).resolves.toBeUndefined()
      const done = jobsMod.getJob(job.jobId)!
      expect(done.status).toBe('failed')
      expect(done.error).toMatch(/PI_RUNNER_FS_MODE/)
      expect(done.events.some((e) => e.summary === 'agent failed')).toBe(true)
      expect(mockCreate).not.toHaveBeenCalled()
    } finally {
      delete process.env.PI_RUNNER_FS_MODE
    }
  })

  it.each([
    ['engine_unavailable', true],
    ['container_start_failed', true],
    ['busy', false],
    ['session_busy', false],
    ['exec_failed', false],
    ['output_invalid', false],
  ])('invariant: %s falls back = %s', async (code, falls) => {
    install(code)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const job = await run()
    expect(mockCreate.mock.calls.length > 0).toBe(falls)
    expect(job.status).toBe(falls ? 'succeeded' : 'failed')
  })
})
