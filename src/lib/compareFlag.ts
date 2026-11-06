// AGENT_COMPARE flag (default off). Dependency-free; re-exported from flags.ts.
const TRUTHY = new Set(['1', 'true', 'on', 'yes'])

export function agentCompareEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  const v = env.AGENT_COMPARE
  return typeof v === 'string' && TRUTHY.has(v.trim().toLowerCase())
}
