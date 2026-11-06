# Phase 34 Verification

status: human_needed (automated checks complete; pending items for Ville and Alok/Jussi in 34-HUMAN-UAT.md)

## Phase summary

| Agent | Verdict | Job ids | Tokens | Est. cost USD | SKILL revisions |
|---|---|---|---|---|---|
| 1 ETIM | COUNTED | 17137e7b | 11545 | 0.0185 | 0 (footer wording) |
| 5 E-BOM to M-BOM | COUNTED | 7b1a2993 | 15851 | 0.0254 | 0 (footer wording) |
| 8 Cut-sheet QA | COUNTED | 8ae1ff62 | 10538 | 0.0169 | 0 (footer wording) |
| 9 Spooling and cutting | COUNTED | 6be8ad41 (not counted, footer), 90a8c8c2 (counted) | 10092 + 9962 | 0.0161 + 0.0159 | 1 (footer wording) |
| 10 D2 code validation | COUNTED | 8e666054 | 12702 | 0.0203 | 0 (footer wording) |

Phase spend 0.1131 USD; fix-run ledger total 0.5271 USD of 5 USD; no run over 0.50 USD.

Scope checklist against 34-CONTEXT.md:
- [x] Explicit label per entry in metadata.attribution, description/assumptions, third-party notices and inventory (34-01; test scripts/ddc-labels.own-design.test.ts green).
- [x] Agent 1 "inspired by bim-classification-ai", agent 5 "inspired by cwicr-material-procurement (method only; no CWICR data)", agent 8 "inspired by submittal-tracker (+ specification-extractor)", agents 9 and 10 "no DDC basis".
- [x] SKILL footers of all five agents aligned to the labels (agents 9 and 10 in 34-03).
- [x] D2 = Finnish building code part D2 assumption visible in entry description and assumptions, alternatives open for Alok/Jussi.
- [x] No "follows a skill" claim; no MCP/LVI/STK framing in agent 5.
- [x] bash scripts/check-ddc-decoupling.sh clean (rerun in 34-03, see end of file).
- [ ] Human confirmation of labels and the D2 reading (34-HUMAN-UAT.md).

Procedure: docs/tryitout-live-run.md Option A (compose stack, internal network, tagged image), gpt-4.1-mini, Pi container, usage observed (countable), synthetic samples, draft for engineer review. Runs one at a time.

## Agent 1: ETIM and classification repair
COUNTED (relabel rerun on the existing sample; SKILL change: footer wording only).

- Job 17137e7b-4fa0-442d-aa9c-71062ac6627b, 11545 tokens, 3 requests, est. 0.0185 USD, label synthetic, ledger row 34-02.
- Rubric (Phase 25-02 plan) and key: 14 rows for 14 CSV rows pass; all proposed codes in the excerpt or NONE pass; E-101..103 missing (SYN-EC001/002/003) pass; E-104, E-105 wrong (EC001, EC005) pass; E-106, E-107 unknown-code NONE pass; E-111, E-112 ambiguous review YES pass; E-113 no-match NONE pass; E-108/109/110/114 ok review NO pass; Counts line (3/2/2/4/2/1) equals the table; no lookup claim; draft caveat present pass.
- Quality note: confidence high on unknown-code and no-match rows (low in Phase 25); harmless, review is YES.

## Agent 5: Product sourcing (E-BOM to M-BOM)
COUNTED (relabel rerun on the existing 6 x 6 synthetic sample; SKILL change: footer wording only, now names cwicr-material-procurement, method only, no CWICR data).

- Job 7b1a2993-51f6-4952-a6fb-25a0b2ff447e, 15851 tokens, 3 requests, est. 0.0254 USD, label synthetic, ledger row 34-02.
- Key (Phase 26 run C) vs returned: BL-01 CP-01 matched; BL-02 CP-02,CP-03 ambiguous; BL-03 no-match near_miss CP-05 (steel vs stainless steel; empty dn counted as Y); BL-04 no-match, no near miss; BL-05 CP-04 matched, unit_same N (pcs vs pack10) review YES; BL-06 CP-06 matched, underspecified review YES. M-BOM lists exactly BL-01, BL-05 (pack10), BL-06. R1 one file, 6 rows in order; R2 qty/unit copied; R3 candidates and status equal the key; R4 flags equal the key; R5 M-BOM correct; R6 nothing invented, no totals; R7 caveat present. All pass. Catalog is generic synthetic; no MCP/LVI/STK/Prysmian/Rakennustieto framing (decoupling script clean).
- Caveat: scoped step only (about 6 x 6 per run); one passing run, not a reliability claim.

## Agent 8: Cut-sheet QA
COUNTED (relabel rerun on the existing synthetic sample; SKILL change: footer wording only).

- Job 8ae1ff62-af10-4c31-9941-cdfbed4d22d6, 10538 tokens, 3 requests, est. 0.0169 USD, label synthetic, ledger row 34-02.
- Key (Phase 27) vs returned: S-01 compliant, S-02 compliant, S-03 deviation (110 < 120), S-04 deviation (compression vs press), S-05 deviation with "unit differs MPa vs bar, not converted" (no 0.16 or 160 anywhere), S-06 not-stated (NONE). R1 pass (one file, 6 check lines, 6 rows in order); R2 cut_sheet_line verbatim; R3 all verdicts equal the key; R4 review NO only S-01, S-02; R5 no rows for unlisted keys; R6 no totals or approval; R7 caveat present. All pass. Quality note: S-03/S-04 open-item reasons are terse but correct.

## Agent 9: Spooling and cutting
COUNTED (relabel rerun on the existing synthetic sample, 6 segments; SKILL change: footer wording only, now "No DDC basis (own design); prefab-optimization is not a pipe-spool or cut-list skill and is not adopted").

- Run 1: job 6be8ad41-f0c0-4b54-8add-9ff3c195d906, 10092 tokens, 3 requests, est. 0.0161 USD. Content matched the key and R1-R7 held, but the old SKILL footer still printed "Ideas adapted from DDC skill prefab-optimization", contradicting the "no DDC basis" label. Not counted; footer wording fixed (no logic change).
- Run 2 (counted): job 90a8c8c2-7d7c-43b4-b436-138aca1bdd76, 9962 tokens, 3 requests, est. 0.0159 USD, label synthetic, ledger row 34-03.
- Key (Phase 27) vs returned: cut list P-01..P-06 in order, values copied, P-05 remainder 300 copied; only P-04 `to compute (tool)` (6200 > 5000); spool groups SP-A P-01,P-02,P-03, SP-B P-04,P-05, SP-C P-06; cut groups 22 copper P-01,P-02,P-05 (1850,720,950), 28 copper P-03,P-04 (2400,6200), 50 steel P-06 (3100); stock_pieces `to compute (tool)` in all. All match (comma spacing differs only). R1 one file, 6 check lines, 6 rows in order pass; R2 copied values pass; R3-R5 pass; R6 no sums, counts, waste or piece numbers, open items P-04, to-compute line, P-05 remainder pass; R7 draft caveat pass.
- Caveat: scoped step only, one sample; no optimisation performed. Not a reliability claim.

## Agent 10: D2 code validation
COUNTED (relabel rerun on the existing 6-row synthetic sample; SKILL change: footer wording only, now "No DDC basis (own design); D2 is assumed to be the Finnish building code part D2 (unconfirmed)").

- Job 8e666054-13cf-4139-ad59-d847985c7dfc, 12702 tokens, 3 requests, est. 0.0203 USD, label synthetic, ledger row 34-03. Single run (footer edited before the run, no failed run).
- Key (Phase 28) vs returned: Q-01 compliant, Q-02 compliant, Q-03 deviation, Q-04 deviation (unit differs ppm vs %, not converted), Q-05 compliant, Q-06 not-stated (NONE). All six match. R1 one file, 6 check lines and 6 rows in order pass; R2 design_line verbatim pass; R3 verdicts equal the key pass; R4 Q-04 note without conversion, Q-06 NONE, review NO only Q-01, Q-02, Q-05 pass; R5 no rows for unlisted keys pass; R6 no totals, approval or regulation claim pass; R7 draft caveat pass.
- Quality note: Q-03 note cell is "-" while the open item gives the reason; harmless. The D2 assumption is visible in the entry description and assumptions (label test, 34-01); the SKILL does not require it in the output, so the output caveat does not repeat it. Alok/Jussi confirmation is pending (HUMAN-UAT).

## Spend
34-02: three runs, 0.0608 USD. 34-03: three runs (agent 9 twice, agent 10 once), 0.0523 USD. Phase 34 total 0.1131 USD over 6 runs; no run near 0.50 USD. Fix-run ledger total after the marker: 0.5271 USD over 22 rows, well within the 5 USD cap (the earlier "about 0.40" note was an underestimate). Stack stopped, no aic.tryitout containers left.

## npm run check
Run once alone after the stack was stopped (free memory above 1 GB, no container or vite process): 310 test files passed (1 skipped), 3720 tests passed (1 skipped); exit 0. No rerun needed. bash scripts/check-ddc-decoupling.sh: "ddc-decoupling: clean".
