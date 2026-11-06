// E3: service.warmForSession / admitSession / staging edge cases.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../tryItOutPrompts', async () => {
  const { z } = await import('zod')
  return {
    AgentIdSchema: z.string().min(1).max(64).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    loadPiSkill: vi.fn(async (slug: string) => {
      if (slug === 'broken-skill') throw new Error('missing skill file for agent broken-skill')
      return { basePrompt: 'BASE', skillMarkdown: `---\nname: ${slug}\ndescription: d\n---\nBODY` }
    }),
  }
})

import { __resetProxy } from './llmProxy'
import { createFakeRuntime } from './runtimeFake'
import { parseRunnerConfig } from './runnerConfig'
import { TryItOutRuntimeError } from './runtime'
import {
  __setTryItOutServiceForTests,
  buildWarmFiles,
  createTryItOutService,
  renderModelsJson,
  warmForSession,
} from './service'

function make(env: Record<string, string> = {}, now?: () => number) {
  const runtime = createFakeRuntime()
  const config = parseRunnerConfig(env)
  const svc = createTryItOutService({ runtime, config, instanceId: 'i', now })
  return { runtime, svc }
}

beforeEach(() => {
  __resetProxy()
  __setTryItOutServiceForTests(null)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  __setTryItOutServiceForTests(null)
})

describe('admitSession', () => {
  it('user sessions are always admitted and never consume the limiter', () => {
    const { svc } = make({ PI_RUNNER_ANON_SESSIONS_PER_CLIENT: '1' })
    for (let i = 0; i < 5; i++) expect(svc.admitSession('user:a@b.c', '1.1.1.1')).toBe(true)
    expect(svc.admitSession('anon:x', '1.1.1.1')).toBe(true)
  })

  it('anon sessions share a bucket per client; undefined clientKey falls into "unknown"', () => {
    const { svc } = make({ PI_RUNNER_ANON_SESSIONS_PER_CLIENT: '2' })
    expect(svc.admitSession('anon:1', undefined)).toBe(true)
    expect(svc.admitSession('anon:2', undefined)).toBe(true)
    expect(svc.admitSession('anon:3', undefined)).toBe(false)
    expect(svc.admitSession('anon:3', '9.9.9.9')).toBe(true)
  })

  it('an anon session that already holds a lease is admitted without a slot, even over the cap', async () => {
    const { svc } = make({ PI_RUNNER_ANON_SESSIONS_PER_CLIENT: '1' })
    expect(svc.admitSession('anon:a', 'c')).toBe(true)
    await svc.leases.ensureWarm('anon:a', 'demo-rfi-triage')
    expect(svc.admitSession('anon:a', 'c')).toBe(true)
    expect(svc.admitSession('anon:b', 'c')).toBe(false)
  })

  it('the window expires with the injected clock', () => {
    let t = 0
    const { svc } = make({ PI_RUNNER_ANON_SESSIONS_PER_CLIENT: '1' }, () => t)
    expect(svc.admitSession('anon:a', 'c')).toBe(true)
    expect(svc.admitSession('anon:b', 'c')).toBe(false)
    t = 10 * 60 * 1000
    expect(svc.admitSession('anon:b', 'c')).toBe(true)
  })

  it('0 disables the cap', () => {
    const { svc } = make({ PI_RUNNER_ANON_SESSIONS_PER_CLIENT: '0' })
    for (let i = 0; i < 30; i++) expect(svc.admitSession('anon:' + i, 'c')).toBe(true)
  })
})

describe('warmForSession', () => {
  it('never rejects when ensureWarm fails, and logs a warning', async () => {
    const { runtime, svc } = make()
    __setTryItOutServiceForTests(svc)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    runtime.failNext('createAndStart', new TryItOutRuntimeError('engine_unavailable', 'sock /run/x'))
    await expect(warmForSession('anon:a', 'demo-rfi-triage')).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
  })

  it('never rejects when the service cannot be built (invalid runner config)', async () => {
    __setTryItOutServiceForTests(null)
    vi.stubEnv('PI_RUNNER_FS_MODE', 'bogus')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(warmForSession('anon:a', 'demo-rfi-triage')).resolves.toBeUndefined()
    expect(warn.mock.calls[0].join(' ')).toMatch(/warm-up failed/)
  })

  it('skips warming (no container) when the client is over its new-session cap', async () => {
    const { runtime, svc } = make({ PI_RUNNER_ANON_SESSIONS_PER_CLIENT: '1' })
    __setTryItOutServiceForTests(svc)
    vi.spyOn(console, 'info').mockImplementation(() => {})
    await warmForSession('anon:a', 'demo-rfi-triage', 'c')
    await warmForSession('anon:b', 'demo-rfi-triage', 'c')
    expect(runtime.containers()).toHaveLength(1)
    expect(svc.leases.snapshot().map((s) => s.sessionKey)).toEqual(['anon:a'])
  })

  it('is a no-op when the runner is disabled', async () => {
    const { runtime, svc } = make({ PI_RUNNER_ENABLED: 'false' })
    __setTryItOutServiceForTests(svc)
    await warmForSession('user:a', 'demo-rfi-triage')
    expect(runtime.calls).not.toContain('createAndStart')
  })

  it('a skill-loading failure is swallowed and frees the slot and container', async () => {
    const { runtime, svc } = make()
    __setTryItOutServiceForTests(svc)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await warmForSession('user:a', 'broken-skill')
    expect(svc.leases.snapshot()).toEqual([])
    await vi.waitFor(() => expect(runtime.containers()).toHaveLength(0))
  })
})

describe('staging', () => {
  it('a missing models.json after putFiles (exec exit != 0) is container_start_failed with the layer hint', async () => {
    const { runtime, svc } = make()
    runtime.scriptExec(() => 1)
    await expect(svc.leases.ensureWarm('user:a', 'demo-rfi-triage')).rejects.toMatchObject({
      code: 'container_start_failed',
      message: expect.stringContaining('PI_RUNNER_FS_MODE=layer'),
    })
    expect(svc.leases.snapshot()).toEqual([])
  })

  it('exit code null (killed) also counts as a staging failure', async () => {
    const { runtime, svc } = make()
    runtime.scriptExec(() => null)
    await expect(svc.leases.ensureWarm('user:a', 'demo-rfi-triage')).rejects.toMatchObject({
      code: 'container_start_failed',
    })
  })

  it('the verification exec runs `test -f` on the models.json path from /', async () => {
    const { runtime, svc } = make()
    const seen: Array<{ cmd: string[]; wd: string }> = []
    runtime.scriptExec(({ cmd, workingDir }) => {
      seen.push({ cmd, wd: workingDir })
      return 0
    })
    await svc.leases.ensureWarm('user:a', 'demo-rfi-triage')
    expect(seen).toEqual([{ cmd: ['test', '-f', '/home/pi/agent/models.json'], wd: '/' }])
  })

  it('a putFiles failure surfaces and cleans up', async () => {
    const { runtime, svc } = make()
    runtime.failNext('putFiles', new TryItOutRuntimeError('exec_failed', 'tar'))
    await expect(svc.leases.ensureWarm('user:a', 'demo-rfi-triage')).rejects.toMatchObject({ code: 'exec_failed' })
    expect(svc.leases.snapshot()).toEqual([])
  })
})

describe('verifyNetwork', () => {
  it('is memoised while it succeeds and shared by concurrent callers', async () => {
    const { runtime, svc } = make()
    await Promise.all([svc.verifyNetwork(), svc.verifyNetwork(), svc.verifyNetwork()])
    await svc.verifyNetwork()
    expect(runtime.calls.filter((c) => c === 'ensureNetwork')).toHaveLength(1)
  })

  it('a failure is not cached: no container is created while failing, and the next call retries', async () => {
    const { runtime, svc } = make()
    runtime.failNext('ensureNetwork', new TryItOutRuntimeError('container_start_failed', 'open egress'))
    await expect(svc.leases.ensureWarm('user:a', 'demo-rfi-triage')).rejects.toMatchObject({ message: 'open egress' })
    expect(runtime.calls).not.toContain('createAndStart')
    await expect(svc.leases.ensureWarm('user:a', 'demo-rfi-triage')).resolves.toMatchObject({ state: 'idle' })
    expect(runtime.calls.filter((c) => c === 'ensureNetwork')).toHaveLength(2)
  })
})

describe('buildWarmFiles / renderModelsJson', () => {
  const base = { basePrompt: 'B', skillMarkdown: 'S', proxyUrl: 'http://p/v1', model: 'm' }

  it.each(['../x', 'A', 'a/b', '', '-a', 'a-', 'a--b', 'x'.repeat(65)])('rejects slug %j', (slug) => {
    expect(() => buildWarmFiles({ ...base, slug })).toThrow()
  })

  it('stages models.json with mode 0600 and the skill under skills/<slug>/SKILL.md', () => {
    const files = buildWarmFiles({ ...base, slug: 'a-1' })
    expect(files.find((f) => f.path === 'models.json')?.mode).toBe(0o600)
    expect(files.map((f) => f.path)).toEqual([
      'models.json',
      'base-prompt.md',
      'skills',
      'skills/a-1',
      'skills/a-1/SKILL.md',
    ])
    expect(files.filter((f) => f.type === 'dir')).toHaveLength(2)
  })

  it('never embeds a real key; apiKey is the env placeholder', () => {
    const parsed = JSON.parse(renderModelsJson('http://p/v1', 'gpt-x'))
    expect(parsed.providers.aic).toEqual({
      baseUrl: 'http://p/v1',
      api: 'openai-completions',
      apiKey: '$AIC_LLM_TOKEN',
      models: [{ id: 'gpt-x' }],
    })
  })
})
