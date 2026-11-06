# E8: implementation of Ville's decisions (2026-10-14)

Branch: worktree-agent-aa97ac96890e5cd5a (based on autonomous/overnight-improvements, nothing pushed). One atomic commit per item, decisions D-460..D-478 in `.planning/AUTONOMOUS-DECISIONS.md`. No new dependencies, no model downloads (`SEARCH_EMBEDDINGS=off`), no paid APIs.

## Items

| # | Decision | Commit subject | Tests |
| --- | --- | --- | --- |
| 1 (D-460) | `/health` 503 `{message}` when the db or the agents table is unavailable | feat(health) | `src/routes/health/health.test.ts` (new) |
| 2 (D-461) | API error bodies use `{message}` | feat(api) | `src/routes/apiErrorShape.test.ts` (new) |
| 3 (D-462) | `handleError` with a reference id, shown on the error page | feat(errors) | `src/routes/handleError.test.ts` (new, includes axe) |
| 4 (D-463) | gap `example-schema-mismatch` | feat(mcpgen) | `adapters/openapi.example-mismatch.test.ts` (new) |
| 5 (D-464) | `pi` user in `Containerfile.mcp-test-runner` | feat(mcptest) | `containerfile.test.ts` |
| 6 (D-465) | generator rate limit and concurrency cap | feat(mcpgen) | `src/lib/mcpgen/limits.test.ts` (new, fake clock) |
| 7 (D-466) | flag-on ingest skips `fixtures` directories | feat(ingest) | `scripts/ingest.fixtures-skip.test.ts` (new) |
| 8 | D-460..D-478 and docs | docs | n/a |

## Pre-existing tests edited (minimal, all added to EXEMPT in `src/lib/mcptest/criteria.test.ts` with a comment)

| File | Why it pinned the old behaviour | Edit |
| --- | --- | --- |
| `src/hooks.server.test.ts` | 401 body was `{error}` | expects `{message: 'Authentication required'}` (D-461) |
| `src/lib/mcptest/generatorSubject.test.ts` | partial-spec case pinned `SILENT_GUESS` for the stale example | now expects PASS plus the new gap; a synthetic subject that drops the gap still yields `SILENT_GUESS` (detection logic in `generatorChecks.ts` untouched) (D-463) |
| `src/lib/mcptest/containerfile.test.ts` | `USER node` | `USER pi` plus new pi-user expectations, mirrored against `Containerfile.pi-runner` (D-464) |
| `src/lib/server/mcptest/containerRun.fixes.test.ts` | asserted the image user is `node` | asserts `pi` (D-464) |
| `src/routes/errorStates.api.test.ts` | asserted `hooks.handleError` is undefined (E6 relied on SvelteKit's default) | asserts it is defined and its output carries no message, table name or stack (D-462) |
| `scripts/ingest.kinds.test.ts` | flag-on catalog was expected to gain `minimal-agent` (D-039) | expects no extra rows (D-466) |

Other test files touched only because their fixtures used the old `error` key: `src/routes/api/mcp-test/mcp-test.test.ts`, `src/lib/components/McpTestPanel.test.ts`, `McpTestPanel.a11y.test.ts` (these are Phase 15 files created after the baseline commit the EXEMPT check diffs against, so they are not flagged; the edits are one-line key renames).

## Design notes

- Item 1: `db.select({slug}).from(agents).limit(1).all()`; the 503 body is the fixed text `Service unavailable`. Smoke expectations unchanged (still 200 with `"ok"`).
- Item 2: left alone on purpose: SvelteKit `error()` (already `{message}`), job and run status payloads with an `error` status field, the LLM proxy (OpenAI wire format `{error:{message,type}}`). `/api/mcp-generate` keeps its `gaps` contract and adds a top-level `message`.
- Item 3: logging goes through `redactText` (shared token patterns, D-440). Only 5xx get a ref; 4xx keep SvelteKit's message. The page validates the ref shape before rendering it.
- Item 4: the check reads examples only for validation and reports property paths and type words, never values (tested with a planted secret-looking value). Goldens: none changed. The Acme golden samples have no contradicting examples and every golden test passed unchanged, so no golden regeneration commit was needed.
- Item 5: rename of the node image's uid/gid 1000 user (same as the Pi runner); `RUNNER_USER` follows. The image is never built or run here; `15-HUMAN-UAT.md` marks the user mismatch resolved and the build still pending human.
- Item 6: the limiter module is in `src/lib/mcpgen/limits.ts`, not `src/lib/server`, because `mcp-generate.test.ts` pins that the route file imports nothing from `$lib/server` (kept as is). Env names: `MCP_GENERATOR_RATE_MAX` (20), `MCP_GENERATOR_RATE_WINDOW_SEC` (600), `MCP_GENERATOR_MAX_CONCURRENT` (2).
- Item 7: `readSubmissionDir` takes an optional `skipDirNames` (default none), so `validate-submission` is unaffected; tested.

## Verification

See the final report of the run (`npm run check` twice, `vite build`, `npm run smoke`).
