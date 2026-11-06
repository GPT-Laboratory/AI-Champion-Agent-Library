// Phase 9 chaos: lease races. Fake runtime only, no real timers beyond setImmediate yields.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetProxy, authenticateBearer, registerLeaseToken, revokeLeaseToken } from './llmProxy'
import { createLeaseManager, type Lease, type LeaseManager } from './leaseManager'
import { parseRunnerConfig } from './runnerConfig'
import { createFakeRuntime, type FakeRuntime } from './runtimeFake'

const CAP = 3
let clock = 1_000_000
let runtime: FakeRuntime
let mgr: LeaseManager
let maxContainers = 0
const tokens = new Map<string, string>() // leaseId -> token
const removeCount = new Map<string, number>()
const revokeCount = new Map<string, number>()

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r))
}

function build(cap = CAP) {
  runtime = createFakeRuntime()
  const origRemove = runtime.remove.bind(runtime)
  runtime.remove = async (id) => {
    removeCount.set(id, (removeCount.get(id) ?? 0) + 1)
    return origRemove(id)
  }
  const origCreate = runtime.createAndStart.bind(runtime)
  runtime.createAndStart = async (spec) => {
    const id = await origCreate(spec)
    maxContainers = Math.max(maxContainers, runtime.containers().length)
    return id
  }
  mgr = createLeaseManager({
    runtime,
    config: parseRunnerConfig({
      PI_RUNNER_MAX_CONTAINERS: String(cap),
      PI_RUNNER_MIN_IDLE_MS: '0',
      PI_RUNNER_IDLE_TTL_MS: '300000',
    }),
    tokens: {
      mint: (id) => {
        const t = registerLeaseToken(id)
        tokens.set(id, t)
        return t
      },
      revoke: (id) => {
        revokeCount.set(id, (revokeCount.get(id) ?? 0) + 1)
        revokeLeaseToken(id)
      },
    },
    stage: async () => {
      await Promise.resolve()
    },
    instanceId: 'inst',
    now: () => clock,
  })
}

function assertInvariants(label: string, settled: boolean) {
  const snap = mgr.snapshot()
  expect(snap.length, `${label}: cap`).toBeLessThanOrEqual(CAP)
  // A container of an evicted lease lives until its (async) removal finishes, so mid-flight the
  // engine may briefly hold more than the cap; every surplus container must belong to a terminal
  // lease. Once settled the count must match the live leases exactly.
  const terminal = tokens.size - snap.length
  expect(runtime.containers().length, `${label}: containers <= cap + dying`).toBeLessThanOrEqual(CAP + terminal)
  const live = new Set(snap.map((s) => s.id))
  for (const [leaseId, token] of tokens) {
    if (!live.has(leaseId)) {
      expect(authenticateBearer('Bearer ' + token), `${label}: token of terminal lease ${leaseId}`).toBeNull()
    }
  }
  if (settled) {
    expect(runtime.containers().length, `${label}: containers == live leases`).toBe(snap.length)
  }
  for (const [id, n] of removeCount) expect(n, `${label}: container ${id} removed once`).toBe(1)
  for (const [id, n] of revokeCount) expect(n, `${label}: token ${id} revoked once`).toBeLessThanOrEqual(1)
}

beforeEach(() => {
  clock = 1_000_000
  maxContainers = 0
  tokens.clear()
  removeCount.clear()
  revokeCount.clear()
  __resetProxy()
  build()
})
afterEach(() => vi.restoreAllMocks())

describe('chaos: lease races', () => {
  it('N > cap concurrent claims never exceed the cap; the rest are busy', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, (_, i) => mgr.claim('s' + i, 'agent-a')),
    )
    const ok = results.filter((r) => r.status === 'fulfilled')
    const busy = results.filter(
      (r) => r.status === 'rejected' && (r.reason as { code?: string }).code === 'busy',
    )
    expect(ok).toHaveLength(CAP)
    expect(busy).toHaveLength(12 - CAP)
    expect(maxContainers).toBeLessThanOrEqual(CAP)
    await flush()
    assertInvariants('claims', true)
  })

  it('N > cap concurrent warm-ups: cap respected, extras report busy', async () => {
    const out = await Promise.all(Array.from({ length: 10 }, (_, i) => mgr.ensureWarm('w' + i, 'agent-a')))
    expect(out.filter((o) => o === 'busy')).toHaveLength(10 - CAP)
    expect(maxContainers).toBeLessThanOrEqual(CAP)
    await flush()
    assertInvariants('warm', true)
  })

  it('the same session claiming twice concurrently gets one lease and one container', async () => {
    const [a, b] = await Promise.allSettled([mgr.claim('S', 'agent-a'), mgr.claim('S', 'agent-a')])
    const fulfilled = [a, b].filter((r) => r.status === 'fulfilled')
    expect(fulfilled).toHaveLength(1)
    const rejected = [a, b].find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect((rejected.reason as { code?: string }).code).toBe('session_busy')
    await flush()
    expect(runtime.containers()).toHaveLength(1)
    assertInvariants('dup', true)
  })

  it('release/discard/reap racing on one lease end in one terminal state, one removal, one revoke', async () => {
    const { lease } = await mgr.claim('S', 'agent-a')
    mgr.release(lease)
    clock += 400_000
    await Promise.all([mgr.discard(lease), mgr.reap(), mgr.discard(lease), mgr.reap()])
    mgr.release(lease) // late release must not resurrect it
    await flush()
    expect(['evicting', 'expired']).toContain(lease.state)
    expect(mgr.snapshot()).toHaveLength(0)
    expect(runtime.containers()).toHaveLength(0)
    expect(revokeCount.get(lease.id)).toBe(1)
    assertInvariants('terminal', true)
  })

  it('seeded random interleavings (200 iterations) keep every invariant', async () => {
    for (let iter = 0; iter < 200; iter++) {
      const seed = 0xc0ffee + iter
      const rnd = mulberry32(seed)
      __resetProxy()
      tokens.clear()
      removeCount.clear()
      revokeCount.clear()
      build()
      const held: Lease[] = []
      const ops: Promise<unknown>[] = []
      const steps = 8 + Math.floor(rnd() * 12)
      for (let i = 0; i < steps; i++) {
        const session = 's' + Math.floor(rnd() * 6)
        const slug = rnd() < 0.8 ? 'agent-a' : 'agent-b'
        const pick = rnd()
        if (pick < 0.35) {
          ops.push(
            mgr
              .claim(session, slug)
              .then((r) => void held.push(r.lease))
              .catch(() => {}),
          )
        } else if (pick < 0.5) {
          ops.push(mgr.ensureWarm(session, slug).catch(() => {}))
        } else if (pick < 0.65 && held.length) {
          mgr.release(held[Math.floor(rnd() * held.length)])
        } else if (pick < 0.8 && held.length) {
          ops.push(mgr.discard(held[Math.floor(rnd() * held.length)]))
        } else if (pick < 0.9) {
          clock += Math.floor(rnd() * 200_000)
          ops.push(mgr.reap())
        } else {
          // yield a tick so some warm-ups complete mid-sequence
          await Promise.resolve()
        }
        assertInvariants(`seed ${seed} step ${i}`, false)
      }
      await Promise.allSettled(ops)
      await flush()
      assertInvariants(`seed ${seed} settled`, true)
    }
  })

  it('token of an evicted lease is dead when the same session gets a new lease', async () => {
    const a = await mgr.ensureWarm('S', 'agent-a')
    if (typeof a === 'string') throw new Error(a)
    const tokenA = tokens.get(a.id)!
    expect(authenticateBearer('Bearer ' + tokenA)).not.toBeNull()
    const b = await mgr.ensureWarm('S', 'agent-b') // different slug evicts A
    if (typeof b === 'string') throw new Error(b)
    const tokenB = tokens.get(b.id)!
    expect(b.id).not.toBe(a.id)
    expect(tokenB).not.toBe(tokenA)
    expect(authenticateBearer('Bearer ' + tokenA)).toBeNull()
    expect(authenticateBearer('Bearer ' + tokenB)).not.toBeNull()
    await flush()
    assertInvariants('reuse', true)
  })
})
