import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetProxy, authenticateBearer, registerLeaseToken, revokeLeaseToken } from './llmProxy'
import { createLeaseManager, type LeaseManager } from './leaseManager'
import { parseRunnerConfig } from './runnerConfig'
import { TryItOutRuntimeError } from './runtime'
import { createFakeRuntime, type FakeRuntime } from './runtimeFake'

let clock = 1_000_000
let runtime: FakeRuntime
let mgr: LeaseManager
const tokensSeen = new Map<string, string>() // leaseId -> token

function build(env: Record<string, string> = {}, stage?: Parameters<typeof createLeaseManager>[0]['stage']) {
  runtime = createFakeRuntime()
  const config = parseRunnerConfig({
    PI_RUNNER_MAX_CONTAINERS: '2',
    PI_RUNNER_MIN_IDLE_MS: '60000',
    PI_RUNNER_IDLE_TTL_MS: '300000',
    ...env,
  })
  mgr = createLeaseManager({
    runtime,
    config,
    tokens: {
      mint: (id) => {
        const t = registerLeaseToken(id)
        tokensSeen.set(id, t)
        return t
      },
      revoke: revokeLeaseToken,
    },
    stage: stage ?? (async () => {}),
    instanceId: 'inst-1',
    now: () => clock,
  })
  return mgr
}

async function warm(session: string, slug = 'agent-a') {
  const l = await mgr.ensureWarm(session, slug)
  if (typeof l === 'string') throw new Error('unexpected ' + l)
  return l
}

beforeEach(() => {
  clock = 1_000_000
  tokensSeen.clear()
  __resetProxy()
  build()
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('cap and eviction', () => {
  it('cap: evicts the oldest idle lease idle long enough and revokes its token', async () => {
    const a = await warm('A')
    clock += 1000
    await warm('B')
    clock += 61_000
    const tokenA = tokensSeen.get(a.id)!
    expect(authenticateBearer('Bearer ' + tokenA)).not.toBeNull()
    const { lease } = await mgr.claim('C', 'agent-a')
    expect(a.state).toBe('evicting')
    expect(authenticateBearer('Bearer ' + tokenA)).toBeNull()
    expect(lease.sessionKey).toBe('C')
    expect(runtime.containers()).toHaveLength(2)
  })

  it('min idle: refuses to evict leases idle for less than the minimum', async () => {
    await warm('A')
    await warm('B')
    clock += 10_000
    await expect(mgr.claim('C', 'agent-a')).rejects.toMatchObject({ code: 'busy' })
    expect(await mgr.ensureWarm('C', 'agent-a')).toBe('busy')
    expect(runtime.containers()).toHaveLength(2)
    expect(runtime.calls.filter((c) => c === 'remove')).toHaveLength(0)
  })

  it('busy: all slots claimed or running', async () => {
    await mgr.claim('A', 'agent-a')
    const { lease } = await mgr.claim('B', 'agent-a')
    mgr.markRunning(lease)
    clock += 600_000
    await expect(mgr.claim('C', 'agent-a')).rejects.toMatchObject({
      code: 'busy',
      message: 'all Try It Out slots are busy, try again shortly',
    })
  })

  it('race: a claim and an eviction in the same tick cannot both win', async () => {
    const a = await warm('A')
    clock += 1000
    await warm('B')
    clock += 61_000
    // B is newer; A is the eviction candidate. Claim A and C in the same tick.
    const results = await Promise.allSettled([mgr.claim('A', 'agent-a'), mgr.claim('C', 'agent-a')])
    expect(results[0].status).toBe('fulfilled')
    expect(a.state).toBe('claimed')
    // C must have evicted B (the only remaining idle), never the claimed A
    expect(results[1].status).toBe('fulfilled')
    expect(mgr.snapshot().map((s) => s.sessionKey).sort()).toEqual(['A', 'C'])
  })

  it('race: when the only candidate gets claimed first, the other session gets busy', async () => {
    const a = await warm('A')
    await mgr.claim('B', 'agent-a')
    clock += 61_000
    const results = await Promise.allSettled([mgr.claim('A', 'agent-a'), mgr.claim('C', 'agent-a')])
    expect(a.state).toBe('claimed')
    expect(results[0].status).toBe('fulfilled')
    expect(results[1]).toMatchObject({ status: 'rejected', reason: { code: 'busy' } })
  })
})

describe('session rules', () => {
  it('session_busy: second claim while one is running', async () => {
    const { lease } = await mgr.claim('A', 'agent-a')
    mgr.markRunning(lease)
    await expect(mgr.claim('A', 'agent-a')).rejects.toMatchObject({ code: 'session_busy' })
    expect((await mgr.claim('A', 'agent-b').catch((e) => e)).code).toBe('session_busy')
  })

  it('replace: a different agent replaces an idle lease; a running one is kept', async () => {
    const a = await warm('A', 'agent-a')
    const oldId = a.containerId!
    const b = await warm('A', 'agent-b')
    expect(b).not.toBe(a)
    expect(a.state).toBe('evicting')
    expect(runtime.containers()).not.toContain(oldId)
    const labels = (await runtime.listManaged()).map((c) => c.labels['aic.agent'])
    expect(labels).toEqual(['agent-b'])

    const { lease } = await mgr.claim('A', 'agent-b')
    mgr.markRunning(lease)
    const kept = await mgr.ensureWarm('A', 'agent-c')
    expect(kept).toBe(lease)
    expect(runtime.calls.filter((c) => c === 'createAndStart')).toHaveLength(2)
  })

  it('concurrent ensureWarm for one session creates exactly one container', async () => {
    const [x, y, z] = await Promise.all([
      mgr.ensureWarm('A', 'agent-a'),
      mgr.ensureWarm('A', 'agent-a'),
      mgr.ensureWarm('A', 'agent-a'),
    ])
    expect(x).toBe(y)
    expect(y).toBe(z)
    expect(runtime.calls.filter((c) => c === 'createAndStart')).toHaveLength(1)
  })

  it('claim while warming waits for ready and reports warm false', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    build({}, async () => gate)
    const warming = mgr.ensureWarm('A', 'agent-a')
    const claimed = mgr.claim('A', 'agent-a')
    await new Promise((r) => setTimeout(r, 5))
    release()
    await warming
    const res = await claimed
    expect(res.warm).toBe(false)
    expect(res.lease.state).toBe('claimed')
  })

  it('claim while warming times out after warmWaitMs', async () => {
    vi.useFakeTimers()
    build({ PI_RUNNER_WARM_WAIT_MS: '1000' }, () => new Promise<void>(() => {}))
    const p = mgr.claim('A', 'agent-a')
    const assertion = expect(p).rejects.toMatchObject({
      code: 'container_start_failed',
      message: expect.stringContaining('timed out'),
    })
    await vi.advanceTimersByTimeAsync(1500)
    await assertion
  })
})

describe('reaper, failures, sweep, shutdown', () => {
  it('reaper: removes idle leases past the TTL and revokes tokens; never claimed or running', async () => {
    const a = await warm('A')
    const { lease: b } = await mgr.claim('B', 'agent-a')
    mgr.markRunning(b)
    const tokenA = tokensSeen.get(a.id)!
    clock += 299_000
    await mgr.reap()
    expect(a.state).toBe('idle')
    clock += 2000
    await mgr.reap()
    expect(a.state).toBe('expired')
    expect(authenticateBearer('Bearer ' + tokenA)).toBeNull()
    expect(b.state).toBe('running')
    expect(runtime.containers()).toHaveLength(1)
  })

  it('WR-01: reaps a lease stuck in warming past 2x warmWaitMs, freeing its slot and token', async () => {
    build({ PI_RUNNER_WARM_WAIT_MS: '1000', PI_RUNNER_MAX_CONTAINERS: '1' }, () => new Promise<void>(() => {}))
    void mgr.ensureWarm('A', 'agent-a')
    await Promise.resolve()
    const [stuck] = mgr.snapshot()
    expect(stuck.state).toBe('warming')
    const token = [...tokensSeen.values()][0]
    expect(authenticateBearer('Bearer ' + token)).not.toBeNull()

    clock += 1999
    await mgr.reap()
    expect(mgr.snapshot()).toHaveLength(1) // not yet past the bound
    expect(await mgr.ensureWarm('B', 'agent-a')).toBe('busy') // the stuck lease holds the only slot
    clock += 2
    await mgr.reap()
    expect(mgr.snapshot()).toHaveLength(0)
    expect(authenticateBearer('Bearer ' + token)).toBeNull()
    expect(runtime.containers()).toHaveLength(0)

    // the slot is free again: a new session gets a lease instead of `busy`
    void mgr.ensureWarm('B', 'agent-a')
    await Promise.resolve()
    expect(mgr.snapshot().map((l) => l.sessionKey)).toEqual(['B'])
  })

  it('startReaper is idempotent and its timer is unref-ed; shutdown stops it', async () => {
    vi.useFakeTimers()
    const spy = vi.spyOn(globalThis, 'setInterval')
    mgr.startReaper()
    mgr.startReaper()
    expect(spy).toHaveBeenCalledTimes(1)
    await mgr.shutdown()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('engine_unavailable on start leaves no lease behind', async () => {
    runtime.failNext('createAndStart', new TryItOutRuntimeError('engine_unavailable', 'no socket'))
    await expect(mgr.claim('A', 'agent-a')).rejects.toMatchObject({ code: 'engine_unavailable' })
    expect(mgr.snapshot()).toHaveLength(0)
  })

  it('stage failure removes the container and revokes the token', async () => {
    build({}, async () => {
      throw new Error('stage boom')
    })
    await expect(mgr.claim('A', 'agent-a')).rejects.toMatchObject({ code: 'container_start_failed' })
    await new Promise((r) => setTimeout(r, 5))
    expect(runtime.containers()).toHaveLength(0)
    const [tok] = [...tokensSeen.values()]
    expect(authenticateBearer('Bearer ' + tok)).toBeNull()
    expect(mgr.snapshot()).toHaveLength(0)
  })

  it('orphan sweep removes only containers of other instances', async () => {
    const mine = await warm('A')
    const foreign = await runtime.createAndStart({
      name: 'old',
      labels: { 'aic.tryitout': '1', 'aic.instance': 'old' },
      env: [],
    })
    await mgr.sweepOrphans()
    expect(runtime.containers()).toEqual([mine.containerId])
    expect(runtime.containers()).not.toContain(foreign)
  })

  it('owner-scoped sweep spares containers of a different owner and unlabelled legacy ones (WR-08)', async () => {
    runtime = createFakeRuntime()
    mgr = createLeaseManager({
      runtime,
      config: parseRunnerConfig({ PI_RUNNER_MAX_CONTAINERS: '2' }),
      tokens: { mint: registerLeaseToken, revoke: revokeLeaseToken },
      stage: async () => {},
      instanceId: 'inst-1',
      ownerId: 'deploy-a',
      now: () => clock,
    })
    const mine = await warm('A')
    const listed = await runtime.listManaged()
    expect(listed.find((c) => c.id === mine.containerId)?.labels['aic.owner']).toBe('deploy-a')
    const mk = (labels: Record<string, string>) =>
      runtime.createAndStart({ name: 'x', labels: { 'aic.tryitout': '1', ...labels }, env: [] })
    const sameOwnerOld = await mk({ 'aic.instance': 'old', 'aic.owner': 'deploy-a' })
    const otherOwner = await mk({ 'aic.instance': 'old', 'aic.owner': 'deploy-b' })
    const legacy = await mk({ 'aic.instance': 'old' })
    await mgr.sweepOrphans()
    const left = runtime.containers()
    expect(left).toContain(mine.containerId)
    expect(left).not.toContain(sameOwnerOld)
    expect(left).toContain(otherOwner)
    expect(left).toContain(legacy)
  })

  it('shutdown removes all of this instance containers', async () => {
    await warm('A')
    await warm('B')
    await mgr.shutdown()
    expect(runtime.containers()).toHaveLength(0)
    expect(mgr.snapshot()).toHaveLength(0)
  })

  it('disabled: ensureWarm returns disabled and claim rejects engine_unavailable', async () => {
    build({ PI_RUNNER_ENABLED: 'false' })
    expect(await mgr.ensureWarm('A', 'agent-a')).toBe('disabled')
    await expect(mgr.claim('A', 'agent-a')).rejects.toMatchObject({ code: 'engine_unavailable' })
    expect(runtime.calls).toHaveLength(0)
  })
})
