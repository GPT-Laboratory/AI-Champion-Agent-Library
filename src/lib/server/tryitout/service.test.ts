import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../tryItOutPrompts', async () => {
  const { z } = await import('zod')
  return {
    AgentIdSchema: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    loadPiSkill: vi.fn(async (slug: string) => ({
      basePrompt: 'BASE',
      skillMarkdown: `---\nname: ${slug}\ndescription: d\n---\nBODY`,
    })),
  }
})

import { __resetProxy, authenticateBearer } from './llmProxy'
import { createFakeRuntime } from './runtimeFake'
import { parseRunnerConfig } from './runnerConfig'
import { TryItOutRuntimeError } from './runtime'
import {
  __setTryItOutServiceForTests,
  buildWarmFiles,
  createTryItOutService,
  renderModelsJson,
  startTryItOutService,
  warmForSession,
} from './service'

const SLUG = 'demo-rfi-triage'
const dec = new TextDecoder()

beforeEach(() => {
  __resetProxy()
  __setTryItOutServiceForTests(null)
})
afterEach(() => {
  vi.restoreAllMocks()
  __setTryItOutServiceForTests(null)
})

function make(env: Record<string, string> = {}) {
  const runtime = createFakeRuntime()
  const config = parseRunnerConfig(env)
  const svc = createTryItOutService({ runtime, config, instanceId: 'inst-1' })
  return { runtime, config, svc }
}

describe('warm staging (tracer)', () => {
  it('warms a labelled container with one token env, models.json, prompt and skill', async () => {
    const { runtime, config, svc } = make()
    const lease = await svc.leases.ensureWarm('anon:a', SLUG)
    if (lease === 'busy' || lease === 'disabled') throw new Error('unexpected ' + lease)
    expect(lease.state).toBe('idle')
    const ids = runtime.containers()
    expect(ids).toHaveLength(1)
    const listed = await runtime.listManaged()
    expect(listed[0].labels).toMatchObject({
      'aic.tryitout': '1',
      'aic.instance': 'inst-1',
      'aic.agent': SLUG,
    })
    expect(listed[0].labels['aic.created']).toBeTruthy()
    const env = runtime.envOf(ids[0])
    const tokenEnv = env.filter((e) => e.startsWith('AIC_LLM_TOKEN='))
    expect(tokenEnv).toHaveLength(1)
    expect(env.some((e) => e.includes('OPENAI_API_KEY'))).toBe(false)
    const token = tokenEnv[0].slice('AIC_LLM_TOKEN='.length)
    expect(authenticateBearer('Bearer ' + token)).toEqual({ leaseId: lease.id })

    const files = runtime.filesOf(ids[0])
    const models = JSON.parse(dec.decode(files.get('/home/pi/agent/models.json') as Uint8Array))
    expect(models.providers.aic).toMatchObject({
      baseUrl: config.proxyUrl,
      api: 'openai-completions',
      apiKey: '$AIC_LLM_TOKEN',
    })
    expect(models.providers.aic.models[0].id).toBe('gpt-4.1-mini')
    expect(dec.decode(files.get('/home/pi/agent/base-prompt.md') as Uint8Array)).toBe('BASE')
    expect(
      dec.decode(files.get(`/home/pi/agent/skills/${SLUG}/SKILL.md`) as Uint8Array).startsWith('---'),
    ).toBe(true)
  })

  it('claims warm, runs and releases; reload reuses the lease', async () => {
    const { runtime, svc } = make()
    const first = await svc.leases.ensureWarm('anon:a', SLUG)
    const second = await svc.leases.ensureWarm('anon:a', SLUG)
    expect(second).toBe(first)
    expect(runtime.calls.filter((c) => c === 'createAndStart')).toHaveLength(1)
    const { lease, warm } = await svc.leases.claim('anon:a', SLUG)
    expect(warm).toBe(true)
    expect(lease.state).toBe('claimed')
    svc.leases.markRunning(lease)
    expect(lease.state).toBe('running')
    const before = lease.idleSince
    await new Promise((r) => setTimeout(r, 2))
    svc.leases.release(lease)
    expect(lease.state).toBe('idle')
    expect(lease.idleSince).toBeGreaterThanOrEqual(before)
  })

  it('cold-starts on claim without a prior warm', async () => {
    const { svc } = make()
    const { lease, warm } = await svc.leases.claim('anon:b', SLUG)
    expect(warm).toBe(false)
    expect(lease.state).toBe('claimed')
  })

  it('fails with a PI_RUNNER_FS_MODE=layer hint when staging check fails', async () => {
    const { runtime, svc } = make()
    runtime.scriptExec(() => 1)
    await expect(svc.leases.claim('anon:c', SLUG)).rejects.toMatchObject({
      code: 'container_start_failed',
      message: expect.stringContaining('PI_RUNNER_FS_MODE=layer'),
    })
    expect(svc.leases.snapshot()).toHaveLength(0)
  })
})

describe('helpers', () => {
  it('renderModelsJson and buildWarmFiles', () => {
    expect(JSON.parse(renderModelsJson('http://p/v1', 'm')).providers.aic.baseUrl).toBe('http://p/v1')
    const files = buildWarmFiles({ slug: SLUG, basePrompt: 'B', skillMarkdown: 'S', proxyUrl: 'u', model: 'm' })
    expect(files.map((f) => f.path)).toEqual([
      'models.json',
      'base-prompt.md',
      'skills',
      `skills/${SLUG}`,
      `skills/${SLUG}/SKILL.md`,
    ])
    expect(() =>
      buildWarmFiles({ slug: '../evil', basePrompt: 'B', skillMarkdown: 'S', proxyUrl: 'u', model: 'm' }),
    ).toThrow()
  })
})

describe('startTryItOutService and warmForSession', () => {
  it('pings, ensures network, sweeps and starts the reaper once', async () => {
    const { runtime, svc } = make()
    const sweep = vi.spyOn(svc.leases, 'sweepOrphans')
    const reaper = vi.spyOn(svc.leases, 'startReaper').mockImplementation(() => {})
    __setTryItOutServiceForTests(svc)
    startTryItOutService()
    startTryItOutService()
    await vi.waitFor(() => expect(sweep).toHaveBeenCalledTimes(1))
    expect(reaper).toHaveBeenCalledTimes(1)
    expect(runtime.calls.filter((c) => c === 'ping')).toHaveLength(1)
    expect(runtime.calls).toContain('ensureNetwork')
    expect(sweep).toHaveBeenCalledTimes(1)
    process.removeAllListeners('SIGTERM')
    process.removeAllListeners('SIGINT')
  })

  it('warns once and does not throw when the engine is unavailable', async () => {
    const { runtime, svc } = make()
    runtime.failNext('ping', new TryItOutRuntimeError('engine_unavailable', 'no socket'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    __setTryItOutServiceForTests(svc)
    expect(() => startTryItOutService()).not.toThrow()
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1))
    expect(String(warn.mock.calls[0][0])).toContain('falling back')
    process.removeAllListeners('SIGTERM')
    process.removeAllListeners('SIGINT')
  })

  it('does nothing when disabled', async () => {
    const { runtime, svc } = make({ PI_RUNNER_ENABLED: 'false' })
    __setTryItOutServiceForTests(svc)
    startTryItOutService()
    await new Promise((r) => setTimeout(r, 5))
    expect(runtime.calls).toHaveLength(0)
  })

  it('warmForSession never rejects and logs the error message', async () => {
    const { svc } = make()
    vi.spyOn(svc.leases, 'ensureWarm').mockRejectedValue(new Error('boom'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    __setTryItOutServiceForTests(svc)
    await expect(warmForSession('anon:a', SLUG)).resolves.toBeUndefined()
    expect(warn.mock.calls[0].join(' ')).toContain('boom')
  })
})

describe('per-client cap on new anonymous sessions (WR-07)', () => {
  it('lets a cookie-less client start only N sessions, but never limits users or existing sessions', async () => {
    const { runtime, svc } = make({ PI_RUNNER_ANON_SESSIONS_PER_CLIENT: '2' })
    __setTryItOutServiceForTests(svc)
    for (const sid of ['a', 'b', 'c', 'd']) await warmForSession(`anon:${sid}`, SLUG, '203.0.113.7')
    expect(runtime.containers()).toHaveLength(2)
    expect(svc.leases.snapshot().map((l) => l.sessionKey).sort()).toEqual(['anon:a', 'anon:b'])
    // an existing session keeps warming (reload), another client and a signed-in user are unaffected
    await warmForSession('anon:a', SLUG, '203.0.113.7')
    await warmForSession('anon:z', SLUG, '198.51.100.9')
    await warmForSession('user:u@x.fi', SLUG, '203.0.113.7')
    expect(runtime.containers()).toHaveLength(4)
  })

  it('admitSession frees the client again after the window', () => {
    let t = 0
    const runtime = createFakeRuntime()
    const svc = createTryItOutService({
      runtime,
      config: parseRunnerConfig({ PI_RUNNER_ANON_SESSIONS_PER_CLIENT: '1' }),
      instanceId: 'i',
      now: () => t,
    })
    expect(svc.admitSession('anon:a', 'ip')).toBe(true)
    expect(svc.admitSession('anon:b', 'ip')).toBe(false)
    t += 11 * 60 * 1000
    expect(svc.admitSession('anon:c', 'ip')).toBe(true)
  })
})

describe('network guard and reaper independent of startup (WR-03)', () => {
  const refusal = () =>
    new TryItOutRuntimeError('container_start_failed', 'network "x" is not internal; refusing to run Pi with open egress.')

  it('starts the reaper even when the startup ping fails', async () => {
    const { runtime, svc } = make()
    runtime.failNext('ping', new TryItOutRuntimeError('engine_unavailable', 'no socket'))
    const reaper = vi.spyOn(svc.leases, 'startReaper').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    __setTryItOutServiceForTests(svc)
    startTryItOutService()
    expect(reaper).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(runtime.calls).toContain('ping'))
    process.removeAllListeners('SIGTERM')
    process.removeAllListeners('SIGINT')
  })

  it('refuses to create a container on a non-internal network even though startup never ran the check', async () => {
    const { runtime, svc } = make()
    runtime.failNext('ensureNetwork', refusal())
    const lease = svc.leases.ensureWarm('anon:a', SLUG)
    await expect(lease).rejects.toMatchObject({ code: 'container_start_failed' })
    expect(runtime.calls).not.toContain('createAndStart')
    expect(runtime.containers()).toHaveLength(0)
    expect(svc.leases.snapshot()).toHaveLength(0)
  })

  it('verifies the network once on success and re-checks after a failure', async () => {
    const { runtime, svc } = make()
    runtime.failNext('ensureNetwork', refusal())
    await expect(svc.leases.ensureWarm('anon:a', SLUG)).rejects.toBeTruthy()
    await svc.leases.ensureWarm('anon:b', SLUG)
    await svc.leases.ensureWarm('anon:c', SLUG)
    expect(runtime.calls.filter((c) => c === 'ensureNetwork')).toHaveLength(2) // failed once, then cached
    expect(runtime.containers()).toHaveLength(2)
  })
})
