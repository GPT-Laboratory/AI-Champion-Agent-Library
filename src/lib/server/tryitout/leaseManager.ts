// src/lib/server/tryitout/leaseManager.ts
// Server-only module — SvelteKit enforces that src/lib/server/ cannot be imported client-side.
//
// Per-session container leases (D-06..D-10). One lease per session key, a
// global cap, oldest-idle eviction with a minimum idle age, an idle-TTL
// reaper and an instance-labelled orphan sweep.
//
// Concurrency rule (D-08): Node is single-threaded, so every state check and
// state change below is synchronous (no await between check and set). A claim
// and an eviction can therefore never both win. A lease is put in the map
// BEFORE its first await so concurrent callers see it.

import { randomBytes } from 'node:crypto'
import {
  LABEL_AGENT,
  LABEL_CREATED,
  LABEL_INSTANCE,
  LABEL_MANAGED,
  LABEL_OWNER,
  TryItOutRuntimeError,
  isTryItOutRuntimeError,
  type ContainerRuntime,
} from './runtime'
import type { RunnerConfig } from './runnerConfig'

export type LeaseState = 'warming' | 'idle' | 'claimed' | 'running' | 'evicting' | 'expired'

export interface Lease {
  readonly id: string
  readonly sessionKey: string
  readonly slug: string
  state: LeaseState
  containerId: string | null
  createdAt: number
  idleSince: number
  ready: Promise<void>
}

export interface TokenIssuer {
  mint(leaseId: string): string
  revoke(leaseId: string): void
}

export interface ClaimResult {
  lease: Lease
  warm: boolean
}

export interface LeaseManager {
  ensureWarm(sessionKey: string, slug: string): Promise<Lease | 'busy' | 'disabled'>
  claim(sessionKey: string, slug: string): Promise<ClaimResult>
  markRunning(lease: Lease): void
  release(lease: Lease): void
  discard(lease: Lease): Promise<void>
  reap(now?: number): Promise<void>
  startReaper(): void
  sweepOrphans(): Promise<void>
  shutdown(): Promise<void>
  snapshot(): Array<{ id: string; sessionKey: string; slug: string; state: LeaseState }>
}

export interface LeaseManagerDeps {
  runtime: ContainerRuntime
  config: RunnerConfig
  tokens: TokenIssuer
  stage: (lease: Lease, containerId: string) => Promise<void>
  /** Awaited before every container create (WR-03): the open-egress/network guard. */
  beforeCreate?: () => Promise<void>
  instanceId: string
  /**
   * Stable deployment id (WR-08). When set, containers are labelled with it and the orphan sweep
   * only touches containers carrying the same owner (unlabelled legacy containers are left alone).
   */
  ownerId?: string
  now?: () => number
  /** Bound on one engine `remove` call (default REMOVE_TIMEOUT_MS). */
  removeTimeoutMs?: number
}

/** A hung engine `remove` must not hold a discard/eviction/shutdown forever (09-02). */
export const REMOVE_TIMEOUT_MS = 15_000

const REAP_INTERVAL_MS = 30_000
const SHUTDOWN_CAP_MS = 3_000

function busyError(): TryItOutRuntimeError {
  return new TryItOutRuntimeError('busy', 'all Try It Out slots are busy, try again shortly')
}

// A lease still `warming` after this many warmWaitMs is considered stuck and reaped (WR-01).
const STUCK_WARMING_FACTOR = 2

export function createLeaseManager(deps: LeaseManagerDeps): LeaseManager {
  const { runtime, config, tokens, instanceId } = deps
  const now = deps.now ?? (() => Date.now())
  const leases = new Map<string, Lease>()
  let reaperTimer: ReturnType<typeof setInterval> | null = null

  // One engine remove per container: a second discard/evict/reap of an already-evicting lease
  // awaits the same removal instead of issuing another one (09-02 chaos finding).
  const removals = new WeakMap<Lease, Promise<void>>()
  function removeContainer(lease: Lease): Promise<void> {
    const id = lease.containerId
    if (!id) return Promise.resolve()
    const existing = removals.get(lease)
    if (existing) return existing
    const attempt = runtime.remove(id).then(
      () => undefined,
      (err: unknown) => {
        console.warn('Try It Out: removing container failed:', err instanceof Error ? err.message : String(err))
      },
    )
    let timer: ReturnType<typeof setTimeout> | undefined
    const bound = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        console.warn('Try It Out: removing container timed out; the orphan sweep will retry')
        resolve()
      }, deps.removeTimeoutMs ?? REMOVE_TIMEOUT_MS)
      timer.unref?.()
    })
    const p = Promise.race([attempt, bound]).finally(() => {
      if (timer) clearTimeout(timer)
    })
    removals.set(lease, p)
    return p
  }

  // Synchronous: state, token revocation and map removal happen in one step.
  // The (async) container removal is returned for the caller to await or not.
  function evictSync(lease: Lease, finalState: 'evicting' | 'expired' = 'evicting'): Promise<void> {
    lease.state = finalState
    tokens.revoke(lease.id)
    if (leases.get(lease.sessionKey) === lease) leases.delete(lease.sessionKey)
    return removeContainer(lease)
  }

  function pickEvictionCandidate(): Lease | null {
    const t = now()
    let best: Lease | null = null
    for (const l of leases.values()) {
      if (l.state !== 'idle') continue
      if (t - l.idleSince < config.minIdleMs) continue
      if (!best || l.idleSince < best.idleSince) best = l
    }
    return best
  }

  async function startLease(lease: Lease): Promise<void> {
    try {
      const token = tokens.mint(lease.id)
      await deps.beforeCreate?.()
      const id = await runtime.createAndStart({
        name: 'aic-pi-' + randomBytes(6).toString('hex'),
        labels: {
          [LABEL_MANAGED]: '1',
          [LABEL_INSTANCE]: instanceId,
          ...(deps.ownerId ? { [LABEL_OWNER]: deps.ownerId } : {}),
          [LABEL_AGENT]: lease.slug,
          [LABEL_CREATED]: String(lease.createdAt),
        },
        env: ['AIC_LLM_TOKEN=' + token],
      })
      lease.containerId = id
      if (lease.state !== 'warming') {
        // Evicted while the container was being created.
        await removeContainer(lease)
        throw new TryItOutRuntimeError('container_start_failed', 'container was removed while warming')
      }
      await deps.stage(lease, id)
      if (lease.state !== 'warming') {
        await removeContainer(lease)
        throw new TryItOutRuntimeError('container_start_failed', 'container was removed while warming')
      }
      lease.state = 'idle'
      lease.idleSince = now()
    } catch (err) {
      if (lease.state === 'warming') {
        void evictSync(lease, 'expired')
      }
      if (isTryItOutRuntimeError(err)) throw err
      throw new TryItOutRuntimeError(
        'container_start_failed',
        err instanceof Error ? err.message : 'container start failed',
      )
    }
  }

  // Synchronous. Returns the lease to use for (sessionKey, slug), creating a
  // warming one when needed. Throws busy when no slot can be freed.
  function acquire(sessionKey: string, slug: string): Lease {
    const existing = leases.get(sessionKey)
    if (existing) {
      if (existing.slug === slug) return existing
      if (existing.state === 'claimed' || existing.state === 'running') return existing
      void evictSync(existing)
    }
    if (leases.size >= config.maxContainers) {
      const victim = pickEvictionCandidate()
      if (!victim) throw busyError()
      void evictSync(victim)
    }
    const t = now()
    const lease: Lease = {
      id: randomBytes(8).toString('hex'),
      sessionKey,
      slug,
      state: 'warming',
      containerId: null,
      createdAt: t,
      idleSince: t,
      ready: Promise.resolve(),
    }
    leases.set(sessionKey, lease)
    lease.ready = startLease(lease)
    lease.ready.catch(() => {}) // never an unhandled rejection for unawaited warm-ups
    return lease
  }

  async function awaitReady(lease: Lease): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new TryItOutRuntimeError('container_start_failed', 'container warm-up timed out')),
        config.warmWaitMs,
      )
    })
    try {
      await Promise.race([lease.ready, timeout])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  const manager: LeaseManager = {
    async ensureWarm(sessionKey, slug) {
      if (!config.enabled) return 'disabled'
      let lease: Lease
      try {
        lease = acquire(sessionKey, slug)
      } catch (err) {
        if (isTryItOutRuntimeError(err) && err.code === 'busy') {
          console.info('Try It Out: no free slot to warm a container')
          return 'busy'
        }
        throw err
      }
      if (lease.state === 'warming') await awaitReady(lease)
      return lease
    },

    async claim(sessionKey, slug) {
      if (!config.enabled) {
        throw new TryItOutRuntimeError('engine_unavailable', 'container runner disabled (PI_RUNNER_ENABLED=false)')
      }
      const current = leases.get(sessionKey)
      if (current && (current.state === 'claimed' || current.state === 'running')) {
        throw new TryItOutRuntimeError('session_busy', 'a job is already running in your session')
      }
      const lease = acquire(sessionKey, slug) // may throw busy
      if (lease.state === 'idle') {
        lease.state = 'claimed' // synchronous CAS
        return { lease, warm: true }
      }
      if (lease.state === 'claimed' || lease.state === 'running') {
        throw new TryItOutRuntimeError('session_busy', 'a job is already running in your session')
      }
      await awaitReady(lease)
      const after = lease.state as LeaseState // mutated by other callers during the await
      if (after === 'idle' && leases.get(sessionKey) === lease) {
        lease.state = 'claimed'
        return { lease, warm: false }
      }
      if (after === 'claimed' || after === 'running') {
        throw new TryItOutRuntimeError('session_busy', 'a job is already running in your session')
      }
      throw new TryItOutRuntimeError('container_start_failed', 'container was removed while warming')
    },

    markRunning(lease) {
      if (lease.state !== 'claimed') {
        throw new Error(`cannot start a job on a lease in state ${lease.state}`)
      }
      lease.state = 'running'
    },

    release(lease) {
      if (lease.state === 'claimed' || lease.state === 'running') {
        lease.state = 'idle'
        lease.idleSince = now()
      }
    },

    async discard(lease) {
      if (lease.state === 'expired' || lease.state === 'evicting') {
        await removeContainer(lease)
        return
      }
      await evictSync(lease)
    },

    async reap(at) {
      const t = at ?? now()
      const pending: Promise<void>[] = []
      for (const l of [...leases.values()]) {
        if (l.state === 'idle' && t - l.idleSince >= config.idleTtlMs) {
          pending.push(evictSync(l, 'expired'))
        } else if (l.state === 'warming' && t - l.createdAt >= config.warmWaitMs * STUCK_WARMING_FACTOR) {
          // WR-01: a warm-up that stalled (hung engine call) would hold its cap slot and token
          // forever. Expiring it frees both; if the create call ever returns, startLease sees the
          // non-warming state and removes the container.
          pending.push(evictSync(l, 'expired'))
        }
      }
      await Promise.allSettled(pending)
    },

    startReaper() {
      if (reaperTimer) return
      reaperTimer = setInterval(() => void manager.reap(), REAP_INTERVAL_MS)
      reaperTimer.unref()
    },

    async sweepOrphans() {
      const managed = await runtime.listManaged()
      const orphans = managed.filter(
        (c) =>
          c.labels[LABEL_INSTANCE] !== instanceId &&
          (!deps.ownerId || c.labels[LABEL_OWNER] === deps.ownerId),
      )
      await Promise.allSettled(orphans.map((c) => runtime.remove(c.id)))
    },

    async shutdown() {
      if (reaperTimer) {
        clearInterval(reaperTimer)
        reaperTimer = null
      }
      const removals = [...leases.values()].map((l) => evictSync(l))
      let timer: ReturnType<typeof setTimeout> | undefined
      const cap = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, SHUTDOWN_CAP_MS)
      })
      try {
        await Promise.race([Promise.allSettled(removals).then(() => undefined), cap])
      } finally {
        if (timer) clearTimeout(timer)
      }
    },

    snapshot() {
      return [...leases.values()].map((l) => ({
        id: l.id,
        sessionKey: l.sessionKey,
        slug: l.slug,
        state: l.state,
      }))
    },
  }
  return manager
}
