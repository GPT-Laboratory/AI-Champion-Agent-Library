# E4 - DISC-02 side-by-side agent comparison

## What
Behind `AGENT_COMPARE` (default off):
- Catalog cards get a "Compare" checkbox (max 3, rest disabled), a "Compare selected" button and a live-region count. Selection is kept in `?compare=a,b,c`; the checkboxes sit in a plain GET form to `/compare`, so it works without JS.
- `/compare?agents=a,b,c` (comma or repeated param): server-rendered responsive table, agents as columns, attributes as rows (summary, kind when AGENT_KINDS is on, category, tags, LLM, tools, invocation = input fields, human approval, maturity, try-it-out mode, GitHub link, tailorable fields). Differing rows are labelled "Differs" and tinted.
- A "Compare agents" nav link. With the flag off `/compare` answers 404 and nothing above renders.

## Not built (see D-362)
Memory, deployment and invocation-style are not in the data model, so they are not shown (no invented values).

## Safety
Slug allow-list, max 3, unknown/invalid slugs give friendly messages (no 500), no `{@html}`, GitHub links via `safeHttpUrl`. Helpers live in `$lib` (`compare.ts`, `compareFlag.ts`); `+page.server.ts` exports only `load` (checked by a test, plus the existing routeExports guard). Decisions D-360..D-365.

## How verified
New tests: `src/lib/flags.compare.test.ts`, `src/lib/compare.test.ts`, `src/routes/compare/page.load.test.ts` (404, exports, unknown/invalid), `src/routes/compare/page.test.ts` (table semantics, axe with landmarks, kind badge gating, nav on/off), `src/routes/catalog/catalog.compare.test.ts` (flag-off loader keys exact), `src/routes/catalog/page.compare.test.ts` (flag-off DOM, checkboxes, max 3, live region, axe), `src/lib/components/AgentCard.compare.a11y.test.ts`. No existing test edited. Full suite 2404 passed; `npm run check` and `SEARCH_EMBEDDINGS=off npx vite build` exit 0.

## Pending human browser check
Run with `AGENT_COMPARE=1`: tick 2-3 cards with the keyboard (Space), confirm the 4th box disables and a screen reader announces "N of 3 selected"; paginate and filter and confirm the selection survives; press "Compare selected"; check the table on a phone width (horizontal scroll region focusable), the "Differs" tint contrast, a bad URL (`/compare?agents=nope,../x`), and the whole flow with JS disabled. Also check the nav with a signed-in user.
