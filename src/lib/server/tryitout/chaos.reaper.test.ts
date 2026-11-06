// Phase 9 chaos: reaper timing. Fake runtime, injected clock and fake timers only.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetProxy, authenticateBearer, registerLeaseToken, revokeLeaseToken } from './llmProxy'
import { createLeaseManager, type Lease, type LeaseManager } from './leaseManager'
import { parseRunnerConfig, type RunnerConfig } from './runnerConfig'
import { LABEL_INSTANCE, LABEL_MANAGED, LABEL_OWNER } from './runtime'
import { createFakeRuntime, type FakeRuntime } from './runtimeFake'

const IDLE_TTL = 300_000
const WARM_WAIT = 5_000
let clock = 5_000_000
let runtime: FakeRuntime
let mgr: LeaseManager
let config: RunnerConfig
const tokens = new Map<string, string>()

function build(opts: { ownerId?: string; stage?: () => Promise<void> } = {}) {
  runtime = createFakeRuntime()
  config = parseRunnerConfig({
    PI_RUNNER_MAX_CONTAINERS: '4',
    PI_RUNNER_MIN_IDLE_MS: '0',
    PI_RUNNER_IDLE_TTL_MS: String(IDLE_TTL),
    PI_RUNNER_WARM_WAIT_MS: String(WARM_WAIT),
  })
  mgr = createLeaseManager({
    runtime,
    config,
    tokens: {
      mint: (id) => {
        const t = registerLeaseToken(id)
        tokens.set(id, t)
        return t
      },
      revoke: revokeLeaseToken,
    },
    stage: opts.stage ?? (async () => {}),
    instanceId: 'inst-now',
    ownerId: opts.ownerId,
    now: () => clock,
  })
}

async function warm(session: string): Promise<Lease> {
  const l = await mgr.ensureWarm(session, 'agent-a')
  if (typeof l === 'string') throw new Error(l)
  return l
}

beforeEach(() => {
  clock = 5_000_000
  tokens.clear()
  __resetProxy()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  build()
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('chaos: idle TTL boundary', () => {
  it('is not reaped at TTL-1 and is reaped at TTL', async () => {
    const l = await warm('A')
    const idleSince = l.idleSince
    clock = idleSince + IDLE_TTL - 1
    await mgr.reap()
    expect(l.state).toBe('idle')
    expect(runtime.containers()).toHaveLength(1)
    clock = idleSince + IDLE_TTL
    await mgr.reap()
    expect(l.state).toBe('expired')
    expect(runtime.containers()).toHaveLength(0)
    expect(authenticateBearer('Bearer ' + tokens.get(l.id))).toBeNull()
    expect(mgr.snapshot()).toHaveLength(0)
  })

  it('claimed and running leases are never reaped by idle TTL; TTL restarts when the job ends', async () => {
    const { lease } = await mgr.claim('A', 'agent-a')
    clock += 10 * IDLE_TTL
    await mgr.reap()
    expect(lease.state).toBe('claimed')
    mgr.markRunning(lease)
    clock += 10 * IDLE_TTL
    await mgr.reap()
    expect(lease.state).toBe('running')
    expect(runtime.containers()).toHaveLength(1)

    mgr.release(lease) // job ended: idleSince = now
    clock += IDLE_TTL - 1
    await mgr.reap()
    expect(lease.state).toBe('idle')
    clock += 1
    await mgr.reap()
    expect(lease.state).toBe('expired')
  })
})

describe('chaos: stalled warm-up', () => {
  it('a warming lease is not reaped before 2x warmWaitMs and is reaped at it', async () => {
    vi.useFakeTimers()
    build({ stage: () => new Promise<void>(() => {}) })
    const pending = mgr.ensureWarm('A', 'agent-a').catch(() => 'warm-timeout')
    await vi.advanceTimersByTimeAsync(WARM_WAIT + 1) // the caller gave up at warmWaitMs
    expect(await pending).toBe('warm-timeout')
    const created = clock
    const [snap] = mgr.snapshot()
    expect(snap.state).toBe('warming')

    clock = created + 2 * WARM_WAIT - 1
    await mgr.reap()
    expect(mgr.snapshot()[0]?.state).toBe('warming')
    expect(runtime.containers()).toHaveLength(1)

    clock = created + 2 * WARM_WAIT
    await mgr.reap()
    expect(mgr.snapshot()).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(5)
    expect(runtime.containers()).toHaveLength(0)
    expect(authenticateBearer('Bearer ' + [...tokens.values()][0])).toBeNull()
  })
})

describe('chaos: clock anomalies and concurrency', () => {
  it('a clock that jumps backwards neither reaps early nor throws', async () => {
    const idle = await warm('A')
    const { lease } = await mgr.claim('B', 'agent-a')
    clock -= 10 * IDLE_TTL
    await expect(mgr.reap()).resolves.toBeUndefined()
    expect(idle.state).toBe('idle')
    expect(lease.state).toBe('claimed')
    expect(runtime.containers()).toHaveLength(2)
  })

  it('reap racing with discard and a second reap removes the container once', async () => {
    const l = await warm('A')
    const removes: string[] = []
    const orig = runtime.remove.bind(runtime)
    runtime.remove = async (id) => {
      removes.push(id)
      return orig(id)
    }
    clock = l.idleSince + IDLE_TTL
    await Promise.all([mgr.reap(), mgr.discard(l), mgr.reap(), mgr.discard(l)])
    expect(removes).toHaveLength(1)
    expect(runtime.containers()).toHaveLength(0)
  })

  it('reap during an in-flight claim of a warming lease leaves the claim consistent', async () => {
    const claim = mgr.claim('A', 'agent-a')
    await mgr.reap() // warming lease is young: must not be touched
    const { lease } = await claim
    expect(lease.state).toBe('claimed')
    expect(runtime.containers()).toHaveLength(1)
  })
})

describe('chaos: reaper timer lifecycle', () => {
  it('ticks every 30 s while running and stops after shutdown', async () => {
    vi.useFakeTimers()
    build()
    const l = await warm('A')
    mgr.startReaper()
    mgr.startReaper() // idempotent
    expect(vi.getTimerCount()).toBe(1)
    clock = l.idleSince + IDLE_TTL
    await vi.advanceTimersByTimeAsync(30_000)
    expect(l.state).toBe('expired')

    const spy = vi.spyOn(mgr, 'reap')
    await mgr.shutdown()
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(5 * 30_000)
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('chaos: orphan sweep owner scoping (WR-08)', () => {
  async function seed(labels: Record<string, string>) {
    return runtime.createAndStart({ name: 'x', labels: { [LABEL_MANAGED]: '1', ...labels }, env: [] })
  }

  it('keeps foreign-owner, unlabelled-owner and current-instance containers; removes same-owner stale ones', async () => {
    build({ ownerId: 'prod' })
    const foreign = await seed({ [LABEL_INSTANCE]: 'old', [LABEL_OWNER]: 'dev-laptop' })
    const legacy = await seed({ [LABEL_INSTANCE]: 'old' })
    const stale = await seed({ [LABEL_INSTANCE]: 'old', [LABEL_OWNER]: 'prod' })
    const mine = await seed({ [LABEL_INSTANCE]: 'inst-now', [LABEL_OWNER]: 'prod' })
    await mgr.sweepOrphans()
    const left = runtime.containers()
    expect(left).toContain(foreign)
    expect(left).toContain(legacy)
    expect(left).toContain(mine)
    expect(left).not.toContain(stale)
  })
})
