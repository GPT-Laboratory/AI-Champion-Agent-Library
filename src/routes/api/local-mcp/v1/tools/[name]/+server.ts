import { env } from '$env/dynamic/private'
import { localMcpAgentsEnabled } from '$lib/flags.js'
import { handleLocalMcpCall } from '$lib/server/localMcp/proxy.js'
import { upstreamFromEnv } from '$lib/server/localMcp/upstream.js'
import { DEFAULT_CALL_BUDGET, DEFAULT_TIMEOUT_MS, type McpUpstream } from '$lib/server/localMcp/types.js'
import type { RequestHandler } from './$types'

// Local-only MCP proxy route (D-635). 404 when LOCAL_MCP_AGENTS is off, checked before anything is created.
const g = globalThis as typeof globalThis & { __aicLocalMcpUpstream?: { key: string; up: McpUpstream | null } }

function cfg(name: string): string | undefined {
  return env[name] ?? process.env[name]
}
function intIn(v: string | undefined, min: number, max: number, dflt: number): number {
  const n = Number(v)
  return v !== undefined && Number.isInteger(n) && n >= min && n <= max ? n : dflt
}

function getUpstream(): McpUpstream | null {
  const merged = { ...process.env, ...env } as Record<string, string | undefined>
  const key = `${merged.LOCAL_MCP_LVI_URL ?? ''}|${merged.LOCAL_MCP_LVI_STDIO ?? ''}`
  if (g.__aicLocalMcpUpstream?.key !== key) {
    void g.__aicLocalMcpUpstream?.up?.close()
    g.__aicLocalMcpUpstream = { key, up: upstreamFromEnv(merged) }
  }
  return g.__aicLocalMcpUpstream.up
}

export const POST: RequestHandler = ({ request, params }) => {
  if (!localMcpAgentsEnabled()) return Response.json({ message: 'Not found' }, { status: 404 })
  return handleLocalMcpCall(request, params.name, {
    upstream: getUpstream(),
    callBudget: intIn(cfg('LOCAL_MCP_JOB_CALL_BUDGET'), 1, 50, DEFAULT_CALL_BUDGET),
    timeoutMs: intIn(cfg('LOCAL_MCP_CALL_TIMEOUT_MS'), 1000, 60000, DEFAULT_TIMEOUT_MS),
  })
}
