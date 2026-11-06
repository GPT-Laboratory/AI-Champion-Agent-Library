import { uiDarkModeEnabled } from './themeFlag.js'

/** UI-02 theme preference helpers. Preference lives in a plain cookie only (D-381). */
export type Theme = 'light' | 'dark' | 'system'
export const THEMES: readonly Theme[] = ['light', 'dark', 'system']
export const THEME_COOKIE = 'aic_theme'
export const THEME_MAX_AGE = 60 * 60 * 24 * 365

/** Whitelist parse: anything unknown (or absent) is "system". */
export function parseTheme(v: string | null | undefined): Theme {
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system'
}

/** Layout load keys; absent when the flag is off so flag-off data is unchanged. */
export function layoutThemeData(
  cookieValue: string | undefined,
  env: Record<string, string | undefined> = process.env
): { themeEnabled?: true; theme?: Theme } {
  return uiDarkModeEnabled(env) ? { themeEnabled: true, theme: parseTheme(cookieValue) } : {}
}

/** Cookie string written by the client toggle (not HttpOnly: JS must write it; holds no identity). */
export function themeCookieString(theme: Theme, secure = false): string {
  return `${THEME_COOKIE}=${theme}; Path=/; Max-Age=${THEME_MAX_AGE}; SameSite=Lax${secure ? '; Secure' : ''}`
}

interface ThemedEvent {
  cookies: { get(name: string): string | undefined }
}
type ResolveOptions = { transformPageChunk?: (input: { html: string; done: boolean }) => string }

/**
 * Applies the stored theme to <html> during SSR so the first paint is already themed (no flash,
 * no inline script, so no CSP concern). Flag off: calls resolve(event) exactly as before.
 */
export function resolveWithTheme<E extends ThemedEvent, R>(
  event: E,
  resolve: (event: E, opts?: ResolveOptions) => R,
  env: Record<string, string | undefined> = process.env
): R {
  if (!uiDarkModeEnabled(env)) return resolve(event)
  const theme = parseTheme(event.cookies.get(THEME_COOKIE))
  return resolve(event, {
    transformPageChunk: ({ html }) => html.replace('<html lang="en">', `<html lang="en" data-theme="${theme}">`),
  })
}
