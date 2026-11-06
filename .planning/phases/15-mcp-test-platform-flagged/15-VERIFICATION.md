---
phase: 15-mcp-test-platform-flagged
status: human_needed
verified: 2026-10-13
---

# Phase 15 verification: MCP test platform (flagged)

Overall status: **human_needed**. Everything that can be checked offline is covered by automated tests and `npm run check` is green. Nothing that needs a real FastMCP process, a container engine or a browser has been run; those items are listed in `15-HUMAN-UAT.md` and are pending human.

## Success criteria

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Port-fidelity map: every component and case ported or deliberately not; implemented versus designed-only separated; remaining cases implemented with synthetic offline fixtures where feasible | Verified by automated test | `docs/mcp-test-port-fidelity.md` and `src/lib/mcptest/core/fidelity.ts` (`fidelity.test.ts` checks every id appears in the doc); 12 suite directories under `src/lib/mcptest/suite/` loaded by `suite.test.ts` and `suite.criteria.test.ts`; `GAPS` lists the honest gaps; `criteria.test.ts` checks suite, table and docs agree. Formats reused (case.yaml, golden.jsonl, rubric.yaml); logic re-implemented in TypeScript, nothing wrapped literally (documented in the map). The source repository was not read during this plan |
| 2 | Cases and scoring match source semantics: Tier 1 gate, Tier 2+3 score, Tier 4 flags; synthetic fixtures and mock upstreams with fault injection only | Verified by automated test, with documented deviations | `core/scoring.ts` + `scoring.test.ts` (23 tests), `tier3Checks.test.ts`, `tier4Checks.test.ts`, `mock/upstream.test.ts` (fault injection), `core/discrimination.test.ts` (good fake scores 100; each flawed variant fails exactly its listed checks and flags). Deviations: tightened pass conditions (D-166), thresholds enforced (D-167), pessimistic ties. The headline score formula is an assumption pending the study author (D-167) |
| 3 | Safety rules kept: no credentials, fake data only, runner never touches real APIs or keys | Verified by automated test | `src/lib/mcptest/criteria.test.ts`: purity of core/mock/fake, `child_process` only in `core/transports/stdio.ts`, no forbidden token, no secret-shaped string, loopback-only URL literals, no `.env` reads, flag defaults, `MCP_TESTER_RUNTIME` set in no committed file; `suite.criteria.test.ts` golden isolation; `core/transports` loopback and exec-guard tests; `containerRun.test.ts` (no egress, open egress refused) |
| 4 | Black-box MCP client over stdio (HTTP where declared); fake runtime for CI, Phase 8 container runtime for real runs | Partially verified; real run pending human | Client: `core/client.test.ts`, `core/transports/*` tests, `fake/fakeMain.smoke.test.ts` (real subprocess over stdio against a fake), HTTP fake in `fake/httpFake.ts`. Container path: `containerRun.test.ts` and `service.test.ts` on the fake runtime; `containerfile.test.ts`, `driver.test.ts`. NOT verified: the runner image build, an actual engine run, a real FastMCP server (HUMAN-UAT items 1 to 4). Legacy HTTP+SSE not implemented |
| 5 | Report JSON + readable summary and a UI panel for progress and results; flag off hides it | Verified by automated test; browser check pending human | `core/report.test.ts` (schema, size cap, redaction, renderers, golden), `scripts/mcp-test.test.ts` (CLI), `src/routes/api/mcp-test/mcp-test.test.ts` (flag off is 404, 202 polling, report), `src/routes/mcp-test/page.test.ts` + `page.load.test.ts` (including axe), Customize menu flag-off regression. Real browser, keyboard and screen reader checks are HUMAN-UAT item 7 |
| 6 | Container runs that cannot be verified unattended are listed as pending human with exact commands | Verified | `.planning/phases/15-mcp-test-platform-flagged/15-HUMAN-UAT.md` (9 items, all unchecked, exact commands); the same list ships in every report (`PENDING_HUMAN_STATIC`) and in `docs/mcp-test-platform.md`; `criteria.test.ts` asserts the doc and the UAT file contain every command |

## Self-check

- **Requirement coverage.** All six criteria are covered by at least one plan: SC-1 by 15-01 and 15-07, SC-2 by 15-05, 15-06, 15-08, SC-3 by 15-02, 15-03, 15-13, SC-4 by 15-02, 15-10, 15-11, SC-5 by 15-08, 15-11, 15-12, SC-6 by 15-10, 15-13 (as declared in the plans' requirements fields).
- **Forbidden tokens.** Enforced by `criteria.test.ts` (tokens built from fragments at runtime): none in tester code, suite, runner image or `docs/mcp-test-platform.md`; the single source case id appears exactly once, in a table row of `docs/mcp-test-port-fidelity.md`, and nowhere else in `src/`, `scripts/`, docs, README or TECHNICAL_DOCUMENTATION.
- **Existing tests unmodified.** `git diff --diff-filter=M --name-only <parent of the Phase 15 start commit>..HEAD -- '*.test.ts'` lists exactly one file, `src/routes/api/tryitout/jobs/jobs.test.ts` (waitForStatus cap 3s to 15s in the earlier flake fix, D-163, a commit made after the phase baseline). That change is exempted by name in `criteria.test.ts`; no other pre-existing test file was modified. (The plan text names the baseline `afa1700`; that commit is the Phase 15 context commit, so the baseline used here is its parent.)
- **Dependencies.** No new dependency (`package.json` untouched by this phase's plans).
- **Test counts.** Final `npm run check` exit 0: 175 test files passed, 1 skipped; 1746 tests passed, 1 skipped. `criteria.test.ts` contributes 18 tests.
- **Decisions.** All `DRAFT-15-NN-x` entries from the twelve SUMMARY files are consolidated as D-164..D-181 in `.planning/AUTONOMOUS-DECISIONS.md` with alternatives, rationale and revert steps (the file already ended at D-163 for the flake fix).

## Honest gaps and open findings

- No real FastMCP server has ever been run or scored. The `fastmcp>=3.4,<4` pin is unverified. Generated Python is never executed in CI.
- The runner image has never been built; the Phase 8 container user (`pi`) differs from the image user (`node`) (D-178).
- Fake variants are scorer fixtures. A scorer that discriminates synthetic flaws is not evidence about real servers.
- Verdict behaviour: a pending-human scoring case blocks PASS, so the good fake scores FAIL over all 12 cases at coverage 6/7 (D-168). This follows the 15-06 rule and its existing test; the alternative is a decision for Ville.
- Phase 14 finding: the generator emits a tool for an operation whose example carries a field absent from the schema, with no gap, so `gap_reported` fails with SILENT_GUESS on the partial-spec sample (D-174). Phase 14 was not changed.
- Tabular and SQL generated servers read data-path variables (`ACME_*_DATA_PATH`, `_DB_PATH`) that the env-name derivation does not map; the runner supplies a data path only for real-runtime cases.
- Legacy HTTP+SSE is unsupported; the real partner profile is not mapped (an invented Acme profile is scored); the generator cannot produce HTTP transport or composite tools; D3 is advisory and D5 not scored.
- Authentication of `/api/mcp-test/*` and `/api/mcp-generate` relies on the global hook and was not verified (D-179).
- The headline score formula is an assumption (D-167).
