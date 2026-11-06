// Feature flags. Plain env access (no SvelteKit $env) so tsx scripts and vitest can import it.
// Read at call time so tests and processes can toggle without re-importing.
const TRUTHY = new Set(['1', 'true', 'on', 'yes'])

export function agentKindsEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  const v = env.AGENT_KINDS
  return typeof v === 'string' && TRUTHY.has(v.trim().toLowerCase())
}

/** Phase 14 MCP generator flag (MCP_GENERATOR), default off. */
export function mcpGeneratorEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  const v = env.MCP_GENERATOR
  return typeof v === 'string' && TRUTHY.has(v.trim().toLowerCase())
}

/** UI-04 raw spec viewer flag (UI_SPEC_VIEWER), default off. */
export function uiSpecViewerEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  const v = env.UI_SPEC_VIEWER
  return typeof v === 'string' && TRUTHY.has(v.trim().toLowerCase())
}

/** DISC-02 side-by-side agent comparison flag (AGENT_COMPARE), default off. Implemented in
 * compareFlag.ts so loaders that tests mock `$lib/flags.js` for still read it from the environment (D-364). */
export { agentCompareEnabled } from './compareFlag.js'

/** UI-02 dark/light theme toggle flag (UI_DARK_MODE), default off. Implemented in themeFlag.ts
 * for the same reason as the compare flag (D-364, D-380). */
export { uiDarkModeEnabled } from './themeFlag.js'

/** Phase 15 MCP tester flag (MCP_TESTER), default off. */
export function mcpTesterEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  const v = env.MCP_TESTER
  return typeof v === 'string' && TRUTHY.has(v.trim().toLowerCase())
}

/** Phase 36 local-only LVI-INFO MCP agent, MCP-server entries, proxy route and staged tool
 * (LOCAL_MCP_AGENTS), default off. Implemented in localMcpFlag.ts for the same reason as the
 * compare and theme flags (D-364, D-380, D-637). */
export { localMcpAgentsEnabled } from './localMcpFlag.js'
