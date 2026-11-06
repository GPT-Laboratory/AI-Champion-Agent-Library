// E3: lease / limiter / session edge cases not covered by leaseManager.test.ts, chaos.lease.test.ts or service.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLeaseManager, type Lease, type LeaseManager } from './leaseManager'
import { createFakeRuntime } from './runtimeFake'
import { parseRunnerConfig } from './runnerConfig'
import { LABEL_INSTANCE, LABEL_OWNER, TryItOutRuntimeError } from './runtime'
import { createClientLimiter } from './clientLimit'
import { sessionKey, TRYOUT_SESSION_COOKIE } from './session'

function setup(env: Record<string, string> = {}, extra: Partial<Parameters<typeof createLeaseManager>[0]> = {}) {
  const runtime = createFakeRuntime()
  const config = parseRunnerConfig({ PI_RUNNER_MIN_IDLE_MS: '0', ...env })
  const revoked: string[] = []
  let t = 1_000
  const mgr = createLeaseManager({
    runtime,
    config,
    instanceId: 'inst',
    now: () => t,
    tokens: { mint: (id) => 'tok-' + id, revoke: (id) => revoked.push(id) },
    stage: async () => {},
    ...extra,
  })
  return { runtime, config, mgr, revoked, advance: (ms: number) => (t += ms) }
}

async function warm(mgr: LeaseManager, key: string, slug = 'a-b'): Promise<Lease> {
  const l = await mgr.ensureWarm(key, slug)
  if (l === 'busy' || l === 'disabled') throw new Error(l)
  return l
}

afterEach(() => vi.restoreAllMocks())

describe('lease state transitions', () => {
  it('markRunning on an idle lease throws and leaves state untouched', async () => {
    const { mgr } = setup()
    const l = await warm(mgr, 'anon:s')
    expect(() => mgr.markRunning(l)).toThrow(/idle/)
    expect(l.state).toBe('idle')
  })

  it('release is a no-op for idle and evicted leases and does not bump idleSince', async () => {
    const { mgr, advance } = setup()
    const l = await warm(mgr, 'anon:s')
    const since = l.idleSince
    advance(500)
    mgr.release(l)
    expect(l.idleSince).toBe(since)
    await mgr.discard(l)
    mgr.release(l)
    expect(l.state).toBe('evicting')
  })

  it('release of a running lease returns it to idle and refreshes idleSince', async () => {
    const { mgr, advance } = setup()
    await warm(mgr, 'anon:s')
    const { lease } = await mgr.claim('anon:s', 'a-b')
    mgr.markRunning(lease)
    advance(700)
    mgr.release(lease)
    expect(lease.state).toBe('idle')
    expect(lease.idleSince).toBe(1_700)
  })

  it('discard twice removes the container once', async () => {
    const { mgr, runtime } = setup()
    const l = await warm(mgr, 'anon:s')
    await mgr.discard(l)
    await mgr.discard(l)
    expect(runtime.calls.filter((c) => c === 'remove')).toHaveLength(1)
    expect(mgr.snapshot()).toEqual([])
  })

  it('claim and ensureWarm report disabled when PI_RUNNER_ENABLED=false, creating nothing', async () => {
    const { mgr, runtime } = setup({ PI_RUNNER_ENABLED: 'false' })
    expect(await mgr.ensureWarm('anon:s', 'a-b')).toBe('disabled')
    await expect(mgr.claim('anon:s', 'a-b')).rejects.toMatchObject({ code: 'engine_unavailable' })
    expect(runtime.containers()).toHaveLength(0)
  })
})

describe('slug change and caps', () => {
  it('an idle lease for another slug is replaced: old token revoked, old container removed', async () => {
    const { mgr, runtime, revoked } = setup()
    const first = await warm(mgr, 'anon:s', 'one')
    const second = await warm(mgr, 'anon:s', 'two')
    expect(second.id).not.toBe(first.id)
    expect(revoked).toContain(first.id)
    await vi.waitFor(() => expect(runtime.containers()).toHaveLength(1))
    expect(mgr.snapshot()).toHaveLength(1)
  })

  it('a claimed lease for another slug is NOT evicted: claim sees session_busy, ensureWarm returns it', async () => {
    const { mgr } = setup()
    await warm(mgr, 'anon:s', 'one')
    const { lease } = await mgr.claim('anon:s', 'one')
    await expect(mgr.claim('anon:s', 'two')).rejects.toMatchObject({ code: 'session_busy' })
    expect(lease.state).toBe('claimed')
    expect(await mgr.ensureWarm('anon:s', 'two')).toBe(lease)
  })

  it('at the cap with only claimed leases, a new session is busy', async () => {
    const { mgr } = setup({ PI_RUNNER_MAX_CONTAINERS: '1' })
    await warm(mgr, 'anon:a')
    await mgr.claim('anon:a', 'a-b')
    expect(await mgr.ensureWarm('anon:b', 'a-b')).toBe('busy')
    await expect(mgr.claim('anon:b', 'a-b')).rejects.toMatchObject({ code: 'busy' })
  })

  it('minIdleMs protects a freshly idle lease from eviction until it has aged', async () => {
    const { mgr, advance } = setup({ PI_RUNNER_MAX_CONTAINERS: '1', PI_RUNNER_MIN_IDLE_MS: '5000' })
    await warm(mgr, 'anon:a')
    expect(await mgr.ensureWarm('anon:b', 'a-b')).toBe('busy')
    advance(5_000)
    expect(await mgr.ensureWarm('anon:b', 'a-b')).not.toBe('busy')
    expect(mgr.snapshot().map((s) => s.sessionKey)).toEqual(['anon:b'])
  })

  it('the oldest idle lease is the eviction victim', async () => {
    const { mgr, advance } = setup({ PI_RUNNER_MAX_CONTAINERS: '2' })
    await warm(mgr, 'anon:old')
    advance(10)
    await warm(mgr, 'anon:new')
    advance(10)
    await warm(mgr, 'anon:third')
    expect(mgr.snapshot().map((s) => s.sessionKey).sort()).toEqual(['anon:new', 'anon:third'])
  })
})

describe('start failures free the slot', () => {
  it('beforeCreate rejection: ensureWarm rejects with container_start_failed, slot and token released', async () => {
    const { mgr, revoked, runtime } = setup({}, {
      beforeCreate: async () => {
        throw new Error('open egress')
      },
    })
    await expect(mgr.ensureWarm('anon:s', 'a-b')).rejects.toMatchObject({
      code: 'container_start_failed',
      message: 'open egress',
    })
    expect(mgr.snapshot()).toEqual([])
    expect(revoked).toHaveLength(1)
    expect(runtime.containers()).toHaveLength(0)
  })

  it('a runtime error from createAndStart keeps its code', async () => {
    const { mgr, runtime } = setup()
    runtime.failNext('createAndStart', new TryItOutRuntimeError('engine_unavailable', 'down'))
    await expect(mgr.ensureWarm('anon:s', 'a-b')).rejects.toMatchObject({ code: 'engine_unavailable' })
    expect(mgr.snapshot()).toEqual([])
  })

  it('a non-Error thrown by stage is wrapped as container_start_failed with a default message', async () => {
    const { mgr } = setup({}, {
      stage: async () => {
        throw 'boom' // eslint-disable-line no-throw-literal
      },
    })
    await expect(mgr.ensureWarm('anon:s', 'a-b')).rejects.toMatchObject({
      code: 'container_start_failed',
      message: 'container start failed',
    })
  })

  it('a stage failure after create leaves no container behind', async () => {
    const { mgr, runtime } = setup({}, {
      stage: async () => {
        throw new Error('stage')
      },
    })
    await expect(mgr.ensureWarm('anon:s', 'a-b')).rejects.toThrow('stage')
    await vi.waitFor(() => expect(runtime.containers()).toHaveLength(0))
  })

  it('warm timeout: ensureWarm rejects after warmWaitMs', async () => {
    vi.useFakeTimers()
    try {
      const { mgr, runtime } = setup({ PI_RUNNER_WARM_WAIT_MS: '1000' })
      runtime.hang('createAndStart')
      const assertion = expect(mgr.ensureWarm('anon:s', 'a-b')).rejects.toMatchObject({
        code: 'container_start_failed',
        message: expect.stringMatching(/timed out/),
      })
      await vi.advanceTimersByTimeAsync(1_001)
      await assertion
    } finally {
      vi.useRealTimers()
    }
  })

  it('reap expires a stuck warming lease only after 2x warmWaitMs', async () => {
    const { mgr, runtime } = setup({ PI_RUNNER_WARM_WAIT_MS: '1000' })
    runtime.hang('createAndStart')
    void mgr.ensureWarm('anon:s', 'a-b').catch(() => {})
    await mgr.reap(1_000 + 1_999)
    expect(mgr.snapshot()).toHaveLength(1)
    await mgr.reap(1_000 + 2_000)
    expect(mgr.snapshot()).toEqual([])
  })
})

describe('reap, sweep, shutdown', () => {
  it('reap leaves claimed and running leases alone however old they are', async () => {
    const { mgr } = setup({ PI_RUNNER_IDLE_TTL_MS: '1000' })
    await warm(mgr, 'anon:a')
    await warm(mgr, 'anon:b')
    const { lease: a } = await mgr.claim('anon:a', 'a-b')
    const { lease: b } = await mgr.claim('anon:b', 'a-b')
    mgr.markRunning(b)
    await mgr.reap(10_000_000)
    expect(a.state).toBe('claimed')
    expect(b.state).toBe('running')
  })

  it('reap uses >= for the idle TTL boundary', async () => {
    const { mgr } = setup({ PI_RUNNER_IDLE_TTL_MS: '1000' })
    await warm(mgr, 'anon:a') // idleSince = 1000
    await mgr.reap(1_000 + 999)
    expect(mgr.snapshot()).toHaveLength(1)
    await mgr.reap(1_000 + 1_000)
    expect(mgr.snapshot()).toHaveLength(0)
  })

  it('sweepOrphans without ownerId removes every foreign-instance container but never its own', async () => {
    const { mgr, runtime } = setup()
    const own = await warm(mgr, 'anon:a')
    const other = await runtime.createAndStart({ name: 'x', labels: { [LABEL_INSTANCE]: 'other' }, env: [] })
    await mgr.sweepOrphans()
    expect(runtime.containers()).toEqual([own.containerId])
    expect(runtime.containers()).not.toContain(other)
  })

  it('sweepOrphans with ownerId skips other owners and unlabelled legacy containers', async () => {
    const { mgr, runtime } = setup({}, { ownerId: 'me' })
    const mine = await runtime.createAndStart({ name: 'm', labels: { [LABEL_INSTANCE]: 'old', [LABEL_OWNER]: 'me' }, env: [] })
    const theirs = await runtime.createAndStart({ name: 't', labels: { [LABEL_INSTANCE]: 'old', [LABEL_OWNER]: 'them' }, env: [] })
    const legacy = await runtime.createAndStart({ name: 'l', labels: { [LABEL_INSTANCE]: 'old' }, env: [] })
    await mgr.sweepOrphans()
    expect(runtime.containers().sort()).toEqual([theirs, legacy].sort())
    expect(runtime.containers()).not.toContain(mine)
  })

  it('sweepOrphans tolerates a failing remove and propagates a listManaged failure', async () => {
    const { mgr, runtime } = setup()
    await runtime.createAndStart({ name: 'x', labels: { [LABEL_INSTANCE]: 'o1' }, env: [] })
    runtime.failNext('remove', new Error('nope'))
    await expect(mgr.sweepOrphans()).resolves.toBeUndefined()
    runtime.failNext('listManaged', new TryItOutRuntimeError('engine_unavailable', 'down'))
    await expect(mgr.sweepOrphans()).rejects.toMatchObject({ code: 'engine_unavailable' })
  })

  it('shutdown with no leases resolves; startReaper is idempotent; shutdown twice is fine', async () => {
    const { mgr } = setup()
    mgr.startReaper()
    mgr.startReaper()
    await expect(mgr.shutdown()).resolves.toBeUndefined()
    await expect(mgr.shutdown()).resolves.toBeUndefined()
  })

  it('shutdown empties the table, revokes every token, removes every container', async () => {
    const { mgr, runtime, revoked } = setup()
    await warm(mgr, 'anon:a')
    await warm(mgr, 'anon:b')
    await mgr.shutdown()
    expect(mgr.snapshot()).toEqual([])
    expect(revoked).toHaveLength(2)
    expect(runtime.containers()).toHaveLength(0)
  })

  it('a hung engine remove cannot block discard past removeTimeoutMs', async () => {
    vi.useFakeTimers()
    try {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const { mgr, runtime } = setup({}, { removeTimeoutMs: 50 })
      const l = await warm(mgr, 'anon:a')
      runtime.hang('remove')
      const p = mgr.discard(l)
      await vi.advanceTimersByTimeAsync(60)
      await expect(p).resolves.toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('createClientLimiter', () => {
  let t = 0
  beforeEach(() => {
    t = 0
  })

  it('max 0 means unlimited', () => {
    const l = createClientLimiter({ max: 0, windowMs: 1000, now: () => t })
    for (let i = 0; i < 50; i++) expect(l.tryAdmit('c')).toBe(true)
  })

  it('blocked attempts are not recorded, so the window frees up from the first admission', () => {
    const l = createClientLimiter({ max: 2, windowMs: 1000, now: () => t })
    expect(l.tryAdmit('c')).toBe(true) // t=0
    t = 500
    expect(l.tryAdmit('c')).toBe(true)
    t = 900
    expect(l.tryAdmit('c')).toBe(false)
    t = 1000 // admission at t=0 is now outside the window
    expect(l.tryAdmit('c')).toBe(true)
    t = 1001
    expect(l.tryAdmit('c')).toBe(false) // 500 and 1000 still inside
  })

  it('clients are independent', () => {
    const l = createClientLimiter({ max: 1, windowMs: 1000, now: () => t })
    expect(l.tryAdmit('a')).toBe(true)
    expect(l.tryAdmit('b')).toBe(true)
    expect(l.tryAdmit('a')).toBe(false)
  })

  it('stays bounded: after >10k distinct clients the oldest is forgotten and admitted again', () => {
    const l = createClientLimiter({ max: 1, windowMs: 1_000_000, now: () => t })
    expect(l.tryAdmit('first')).toBe(true)
    expect(l.tryAdmit('first')).toBe(false)
    for (let i = 0; i < 10_000; i++) l.tryAdmit('c' + i)
    expect(l.tryAdmit('first')).toBe(true)
  })
})

describe('sessionKey', () => {
  const mkCookies = (initial?: string) => {
    const set = vi.fn()
    return { cookies: { get: (n: string) => (n === TRYOUT_SESSION_COOKIE ? initial : undefined), set }, set }
  }

  it('signed-in user wins over any cookie', () => {
    const { cookies, set } = mkCookies('A'.repeat(22))
    expect(sessionKey({ locals: { user: { email: 'a@b.c' } }, cookies })).toBe('user:a@b.c')
    expect(set).not.toHaveBeenCalled()
  })

  it('a valid cookie is reused without rewriting it', () => {
    const sid = 'abcDEF0123456789_-abcd'
    const { cookies, set } = mkCookies(sid)
    expect(sessionKey({ locals: { user: null }, cookies })).toBe('anon:' + sid)
    expect(set).not.toHaveBeenCalled()
  })

  it.each(['short', 'A'.repeat(23), 'A'.repeat(21) + '!', '../'.repeat(8) + 'ab', ''])(
    'a malformed cookie %j is replaced by a fresh one',
    (bad) => {
      const { cookies, set } = mkCookies(bad)
      const key = sessionKey({ locals: {}, cookies })
      expect(key).toMatch(/^anon:[A-Za-z0-9_-]{22}$/)
      expect(key).not.toBe('anon:' + bad)
      expect(set).toHaveBeenCalledTimes(1)
      const [name, value, opts] = set.mock.calls[0]
      expect(name).toBe(TRYOUT_SESSION_COOKIE)
      expect(key).toBe('anon:' + value)
      expect(opts).toMatchObject({ httpOnly: true, maxAge: 86400 })
    },
  )

  it('without a cookie jar the key is ephemeral and differs per call', () => {
    const a = sessionKey({})
    expect(a).toMatch(/^anon:ephemeral-/)
    expect(a).not.toBe(sessionKey({}))
  })
})
