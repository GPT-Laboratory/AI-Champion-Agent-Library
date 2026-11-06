# 36-02 Summary: app-side MCP proxy

## Built
- `src/lib/server/localMcp/`: `types.ts` (contracts, caps), `allowlist.ts` (zod strict per tool; 403/400; page_size max 25 default 10; max_pages max 2; filter_by_etim_class needs supplier_number, business_id or lvi_number), `sanitize.ts` (control chars stripped, strings 500, arrays 50, depth 6, prototype keys dropped, 24 KB cap with valid stand-in), `upstream.ts` (own JSON-RPC clients: streamable HTTP incl. SSE, session id, re-init on 404/400; stdio with minimal env, stderr discarded, kill on abort, max 3 restarts; `upstreamFromEnv` restricts URLs to http loopback/host gateway), `proxy.ts` (`handleLocalMcpCall`, `__resetLocalMcp`), `fixtures/fake-mcp-stdio.mjs`.
- Route `src/routes/api/local-mcp/v1/tools/[name]/+server.ts`: 404 before anything is created when the flag is off; lazy upstream singleton; LOCAL_MCP_JOB_CALL_BUDGET (1..50, default 12), LOCAL_MCP_CALL_TIMEOUT_MS (1000..60000, default 20000).
- `src/hooks.server.ts`: `publicPrefixes()` adds `/api/local-mcp/` only when the flag is on.
- `llmProxy.ts`: additive `getActiveJobId`.
- Handler order: 404, 401, 413/400, 403/400, 429 no active job, 429 budget (counter incremented before the await), 503, 504/502, 200 envelope. Tool-reported errors return 200 with `ok:false` and the (sanitized) text as data.

## Tests (all with fakes; no container, python or network beyond 127.0.0.1)
allowlist 7, sanitize 6, upstream 22 (stable over 3 runs), proxy 12, route 3, hook +1. Existing LLM proxy and hook tests unchanged and green.

## Verification
`npm run check`: svelte-kit sync + tsc clean, vitest 325 files passed / 1 skipped, 3935 tests passed / 1 skipped, exit 0.
runtimeDockerode.ts, runnerConfig.ts, podman-compose.yml, Containerfile, check-ddc-decoupling.sh, package.json and the lockfile untouched; DDC agents untouched.

## Deviations
- Error logging on upstream failure records only the error class name (stricter than the plan's "redacted message").
- Tool isError results use HTTP 200 with ok:false (plan said "error envelope" without a status).
