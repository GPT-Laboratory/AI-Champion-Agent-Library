// UI_DARK_MODE flag (default off). Dependency-free; re-exported from flags.ts (D-380).
const TRUTHY = new Set(['1', 'true', 'on', 'yes'])

export function uiDarkModeEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  const v = env.UI_DARK_MODE
  return typeof v === 'string' && TRUTHY.has(v.trim().toLowerCase())
}
