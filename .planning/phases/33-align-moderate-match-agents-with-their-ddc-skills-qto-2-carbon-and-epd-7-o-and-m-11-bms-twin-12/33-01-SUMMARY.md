# 33-01 summary: agent 2 QTO normalization aligned with bim-qto

Status: aligned, helper tested, live verification COUNTED (first run).

- Skill: primary `2_DDC_Book/3.2-QTO-Auto-Estimates/bim-qto` (working mapping said qto-report first; qto-report opens with a DDC book quotation and is generic pandas, so bim-qto is the closer match). SKILL.md and instructions.md of both read in full. Spec: docs/ddc-alignment/qto-normalization.md (written and committed first).
- Taken: one item per row (group, description, quantity, unit, level), grouping by group and level, report idea. Changed: model only copies and looks up (8-cell row: row_id, group, level, qty, unit, factor, dup_of, issue; one issue code by fixed priority); canonical quantity and grouped totals by group/level and unit come from a helper, the model writes `to compute (tool)`. Not adopted: prices, waste, design vs as-built, export, level matrix.
- Skill bugs verified in code and fixed in the helper: silent zero with wrong unit for a missing quantity, first-level-only reporting, summing across units, dropped rows with missing keys (pandas NaN), `Quantity` read as a count, `ngroup()+1` as count, unconverted imperial units, bare `except`, round-then-sum.
- Helper: src/lib/qto/groupTotals.ts (unit lookup, number parsing with typed errors incl. ambiguous `1,250`, group label, duplicate rule, totals keyed on unit, 6-decimal noise removal, 3-decimal output), 29 unit tests green; CLI scripts/qto-group-totals.ts also checks a result.md cell by cell.
- Files: spec, helper and tests, CLI, data/agents/qto-normalization.yaml (github_url now bim-qto, tool placeholder replaced, gaps updated), SKILL.md, sample (6 rows), scripts/ddc-alignment.qto-normalization.test.ts, flag-off.json (this entry only), third-party notices, inventory, VERIFICATION, HUMAN-UAT, spend log.
- Run (synthetic, gpt-4.1-mini, Option A): ab6e8dcd-04f0-46e0-94cf-e281eccf170a, 11067 tokens, 3 requests, 0.0177 USD, rubric R1-R7 met, 6 of 6 rows match the key and the helper: counted. No revisions or retries. Fix-run total about 0.2746 USD after Phase 32 (0.2569) plus this run.
- Stack stopped, no stragglers. `npm run check` is left to plan 33-05.
