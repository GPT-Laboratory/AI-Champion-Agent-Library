// LOCAL_MCP_AGENTS flag (default off). Dependency-free; re-exported from flags.ts (D-364, D-380, D-637).
const TRUTHY = new Set(['1', 'true', 'on', 'yes'])

export function localMcpAgentsEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  const v = env.LOCAL_MCP_AGENTS
  return typeof v === 'string' && TRUTHY.has(v.trim().toLowerCase())
}
