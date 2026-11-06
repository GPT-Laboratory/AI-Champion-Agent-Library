---
phase: 15-mcp-test-platform-flagged
plan: 11
subsystem: mcptest-api
tags: [mcp, api, job-store, container-runtime, flag]
requires: [15-08, 15-09, 15-10]
provides:
  - src/lib/mcptest/api-contract.ts (ROUTE_PATH, request/response types, limits; client-safe)
  - src/lib/server/mcptest/jobs.ts (createRunStore, runStore singleton, isValidRunId, TTL store)
  - src/lib/server/mcptest/containerRun.ts (runInContainer, mcpTestRunnerConfig, readDriverTree)
  - src/lib/server/mcptest/service.ts (executeRun, startRun, allowlists, admitStart, test hooks)
  - POST /api/mcp-test/runs, GET /api/mcp-test/runs/:id, GET /api/mcp-test/runs/:id/report
affects: [15-12, 15-13]
key-files:
  created:
    - src/lib/mcptest/api-contract.ts
    - src/lib/server/mcptest/jobs.ts
    - src/lib/server/mcptest/jobs.test.ts
    - src/lib/server/mcptest/containerRun.ts
    - src/lib/server/mcptest/containerRun.test.ts
    - src/lib/server/mcptest/service.ts
    - src/lib/server/mcptest/service.test.ts
    - src/routes/api/mcp-test/runs/+server.ts
    - src/routes/api/mcp-test/runs/[id]/+server.ts
    - src/routes/api/mcp-test/runs/[id]/report/+server.ts
    - src/routes/api/mcp-test/mcp-test.test.ts
  modified: []
requirements-completed: [SC-3, SC-4, SC-5]
completed: 2026-10-13
---

# Phase 15 Plan 11: Run API, TTL job store and container run path Summary

A flag-gated (MCP_TESTER) run API starts known fake or generator subjects fire-and-forget behind single-flight, size and rate guards, stores runs in a TTL-evicted in-memory store, and offers an opt-in container path (MCP_TESTER_RUNTIME=container) that is verified only against the Phase 8 fake runtime.

## Commits (branch worktree-agent-ad6c7b30d04ded075)
- 398a6a8 api-contract and TTL run store (7 tests)
- 8ab7d86 container run path, runner config and service (26 tests)
- 882b961 routes and start limiter (14 tests)

## Behaviour
- Flag off: all three handlers are `error(404)` as their first statement (a source test pins this); store, session and runtime are never touched.
- POST: strict allowlist `{subject, cases?, reruns?}`; subject must be in `listSubjects()` as fake or generator (so `cmd:`, uploads and unknown variants are 400); cases must be in `KNOWN_CASE_IDS` (max 12, duplicates collapsed); reruns integer 1-3; extra keys 400; body over 4 KiB 413 (content-length and actual text). Order: flag, size, parse, validate, session, single-flight 429 (global and per-session), per-client limiter 429 (10 starts per 10 min), create, fire-and-forget `startRun`, 202 `{id,status:'queued'}`.
- GET status: UUID regex before lookup, literal `{status, progress, events, error}`. Report: 409 while queued/running, 404 when failed, 200 `application/json` attachment `mcptest-report.json` with the stored JSON verbatim.
- Store: events capped at 200 (300 chars, redacted), report capped at 1,000,000 bytes (oversize fails the run), TTL 30 min, max 50 runs (finished evicted oldest-first, running never), `publicView` hides the session key.
- Executor: default in-process `runSuite` (runtime label `fake`, `allowStdioExec: false`); generated Python is never run, server-side cells are PENDING_HUMAN with generator-side checks scored. With `MCP_TESTER_RUNTIME=container`, a `DriverRequest` is built (validated by the imported `DriverRequestSchema` before staging), the generator package is generated in a temp dir and staged via `runInContainer` (ensureNetwork, createAndStart with empty env and label `aic.mcptest`, one putFiles to /work with dirs, exec `tsx /work/src/lib/mcptest/driver.ts`, getFiles /work/out under caps, remove in finally including timeout and abort).
- `mcpTestRunnerConfig`: image `localhost/mcp-test-runner:latest`, network `aic-mcptest-internal`, proxyUrl '', open egress forced false (throws if MCPTEST_ALLOW_OPEN_EGRESS is true), no tools, zero LLM budgets; reads no LLM variables.

## Decision drafts (not written to AUTONOMOUS-DECISIONS.md)
- **DRAFT-15-11-a** MCP_TESTER flag and API shape; v1 accepts only known fake variants and generator samples, no uploaded or `cmd:` subjects. Revert: widen `isAllowedSubject` after an isolation review.
- **DRAFT-15-11-b** TTL store (30 min, 50 runs, finished-first eviction, running never evicted), an improvement over the Phase 8 never-evict store. Revert: remove `evict()`.
- **DRAFT-15-11-c** `MCP_TESTER_RUNTIME=container` is an explicit operator opt-in; second RunnerConfig with no egress, internal network, no LLM proxy or token. The variable is set in no committed file. Revert: drop the container branch in `executeRun`.
- **DRAFT-15-11-d** The routes add no auth logic of their own beyond the session key; they rely on the global hook (see Questions for Ville).
- **DRAFT-15-11-e** Container mode for generator subjects stages one package generated from the primary sample (via the T2-CATALOG-API case) and drops T4-PARTIAL-SPEC from the request (its package differs). In-process generator-side checks (`extraChecks`) are not part of a container report. Revert: stage one package per case, which needs a driver request extension.
- **DRAFT-15-11-f** Start limiter: 10 starts per client per 10 min (sliding window, reuses `createClientLimiter`), constants in service.ts. Revert: edit `STARTS_PER_CLIENT`.
- **DRAFT-15-11-g** Generator runs in process use runtime label `fake` in the report (the label text says in-process scorer fixtures); a dedicated label would need a runner/report change.

## Questions for Ville
- Is auth enforced by a global hook for /api/* when AUTH is on? These routes only derive a session key (user email, else the Phase 8 anonymous cookie) and apply per-client limits.
- Phase 8 `buildCreateOptions` hardcodes `User: 'pi'`, but the runner image (15-10) defines user `node`. A real engine run may need the image to also provide a `pi` user, or a small Phase 8 change (a pending human item; not modified here).

## Deviations from Plan
- Auto-fixed (Rule 1): the first staging used `src/src/...` for the driver tree because the tree paths are already repo-relative; fixed to stage tree paths directly under /work (caught by the test).
- Added `admitStart` and `__resetStartLimiterForTests` to service.ts (the routes cannot export extra symbols); `__setExecutorForTests` lives there as planned.
- Case allowlist uses the pinned `KNOWN_CASE_IDS` instead of a cached `loadSuite`.
- Not verified: any real engine or image run (pending human, as designed).

## Verification
`npx vitest run src/routes/api/mcp-test src/lib/server/mcptest` green (47 tests); `npm run check` exit 0 (167 files passed, 1 skipped, 1698 tests). No existing test or Phase 8/14 source file modified; no new dependency; no container engine contacted; no forbidden tokens in new files.

## Self-Check: PASSED
All listed files exist; commits 398a6a8, 8ab7d86, 882b961 are on the worktree branch.
