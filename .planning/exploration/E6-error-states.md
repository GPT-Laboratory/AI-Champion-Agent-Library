# E6 - error-state and empty-state audit

Branch: worktree-agent-a9f64c2d27c79b167 (based on autonomous/overnight-improvements). Decisions D-400..D-404.
Method: read every load/handler, then probe with a real temporary SQLite file (no db mocks) and hostile inputs, flags off and all key flags on (AGENT_KINDS, AGENT_COMPARE, UI_SPEC_VIEWER, MCP_GENERATOR, MCP_TESTER, UI_DARK_MODE). New tests: `src/routes/errorStates.db.test.ts`, `errorStates.page.test.ts`, `errorStates.api.test.ts`.

## States found

| # | State | Behaviour before | Verdict |
|---|-------|------------------|---------|
| 1 | No `src/routes/+error.svelte` | SvelteKit built-in page: no layout, no nav, no route home | DEFECT, fixed D-400 |
| 2 | db file exists, no tables (fresh checkout before db:push) | catalog, detail, compare: 500 "no such table" | DEFECT, fixed D-401 |
| 3 | `./db` directory missing | `db.ts` throws at import, every route incl. /health 500 | DEFECT, fixed D-403 |
| 4 | A row with invalid / non-array JSON in tags, tool_names, input_schema, fixed_fields, customizable_fields | catalog, detail, compare all 500 (SyntaxError); valid-JSON-but-not-array would crash render | DEFECT, fixed D-402 |
| 5 | `POST /api/tryitout/jobs` with JSON/empty/bad multipart body | unhandled TypeError, 500 | DEFECT, fixed D-404 |
| 6 | Empty `agents` table, catalog | 200, shows "No agents match your filters" | OK (copy proposal Q1) |
| 7 | Catalog `?page` = abc, 0, -5, 1e20, %00, repeated | clamped by `parsePage` to 1..1,000,000 | OK |
| 8 | Catalog `?kind` unknown, `__proto__` | allow-list; ignored; flag off ignored entirely | OK |
| 9 | Catalog `?q` empty, whitespace, 5000 chars, SQL-ish, NUL, emoji | trimmed, capped at 200; Drizzle binds params | OK |
| 10 | Search backend throws | caught, `searchDegraded`, LIKE-style fallback, banner + live region | OK |
| 11 | Catalog `?compare=` more than max or junk | `parseCompareSlugs` truncates/ignores | OK |
| 12 | Detail unknown slug, `../`, `%00`, 100k chars | 404 via `error(404)`, now rendered by +error.svelte | OK |
| 13 | Detail row with null category/link/temperature, empty summary | renders, axe clean (test) | OK |
| 14 | Detail huge summary/prompt (500 KB), markup in title/tags | rendered as text, no injection | OK |
| 15 | Detail try-it-out mode none, or non-agent kind | no run controls; mode normalised server-side | OK |
| 16 | Detail related-agents search failure | caught, empty list | OK |
| 17 | `/compare` flag off | 404 before any read | OK |
| 18 | `/compare` no/blank/hostile/duplicate/too many `agents` | invalid and unknown reported, never throws | OK |
| 19 | `/mcp-test` flag off (GET and POST) | 404 | OK |
| 20 | `/api/search` empty q, hostile q, backend failure | `{results:[],mode:'none'}` / 500 `{message:'Search failed.'}` | OK |
| 21 | `/api/try-out` bad JSON / fields / unknown agent / non-agent kind | 400/404/403 all `{message}`; 500s carry fixed text, error only logged | OK |
| 22 | `/api/mcp-generate` | flag off 404; others `{ok:false,gaps:[...]}` with 400/413/422 (documented contract) | OK, shape differs by design (Q2) |
| 23 | `/api/tryitout/jobs/[id]` and `/artifact` malformed/unknown id | 404, id validated before any lookup | OK |
| 24 | hooks: no `handleError` | SvelteKit default: logs server-side, client gets `{message:"Internal Error"}`; no stack or secret reaches the client in prod | OK |
| 25 | hooks: unauthenticated API call (auth on) | 401 `{error:'Authentication required'}` | Inconsistent key (`error` vs `message`), pinned by `hooks.server.test.ts`; not changed (Q2) |
| 26 | Dark mode on any error/empty page | same tokens as the rest of the UI; +error.svelte uses only mapped tokens (existing css guard test passes) | OK |
| 27 | db locked | better-sqlite3 default 5 s busy timeout, then SQLITE_BUSY surfaces as 500 "Internal Error" on that request only | Acceptable; no change |
| 28 | `SEARCH_EMBEDDINGS=off` / model load fail | search path degrades (see 10) | OK |

## Fixes (all with regression tests)
- D-400 `+error.svelte` (axe clean, landmarks mode; 500 never shows message/stack; hostile message escaped).
- D-401 table-less db -> empty catalog / 404 detail / unknown compare slugs (`$lib/dbErrors.ts`, `$lib/catalogEmpty.ts`).
- D-402 `$lib/safeJson.ts` for JSON text columns.
- D-403 `db.ts` creates the db directory.
- D-404 jobs route 400 on unparseable body.
No existing test was edited.

## Questions for Ville (cosmetic or contract changes, NOT made)
1. Catalog empty state with no filters and no query says "No agents match your filters". An empty library (fresh install) could say "The library has no agents yet. Run `npm run ingest`." Needs a decision on wording.
2. API error shapes: most routes use `{message}`; the auth hook uses `{error}`; mcp-generate uses `{ok:false,gaps}`. Unify the hook to `{message}`? It would edit `hooks.server.test.ts` and could break any client reading `error`.
3. `/api/tryitout/jobs/[id]` 404 messages echo the (validated or not) id; harmless in JSON and escaped in HTML, but could be a fixed string.
4. Should /health also check the db (return 503 when tables are missing) so a deploy probe notices a skipped ingest? Today it always says ok.
5. Add a `handleError` that logs a reference id and returns it to the client for support? Default behaviour is already safe.
