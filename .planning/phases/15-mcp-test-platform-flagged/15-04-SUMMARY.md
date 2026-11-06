---
phase: 15-mcp-test-platform-flagged
plan: 04
subsystem: mcptest-fake
tags: [mcp, fake-server, fixtures, stdio, streamable-http]
requires: [15-01, 15-02, 15-03]
provides:
  - serveStdio / createFake (shared dispatcher), startHttpFake
  - VARIANTS registry (21 variants), variantIds(), getVariant()
  - fakeMain.ts entry, fake/testing.ts helpers (withFake, CANARY, FAKE_SPEC)
affects: [15-07, 15-08]
key-files:
  created:
    - src/lib/mcptest/fake/behaviour.ts
    - src/lib/mcptest/fake/tools.ts
    - src/lib/mcptest/fake/fakeServer.ts
    - src/lib/mcptest/fake/httpFake.ts
    - src/lib/mcptest/fake/variants.ts
    - src/lib/mcptest/fake/fakeMain.ts
    - src/lib/mcptest/fake/testing.ts
    - src/lib/mcptest/fake/fakeServer.test.ts
    - src/lib/mcptest/fake/variants.test.ts
    - src/lib/mcptest/fake/fakeMain.smoke.test.ts
decisions: [DRAFT-15-04-a, DRAFT-15-04-b, DRAFT-15-04-c, DRAFT-15-04-d]
metrics:
  tasks: 3
  tests: 41
  completed: 2026-10-12
---

# Phase 15 Plan 04: Fake MCP runtime Summary

In-process fake MCP server (good variant plus 15 behaviour flaws and 5 process-level faults) that speaks real line-framed stdio or Streamable HTTP and calls the 15-03 mock over loopback fetch, so CI can prove the scorer discriminates without Python.

## Commits (branch worktree-agent-afd3e09b65e6f8767)
- 22ecf93 fake server, good variant, stdio and HTTP flavours (16 tests)
- 3a23d68 flawed variants and VARIANTS registry (+18 tests)
- 6d845ea process-level variants, fakeMain.ts, real-subprocess smoke test (+7 tests)

## What exists
- `createFake({variant, env, sleep?, stderr?})` returns one `handle(msg)` dispatcher (initialize, notifications, ping, tools/list, tools/call; unknown tool gives -32602). `serveStdio` and `startHttpFake` both use it. Unknown variant rejects/throws a typed `FakeError` (code `unknown-variant`).
- All 9 contract tools are exposed (plus `delete_item` for write-tool); good variant output is `{ok, items|item, page, per_page, total, truncated?, shown?}` and errors `{ok:false, kind, message, hint}`. Message wording avoids the envelope words so the 3-of-4 rule is never tripped (asserted over ten calls).
- Derived filter pages the mock per category partition (4 x 2 pages of 50, inside the 200 result window) and filters attributes in memory; no `attribute` query param ever reaches the mock.
- `VARIANTS` entries carry `mustFail`, `flags`, `expectScoreBand`; every description starts with "Scorer fixture:".
- Only `fakeMain.ts` reads the process environment (copies the three ACME_* names into the explicit `env` option). `fake/` imports nothing from `$lib` or svelte.

## Decision drafts (for 15-13 to consolidate)
- **DRAFT-15-04-a** Fake variants are scorer fixtures and are labelled so (description prefix, serverInfo name `scorer-fixture-<id>`); they are never reported as a tested real server. Revert: n/a, documentation.
- **DRAFT-15-04-b** One all-tools fake with per-case binding (hints) instead of per-case fakes; irrelevant tools are simply not called. A test asserts the structural hint kinds (partition_filter, derived_filter, composite, i18n_codes, large_response, grounding, profile) each bind exactly one good-variant tool, so descriptions must not contain other tools' hint words. Revert: split tools per case.
- **DRAFT-15-04-c** Strict malformed handling: a non-JSON content-type on a 2xx upstream reply counts as malformed (good variant reports `upstream`, confident-wrong fabricates). Revert: drop the content-type test in `Ctx.request`.
- **DRAFT-15-04-d** `mirror` and `leaky-errors` declare flag LEAK (their output genuinely contains upstream envelope/traceback text). The plan table listed LEAK only for leaky-errors; 15-08 should treat flags as "must raise" and not assert flags absent for mirror. Revert: set `flags: []` on mirror in variants.ts.

## Deviations from Plan
- **[Additive]** `fake/testing.ts` (withFake, CANARY, FAKE_SPEC, envelopeLeak) is a shared test helper not in the file list, so variants.test.ts and the smoke test do not import from a test file.
- **[Additive]** Two extra process variants beyond the plan's four: `unknown-protocol` (replies 1999-01-01; the plan's behaviour list names it) is registered; `serveStdio` accepts `endOutputOnEof` (default true; fakeMain passes false because process.stdout cannot be ended).
- Task 1 commit already contains the full tools.ts (all flaw branches) because the branches live in the same table-driven file; Task 2 commit adds the registry and the flaw tests.
- **[Rule 1 - Bug, found while testing]** The hallucinated route `/widgets/featured` matched the documented `/widgets/:id` pattern so docs mode did not flag it; changed to `/widgets/featured/list`.
- Sizing: huge-payload returns 600 projected items (about 250 KB) so the failure is "too big" and not "line dropped by the 1 MiB client cap".

## Notes for 15-07 / 15-08
- no-clamp forwards `per_page` verbatim; with the default mock ceiling (200) a 250-item request becomes a 500 "all shards failed" and the fake reports a clean upstream failure (the pagesize_clamp validator would then pass). The no-clamp and mirror observability tests therefore use a mock spec with `ceiling: null`; the discrimination case for those variants should do the same.
- bare-empty and leaky-errors differ only for empty results: bare returns the raw body, leaky adds an envelope object.
- Fault variants over HTTP: crash-on-init destroys the socket, hang never answers, others are protocol-level only.

## Verification
- `npx vitest run src/lib/mcptest/fake`: 3 files, 41 tests pass (smoke test about 1-2 s, limit 20 s); `npx tsc --noEmit` clean.
- grep: no process.env / $lib / svelte imports in fake/ (except fakeMain's single env copy), no forbidden tokens, no existing test files edited, no Python executed.
- `npm run check` exit 0: 148 files passed, 1 skipped, 1436 tests passed.

## Self-Check: PASSED
All files above exist; commits 22ecf93, 3a23d68, 6d845ea present on the worktree branch.
