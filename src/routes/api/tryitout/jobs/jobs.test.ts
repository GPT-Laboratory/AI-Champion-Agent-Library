import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { mkdtemp, rm, readdir, readFile as fsReadFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { unzipSync, strFromU8 } from 'fflate'
import { join } from 'node:path'

// Hoisted so the vi.mock factory below (hoisted above all imports) can
// reference these — mirrors src/lib/server/tryItOutRunner.test.ts.
const { mockCreate } = vi.hoisted(() => {
  return { mockCreate: vi.fn() }
})

vi.mock('openai', () => {
  return {
    default: class MockOpenAI {
      responses = { create: mockCreate }
    },
  }
})

// Partial mock: keep every real export, but wrap `createJob` in a spy so
// tests can assert "no job created" without needing to guess a jobId.
vi.mock('$lib/server/tryItOutJobs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/tryItOutJobs')>()
  return { ...actual, createJob: vi.fn(actual.createJob) }
})

// Only the Pi skill loader is mocked; the real loadPromptFor stays for the fallback.
vi.mock('$lib/server/tryItOutPrompts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/tryItOutPrompts')>()
  return {
    ...actual,
    loadPiSkill: vi.fn(async (slug: string) => ({
      basePrompt: 'BASE',
      skillMarkdown: `---\nname: ${slug}\ndescription: d\n---\nBODY`,
    })),
  }
})

// Populated in beforeAll, AFTER TRYITOUT_WORK_DIR is pointed at a throwaway
// tmpdir — tryItOutJobs.ts reads that env var once at module load, so every
// module under test must be imported (dynamically) only after the env var
// is set (07-03's established pattern).
let tmpDir: string
let jobsMod: typeof import('$lib/server/tryItOutJobs')
let POST: typeof import('./+server').POST
let GET_STATUS: typeof import('./[id]/+server').GET
let GET_ARTIFACT: typeof import('./[id]/artifact/+server').GET
let svcMod: typeof import('$lib/server/tryitout/service')
let runtimeMod: typeof import('$lib/server/tryitout/runtime')
let fakeMod: typeof import('$lib/server/tryitout/runtimeFake')
let cfgMod: typeof import('$lib/server/tryitout/runnerConfig')
let fixtures: typeof import('$lib/server/tryitout/piFixtures')

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'tryitout-jobs-route-test-'))
  process.env.TRYITOUT_WORK_DIR = tmpDir

  jobsMod = await import('$lib/server/tryItOutJobs')
  svcMod = await import('$lib/server/tryitout/service')
  runtimeMod = await import('$lib/server/tryitout/runtime')
  fakeMod = await import('$lib/server/tryitout/runtimeFake')
  cfgMod = await import('$lib/server/tryitout/runnerConfig')
  fixtures = await import('$lib/server/tryitout/piFixtures')
  ;({ POST } = await import('./+server'))
  ;({ GET: GET_STATUS } = await import('./[id]/+server'))
  ;({ GET: GET_ARTIFACT } = await import('./[id]/artifact/+server'))
})

afterAll(async () => {
  delete process.env.TRYITOUT_WORK_DIR
  await rm(tmpDir, { recursive: true, force: true })
})

function installService(runtime: import('$lib/server/tryitout/runtimeFake').FakeRuntime) {
  svcMod.__setTryItOutServiceForTests(
    svcMod.createTryItOutService({ runtime, config: cfgMod.parseRunnerConfig({}), instanceId: 't' }),
  )
}

// Default: engine unreachable, so the mocked OpenAI fallback produces the output.
function installUnavailableEngine() {
  const rt = fakeMod.createFakeRuntime()
  const err = () => new runtimeMod.TryItOutRuntimeError('engine_unavailable', 'engine down')
  rt.failNext('ping', err())
  for (let i = 0; i < 20; i++) rt.failNext('createAndStart', err())
  installService(rt)
}

beforeEach(() => {
  jobsMod.__resetJobs()
  // clearAllMocks keeps queued *Once results; mockReset drops them so a job left in flight by
  // an earlier test cannot hand its queued mock to the next test (B-003).
  vi.clearAllMocks()
  mockCreate.mockReset()
  mockCreate.mockResolvedValue({ output_text: 'mock model output' })
  installUnavailableEngine()
})

function makeForm(fields: Record<string, string | File | undefined>): Request {
  const form = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue
    form.set(key, value)
  }
  return new Request('http://localhost/api/tryitout/jobs', { method: 'POST', body: form })
}

function asPostEvent(request: Request): Parameters<typeof POST>[0] {
  return {
    request,
    locals: { user: null },
    cookies: { get: () => 'AAAAAAAAAAAAAAAAAAAAAA', set: vi.fn() },
    url: new URL(request.url),
  } as unknown as Parameters<typeof POST>[0]
}

// Loosely typed (`any`) on purpose: this same `{ params }` shape is passed
// to both GET handlers below (status and artifact), which SvelteKit types as
// two distinct, non-interchangeable `RequestEvent<..., RouteId>` types even
// though only `params.id` is ever read by either handler.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function asGetEvent(id: string): any {
  return { params: { id } }
}

async function expectHttpError(fn: () => unknown, status: number): Promise<void> {
  try {
    await fn()
    throw new Error(`expected handler to throw an HTTP ${status} error, but it did not throw`)
  } catch (e) {
    expect((e as { status?: number }).status).toBe(status)
  }
}

async function waitForStatus(
  jobId: string,
  terminal: Array<'queued' | 'running' | 'succeeded' | 'failed'>,
  maxMs = 15000
) {
  const start = Date.now()
  for (;;) {
    const job = jobsMod.getJob(jobId)
    if (job && terminal.includes(job.status)) return job
    if (Date.now() - start > maxMs) {
      throw new Error(`timed out waiting for status in [${terminal.join(', ')}] on job ${jobId}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

async function listAllFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await listAllFiles(p)))
    else out.push(p)
  }
  return out
}

const AGENT_ID = 'etim-classification-repair'

describe('POST /api/tryitout/jobs', () => {
  it('valid agentId + task + file resolves to { jobId, status: queued } immediately, and writes the file before returning', async () => {
    const file = new File(['hello world'], 'note.txt', { type: 'text/plain' })
    const res = await POST(asPostEvent(makeForm({ agentId: AGENT_ID, task: 'triage this', file })))
    const body = await res.json()

    expect(body.status).toBe('queued')
    expect(body.jobId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)

    const written = await fsReadFile(jobsMod.inputFilePath(body.jobId), 'utf-8')
    expect(written).toBe('hello world')

    // The response did not wait for the model call.
    expect(mockCreate).not.toHaveBeenCalled()

    // Drain the fire-and-forget background run so it cannot bleed a
    // `mockCreate` call into a later test.
    await waitForStatus(body.jobId, ['succeeded', 'failed'])
  })

  it('missing/non-string agentId -> 400, no job created', async () => {
    const req = makeForm({ task: 'triage this' })
    await expectHttpError(() => POST(asPostEvent(req)), 400)
    expect(jobsMod.createJob).not.toHaveBeenCalled()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('missing/non-string task -> 400, no job created', async () => {
    const req = makeForm({ agentId: AGENT_ID })
    await expectHttpError(() => POST(asPostEvent(req)), 400)
    expect(jobsMod.createJob).not.toHaveBeenCalled()
  })

  it('agentId failing the slug regex -> 400, no job created, no filesystem access', async () => {
    const before = await readdir(tmpDir).catch(() => [])
    const req = makeForm({ agentId: 'Not Valid!!', task: 'triage this' })
    await expectHttpError(() => POST(asPostEvent(req)), 400)
    expect(jobsMod.createJob).not.toHaveBeenCalled()
    const after = await readdir(tmpDir).catch(() => [])
    expect(after).toEqual(before)
  })

  it('a zero-byte, empty-named File is treated as NO file: fileName null, nothing written, run uses task text', async () => {
    const emptyFile = new File([], '')
    const res = await POST(
      asPostEvent(makeForm({ agentId: AGENT_ID, task: 'triage this without a file', file: emptyFile }))
    )
    const body = await res.json()

    const job = jobsMod.getJob(body.jobId)!
    expect(job.fileName).toBeNull()

    await expect(fsReadFile(jobsMod.inputFilePath(body.jobId), 'utf-8')).rejects.toThrow()

    await waitForStatus(body.jobId, ['succeeded', 'failed'])
    const updated = jobsMod.getJob(body.jobId)!
    expect(updated.events.some((e) => e.summary === 'using task text as input…')).toBe(true)
  })

  it('a 201 KB file -> 413, no job created, nothing written', async () => {
    const before = await readdir(tmpDir).catch(() => [])
    const bigFile = new File([new Uint8Array(201 * 1024)], 'big.bin')
    const req = makeForm({ agentId: AGENT_ID, task: 'triage this', file: bigFile })
    await expectHttpError(() => POST(asPostEvent(req)), 413)
    expect(jobsMod.createJob).not.toHaveBeenCalled()
    expect(mockCreate).not.toHaveBeenCalled()
    const after = await readdir(tmpDir).catch(() => [])
    expect(after).toEqual(before)
  })

  it('an oversized task string alone (no file) -> 413, no job created', async () => {
    const before = await readdir(tmpDir).catch(() => [])
    const req = makeForm({ agentId: AGENT_ID, task: 'x'.repeat(201 * 1024) })
    await expectHttpError(() => POST(asPostEvent(req)), 413)
    expect(jobsMod.createJob).not.toHaveBeenCalled()
    const after = await readdir(tmpDir).catch(() => [])
    expect(after).toEqual(before)
  })

  it('WR-07: a cookie-less client minting fresh sessions is capped per client address with a 429', async () => {
    svcMod.__setTryItOutServiceForTests(
      svcMod.createTryItOutService({
        runtime: fakeMod.createFakeRuntime(),
        config: cfgMod.parseRunnerConfig({ PI_RUNNER_ANON_SESSIONS_PER_CLIENT: '2' }),
        instanceId: 't',
      }),
    )
    const freshSessionEvent = (ip: string, sid: string) => {
      const ev = asPostEvent(makeForm({ agentId: AGENT_ID, task: 'hello' })) as unknown as Record<string, unknown>
      ev.cookies = { get: () => sid, set: vi.fn() }
      ev.getClientAddress = () => ip
      return ev as unknown as Parameters<typeof POST>[0]
    }
    await POST(freshSessionEvent('203.0.113.7', 'AAAAAAAAAAAAAAAAAAAAA1'))
    await POST(freshSessionEvent('203.0.113.7', 'AAAAAAAAAAAAAAAAAAAAA2'))
    await expectHttpError(() => POST(freshSessionEvent('203.0.113.7', 'AAAAAAAAAAAAAAAAAAAAA3')), 429)
    // another client is unaffected
    await POST(freshSessionEvent('198.51.100.9', 'AAAAAAAAAAAAAAAAAAAAA4'))
  })

  it('a file named ../../escape.txt lands at input/input.txt; nothing exists outside workDir', async () => {
    const traversalFile = new File(['payload'], '../../escape.txt')
    const res = await POST(
      asPostEvent(makeForm({ agentId: AGENT_ID, task: 'triage this', file: traversalFile }))
    )
    const body = await res.json()

    const written = await fsReadFile(jobsMod.inputFilePath(body.jobId), 'utf-8')
    expect(written).toBe('payload')

    const files = await listAllFiles(jobsMod.workDir(body.jobId))
    expect(files.some((f) => f.includes('escape.txt'))).toBe(false)
    expect(files).toContain(jobsMod.inputFilePath(body.jobId))

    // Drain the fire-and-forget background run before the next test starts.
    await waitForStatus(body.jobId, ['succeeded', 'failed'])
  })

  it('two sequential POSTs produce two distinct jobIds; each job\'s artifact reflects only its own task', async () => {
    mockCreate.mockImplementation(async (args: { input: string }) => ({
      output_text: args.input.includes('JOB_A') ? 'result for A' : 'result for B',
    }))

    const res1 = await POST(asPostEvent(makeForm({ agentId: AGENT_ID, task: 'JOB_A task' })))
    const body1 = await res1.json()
    const res2 = await POST(asPostEvent(makeForm({ agentId: AGENT_ID, task: 'JOB_B task' })))
    const body2 = await res2.json()

    expect(body1.jobId).not.toBe(body2.jobId)

    await waitForStatus(body1.jobId, ['succeeded', 'failed'])
    await waitForStatus(body2.jobId, ['succeeded', 'failed'])

    const status1 = await (await GET_STATUS(asGetEvent(body1.jobId))).json()
    const status2 = await (await GET_STATUS(asGetEvent(body2.jobId))).json()
    expect(status1.status).toBe('succeeded')
    expect(status2.status).toBe('succeeded')

    const readResult = async (id: string) =>
      strFromU8(
        unzipSync(new Uint8Array(await (await GET_ARTIFACT(asGetEvent(id))).arrayBuffer()))['result.txt']
      )
    const artifact1 = await readResult(body1.jobId)
    const artifact2 = await readResult(body2.jobId)
    expect(artifact1).toBe('result for A')
    expect(artifact2).toBe('result for B')
  })
})

describe('GET /api/tryitout/jobs/[id]', () => {
  it('returns a body with exactly { status, events, error } — no agentId/task/fileName leakage', async () => {
    const res = await POST(asPostEvent(makeForm({ agentId: AGENT_ID, task: 'triage this' })))
    const { jobId } = await res.json()

    const statusRes = await GET_STATUS(asGetEvent(jobId))
    const body = await statusRes.json()

    expect(Object.keys(body).sort()).toEqual(['error', 'events', 'status'])
    expect(['queued', 'running', 'succeeded', 'failed']).toContain(body.status)

    // Drain the fire-and-forget background run before the next test starts.
    await waitForStatus(jobId, ['succeeded', 'failed'])
  })

  it('returns 404 for an unknown UUID', async () => {
    await expectHttpError(() => GET_STATUS(asGetEvent('00000000-0000-0000-0000-000000000000')), 404)
  })

  it.each(['../etc', 'abc', ''])('returns 404 for a malformed id %j', async (id) => {
    await expectHttpError(() => GET_STATUS(asGetEvent(id)), 404)
  })
})

describe('GET /api/tryitout/jobs/[id]/artifact', () => {
  it('returns 200 with the exact bytes and correct headers for a succeeded job', async () => {
    mockCreate.mockResolvedValueOnce({ output_text: 'artifact content here' })
    const res = await POST(asPostEvent(makeForm({ agentId: AGENT_ID, task: 'triage this' })))
    const { jobId } = await res.json()
    await waitForStatus(jobId, ['succeeded', 'failed'])
    expect(jobsMod.getJob(jobId)!.status).toBe('succeeded')

    const artifactRes = await GET_ARTIFACT(asGetEvent(jobId))
    expect(artifactRes.status).toBe(200)
    expect(artifactRes.headers.get('Content-Type')).toBe('application/zip')
    expect(artifactRes.headers.get('Content-Disposition')).toBe(`attachment; filename="aic-job-${jobId}.zip"`)
    const entries = unzipSync(new Uint8Array(await artifactRes.arrayBuffer()))
    expect(Object.keys(entries)).toEqual(['result.txt'])
    expect(strFromU8(entries['result.txt'])).toBe('artifact content here')
  })

  it('returns 409 for a running job', async () => {
    let release!: (v: { output_text: string }) => void
    mockCreate.mockImplementationOnce(() => new Promise((resolve) => { release = resolve })) // stays running until released
    const res = await POST(asPostEvent(makeForm({ agentId: AGENT_ID, task: 'triage this' })))
    const { jobId } = await res.json()
    await waitForStatus(jobId, ['running'])
    await vi.waitFor(() => expect(mockCreate).toHaveBeenCalled())
    await expectHttpError(() => GET_ARTIFACT(asGetEvent(jobId)), 409)
    // settle the in-flight job so it cannot leak into the next test
    release({ output_text: 'done' })
    await waitForStatus(jobId, ['succeeded', 'failed'])
  })

  it('returns 409 for a failed job', async () => {
    mockCreate.mockRejectedValueOnce(new Error('boom'))
    const res = await POST(asPostEvent(makeForm({ agentId: AGENT_ID, task: 'triage this' })))
    const { jobId } = await res.json()
    await waitForStatus(jobId, ['succeeded', 'failed'])
    expect(jobsMod.getJob(jobId)!.status).toBe('failed')
    await expectHttpError(() => GET_ARTIFACT(asGetEvent(jobId)), 409)
  })

  it('returns 404 for an unknown id', async () => {
    await expectHttpError(() => GET_ARTIFACT(asGetEvent('00000000-0000-0000-0000-000000000000')), 404)
  })

  it('returns 404, not an unhandled ENOENT, for a succeeded job whose artifact.zip was deleted', async () => {
    mockCreate.mockResolvedValueOnce({ output_text: 'will be deleted' })
    const res = await POST(asPostEvent(makeForm({ agentId: AGENT_ID, task: 'triage this' })))
    const { jobId } = await res.json()
    await waitForStatus(jobId, ['succeeded', 'failed'])
    await rm(jobsMod.artifactZipPath(jobId))
    await expectHttpError(() => GET_ARTIFACT(asGetEvent(jobId)), 404)
  })
})

describe('container path', () => {
  it('runs the job in the session container and zips what Pi wrote', async () => {
    const rt = fakeMod.createFakeRuntime()
    let seenCmd: string[] = []
    let seenDir = ''
    const filesAtExec: Record<string, string> = {}
    rt.scriptExec((ctx) => {
      if (ctx.cmd[0] === 'pi' || ctx.cmd[0] === 'timeout') {
        seenCmd = ctx.cmd
        seenDir = ctx.workingDir
        for (const [k, v] of ctx.files) {
          if (v !== 'dir' && k.startsWith(ctx.workingDir + '/input/')) filesAtExec[k] = new TextDecoder().decode(v)
        }
        ctx.files.set(`${ctx.workingDir}/output/result.txt`, new TextEncoder().encode('Urgency: high'))
        ctx.stdout(fixtures.PI_SUCCESS_STREAM)
        return 0
      }
      if (ctx.cmd[0] === 'rm') {
        for (const k of [...ctx.files.keys()]) if (k.startsWith(ctx.cmd[2])) ctx.files.delete(k)
      }
      return 0
    })
    installService(rt)

    const file = new File(['uploaded rfi text'], 'rfi.txt', { type: 'text/plain' })
    const res = await POST(asPostEvent(makeForm({ agentId: AGENT_ID, task: 'triage this', file })))
    const body = await res.json()
    expect(body.status).toBe('queued')
    const job = await waitForStatus(body.jobId, ['succeeded', 'failed'])
    expect(job.error).toBeNull()
    expect(job.status).toBe('succeeded')

    expect(job.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'tool_start', tool: 'read' }),
        expect.objectContaining({ type: 'tool_end', tool: 'write' }),
      ]),
    )
    expect(job.events.some((e) => /using warm container|started a fresh container/.test(e.summary))).toBe(true)
    expect(mockCreate).not.toHaveBeenCalled()

    const art = await GET_ARTIFACT(asGetEvent(body.jobId))
    const entries = unzipSync(new Uint8Array(await art.arrayBuffer()))
    expect(Object.keys(entries)).toEqual(['result.txt'])
    expect(strFromU8(entries['result.txt'])).toBe('Urgency: high')

    expect(seenCmd.slice(0, 6)).toEqual(['timeout', '--signal=KILL', '300', 'pi', '--mode', 'json'])
    expect(seenCmd).toContain('--offline')
    expect(seenCmd).toContain('--no-session')
    expect(seenCmd.some((a) => a.includes('triage this') || a.includes('uploaded rfi text'))).toBe(false)
    expect(seenDir).toBe(`/work/${body.jobId}`)
    expect(filesAtExec[`/work/${body.jobId}/input/task.txt`]).toBe('triage this')
    expect(filesAtExec[`/work/${body.jobId}/input/upload.txt`]).toBe('uploaded rfi text')

    const cid = rt.containers()[0]
    expect([...rt.filesOf(cid).keys()].filter((k) => k.startsWith(`/work/${body.jobId}`))).toEqual([])
  })
})
