import { mcpGeneratorEnabled, mcpTesterEnabled, uiSpecViewerEnabled } from '$lib/flags.js'
import { buildSpecText, type SpecRowLike } from '$lib/specViewer.js'

/** UI-04: the key exists only when UI_SPEC_VIEWER is on, so flag-off data is unchanged. */
export function specViewerData(
  row: SpecRowLike,
  env: Record<string, string | undefined> = process.env
): { specViewer?: { text: string; truncated: boolean } } {
  return uiSpecViewerEnabled(env) ? { specViewer: buildSpecText(row) } : {}
}

// SvelteKit only allows load/actions/etc. to be exported from +page.server.ts, so these
// load helpers live here (a vite build fails on any other export).

/** Phase 14: the key exists only when MCP_GENERATOR is on, so flag-off data is unchanged. */
export function mcpGeneratorData(
  env: Record<string, string | undefined> = process.env
): { mcpGeneratorEnabled?: true } {
  return mcpGeneratorEnabled(env) ? { mcpGeneratorEnabled: true } : {}
}

/** Phase 15: the key exists only when MCP_TESTER is on, so flag-off data is unchanged. */
export function mcpTesterData(
  env: Record<string, string | undefined> = process.env
): { mcpTesterEnabled?: true } {
  return mcpTesterEnabled(env) ? { mcpTesterEnabled: true } : {}
}
