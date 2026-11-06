# E5 - UI-02 dark/light theme toggle (UI_DARK_MODE)

Branch: worktree-agent-ae286876ece46a853 (based on autonomous/overnight-improvements). Decisions D-380..D-384.

## Approach
- Flag `UI_DARK_MODE`, default off. `themeFlag.ts` re-exported from `flags.ts` (D-380).
- Preference: cookie `aic_theme` = light | dark | system (default system). Nothing is stored server-side (D-381).
- No flash and no inline script: `hooks.server.ts` -> `resolveWithTheme` stamps `data-theme` on `<html>` at SSR when the flag is on. No CSP exists in hooks/app.html, but a script was not needed (D-382). Flag off: `resolve(event)` is called exactly as before.
- Styling: `app.css` remaps the Tailwind colour variables under `html[data-theme="dark"]` and (for "system") under `@media (prefers-color-scheme: dark)`. Components are untouched, so catalog, detail, compare, related agents, search bar, filter bar, customize menu, spec viewer, try-it-out, MCP panels and forms all follow (D-383). `@custom-variant dark` is declared on the attribute for future `dark:` utilities. Without the attribute every dark rule is inert.
- UI: `ThemeToggle.svelte` (group labelled "Colour theme", three `<button aria-pressed>`: Light / Dark / System) rendered in the layout nav only when `data.themeEnabled`. Layout load adds `themeEnabled`/`theme` only when the flag is on.

## Files
New: `src/lib/themeFlag.ts`, `src/lib/theme.ts`, `src/lib/components/ThemeToggle.svelte`, `src/lib/a11y/contrastDark.ts`; tests `src/lib/theme.test.ts`, `src/lib/darkTheme.css.test.ts`, `src/lib/a11y/contrast.dark.test.ts`, `src/lib/components/ThemeToggle.a11y.test.ts`.
Edited: `src/app.css` (appended block), `src/lib/flags.ts` (re-export), `src/lib/a11y/contrast.ts` (`export` on `OKLCH` only), `src/hooks.server.ts` (2 resolve calls), `src/routes/+layout.server.ts`, `src/routes/+layout.svelte`.
No component class edits were needed (no mechanical utility pass).

## Flag-off regression
- Loader keys: test asserts layout load returns only `user` (+ `compareEnabled` when that flag is on).
- Hook: test asserts `resolve` receives exactly one argument and the cookie is never read.
- Markup: the only change is the new `{#if data.themeEnabled}` in the layout, which can add Svelte's inert `<!---->` anchor (same caveat as D-302/D-365).
- CSS output: the dark block is in the bundle but keyed to `html[data-theme=...]`, an attribute never written when the flag is off (a test checks nothing dark sits outside those selectors). The CSS file is a few KB larger; rendered styling is identical.
- Existing tests: full suite passed (230 files, 2474 tests) with no edits to existing test files.

## AA proof
`contrastDark.ts` mirrors every token through `DARK_SWAP` and evaluates all Phase 10 `PAIRS` plus 13 extra themed pairs (toggle, header, spec viewer tokens, MCP flags, compare badge) = 45 pairs, all >= 4.5:1 (text) or 3:1 (UI). `contrast.dark.test.ts` fails on any pair below its minimum. Lowest margin: 5.12:1 (indigo link on indigo-50 hover); primary button 6.43:1. `darkTheme.css.test.ts` pins both CSS blocks to the same oklch values the proof uses and fails if a component uses a colour token that is not remapped.

## Needs human visual check
- Overall look of every page in dark (catalog cards, detail, compare table, spec viewer, panels). Contrast is proven for listed pairs only, not for taste.
- `bg-indigo-50/40` (TryOutPanel) and other `/NN` opacity colours: blended result is not in the proof.
- Placeholder text (Tailwind mixes currentColor at 50%) and disabled buttons (exempt from 1.4.3, but check legibility).
- Borders (gray-200 -> gray-700) are decorative; confirm cards still separate visually.
- `system` follows the OS preference at load via CSS; check it switches when the OS setting changes.
- Toggle needs JS. Without JS the stored cookie still applies at SSR.
- Cookie is not Secure on plain http; Secure is added on https.
- Responses vary by cookie when the flag is on; add `Vary: Cookie` if a shared cache/CDN is introduced.
