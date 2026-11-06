# Runtime smoke test

`npm run smoke` runs `scripts/smoke.ts`. It is not part of `npm run check` because it runs `vite build` (a few minutes at most). Unit tests run in jsdom with mocks and have missed runtime-only breaks (a build failure, a page that returned 500 on every request); this runs the real built server.

## What it does

1. Creates a temp dir and a temp SQLite DB (`CATALOG_DB_PATH`). `db/catalog.db` and `data/agents` are never touched: the shipped agents are copied into the temp dir together with 150 synthetic agents from `scripts/fixtures/generate-scale.ts`.
2. Pushes the schema with a temp drizzle config, ingests (`SEARCH_EMBEDDINGS=off`, no model download), applies `tryout:configure`, runs `vite build` (output in the gitignored `build/`).
3. For each flag configuration (all off, each of `AGENT_KINDS`, `AGENT_COMPARE`, `UI_SPEC_VIEWER`, `UI_DARK_MODE`, `MCP_GENERATOR`, `MCP_TESTER` alone, all on) starts `node build` on `127.0.0.1` at a random free port with `AUTH_ENABLED=false`, then probes 13 requests.
4. Asserts status, content-type and body markers, and that no body contains `node_modules` or a stack trace; the server log is also checked for stack traces.
5. Kills each child and removes the temp dir, also on failure. Exits 1 with a PASS/FAIL table if anything is off.

## Expectations

`/health` 200 json; `/` 302 to /catalog; `/catalog` (also `?q=sql`, `?page=999`, `?kind=bogus`) 200 html; `/agents/hvac-load-calculator` 200; `/agents/does-not-exist` 404; `/compare` 404 unless `AGENT_COMPARE`; `/mcp-test` 404 unless `MCP_TESTER`; `/api/search?q=x` 200 json; `POST /api/mcp-generate` 404 unless `MCP_GENERATOR` (then a 200 zip for a tiny OpenAPI document); `GET /api/mcp-test/runs` 404 off, 405 on (the route is POST-only).

Loopback only; no paid APIs or external network.
