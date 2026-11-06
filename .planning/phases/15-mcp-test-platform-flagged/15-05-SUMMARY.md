---
phase: 15-mcp-test-platform-flagged
plan: 05
subsystem: testing
tags: [mcp, validators, leak-detector, scoring]
requires: [15-01]
provides: [leak.ts, walk.ts, binding.ts, expect.ts, validators.ts]
affects: [scorer, runner]
key-files:
  created:
    - src/lib/mcptest/core/leak.ts
    - src/lib/mcptest/core/walk.ts
    - src/lib/mcptest/core/binding.ts
    - src/lib/mcptest/core/expect.ts
    - src/lib/mcptest/core/validators.ts
    - src/lib/mcptest/core/leak.test.ts
    - src/lib/mcptest/core/walk.test.ts
    - src/lib/mcptest/core/binding.test.ts
    - src/lib/mcptest/core/expect.test.ts
    - src/lib/mcptest/core/validators.test.ts
requirements-completed: [SC-2]
duration: ~25min
completed: 2026-10-12
---

# Phase 15 Plan 05: Validators Summary

Pure, server-independent validator logic: exact-port leak detector with additive runtime extras, field-name-agnostic walkers, strict tool binding, strict golden `expect` evaluator and the 10 behaviour checks, all pinned by canned-result tests (108 tests in core/ pass; `npm run check` exit 0).

## Commits
- f062709 leak, walk, binding
- 87bb5fd expect evaluator
- 507c530 behaviour checks and tests

## Notes for downstream plans
- Argument templating: bound args may carry `{{badId}}`, `{{pageSize}}`, `{{page}}` placeholders; validators substitute them (whole-string placeholders become numbers). Without placeholders the bound args are used as-is. The runner (bind callback) is responsible for supplying them.
- `auth_fail` calls the bound tool on the relaunched caller with the bound args; `WRONG_KEY` is exported.
- `expect.ts` imports only the `Identity` type from validators.ts, and validators.ts imports `NOT_FOUND_RE`/`EMPTY_MSG_RE` from expect.ts (no runtime cycle).
- Error outcomes (rpc/transport) never auto-pass data expects (field_*, max_*); they only satisfy no_leak when leak-free.

## Decision drafts

### DRAFT-15-05-a: Tightened pass conditions
Deliberate deviations from the source harness (comparability note: scores may differ from source runs on the same server):
1. `clean_not_found` is strict: requires isError / rpc_error / explicit not-found text, no leak, and no item object. Revert: relax the `signal` condition in `evaluateExpect` (expect.ts, `expect.clean_not_found` block) to accept a non-error result without an item.
2. `auth_fail` uses `AUTH_RE` without the loose `invalid` alternative (only `invalid key`). Revert: edit `AUTH_RE` in validators.ts.
3. Tool binding requires an explicit tool or a `tool_hint` that matches exactly one tool (name first, then description); ambiguity yields status ERROR ("our problem"), absence yields FAIL "no tool". Revert: in `bindTool` (binding.ts) take `matches[0]` instead of returning `ambiguous`.
4. `derived_filter` with an empty expected-ids list returns NA instead of passing vacuously.

### DRAFT-15-05-b: Added runtime leak extras (additive)
`RUNTIME_LEAK_EXTRA = ECONNREFUSED, undici, at Object.<anonymous>, node:internal` are applied by `looksLikeLeak`, the validators and `evaluateExpect`; `leakReason(text)` with no extra argument is the exact source rule. Revert: pass `[]` instead of `RUNTIME_LEAK_EXTRA` in those call sites, or empty the array.

## Deviations from Plan
None in behaviour. Setup note: first `npm ci`/ingest was launched twice by accident (duplicate background run); harmless.

## Issues
None. Full `npm run check` passed with no load-induced timeouts.
