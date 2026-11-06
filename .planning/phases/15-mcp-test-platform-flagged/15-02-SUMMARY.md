---
phase: 15-mcp-test-platform-flagged
plan: 02
subsystem: mcptest-core
tags: [mcp, json-rpc, stdio, streamable-http, client]
requires: [15-01]
provides:
  - McpClient (initialize, listTools, callTool, findings), Channel, lineChannel
  - spawnStdioChannel (env allowlist, allowLocalExec guard)
  - httpChannel (Streamable HTTP, loopback only), UNSUPPORTED_TRANSPORTS
affects: [15-08]
tech-stack:
  added: []
  patterns: [transport-agnostic Channel, protocol misbehaviour recorded as findings]
key-files:
  created:
    - src/lib/mcptest/core/jsonrpc.ts
    - src/lib/mcptest/core/client.ts
    - src/lib/mcptest/core/transports/stdio.ts
    - src/lib/mcptest/core/transports/streamableHttp.ts
    - src/lib/mcptest/core/testing/stubServer.mjs
    - (matching *.test.ts for jsonrpc, client, stdio, streamableHttp)
key-decisions:
  - DRAFT-15-02-a, DRAFT-15-02-b, DRAFT-15-02-c (below)
requirements-completed: [SC-4, SC-3]
duration: ~15 min
completed: 2026-10-12
---

# Phase 15 Plan 02: MCP client and transports Summary

Hand-written black-box MCP client (no SDK, no new dependency) over line-delimited stdio and Streamable HTTP that records protocol misbehaviour as findings and never throws from callTool.

## Commits
- 8e88cbf feat: jsonrpc framing and McpClient
- 6649a65 feat: stdio transport
- 0d9652a feat: Streamable HTTP transport

## Decision drafts (for 15-13 to consolidate)
- **DRAFT-15-02-a** Own minimal MCP client, no `@modelcontextprotocol/sdk`. Alternative: SDK (1.32.1). Why: no new dependency, tolerant recording of misbehaviour (SDK would throw), small surface. Revert: add SDK as devDependency, replace `transports/*`, keep `Channel`.
- **DRAFT-15-02-b** stdio child env is an allowlist (PATH, LANG, fresh temp HOME + caller vars) and spawning needs explicit `allowLocalExec: true` (else `StdioSpawnError` code `exec-not-allowed`, nothing spawned). Why: Pitfall on env inheritance; the runtime decides who may execute. Revert: widen env in `stdio.ts`.
- **DRAFT-15-02-c** HTTP transport accepts only 127.0.0.1, localhost, [::1] (`HttpChannelError` code `non-loopback`). Why: SC-3, runner never touches real APIs. Revert: relax `parseLoopback`. Legacy HTTP+SSE is not implemented (`UNSUPPORTED_TRANSPORTS`).

## Deviations from Plan
- **[Rule 3 - Blocking/simplification]** types.ts from 15-01 already existed in the base branch, so client.ts imports `ToolCaller`, `ToolInfo`, `ToolOutcome` from `./types` instead of a local copy.
- **[Additive]** `Channel` gained two optional hooks beyond the plan interface: `onOversize` (lineChannel/HTTP report dropped over-cap lines) and `onTransportError` (HTTP failures reach the pending request as transport_error). `lineChannel` got a `closeOnEnd` option so stdio reports the real exit code from the child `close` event. `StdioOptions.graceMs` (default 500) makes kill timing testable.
- stubServer.mjs also has a `stubborn` flag (ignores SIGTERM) to prove the SIGKILL step.

## Verification
- New test files: jsonrpc (6), client (13), stdio (6), streamableHttp (9) all pass; `npx tsc --noEmit` clean.
- Grep confirms no `process.env` spread into the child env, no `$lib`/svelte imports, no forbidden tokens in new files.
- `npm run check`: all checks passed except one load-induced 5 s timeout in scripts/validate-submission.test.ts (unrelated); rerun alone: 29/29 pass.

## Self-Check: PASSED
