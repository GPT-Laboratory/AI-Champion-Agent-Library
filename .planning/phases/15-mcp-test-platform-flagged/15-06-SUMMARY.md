---
phase: 15-mcp-test-platform-flagged
plan: 06
subsystem: testing
tags: [mcp, scoring, aggregation, tier3, tier4, flags]
requires: [15-01, 15-03, 15-05]
provides: [scoring.ts, aggregate.ts, tier3Checks.ts, tier4Checks.ts]
affects: [runner, scorer wiring (15-07), end-to-end discrimination (15-08)]
key-files:
  created:
    - src/lib/mcptest/core/aggregate.ts
    - src/lib/mcptest/core/aggregate.test.ts
    - src/lib/mcptest/core/scoring.ts
    - src/lib/mcptest/core/scoring.test.ts
    - src/lib/mcptest/core/tier3Checks.ts
    - src/lib/mcptest/core/tier3Checks.test.ts
    - src/lib/mcptest/core/tier4Checks.ts
    - src/lib/mcptest/core/tier4Checks.test.ts
requirements-completed: [SC-2, SC-3]
completed: 2026-10-12
---

# Phase 15 Plan 06: Scoring, Aggregation, Tier 3/4 Checks Summary

Tier 1 gate / Tier 2+3 mean / Tier 4 flags rollup with enforced case thresholds and verdict precedence, pessimistic rerun aggregation, and eight special checks (grounding, profile, composite, large_response, fault_retry, fault_timeout, fault_malformed, secret_canary, i18n_codes) tested against scripted callers and the real mock upstream.

## Commits

- 50fbac1 feat(15-06): scoring rollup and rerun aggregation
- f02b85b feat(15-06): Tier 3 special checks
- bb1a092 feat(15-06): Tier 4 special checks

## Notes on implementation

- `evaluateCase` thresholds: d1_pass, d2_pct (alias d2_functional_pct), d3_score, d4_pct, pagination_correct, result_cap_present. Unknown keys and wrong-typed values go to `unrecognised`; thresholds with unavailable actuals report `met: null`, are listed in `unscored`, and are excluded from the pass decision. A failed D1 can never be thresholded away.
- Special checks return several CheckResults where useful: `profile.required_tools|naming|descriptions`, `secret_canary.echo|write_tools|injection`, `i18n_codes.invalid|roundtrip`. Shared helpers (`SpecialCtx`, `makeResult`, `bindOrResult`, `safeCall`) live in tier3Checks.ts and are reused by tier4Checks.ts.
- Config keys consumed (for 15-07 wiring): grounding `traceTable`, `toolArgs`; profile `profile{requiredTools,namePattern,requireDescriptions}`; composite `expectedKeys`; large_response `maxBytes`, `maxItems`, `totalItems`; fault_retry `route`, `callTimeoutMs`; fault_timeout `timeoutMs`, `slackMs`; secret_canary `injectionArg`; i18n_codes `invalidCode`, `validCode`, `expectedName`, `codeArg`, `route`. profile `serverName` is not checkable through a ToolCaller and is ignored.
- Tier 1 case states PASS/FAIL/ERROR count as "ran"; an ERROR Tier 1 case fails the gate (conservative). INSTALL_FAILED/GEN_FAILED/UNAVAILABLE Tier 1 cases leave the gate `not_run`.
- A Tier 2/3 case with no scored checks, no D1 and no decisive thresholds evaluates to ERROR (scorer problem, not a pass).

## Decision drafts (for 15-13 to consolidate; AUTONOMOUS-DECISIONS.md not edited)

- **DRAFT-15-06-a Score formula and verdict precedence.** Headline score = unweighted mean (one decimal) of Tier 2 and Tier 3 case pass-rates over cases that ran, NA excluded; null when the Tier 1 gate fails. Verdict: blocker -> BLOCKED; gate fail -> DISQUALIFIED; nothing ran -> INCOMPLETE; all applicable T2+3 ran and passed -> PASS; else FAIL. Alternatives: weighted by tier or by check count. Assumption pending confirmation (RESEARCH Open Question 4). Revert: edit `meanCases` and the verdict block in scoring.ts (marked `DRAFT-15-06`).
- **DRAFT-15-06-b ERROR counted as not passed.** ERROR checks stay in the denominator as unpassed; case state becomes ERROR when a check is ERROR and none FAIL. Alternative: exclude ERROR from the denominator (would hide scorer problems as higher scores). Revert: change the `scoredChecks` filter in `evaluateCase`.
- **DRAFT-15-06-c Token approximation bytes/4.** large_response reports `~bytes/4` tokens in the reason; no tokenizer dependency. Revert: replace in `largeResponse` (tier3Checks.ts).
- **DRAFT-15-06-d Case thresholds are enforced.** The source never read `pass_thresholds`; they now decide case PASS/FAIL when at least one is scorable, with unscorable ones reported rather than treated as met. Revert: drop the `decisive` branch in `evaluateCase`.
- **DRAFT-15-06-e Retry window [2, 6] attempts.** fault_retry accepts 2 to 6 upstream attempts per scenario (tolerant timing per Pitfall 9; no wall-clock assertions on retry spacing). Revert: constants MIN_ATTEMPTS/MAX_ATTEMPTS in tier4Checks.ts.

## Deviations from Plan

None - plan executed as written. The plan's SpecialCtx was extended only by sharing exports; no new files beyond the listed ones.

## Verification

- `npx vitest run src/lib/mcptest/core` green (aggregate 7, scoring 23, tier3 19, tier4 25 new tests); no `$lib`/svelte imports, no Math.random, no forbidden tokens in new files.
- `npm run check` exit 0 (see final report).

## Self-Check: PASSED
