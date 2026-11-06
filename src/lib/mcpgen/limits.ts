// Server use only (imported by the route; kept outside src/lib/server because the route is pinned to import nothing from there).
// Per-client rate limit and global concurrency cap for POST /api/mcp-generate (D-465, decided by Ville).
// Same style as the tester's start limiter (src/lib/server/mcptest/service.ts): in-memory sliding window per client
// address, recorded on admission. Nothing is persisted and no input is kept. Server-only.
import { createClientLimiter, type ClientLimiter } from '../server/tryitout/clientLimit.js'

export const DEFAULT_RATE_MAX = 20
export const DEFAULT_RATE_WINDOW_SEC = 600
export const DEFAULT_MAX_CONCURRENT = 2

type Env = Record<string, string | undefined>

function nonNegInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback
  const n = Number(raw)
  return Number.isInteger(n) && n >= 0 ? n : fallback
}

export interface GeneratorLimitConfig {
  /** requests per client per window; 0 = unlimited */
  rateMax: number
  windowMs: number
  /** simultaneous generations; 0 = unlimited */
  maxConcurrent: number
}

/** MCP_GENERATOR_RATE_MAX, MCP_GENERATOR_RATE_WINDOW_SEC, MCP_GENERATOR_MAX_CONCURRENT; invalid values fall back to the defaults. */
export function generatorLimitConfig(env: Env = process.env): GeneratorLimitConfig {
  const windowSec = nonNegInt(env.MCP_GENERATOR_RATE_WINDOW_SEC, DEFAULT_RATE_WINDOW_SEC)
  return {
    rateMax: nonNegInt(env.MCP_GENERATOR_RATE_MAX, DEFAULT_RATE_MAX),
    windowMs: (windowSec === 0 ? DEFAULT_RATE_WINDOW_SEC : windowSec) * 1000,
    maxConcurrent: nonNegInt(env.MCP_GENERATOR_MAX_CONCURRENT, DEFAULT_MAX_CONCURRENT),
  }
}

export type Admission = { ok: true; release: () => void } | { ok: false; reason: 'busy' | 'rate' }

export interface GeneratorGate {
  /** Concurrency is checked first (it records nothing), then the per-client rate. The caller must call release(). */
  admit(clientKey: string | undefined): Admission
  inFlight(): number
}

export function createGeneratorGate(cfg: GeneratorLimitConfig, now?: () => number): GeneratorGate {
  const limiter: ClientLimiter = createClientLimiter({ max: cfg.rateMax, windowMs: cfg.windowMs, now })
  let active = 0
  return {
    admit(clientKey) {
      if (cfg.maxConcurrent > 0 && active >= cfg.maxConcurrent) return { ok: false, reason: 'busy' }
      if (!limiter.tryAdmit(clientKey ?? 'unknown')) return { ok: false, reason: 'rate' }
      active++
      let released = false
      return {
        ok: true,
        release: () => {
          if (released) return
          released = true
          active--
        },
      }
    },
    inFlight: () => active,
  }
}

let gate: GeneratorGate | null = null
/** The process-wide gate, created on first use from the environment. */
export function generatorGate(): GeneratorGate {
  return (gate ??= createGeneratorGate(generatorLimitConfig()))
}
/** Test hook: install a gate (null restores lazy creation from the environment). */
export function __setGeneratorGateForTests(g: GeneratorGate | null): void {
  gate = g
}
