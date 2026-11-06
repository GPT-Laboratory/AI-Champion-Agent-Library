// Phase 13 review fix WR-09: POST /api/tryitout/jobs and POST /api/try-out refuse non-agent kinds
// when AGENT_KINDS is on (the service refuses, not only the UI).
import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({ flagOn: false, nonAgent: new Set<string>() }))

vi.mock('$lib/flags.js', () => ({ agentKindsEnabled: () => state.flagOn }))
vi.mock('$lib/server/kinds.js', () => ({
  isNonAgentKind: (_db: unknown, slug: string) => state.nonAgent.has(slug),
}))
vi.mock('$lib/server/db.js', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ get: () => ({ slug: 'a-system', title: 'T', inputSchema: '[]' }) }),
      }),
    }),
  },
  agents: { slug: 'slug', title: 'title', inputSchema: 'input_schema' },
}))
vi.mock('drizzle-orm', async (orig) => ({ ...(await orig<typeof import('drizzle-orm')>()), eq: vi.fn() }))
vi.mock('$lib/server/tryItOutJobs', () => ({
  createJob: vi.fn(() => ({ jobId: 'job-1', status: 'queued' })),
  inputDir: () => '/tmp/none',
  inputFilePath: () => '/tmp/none/f',
}))
vi.mock('$lib/server/tryItOutRunner', () => ({ runJob: vi.fn(async () => {}) }))
vi.mock('$lib/server/tryitout/service', () => ({ getTryItOutService: () => ({ admitSession: () => true }) }))
vi.mock('$lib/server/tryitout/session', () => ({ sessionKey: () => 'anon:test' }))
vi.mock('$lib/server/tryItOutPrompts', () => ({
  AgentIdSchema: { safeParse: (v: string) => ({ success: /^[a-z0-9-]+$/.test(v) }) },
}))
const runTryOut = vi.hoisted(() => vi.fn(async () => ({ id: 's1' })))
vi.mock('$lib/server/try-out.js', () => ({ runTryOut }))
vi.mock('$lib/server/try-out-inputs.js', () => ({ validateInputValues: () => ({ values: {} }) }))

import { createJob } from '$lib/server/tryItOutJobs'
import { POST as jobsPost } from './+server'
import { POST as tryOutPost } from '../../try-out/+server'

function jobRequest(agentId: string): Request {
  const form = new FormData()
  form.set('agentId', agentId)
  form.set('task', 'do it')
  return new Request('http://localhost/api/tryitout/jobs', { method: 'POST', body: form })
}
const jobEvent = (agentId: string) =>
  ({ request: jobRequest(agentId), locals: {}, cookies: {}, url: new URL('http://localhost/x'), getClientAddress: () => '1.2.3.4' }) as never

function tryOutRequest(slug: string): Request {
  return new Request('http://localhost/api/try-out', {
    method: 'POST',
    body: JSON.stringify({
      agentSlug: slug,
      inputValues: {},
      additionalInstructions: '',
      customization: { systemPrompt: 'p', llmName: 'm', temperature: null, toolNames: [] },
    }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  state.flagOn = false
  state.nonAgent = new Set(['a-system'])
})

describe('POST /api/tryitout/jobs', () => {
  it('flag on: a non-agent slug is refused with 403 and no job is created', async () => {
    state.flagOn = true
    await expect(jobsPost(jobEvent('a-system'))).rejects.toMatchObject({ status: 403 })
    expect(createJob).not.toHaveBeenCalled()
  })
  it('flag on: an agent slug still creates a job', async () => {
    state.flagOn = true
    const res = await jobsPost(jobEvent('plain-agent'))
    expect((await res.json()).jobId).toBe('job-1')
  })
  it('flag off: the kind check never runs', async () => {
    const res = await jobsPost(jobEvent('a-system'))
    expect((await res.json()).jobId).toBe('job-1')
  })
})

describe('POST /api/try-out', () => {
  it('flag on: a non-agent slug is refused with 403', async () => {
    state.flagOn = true
    const res = await tryOutPost({ request: tryOutRequest('a-system') } as never)
    expect(res.status).toBe(403)
    expect(runTryOut).not.toHaveBeenCalled()
  })
  it('flag off: unchanged behaviour', async () => {
    const res = await tryOutPost({ request: tryOutRequest('a-system') } as never)
    expect(res.status).toBe(201)
  })
})
