// src/lib/server/tryitout/service.ts
// Server-only module — SvelteKit enforces that src/lib/server/ cannot be imported client-side.
//
// Process-wide Try It Out service: container runtime + runner config + proxy
// tokens + the lease manager, plus warm staging (Pi's models.json pointing at
// the LLM proxy, the base prompt and the agent skill). The singleton lives on
// globalThis so Vite HMR does not duplicate it. Nothing connects at import time.

import { randomBytes } from 'node:crypto'
import { hostname } from 'node:os'
import { AgentIdSchema, loadPiSkill } from '../tryItOutPrompts'
import { MODEL } from '../tryItOutModel'
import { getRunnerConfig } from './config'
import { registerLeaseToken, revokeLeaseToken } from './llmProxy'
import { createLeaseManager, type Lease, type LeaseManager } from './leaseManager'
import { AGENT_DIR, TryItOutRuntimeError, type ContainerRuntime, type StagedFile } from './runtime'
import { createDockerodeRuntime } from './runtimeDockerode'
import type { RunnerConfig } from './runnerConfig'
import { createClientLimiter } from './clientLimit'
import { localMcpAgent } from '../localMcp/agents'

export interface TryItOutService {
  config: RunnerConfig
  runtime: ContainerRuntime
  leases: LeaseManager
  instanceId: string
  /**
   * WR-07: may this (session, client) start a container? Signed-in users and sessions that already
   * hold a lease always may; a NEW anonymous session consumes one of the client's per-window slots.
   */
  admitSession(sessionKey: string, clientKey: string | undefined): boolean
  /** Memoised network guard (D-19/D-20); a failed check is retried on the next call. */
  verifyNetwork(): Promise<void>
}

/** Window for the per-client cap on new anonymous sessions. */
export const ANON_SESSION_WINDOW_MS = 10 * 60 * 1000

interface ServiceGlobal {
  service?: TryItOutService | null
  started?: boolean
}

const g = globalThis as typeof globalThis & { __aicTryItOut?: ServiceGlobal }

function state(): ServiceGlobal {
  if (!g.__aicTryItOut) g.__aicTryItOut = {}
  return g.__aicTryItOut
}

// R-02: baseUrl interpolation is not supported by Pi, so the concrete URL is
// rendered here; the per-lease token stays in the env (AIC_LLM_TOKEN).
export function renderModelsJson(proxyUrl: string, model: string): string {
  return JSON.stringify(
    {
      providers: {
        aic: {
          baseUrl: proxyUrl,
          api: 'openai-completions',
          apiKey: '$AIC_LLM_TOKEN',
          models: [{ id: model }],
        },
      },
    },
    null,
    2,
  )
}

export function buildWarmFiles(input: {
  slug: string
  basePrompt: string
  skillMarkdown: string
  proxyUrl: string
  model: string
  /** Phase 36: extra staged files (flag-gated local MCP extension). Absent keeps the exact old list. */
  extraFiles?: StagedFile[]
}): StagedFile[] {
  const slug = AgentIdSchema.parse(input.slug)
  return [
    { path: 'models.json', content: renderModelsJson(input.proxyUrl, input.model), mode: 0o600 },
    { path: 'base-prompt.md', content: input.basePrompt },
    { path: 'skills', type: 'dir' },
    { path: `skills/${slug}`, type: 'dir' },
    { path: `skills/${slug}/SKILL.md`, content: input.skillMarkdown },
    ...(input.extraFiles ?? []),
  ]
}

export function createTryItOutService(opts: {
  runtime: ContainerRuntime
  config: RunnerConfig
  instanceId?: string
  /** Stable deployment id for the orphan sweep (WR-08). Omit to keep the unscoped sweep. */
  ownerId?: string
  now?: () => number
}): TryItOutService {
  const { runtime, config } = opts
  const instanceId = opts.instanceId ?? randomBytes(8).toString('hex')

  const stage = async (lease: Lease, containerId: string): Promise<void> => {
    const { basePrompt, skillMarkdown } = await loadPiSkill(lease.slug)
    const local = localMcpAgent(lease.slug)
    await runtime.putFiles(
      containerId,
      AGENT_DIR,
      buildWarmFiles({
        slug: lease.slug,
        basePrompt,
        skillMarkdown,
        proxyUrl: config.proxyUrl,
        model: MODEL,
        ...(local
          ? {
              extraFiles: [
                { path: 'extensions', type: 'dir' as const },
                { path: local.extensionFile, content: local.render(config) },
              ],
            }
          : {}),
      }),
    )
    const check = await runtime.exec(containerId, {
      cmd: ['test', '-f', `${AGENT_DIR}/models.json`],
      workingDir: '/',
      onStdout: () => {},
      onStderr: () => {},
    })
    if (check.exitCode !== 0) {
      throw new TryItOutRuntimeError(
        'container_start_failed',
        'staging files into the container failed; on this engine set PI_RUNNER_FS_MODE=layer',
      )
    }
  }

  // WR-03: the open-egress refusal must hold even when the startup sequence failed, so every
  // container create waits on this (cached once it has succeeded, retried after a failure).
  let networkVerified: Promise<void> | null = null
  const verifyNetwork = (): Promise<void> => {
    if (!networkVerified) {
      const attempt = runtime.ensureNetwork()
      networkVerified = attempt
      attempt.catch(() => {
        if (networkVerified === attempt) networkVerified = null
      })
    }
    return networkVerified
  }

  const leases = createLeaseManager({
    runtime,
    config,
    beforeCreate: verifyNetwork,
    tokens: { mint: registerLeaseToken, revoke: revokeLeaseToken },
    stage,
    instanceId,
    ownerId: opts.ownerId,
    now: opts.now,
  })
  const limiter = createClientLimiter({
    max: config.anonSessionsPerClient,
    windowMs: ANON_SESSION_WINDOW_MS,
    now: opts.now,
  })
  const admitSession = (sessionKey: string, clientKey: string | undefined): boolean => {
    if (!sessionKey.startsWith('anon:')) return true
    if (leases.snapshot().some((l) => l.sessionKey === sessionKey)) return true
    return limiter.tryAdmit(clientKey ?? 'unknown')
  }
  return { config, runtime, leases, instanceId, admitSession, verifyNetwork }
}

export function getTryItOutService(): TryItOutService {
  const s = state()
  if (!s.service) {
    const config = getRunnerConfig()
    const instanceId = randomBytes(8).toString('hex')
    s.service = createTryItOutService({
      runtime: createDockerodeRuntime(config, instanceId),
      config,
      instanceId,
      ownerId: process.env.APP_INSTANCE_NAME?.trim() || hostname(),
    })
  }
  return s.service
}

export function __setTryItOutServiceForTests(svc: TryItOutService | null): void {
  const s = state()
  s.service = svc
  s.started = false
}

/** Never rejects; a failed warm-up only costs the first-job latency. */
export async function warmForSession(
  sessionKey: string,
  slug: string,
  clientKey?: string,
): Promise<void> {
  try {
    const svc = getTryItOutService()
    if (!svc.admitSession(sessionKey, clientKey)) {
      console.info('Try It Out: warm-up skipped, client is over its new-session cap')
      return
    }
    await svc.leases.ensureWarm(sessionKey, slug)
  } catch (err) {
    console.warn('Try It Out warm-up failed:', err instanceof Error ? err.message : String(err))
  }
}

// Delays between startup attempts (ping, network guard, orphan sweep); the first runs at once.
const STARTUP_RETRY_DELAYS_MS = [0, 2_000, 6_000, 20_000]

function sleepUnref(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms)
    t.unref?.()
  })
}

/** Idempotent, never throws. Reaper, ping, network, orphan sweep (retried), signal cleanup. */
export function startTryItOutService(): void {
  const s = state()
  if (s.started) return
  s.started = true
  try {
    const svc = getTryItOutService()
    if (!svc.config.enabled) return
    // The reaper is independent of the engine being reachable now: it only touches known leases.
    svc.leases.startReaper()
    void (async () => {
      for (let attempt = 0; attempt < STARTUP_RETRY_DELAYS_MS.length; attempt++) {
        if (attempt > 0) await sleepUnref(STARTUP_RETRY_DELAYS_MS[attempt])
        try {
          await svc.runtime.ping()
          await svc.verifyNetwork()
          await svc.leases.sweepOrphans()
          return
        } catch (err) {
          if (attempt === 0) {
            console.warn(
              'Try It Out container engine unavailable (falling back to direct model calls when enabled):',
              err instanceof Error ? err.message : String(err),
            )
          }
        }
      }
      console.warn('Try It Out startup checks did not complete; the network guard still runs before every container create')
    })()
    let stopping = false
    const stop = () => {
      if (stopping) return
      stopping = true
      void svc.leases.shutdown()
    }
    process.once('SIGTERM', stop)
    process.once('SIGINT', stop)
  } catch (err) {
    console.warn('Try It Out service start failed:', err instanceof Error ? err.message : String(err))
  }
}
