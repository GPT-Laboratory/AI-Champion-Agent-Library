---
phase: 16-review-and-hardening-pass
plan: 01
subsystem: cross-cutting
tags: [review, hardening, security, tests, docs, errors, smoke]
execution: outside-gsd-flow
status: complete
requires: [13, 14, 15]
provides:
  - code reviews and fixes for Phases 13, 14, 15 (13/14/15-REVIEW.md, *-REVIEW-FIX.md)
  - milestone integration audit and fixes (v1.0-MILESTONE-AUDIT.md)
  - build break fix with guard test, flake fix, redaction fix, error-state fixes
  - runtime smoke test, performance profile, dependency health, deploy runbook
  - the user's seven code decisions implemented (D-460..D-466)
key-files:
  created:
    - src/routes/routeExports.test.ts
    - src/lib/pageFlags.ts
    - src/routes/+error.svelte
    - scripts/smoke.ts
    - scripts/bench.ts
    - docs/performance.md
    - docs/smoke-test.md
    - docs/dependency-health.md
    - docs/deploy-runbook.md
    - .planning/exploration/E2-perf.md
    - .planning/exploration/E3-phase8-tests.md
    - .planning/exploration/E6-error-states.md
    - .planning/exploration/E7-smoke.md
    - .planning/exploration/E8-decisions-impl.md
  modified:
    - src/hooks.server.ts
    - src/lib/mcpgen/limits.ts
    - podman-compose.yml
    - Containerfile.mcp-test-runner
decisions: [D-163, D-200..D-206, D-220..D-236, D-240..D-252, D-253..D-258, D-340, D-400..D-404, D-420, D-440..D-445, D-460..D-478]
completed: 2026-10-14
---

# Phase 16: Review and Hardening Pass Summary

**Executed outside the normal GSD flow.** There are no PLAN files by design: the work was done by directly launched agents (reviewers, fixers, explorers in worktrees) under an autonomous run and then a human-supervised session, and was recorded afterwards from the commit history, the exploration notes (`.planning/exploration/E2, E3, E6, E7, E8`), the `*-REVIEW*.md` files and the decisions log. This file is a record, not a plan retrospective.

**The flagged Phases 13-15 were code-reviewed and fixed, the milestone was audited, a hidden build break was found and guarded, and the user's seven code decisions were implemented.**

## Accomplishments

- **Code review + fix of Phases 13, 14, 15** (`13-REVIEW.md`, `14-REVIEW.md`, `15-REVIEW.md` with matching `*-REVIEW-FIX.md`): Phase 13 redaction bypass, slug collisions, `javascript:` href (D-200..D-206); Phase 14 scanner ReDoS, allOf fan-out DoS, credentials reaching generated files, generated-code path traversal (D-220..D-236); Phase 15 false-PASS paths, container path mismatches, HTTP redirect/SSRF, flag-off 405s, `/mcp-test` 500 (D-240..D-252).
- **Build break fix (B-002, D-258):** `vite build` failed on extra route-module exports; helpers moved to `src/lib/pageFlags.ts`, guard test `src/routes/routeExports.test.ts` added, real `vite build` verified exit 0.
- **Flake fix (B-001, B-003; D-163, D-443):** vitest timeouts raised, then the probable root cause fixed (`mockReset` instead of `clearAllMocks` in `jobs.test.ts`). Status for B-003: likely fixed, not proven (intermittent).
- **Redaction word-boundary bug (D-340):** `sk-` matched inside words such as "task-force"; fixed. Redaction patterns later shared across the five redactors (D-440).
- **Error states (E6, D-400..D-404):** `+error.svelte`, empty-DB 500s, bad-JSON row, missing `db/` dir, malformed job POST.
- **Runtime smoke test (D-420):** `npm run smoke`, 8 flag configurations x 13 probes.
- **Dependency health (D-253..D-257):** in-range bumps only, `docs/dependency-health.md`; deploy runbook `docs/deploy-runbook.md`.
- **Performance profile (E2):** `npm run bench`, `docs/performance.md` (no code change).
- **Phase 8 extra tests (E3):** about 235 tests in 7 files plus the D-340 fix.
- **Milestone integration audit** (`.planning/v1.0-MILESTONE-AUDIT.md`) and fixes G1-G6, B-003 (D-440..D-444).
- **The user's seven code decisions (decided by Ville, 2026-10-14; E8 notes):** `/health` 503 readiness check (D-460); API errors unified on `{message}` (D-461); `handleError` with an 8-hex reference id shown on the 5xx error page (D-462); OpenAPI example/schema mismatch reported as warn gap `example-schema-mismatch` (D-463); `pi` user in `Containerfile.mcp-test-runner` (D-464); per-client rate limit and concurrency cap on `/api/mcp-generate`, env `MCP_GENERATOR_RATE_MAX`, `MCP_GENERATOR_RATE_WINDOW_SEC`, `MCP_GENERATOR_MAX_CONCURRENT` (D-465); flag-on ingest skips directories named `fixtures` (D-466).
- **Also decided:** keep the empty-library copy (D-473), `APP_INSTANCE_NAME` in `podman-compose.yml` (D-445), keep PENDING_HUMAN blocking PASS (D-472), no tech-debt consolidation now (D-477), design defaults of Phases 12-15 confirmed (D-467..D-471, D-474..D-476, D-478).

## Deviations from the GSD flow

No discuss/plan/execute/verify cycle, no PLAN.md, no per-plan commits tied to plan ids; commits are atomic per item and reference decision ids. Nothing was faked: the verification file lists what was and was not run.

## Next

Phase 17 (optional UI features), Phase 18 (live verification), Phases 19-20 (generator work).
