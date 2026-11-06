---
phase: 15-mcp-test-platform-flagged
plan: 08
subsystem: mcptest-core
tags: [mcp, runner, report, discrimination, fake-runtime]
requires: [15-01, 15-02, 15-03, 15-04, 15-05, 15-06, 15-07, 15-09]
provides:
  - runSuite (cases x reruns, never throws), cellRun.runOnce
  - subjects registry (fakeSubject, listSubjects, resolveSubject, RunnableSubject)
  - mcptest-report/1 schema, buildReport, renderMatrix, renderSummary, toLegacyCsvRow, redact
  - discrimination proof (variant x expected failures) and golden report
affects: [15-10, 15-11, 15-12, 15-13]
key-files:
  created:
    - src/lib/mcptest/core/redact.ts
    - src/lib/mcptest/core/report.ts
    - src/lib/mcptest/core/report.test.ts
    - src/lib/mcptest/core/subjects.ts
    - src/lib/mcptest/core/runner.ts
    - src/lib/mcptest/core/cellRun.ts
    - src/lib/mcptest/core/runner.test.ts
    - src/lib/mcptest/core/discrimination.test.ts
    - src/lib/mcptest/core/__golden__/report-good-t1.json
  modified:
    - src/lib/mcptest/core/walk.ts (DRAFT-15-08-fix-2)
    - src/lib/mcptest/fake/tools.ts (DRAFT-15-08-fix-1)
requirements-completed: [SC-2, SC-4, SC-5]
completed: 2026-10-13
---

# Phase 15 Plan 08: Runner, report and discrimination proof Summary

The real runner over the fake variants shows the scorer discriminates: good scores 100 with no flags, each flawed variant fails exactly the checks in its `mustFail` and raises its flags, blockers force BLOCKED, and process-level faults become D1 failures or findings.

## Commits (branch worktree-agent-a5c7c417d9b4dd490)
- bb72cec report schema, renderers, redaction (10 tests)
- 2d41400 fix: findAllProducts outermost items only; fake assemble accepts component_id
- 0642b2e subject registry and cell runner (20 tests)
- 126965e discrimination proof and golden report (34 tests)

## Discrimination results (what the tests assert)
- good over all 12 cases: 6 cases PASS, T2-CATALOG-DUMP PENDING_HUMAN, T4-PARTIAL-SPEC NA_MODALITY, gate pass, score 100, zero flags, coverage 6/7; with the dump case left out the verdict is PASS.
- Every flawed variant fails its listed kinds (D1 for crash-on-init and hang); `no-derived-tool`, `no-clamp`, `raw-passthrough`, `bare-empty`, `no-auth-message` fail exactly one of the ten generic checks and nothing outside T2-CATALOG-API.
- Flags: LEAK (mirror, leaky-errors), SECRET_ECHO, WRITE_TOOL, CONFIDENT_WRONG (blockers, verdict BLOCKED at score 100); NO_RETRY, UNVALIDATED_CODE (warnings, never BLOCKED); STDOUT_NOISE (warning, case still PASS).
- hallucinated-endpoint: T3-RT-DOCS D3 = 0. huge-payload and no-trunc-signal: large_response FAIL.
- Calibration: good > no-clamp (partial) > mirror on T2-CATALOG-API. A stricter Tier 1 clone gives gate fail, score null, DISQUALIFIED, with T2 still shown.

## Interface notes honoured
- 15-07 golden argument names: `search_items` accepts `query` already; the fake's `assemble_composite` only read `id`, so it now also accepts `component_id` (fix-1). Checks were not weakened.
- 15-04: the no-clamp and mirror discrimination runs use `ceiling: null` on the mock spec (test-side override of the SuiteCase).
- 15-05: bind callback returns golden args unchanged; the validators fill `{{badId}}`, `{{pageSize}}`, `{{page}}`.
- 15-09: env names come from `PrepareResult.envNames`; `dataPath` is placed in the env only for `x-requires: real-runtime` cases (value = the case's dump fixture path). Generated servers are never executed: stdio launch gives PENDING_HUMAN with extraChecks and their flags still counted.

## Decision drafts (not written to AUTONOMOUS-DECISIONS.md)
- **DRAFT-15-08-a** Additive cell states NA_TRANSPORT and PENDING_HUMAN. Revert: remove from CellState, `preResolve` and the stdio branch in runner.ts.
- **DRAFT-15-08-b** Per-run random canary key (`canary-` + 16 hex from crypto.randomBytes) passed to the mock and as ctx.canary; subject env is an allowlist (exactly the case x-env names or PrepareResult.envNames, plus dataPath for real-runtime cases), never process.env; the canary is redacted from every report string. Revert: fixed key in runSuite.
- **DRAFT-15-08-c** Reruns default 1 (clamp 1..3) in API/CI; the source suggests 3 for real subjects. Revert: change `clamp` default.
- **DRAFT-15-08-d** `x-requires: real-runtime` on a fake subject gives PENDING_HUMAN before prepare, so no result is fabricated. Revert: drop the branch in `preResolve`.
- **DRAFT-15-08-e** fault_timeout default deadline 8000 ms with 3000 ms slack in the runner (the fake's own upstream timeout is 5 s; the 15-06 default of 2000 ms would fail a well-behaved server). Revert: edit `specialConfig` in cellRun.ts.
- **DRAFT-15-08-f** Verdict stays FAIL when a scoring case is PENDING_HUMAN (15-06 rule, pinned by its existing test), so good over the full suite is FAIL at coverage 6/7 and PASS only when every applicable case ran. Alternative: let PENDING_HUMAN not block PASS (needs a 15-06 test change). Plan text expected PASS with the dump case present.
- **DRAFT-15-08-g** Fake subject exposes a per-case tool scope (`toolScope`): T3-RT-DOCS shows only the documented tools, because grounding fails any tool without a documented operation and the all-tools fake would always fail it. Revert: remove `toolScope` and trim the fake's tool list per case.
- **DRAFT-15-08-h** LEAK flag attached by the runner to any FAIL check whose reason reports a leak (behaviour validators return no flags), plus golden-line leaks via evaluateExpect. STDOUT_NOISE is carried by an NA check so the case state is unaffected. Report gains `incomplete` handling: an aborted run reports remaining cases as ERROR and verdict INCOMPLETE.
- **DRAFT-15-08-fix-1** fake `assemble_composite` accepts `component_id` (suite golden name).
- **DRAFT-15-08-fix-2** `findAllProducts` returns outermost item-like objects only. Before, the nested `supplier {id,name}` counted as a second item, so the good fake failed pagesize_clamp ("100 items > max 50"). Existing walk tests unchanged and green.

## Deviations from Plan
- Added `core/cellRun.ts` (plan allowed a second file) holding the single-run logic; `report.ts` has an extra `incomplete` input.
- `PrepareResult` was not changed; `RunnableSubject.prepare` returns `PrepareResult & { stderrText? }` so in-process stderr reaches the secret canary check.
- Pending-human static commands use the generic case id T2-CATALOG-API and `npm run mcp-test`, which does not exist yet (later plans add the CLI); commands are from 15-RESEARCH "Pending Human" 2-3.
- Resume note: a rate limit interrupted the first session before any file was written; work restarted from a clean tree.

## Verification
- `npx vitest run src/lib/mcptest`: all green (discrimination about 20 s); `npx tsc --noEmit` clean.
- `npm run check` exit 0 (159 files passed, 1 skipped, 1620 tests; no timeouts).
- Token scan of new files: no forbidden tokens; golden report has no port, canary or timestamp. No existing test file edited, no Python executed, no new dependency.

## Self-Check: PASSED
Created files and commits bb72cec, 2d41400, 0642b2e, 126965e exist.
