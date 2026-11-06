// src/lib/server/tryitout/config.ts
// Server-only module — SvelteKit enforces that src/lib/server/ cannot be imported client-side.
//
// SvelteKit-aware wrapper: reads private env at CALL time (Vite dev loads .env
// into $env, not process.env). Pure parsing lives in runnerConfig.ts.

import { env } from '$env/dynamic/private'
import { parseRunnerConfig, type RunnerConfig } from './runnerConfig'

export function getRunnerConfig(): RunnerConfig {
  return parseRunnerConfig({ ...process.env, ...env })
}
