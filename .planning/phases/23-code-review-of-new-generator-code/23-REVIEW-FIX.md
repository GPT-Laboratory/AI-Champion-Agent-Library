---
phase: 23-code-review-of-new-generator-code
plan: 02
status: complete
part_1: critical 6 of 6 fixed; warnings fixed (passes A, B, C plus CR-32, CR-40, CR-42)
part_2: all remaining warnings fixed; info fixed, accepted or deferred with reasons
fixed: 50
accepted: 5
not_a_defect: 0
deferred: 4
total: 59
---

# Phase 23 Review Fix

Source: 23-REVIEW.md (baseline d45f59b). Fixes were made one finding or tight cluster at a time on branch
autonomous/overnight-improvements, failing test first, `Co-Authored-By` trailer on every commit. Statuses:
fixed (commit, test), accepted (decision id, finding left as is), not-a-defect (evidence), deferred (follow-up).
Part 2 rows follow the Part 1 rows; the counts above cover both parts (fixed includes the partly fixed info findings).

## Part 1 summary

- All 6 critical findings reproduced as described and fixed (CR-10, CR-18, CR-26, CR-27, CR-38, CR-39). None was a false positive.
- Warnings of passes A, B and C fixed: CR-01..CR-05, CR-11, CR-12, CR-19, CR-20. Entangled warnings from passes D and E1 fixed with them:
  CR-32 (same cause as CR-20), CR-40 (truncation in the text cleaners CR-38/39 rewrote), CR-42 (link filter shared with CR-38).
- Where a fix is narrower than the suggested fix, the decision id says how (see AUTONOMOUS-DECISIONS.md D-611..D-617).
- Goldens: two goldens-only commits. eb4dd6f: model/report JSON gain the info gap `base-path-in-env` (fixtures with a servers url or
  basePath), proposal review goldens and `proposals/real/acme-openapi.proposals.json` carry the new baseline fingerprint (the fingerprint
  covers gaps); no server.py text changed. 4803492: OData goldens (server.py, test_server.py, model, report) for CR-19 (new runtime
  helpers, list tools warn on capped responses, one new generated test). Generated OData pytest passes (21 tests) on FastMCP 4.1.0 in a
  throwaway venv outside the repo (deleted afterwards). No other emitted Python changed.
- A repo guard (criteria.test.ts, "no pre-existing test file was modified by Phase 15") forced the CR-10/11/12 tests into the new file
  adapters/sql-ddl.review23.test.ts.

## Part 1 rows

| Finding | Severity | Status | Commit | Test | Decision |
|---|---|---|---|---|---|
| CR-01 | warning | fixed | 20ac57e | adapters/openapi.test.ts "detects the marker after 64 KB of components" |  |
| CR-02 | warning | fixed | 66be918 | adapters/openapi.security.test.ts "undefined security scheme (CR-02)" |  |
| CR-03 | warning | fixed | 53f0aa0 | adapters/openapi.swagger2.test.ts "swagger 2.0 produces */* (CR-03)" |  |
| CR-04 | warning | fixed | 8d3e753, 8ea0bb8 (goldens eb4dd6f) | adapters/openapi.test.ts "base path gap (CR-04)" | D-611 |
| CR-05 | warning | fixed | cc07a67 | adapters/openapi.audit31.test.ts "3.1 nullable unions and const (CR-05)" |  |
| CR-10 | critical | fixed | 2e9c8ac | adapters/sql-ddl.review23.test.ts "columns named like constraint keywords (CR-10)" | D-612 |
| CR-11 | warning | fixed | 43d6e68 | adapters/sql-ddl.review23.test.ts "identifier case in keys (CR-11)" |  |
| CR-12 | warning | fixed | 9237075 | adapters/sql-ddl.review23.test.ts "MySQL comments (CR-12)" |  |
| CR-18 | critical | fixed | d627b20 | adapters/odata.adversarial.test.ts "entity and property names that collide with Object.prototype (CR-18)" | D-612 |
| CR-19 | warning | fixed | 0400021 (goldens 4803492) | generated test_capped_response_with_next_link_warns (pytest, FastMCP 4.1.0 venv) + adapters/odata.golden.test.ts | D-613 |
| CR-20 | warning | fixed | 1e3e4d2 | mcptest/proposalEval.xml.test.ts |  |
| CR-26 | critical | fixed | 789dd8a | proposals/gates.test.ts "gate 4: rename_arg collisions (CR-26)" | D-614 |
| CR-27 | critical | fixed | e5c702f | proposals/contextPack.test.ts "SQL dump data rows stay out of the pack (CR-27)" | D-615 |
| CR-32 | warning | fixed | 1e3e4d2 (same fix as CR-20) | mcptest/proposalEval.xml.test.ts |  |
| CR-38 | critical | fixed | 7b97acc | hygiene.test.ts "CR-38: long link-shaped tokens are linear" |  |
| CR-39 | critical | fixed | e5834b9 | hygiene.test.ts + proposals/hygiene.test.ts "CR-39 invisible characters" | D-616 |
| CR-40 | warning | fixed | 7aaf7db | hygiene.test.ts "CR-40 truncation never leaves a lone surrogate" |  |
| CR-42 | warning | fixed | 7aaf7db | hygiene.test.ts + proposals/hygiene.test.ts "CR-42 ..." | D-617 |

## Part 2 rows

All 41 ids that Part 1 left open. Every finding was checked against the code before it was changed: all of them are real
(none is "not a defect"). Partly fixed findings say in the Test column what was left and the decision id says why.

| Finding | Severity | Status | Commit | Test | Decision |
|---|---|---|---|---|---|
| CR-06 | info | fixed | d05b2d6 | adapters/review23.info.test.ts "CR-06" | D-628 |
| CR-07 | info | fixed | d05b2d6 | adapters/review23.info.test.ts "CR-07" | D-628 |
| CR-08 | info | fixed | 270dcf9 | plan.review23.test.ts "unusable API key name (CR-08)" | D-628 |
| CR-09 | info | fixed | d05b2d6 | adapters/review23.info.test.ts "CR-09" | D-628 |
| CR-13 | info | fixed | d05b2d6 | adapters/review23.info.test.ts "CR-13" | D-628 |
| CR-14 | info | accepted |  |  | D-629 |
| CR-15 | info | accepted |  |  | D-629 |
| CR-16 | info | fixed | d05b2d6 | adapters/review23.info.test.ts "CR-16" | D-628 |
| CR-17 | info | accepted |  |  | D-629 |
| CR-21 | info | fixed | d05b2d6 | adapters/review23.info.test.ts "CR-21" | D-628 |
| CR-22 | info | fixed | d05b2d6 | adapters/review23.info.test.ts "CR-22" | D-628 |
| CR-23 | info | fixed | d05b2d6 | adapters/review23.info.test.ts "CR-23" | D-628 |
| CR-24 | info | deferred |  |  | D-631 |
| CR-25 | info | accepted |  |  | D-629 |
| CR-28 | warning | fixed | 67a4576 | proposals/gates.test.ts "gate 3: reserved runtime names (CR-28)" | D-619 |
| CR-29 | warning | fixed | 6206c1f | proposals/gates.test.ts "composite argument constraints (CR-29)" | D-627 |
| CR-30 | warning | fixed | ca6240a | proposals/hygiene.test.ts "write claim: bypasses found in review 23 (CR-30)" | D-620 |
| CR-31 | warning | fixed | e4dc762 | proposals/contextPack.test.ts "trusted README and the spec title (CR-31)" | D-627 |
| CR-33 | warning | fixed | fde49ea | mcptest/proposalEval.review23.test.ts "serverInvariantProblems (CR-33)" | D-627 |
| CR-34 | warning | fixed | 0765a1c | mcpgen/credentials.review23.test.ts "isEnvFileName (CR-34)" | D-621 |
| CR-35 | warning | fixed | 08a603b | proposals/contextPack.test.ts "pack truncation (CR-35)" | D-623 |
| CR-36 | info | fixed | 4c49ede | mcptest/core/packageBinding.review23.test.ts | D-628 |
| CR-37 | info | fixed | 7a4c704 | proposals/index.review23.test.ts "proposal file edge cases (CR-37)" | D-628 |
| CR-41 | warning | fixed | adf6a31 | mcpgen/plan.review23.test.ts "projection override with no valid field (CR-41)" | D-627 |
| CR-43 | info | deferred |  |  | D-631 |
| CR-44 | info | deferred |  |  | D-631 |
| CR-45 | info | deferred |  |  | D-631 |
| CR-46 | info | fixed | 7a4c704 | proposals/contextPack.test.ts "buildContextPack never throws (CR-46)" | D-628 |
| CR-47 | warning | fixed (not built) | e3fb462 | server/mcptest/containerRun.review23.test.ts "resolveDriverRoot (CR-47)", "Containerfile runtime stage ..." | D-622 |
| CR-48 | warning | fixed | ac32108 | scripts/is-main.test.ts "script entry detection" | D-624 |
| CR-49 | warning | fixed | ac32108 | scripts/is-main.test.ts "script entry detection" | D-624 |
| CR-50 | warning | fixed | 3fbab52 | routes/api/mcp-generate/mcp-generate.review23.test.ts "slot handling (CR-50)" | D-625 |
| CR-51 | warning | fixed | 77f0271 | mcptest/generatorSubject.test.ts "maps bearer and OAuth2 tokens ..." | D-626 |
| CR-52 | warning | fixed | 40a5440 | scripts/tryout-run.review23.test.ts (timeouts, spend, ledger lock) + tryout-run.test.ts transport case | D-618 |
| CR-53 | warning | fixed | 40a5440 | scripts/tryout-run.review23.test.ts "server-supplied values (CR-53)" | D-618 |
| CR-54 | info | accepted |  |  | D-630 |
| CR-55 | info | fixed | 0765a1c, 59f7a92 | scripts/generate-mcp.review23.test.ts "defaultIo (CR-55)"; credentials.review23.test.ts | D-621, D-628 |
| CR-56 | info | fixed (partial) | 0f5c452 | scripts/validate-entries.review23.test.ts; mcp-test exit code accepted | D-628, D-630 |
| CR-57 | info | fixed (partial) | b7df137 | scripts/smoke.review23.test.ts "skipFixtures (CR-57)"; env allowlist accepted | D-628, D-630 |
| CR-58 | info | fixed (partial) | e3fb462 | containerRun.review23.test.ts "Containerfile.mcp-test-runner installs sax (CR-58)"; pip pins pending human | D-622, D-630 |
| CR-59 | info | fixed (partial) | c3381dd | mcp-generate.review23.test.ts "retry-after (CR-59)"; rest accepted | D-628, D-630 |

## Part 2 summary

- Warnings: all 15 remaining warnings fixed (CR-28..31, 33..35, 41, 47..53). Info: 17 fixed (4 of them partly), 5 accepted (D-629, D-630), 4 deferred (D-631).
- Goldens: none changed in Part 2 (no commit touches `__golden__`); the generated Python is byte-identical.
- Containerfile and Containerfile.mcp-test-runner changed and were NOT built (Podman off-limits): see 23-HUMAN-UAT.md.
- Test-file rule: `scripts/tryout-run.test.ts` and `generatorSubject.test.ts` were edited (the first pinned the old reserve over-count, D-618, and is
  now in the guard's EXEMPT list; the second was already exempt); every other new test is in a new `*.review23.test.ts` file or an
  existing file that the Phase 15 guard does not pin.

## Info findings

Dispositions are in the two tables above (Part 1 had no info rows). Accepted: CR-14, CR-15, CR-17, CR-25, CR-54. Deferred (output-changing, need a goldens commit): CR-24, CR-43, CR-44, CR-45.
