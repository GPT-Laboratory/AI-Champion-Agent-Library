---
phase: 15-mcp-test-platform-flagged
plan: 03
subsystem: mcptest-mock
tags: [mcp, testing, mock, fault-injection, loopback]
requires: [15-01]
provides:
  - src/lib/mcptest/mock/contract.ts (ROUTES, DATASETS, TOOL_NAMES, HINTS, ENV_VARS, ITEM_FIELD_COUNT_MIN)
  - src/lib/mcptest/mock/upstream.ts (createMockUpstream -> MockHandle, structurally a MockView)
  - src/lib/mcptest/mock/datasets.ts, prng.ts (seeded Acme data, mulberry32)
  - src/lib/mcptest/mock/faults.ts, spec.ts, testing.ts (withMock)
affects: [15-04, 15-07, 15-08]
key-files:
  created:
    - src/lib/mcptest/mock/prng.ts
    - src/lib/mcptest/mock/contract.ts
    - src/lib/mcptest/mock/datasets.ts
    - src/lib/mcptest/mock/datasets.test.ts
    - src/lib/mcptest/mock/spec.ts
    - src/lib/mcptest/mock/faults.ts
    - src/lib/mcptest/mock/upstream.ts
    - src/lib/mcptest/mock/upstream.test.ts
    - src/lib/mcptest/mock/testing.ts
decisions: [DRAFT-15-03-a, DRAFT-15-03-b, DRAFT-15-03-c, DRAFT-15-03-d]
metrics:
  tasks: 3
  completed: 2026-10-12
---

# Phase 15 Plan 03: Mock Upstream Summary

Strict offline mock upstream (node:http, 127.0.0.1 ephemeral port) with seeded Acme datasets, a times-limited fault controller, a header-names-only request log, and the shared contract (routes, tool names, hint regexes) for plans 15-04 and 15-07.

## Commits

- 7de7026 contract, prng, datasets (+ tests)
- dff8610 spec, faults, upstream, testing helper
- 17f73d1 integration tests (19 tests: every fault, log, strictness, determinism, lifecycle)

## Verification

- `npx vitest run src/lib/mcptest/mock` green (30 tests), `npx tsc --noEmit` clean.
- `npm run check` exit 0 (136 files passed, 1 skipped, 1278 tests; no timeouts).
- grep: no Math.random (also asserted by a test), no non-loopback URL, no $lib/svelte import in mock/ code (only mentions in comments), no forbidden tokens. No existing test files edited.

## Decision drafts

- **DRAFT-15-03-a**: the mock rejects unknown query parameters with 400 (default on), so the derived-filter check cannot be satisfied via a parameter the "real API" lacks. Revert: set `rejectUnknownParams` default to false in spec.ts.
- **DRAFT-15-03-b**: ephemeral loopback ports (listen 127.0.0.1:0) instead of the source's random fixed range; non-loopback Host header gets 421. Revert: choose a port range in upstream.ts.
- **DRAFT-15-03-c**: the token-budget approximation (bytes/4) was not needed here; large-response sizing is by bytes (`huge` fault, 5000-item bulk set). Left to 15-07 to apply.
- **DRAFT-15-03-d**: fault ordering is host check, fault, auth, documented-route check, unknown-param check, handler; so an injected fault wins over auth. Docs mode does not exempt /health (literal reading of the plan). Per_page above maxPageSize is honoured up to 5x (non-clamping servers visibly return oversize), above 5x gives 400. Revert: reorder in `onRequest`.

## Deviations from Plan

None of substance. Minor choices: the `products` dataset is served as assemblies (joined to `components` by component id); `bulk` always has 5000 items regardless of `spec.size`; fault `route` matches either the raw path prefix or the route pattern prefix; `hits(prefix)` matches the same two ways. Log `route` holds the ROUTES pattern string (or `(unmatched)`).

## Self-Check: PASSED

All nine files exist; commits 7de7026, dff8610, 17f73d1 present on branch worktree-agent-ae3de20aa3aa8f228.
