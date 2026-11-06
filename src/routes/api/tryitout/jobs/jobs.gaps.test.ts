// E3: input-validation and status-mapping edge cases of the Try It Out job routes
// (real job store and real fs in a tmp dir; runner, service and kind lookup are stubbed).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const state = vi.hoisted(() => ({
  flagOn: false,
  nonAgent: new Set<string>(),
  admit: vi.fn((_k: string, _c: string | undefined) => true),
  runJob: vi.fn(async (_id: string) => {}),
}))

vi.mock('$lib/flags.js', () => ({ agentKindsEnabled: () => state.flagOn }))
vi.mock('$lib/server/kinds.js', () => ({
  isNonAgentKind: (_db: unknown, slug: string) => state.nonAgent.has(slug),
}))
vi.mock('$lib/server/db.js', () => ({ db: {} }))
vi.mock('$lib/server/tryItOutRunner', () => ({ runJob: (id: string) => state.runJob(id) }))
vi.mock('$lib/server/tryitout/service', () => ({
  getTryItOutService: () => ({ admitSession: state.admit }),
}))
vi.mock('$lib/server/tryItOutPrompts', async () => {
  const { z } = await import('zod')
  return { AgentIdSchema: z.string().min(1).max(64).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/) }
})

let tmpDir: string
let jobs: typeof import('$lib/server/tryItOutJobs')
let POST: typeof import('./+server').POST
let GET_STATUS: typeof import('./[id]/+server').GET
let GET_ARTIFACT: typeof import('./[id]/artifact/+server').GET

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'tryitout-jobs-gaps-'))
  process.env.TRYITOUT_WORK_DIR = tmpDir
  jobs = await import('$lib/server/tryItOutJobs')
  ;({ POST } = await import('./+server'))
  ;({ GET: GET_STATUS } = await import('./[id]/+server'))
  ;({ GET: GET_ARTIFACT } = await import('./[id]/artifact/+server'))
})
afterAll(async () => {
  delete process.env.TRYITOUT_WORK_DIR
  await rm(tmpDir, { recursive: true, force: true })
})

beforeEach(() => {
  jobs.__resetJobs()
  state.flagOn = false
  state.nonAgent.clear()
  state.admit.mockReset().mockReturnValue(true)
  state.runJob.mockReset().mockResolvedValue(undefined)
})

const MAX = 200 * 1024

function event(fields: Record<string, string | File>, extra: Record<string, unknown> = {}) {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.set(k, v)
  const request = new Request('http://localhost/api/tryitout/jobs', { method: 'POST', body: form })
  return {
    request,
    locals: { user: null },
    cookies: { get: () => 'AAAAAAAAAAAAAAAAAAAAAA', set: vi.fn() },
    url: new URL(request.url),
    getClientAddress: () => '10.0.0.1',
    ...extra,
  } as unknown as Parameters<typeof POST>[0]
}

async function statusOf(fn: () => unknown): Promise<number> {
  try {
    await fn()
  } catch (e) {
    return (e as { status: number }).status
  }
  return 200
}

const jobCount = () => {
  // createJob is real; count via a probe of the store through two sequential ids is not possible,
  // so detect creation by whether the runner was started.
  return state.runJob.mock.calls.length
}

describe('POST validation order and field types', () => {
  it('a File in the agentId or task slot is not a string -> 400', async () => {
    const f = new File(['x'], 'a.txt')
    expect(await statusOf(() => POST(event({ agentId: f, task: 't' })))).toBe(400)
    expect(await statusOf(() => POST(event({ agentId: 'demo', task: f })))).toBe(400)
    expect(jobCount()).toBe(0)
  })

  it('an empty task string is 400 (not accepted as "no task")', async () => {
    expect(await statusOf(() => POST(event({ agentId: 'demo', task: '' })))).toBe(400)
  })

  it.each(['Demo', 'a_b', 'a b', '-a', 'a-', 'a--b', '../x', 'a/b', 'x'.repeat(65), 'ä'])(
    'agentId %j fails the slug schema with 400 before any session or kind lookup',
    async (agentId) => {
      state.flagOn = true
      expect(await statusOf(() => POST(event({ agentId, task: 't' })))).toBe(400)
      expect(state.admit).not.toHaveBeenCalled()
    },
  )

  it('a 64-char slug is accepted', async () => {
    const res = await POST(event({ agentId: 'a'.repeat(64), task: 't' }))
    expect(res.status).toBe(200)
  })

  it('validation errors beat the size check: missing agentId with an oversized task is 400, not 413', async () => {
    expect(await statusOf(() => POST(event({ task: 'x'.repeat(MAX + 1) })))).toBe(400)
  })
})

describe('POST kind gate (flag on)', () => {
  it('403 for a non-agent kind, before size check, session admission and job creation', async () => {
    state.flagOn = true
    state.nonAgent.add('a-skill')
    expect(await statusOf(() => POST(event({ agentId: 'a-skill', task: 'x'.repeat(MAX + 1) })))).toBe(403)
    expect(state.admit).not.toHaveBeenCalled()
    expect(jobCount()).toBe(0)
  })

  it('an agent-kind slug passes with the flag on; flag off never consults the kind table', async () => {
    state.flagOn = true
    state.nonAgent.add('a-skill')
    expect((await POST(event({ agentId: 'real-agent', task: 't' }))).status).toBe(200)
    state.flagOn = false
    expect((await POST(event({ agentId: 'a-skill', task: 't' }))).status).toBe(200)
  })
})

describe('POST size limits (413)', () => {
  it('task of exactly 200 KiB characters is accepted, one more is 413', async () => {
    expect((await POST(event({ agentId: 'demo', task: 'x'.repeat(MAX) }))).status).toBe(200)
    expect(await statusOf(() => POST(event({ agentId: 'demo', task: 'x'.repeat(MAX + 1) })))).toBe(413)
  })

  it('file of exactly 200 KiB is written in full, one byte more is 413 and writes nothing', async () => {
    const ok = await (await POST(event({ agentId: 'demo', task: 't', file: new File([new Uint8Array(MAX)], 'a.bin') }))).json()
    expect((await readFile(jobs.inputFilePath(ok.jobId))).byteLength).toBe(MAX)
    const before = state.runJob.mock.calls.length
    expect(
      await statusOf(() => POST(event({ agentId: 'demo', task: 't', file: new File([new Uint8Array(MAX + 1)], 'a.bin') }))),
    ).toBe(413)
    expect(state.runJob.mock.calls.length).toBe(before)
  })

  it('413 is returned before admission, so an oversized request does not burn a session slot', async () => {
    await statusOf(() => POST(event({ agentId: 'demo', task: 'x'.repeat(MAX + 1) })))
    expect(state.admit).not.toHaveBeenCalled()
  })

  it('a zero-byte file with a name is treated as no file (nothing written); non-empty file with empty name too', async () => {
    const a = await (await POST(event({ agentId: 'demo', task: 't', file: new File([], 'empty.txt') }))).json()
    expect(existsSync(jobs.inputFilePath(a.jobId))).toBe(false)
    expect(jobs.getJob(a.jobId)!.fileName).toBeNull()
    const b = await (await POST(event({ agentId: 'demo', task: 't', file: new File(['data'], '') }))).json()
    expect(existsSync(jobs.inputFilePath(b.jobId))).toBe(false)
  })

  it('FINDING: the task cap counts characters, so multibyte text can exceed 200 KiB in bytes', async () => {
    const task = '日'.repeat(MAX) // 3 bytes each -> 600 KiB on the wire
    const res = await POST(event({ agentId: 'demo', task }))
    expect(res.status).toBe(200)
    expect(Buffer.byteLength(task)).toBeGreaterThan(MAX)
  })
})

describe('POST session admission (429) and robustness', () => {
  it('429 when admitSession says no; no job is created and the runner is not started', async () => {
    state.admit.mockReturnValue(false)
    expect(await statusOf(() => POST(event({ agentId: 'demo', task: 't' })))).toBe(429)
    expect(jobCount()).toBe(0)
  })

  it('passes the client address and an anon session key to admitSession', async () => {
    await POST(event({ agentId: 'demo', task: 't' }))
    expect(state.admit).toHaveBeenCalledWith('anon:AAAAAAAAAAAAAAAAAAAAAA', '10.0.0.1')
  })

  it('a throwing getClientAddress falls back to an undefined client key (still admitted)', async () => {
    const e = event({ agentId: 'demo', task: 't' }, {
      getClientAddress: () => {
        throw new Error('no address')
      },
    })
    expect((await POST(e)).status).toBe(200)
    expect(state.admit).toHaveBeenCalledWith(expect.any(String), undefined)
  })

  it('a missing getClientAddress is tolerated', async () => {
    expect((await POST(event({ agentId: 'demo', task: 't' }, { getClientAddress: undefined }))).status).toBe(200)
  })

  it('a service that cannot be built (admitSession throws) does not block the job', async () => {
    state.admit.mockImplementation(() => {
      throw new Error('bad PI_RUNNER_FS_MODE')
    })
    const res = await POST(event({ agentId: 'demo', task: 't' }))
    expect(res.status).toBe(200)
    expect(state.runJob).toHaveBeenCalledTimes(1)
  })

  it('a signed-in user gets a user: session key', async () => {
    await POST(event({ agentId: 'demo', task: 't' }, { locals: { user: { email: 'a@b.fi' } } }))
    expect(state.admit).toHaveBeenCalledWith('user:a@b.fi', '10.0.0.1')
  })

  it('a rejected runJob promise never becomes a 500 or an unhandled rejection', async () => {
    state.runJob.mockRejectedValue(new Error('runner exploded'))
    const res = await POST(event({ agentId: 'demo', task: 't' }))
    expect(res.status).toBe(200)
    await new Promise((r) => setTimeout(r, 5))
  })

  it('the response is exactly { jobId, status: "queued" } and the job stores the session key but status does not leak it', async () => {
    const body = await (await POST(event({ agentId: 'demo', task: 'secret task' }))).json()
    expect(Object.keys(body).sort()).toEqual(['jobId', 'status'])
    expect(body.status).toBe('queued')
    const status = await (await GET_STATUS({ params: { id: body.jobId } } as never)).json()
    expect(JSON.stringify(status)).not.toMatch(/secret task|anon:/)
  })

  it('the stored upload path never depends on the client file name', async () => {
    const body = await (await POST(event({ agentId: 'demo', task: 't', file: new File(['x'], '../../../etc/passwd') }))).json()
    expect(jobs.inputFilePath(body.jobId).startsWith(tmpDir)).toBe(true)
    expect(await readFile(jobs.inputFilePath(body.jobId), 'utf8')).toBe('x')
  })
})

describe('GET status / artifact mapping', () => {
  const get = (id: string) => ({ params: { id } }) as never

  it('status exposes events and the (already public) error text of a failed job', async () => {
    const j = jobs.createJob('demo', 't', null)
    jobs.pushEvent(j.jobId, 'hello', 'info')
    jobs.setStatus(j.jobId, 'failed', 'container engine unavailable')
    const body = await (await GET_STATUS(get(j.jobId))).json()
    expect(body.status).toBe('failed')
    expect(body.error).toBe('container engine unavailable')
    expect(body.events).toHaveLength(1)
  })

  it('an upper-case UUID is a valid id shape: unknown -> 404 (not a 500 from the path helpers)', async () => {
    const id = '123E4567-E89B-42D3-A456-426614174000'
    expect(await statusOf(() => GET_STATUS(get(id)))).toBe(404)
    expect(await statusOf(() => GET_ARTIFACT(get(id)))).toBe(404)
  })

  it.each(['%2e%2e', '..', '../..', 'a'.repeat(1000), '00000000-0000-0000-0000-00000000000g', ' '])(
    'malformed id %j -> 404 on both routes',
    async (id) => {
      expect(await statusOf(() => GET_STATUS(get(id)))).toBe(404)
      expect(await statusOf(() => GET_ARTIFACT(get(id)))).toBe(404)
    },
  )

  it('artifact: queued -> 409 naming the status; succeeded with zip -> 200 with a UUID-only filename', async () => {
    const j = jobs.createJob('demo', 't', null)
    try {
      await GET_ARTIFACT(get(j.jobId))
      throw new Error('should have thrown')
    } catch (e) {
      expect((e as { status: number }).status).toBe(409)
      expect(JSON.stringify((e as { body: unknown }).body)).toContain('queued')
    }
    jobs.setStatus(j.jobId, 'succeeded')
    await mkdir(jobs.workDir(j.jobId), { recursive: true })
    await writeFile(jobs.artifactZipPath(j.jobId), Buffer.from([80, 75, 5, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))
    const res = await GET_ARTIFACT(get(j.jobId))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toBe(`attachment; filename="aic-job-${j.jobId}.zip"`)
    expect((await res.arrayBuffer()).byteLength).toBe(22)
  })

  it('artifact: succeeded but the work dir is gone -> 404', async () => {
    const j = jobs.createJob('demo', 't', null)
    jobs.setStatus(j.jobId, 'succeeded')
    expect(await statusOf(() => GET_ARTIFACT(get(j.jobId)))).toBe(404)
  })
})
