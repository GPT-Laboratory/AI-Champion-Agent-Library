// src/lib/server/tryitout/runnerConfig.ts
// Server-only module — SvelteKit enforces that src/lib/server/ cannot be imported client-side.
//
// Pure env parser (does not read SvelteKit env) so tsx scripts can use it too. The
// SvelteKit-aware wrapper lives in config.ts.

import { z } from 'zod'

export const ALLOWED_PI_TOOLS = ['read', 'write', 'edit', 'bash', 'grep', 'find', 'ls'] as const

export interface RunnerConfig {
  enabled: boolean
  image: string
  socketPath: string
  network: string
  allowOpenEgress: boolean
  proxyUrl: string
  maxContainers: number
  idleTtlMs: number
  minIdleMs: number
  warmWaitMs: number
  jobTimeoutMs: number
  memoryMb: number
  cpus: number
  pids: number
  workTmpfsMb: number
  tmpTmpfsMb: number
  agentTmpfsMb: number
  fsMode: 'tmpfs' | 'layer'
  tools: string[]
  fallbackEnabled: boolean
  jobTokenBudget: number
  jobRequestBudget: number
  maxOutputBytes: number
  maxOutputFiles: number
  anonSessionsPerClient: number
  /**
   * Container user. Default 'pi' (the Pi runner image). Other images set it to the user their
   * Containerfile ends with (the MCP test runner image runs as 'node'). Never read from the environment.
   */
  runUser?: string
  /** Mount the Pi agent dir tmpfs (/home/pi/agent). Default true; images without that path set false. */
  mountAgentDir?: boolean
}

function num(
  source: Record<string, string | undefined>,
  name: string,
  def: number,
  min: number,
  max: number,
  int = true,
): number {
  const raw = source[name]
  if (raw === undefined || raw.trim() === '') return def
  const schema = z.coerce.number().min(min).max(max)
  const parsed = schema.safeParse(raw.trim())
  if (!parsed.success || Number.isNaN(parsed.data) || (int && !Number.isInteger(parsed.data))) {
    throw new Error(`invalid ${name}: ${raw}`)
  }
  return parsed.data
}

function str(source: Record<string, string | undefined>, name: string, def: string): string {
  const raw = source[name]
  return raw === undefined || raw.trim() === '' ? def : raw.trim()
}

// Only the literal "false" disables (AUTH_ENABLED style).
function enabledUnlessFalse(value: string | undefined): boolean {
  return value?.trim().toLowerCase() !== 'false'
}

// Only the literal "true" enables.
function disabledUnlessTrue(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true'
}

export function parseRunnerConfig(source: Record<string, string | undefined>): RunnerConfig {
  const xdg = source.XDG_RUNTIME_DIR?.trim()
  const defaultSocket = xdg ? `${xdg}/podman/podman.sock` : '/run/podman/podman.sock'

  const fsModeRaw = str(source, 'PI_RUNNER_FS_MODE', 'tmpfs')
  if (fsModeRaw !== 'tmpfs' && fsModeRaw !== 'layer') {
    throw new Error(`invalid PI_RUNNER_FS_MODE: ${fsModeRaw}`)
  }

  const toolsRaw = str(source, 'PI_RUNNER_TOOLS', 'read,write,edit,grep,find,ls')
  const tools = toolsRaw
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
  for (const t of tools) {
    if (!(ALLOWED_PI_TOOLS as readonly string[]).includes(t)) {
      throw new Error(`invalid PI_RUNNER_TOOLS: ${toolsRaw}`)
    }
  }

  return {
    enabled: enabledUnlessFalse(source.PI_RUNNER_ENABLED),
    image: str(source, 'PI_RUNNER_IMAGE', 'localhost/pi-runner:latest'),
    socketPath: str(source, 'PI_RUNNER_SOCKET', defaultSocket),
    network: str(source, 'PI_RUNNER_NETWORK', 'aic-pi-internal'),
    allowOpenEgress: disabledUnlessTrue(source.PI_RUNNER_ALLOW_OPEN_EGRESS),
    proxyUrl: str(source, 'PI_LLM_PROXY_URL', 'http://aic-agent-library:3000/api/llm/v1'),
    maxContainers: num(source, 'PI_RUNNER_MAX_CONTAINERS', 5, 1, 50),
    idleTtlMs: num(source, 'PI_RUNNER_IDLE_TTL_MS', 300000, 1000, 86_400_000),
    minIdleMs: num(source, 'PI_RUNNER_MIN_IDLE_MS', 60000, 0, 86_400_000),
    warmWaitMs: num(source, 'PI_RUNNER_WARM_WAIT_MS', 90000, 1000, 600_000),
    jobTimeoutMs: num(source, 'PI_RUNNER_JOB_TIMEOUT_MS', 300000, 1000, 3_600_000),
    memoryMb: num(source, 'PI_RUNNER_MEMORY_MB', 1024, 64, 65536),
    cpus: num(source, 'PI_RUNNER_CPUS', 0.5, 0.05, 64, false),
    pids: num(source, 'PI_RUNNER_PIDS', 200, 10, 100000),
    workTmpfsMb: num(source, 'PI_RUNNER_WORK_TMPFS_MB', 256, 1, 8192),
    tmpTmpfsMb: num(source, 'PI_RUNNER_TMP_TMPFS_MB', 64, 1, 8192),
    agentTmpfsMb: num(source, 'PI_RUNNER_AGENT_TMPFS_MB', 16, 1, 1024),
    fsMode: fsModeRaw,
    tools,
    fallbackEnabled: enabledUnlessFalse(source.PI_FALLBACK_ENABLED),
    jobTokenBudget: num(source, 'PI_JOB_TOKEN_BUDGET', 100000, 1, 100_000_000),
    jobRequestBudget: num(source, 'PI_JOB_REQUEST_BUDGET', 40, 1, 10000),
    maxOutputBytes: num(source, 'PI_RUNNER_MAX_OUTPUT_BYTES', 20971520, 1, 1_073_741_824),
    maxOutputFiles: num(source, 'PI_RUNNER_MAX_OUTPUT_FILES', 200, 1, 100000),
    anonSessionsPerClient: num(source, 'PI_RUNNER_ANON_SESSIONS_PER_CLIENT', 5, 0, 1000),
  }
}
