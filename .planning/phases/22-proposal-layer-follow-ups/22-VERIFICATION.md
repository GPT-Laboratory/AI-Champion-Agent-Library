---
phase: 22-proposal-layer-follow-ups
status: human_needed
verified: 2026-10-15
---

# Phase 22 Verification

Status: human_needed. Criteria 2, 3 and 4 are evidenced; criterion 1 ("reviewed by Ville") is NOT met until Ville reads the proposal (pending in `22-HUMAN-UAT.md`).

## Verified numbers (branch autonomous/overnight-improvements, 2026-10-15)

- `npm run check` run alone, exit 0, once: 279 test files passed (1 skipped), 3352 tests passed (1 skipped); about 4m20s. (Phase 21 closed at 277 files / 3319 tests; the delta is the real-proposal test and the new hygiene tests, plus OData tests.)
- `npx vitest run src/lib/mcpgen`: 51 files, 1016 tests green after 22-04; goldens unchanged (no golden commit in this phase).
- Spend: 0 USD; `.planning/spend-log.md` untouched. No model call, no network call by the platform, no container, no `.env` read. Throwaway venv and packages from 22-02 were outside the repo and deleted; `git status` clean.

## Evidence per success criterion

| # | Criterion | Status | Evidence |
| --- | --- | --- | --- |
| 1 | First real proposal from an agent session, reviewed by Ville | Written; review PENDING (HUMAN-UAT item 1) | `proposals/real/acme-openapi.proposals.json` (9 ops), `real/real.test.ts`, strict accept with 0 rejected ops, `22-01-FINDINGS.md`; D-607 |
| 2 | Baseline and proposal-assisted run through `mcp-test --allow-local-exec`, compared with the Phase 15 scorer | Met with limits (sign-off pending, HUMAN-UAT item 2) | `22-COMPARISON.md`: no regression in `mcp-propose-eval`; both packages DISQUALIFIED at Tier 1 in the local-exec run because the scorer mock serves the suite catalogue, so it shows no regression and that renames bind, not that the proposal is better; D-608 |
| 3 | Hygiene false positives tuned from real proposals | Met | `22-03-SUMMARY.md`, `proposals/hygiene.test.ts` (accept and still-reject both directions, security checks re-asserted); the real proposal itself produced no rejection, the one tuned false positive came from a documented probe (honest data point); D-609 |
| 4 | `derived_filter` on OData supported or final limitation | Met (final limitation) | `22-04-SUMMARY.md`, `odata.test.ts` (json and xml), gate message, pack text, docs row and Limits; D-610 |

## Not run

- A selection evaluation with an agent client (does the proposal help an agent pick tools).
- A scorer-compatible mock for the Acme spec (would make the local-exec comparison informative).
- Review by Ville of the proposal and of the comparison interpretation.
- The release branch `release/agents-2026-10` does not receive Phase 21-23 changes (D-606).

## Pending human

See `22-HUMAN-UAT.md`: (1) review `acme-openapi.proposals.json`; (2) accept the interpretation in `22-COMPARISON.md`.
