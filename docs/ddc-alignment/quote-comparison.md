# Alignment spec: agent 6 Quote comparison

Source skill (untrusted data, read in full, SKILL.md and instructions.md, 2026-10-15): `1_DDC_Toolkit/Procurement/bid-analysis-comparator` of the DDC skills repository (MIT, (c) 2026 DataDrivenConstruction). The skill's method, data model and rules are the spec; its code is not packaged or run. instructions.md is a generic wrapper (gather input, process per SKILL.md, tables, constraints) and adds no rules. Nothing from the DDC book or CWICR is used. Written before the agent files were changed.

## 1. Skill method

1. Define evaluation criteria with weights (default six: Price 0.35, Experience 0.20, Schedule 0.15, Safety Record 0.10, References 0.10, Capacity 0.10; sum 1.0), each scored 0-10.
2. Register bids (bidder, base bid, alternates, qualifications, exclusions) and score each bid per criterion (manual integer scores; the Price score is a manual input, not derived from the base bid).
3. Calculate weighted scores per bid, sort descending.
4. Recommend: the highest total score, plus the lowest base bid for reference. Export to a spreadsheet (comparison and details sheets).
Scope-gap identification is named in the skill description but the code only stores free-text `qualifications` and `exclusions`; there is no gap detection logic.

## 2. Data model (own words)

| Entity | Fields | Meaning |
|---|---|---|
| Criterion | name, weight, max score (10) | what is judged and how much it counts |
| Bid score | criterion, score, notes | one score per criterion per bid |
| Bid | id, bidder, package, date, base bid, alternates, status, scores, qualifications, exclusions | one offer |
| Recommendation | highest score (bidder, score, bid), lowest price (bidder, bid), count, recommended bidder | the output |

Agent mapping: Bid = one supplier quote (letter A, B, C); criterion table and scores are supplied by the engineer; scope gaps come from the existing line checks (NOT-QUOTED, ITEM-SUBSTITUTE, UNIT-DIFF, QTY-DIFF) and exclusions are the non-comparable basis (BASIS-DIFF); the recommendation is a draft.

## 3. Outputs of the skill and of the agent

Skill: weighted comparison table, bid details, recommendation. Agent (one `output/result.md`): Quote basis table, Line checks, Per-line comparison (Phase 26, proven), Criteria and scores table with `to compute (tool)` totals, Scope gaps, Draft recommendation, notes and caveat.

## 4. Finnish MEP adaptation

Criteria names suggested for the engineer's table: price, delivery_time, technical_compliance (with the RFQ items), references (experience), warranty. Weights are the engineer's. EUR and VAT basis stay in the existing quote basis table (currency, vat, delivery_terms compared with the first quote); RFQ lines are HVAC and ventilation, sprinkler and electrical items (the synthetic sample uses copper pipe, valves, pump, clamp, floor drain). Safety record and capacity criteria of the skill are not defaults; they can be added by the engineer as rows.

## 5. Deliberately different

- No model arithmetic: totals and ranking are `to compute (tool)`; the tested helper computes them.
- Scores and weights are supplied by the engineer in `## CRITERIA` and `## SCORES`; the model copies them, never invents or adjusts them.
- The recommendation is a DRAFT for engineer review, never a decision; it is written as `pending tool totals`.
- Quotes with BASIS-DIFF are shown but marked non-comparable and are excluded from the recommendation.
- Scope gaps are detected per RFQ line from the line checks instead of free text.

## 6. Bugs and weaknesses verified in the skill code, and the fix

| # | Claim / finding | Verified in code | Fix in the helper |
|---|---|---|---|
| 1 | `Bid.total_weighted_score` is an unweighted sum of scores | verified: `sum(s.score for s in self.scores)`, no weight is looked up. It is not used by `calculate_weighted_scores`, so it is a misleading dead property, but any caller reading it gets an unweighted total | totals only come from the weighted function |
| 2 | `calculate_weighted_scores` computes `score * weight * 10` | verified. The weights ARE applied, but the factor 10 is a hidden scale that only gives 0-100 when the weights sum to 1; custom weights (for example 40/30/30) give a total of up to 1000 | normalise: `sum(score_i * w_i) / sum(w)`, on the 0-10 scale, independent of the weight scale |
| 3 | No weight validation | verified: weights are not checked for sum, sign or finiteness | reject negative, non-finite, all-zero, duplicate and empty-name criteria |
| 4 | Missing score for a criterion contributes nothing (a silent zero) | verified: the loop runs over scores present, absent criteria are skipped | missing score is an error |
| 5 | A score for an unknown criterion gets weight 0 silently (`criteria_weights.get(..., 0)`) | verified | unknown criterion is an error |
| 6 | `max_score` exists but no score is range-checked | verified | score must be finite and within 0-10 |
| 7 | Ties: `sort_values` (default quicksort, not stable) and `iloc[0]` pick one winner, no rank | verified | ties reported as ties (shared rank, stable input order) |
| 8 | Recommendation ignores qualifications, exclusions and scope gaps and names a bidder as "recommendation" | verified: it returns the top bidder only | the agent's recommendation is a DRAFT among rankable quotes, with open gaps listed |
| 9 | Rounding: components rounded to 1 decimal for display, total sums the unrounded values | verified, not a defect | round once at output, to 2 decimals |
| 10 | `score_bid` on an unknown bid id silently does nothing | verified | not applicable (no bid registry) |

Corrected formula: total_q = sum over criteria of (score_q,i * w_i) / sum(w), on the 0-10 scale, rounded to 2 decimals at output only. Ranking: descending on the rounded total, equal totals share a rank (1, 1, 3), input order is kept within a tie.

## 7. A-02 choice record

Route chosen: BOTH halves, no app change. The model output carries a criteria table (criterion, weight, per-quote score) whose weights and scores are COPIED from engineer-supplied `## CRITERIA` and `## SCORES` sections of the input and writes `to compute (tool)` in every total cell. The deterministic helper (`src/lib/procurement/weightedScore.ts`, a TypeScript port of the corrected calculation, own code) computes totals and ranking; it is run by the harness evidence step through `npx tsx scripts/bid-weighted-score.ts <file>` (the file is the input or the result.md) and is documented as the way a connected setup computes totals. The Try It Out job stays text in, text out. No change to the app, job API or runner.

Input format (exact, parsed by the CLI):

```
## CRITERIA
criterion,weight
price,50
...
## SCORES
criterion,A,B,C
price,6,9,5
...
```

Result format (parsed by the CLI too): section `## Criteria and scores`, header `criterion | weight | A | B | C`, one row per criterion, last row `total | - | to compute (tool) | ...` (skipped by the parser).

Recommendation text is drafted before the totals exist: conditional, `pending tool totals`. The harness evidence shows the tool totals next to it.

## 8. Answer key (synthetic sample) and rubric

Sample: 5 RFQ lines R-01 Copper pipe 22 mm 120 m, R-02 Ball valve DN22 brass 8 pcs, R-03 Mineral wool pipe insulation 22 mm 120 m, R-04 Circulation pump 25-60 2 pcs, R-05 Pipe clamp 22 100 pcs (an original sixth line R-06 Floor drain DN50 was dropped in the scope-shrink retry after the 32-03 revisions, Revision note in 32-VERIFICATION.md); quotes A (EUR, excluded, DAP site, 14 days), B (same basis, 10 days), C (SEK, included 25.5 percent, EXW, 7 days).

Quote basis: A first, rankable Y; B same, Y; C `differs: currency, vat, delivery_terms`, N.

Flags: A all OK. B: R-03 NOT-QUOTED, R-05 UNIT-DIFF (pack10 vs pcs), rest OK. C: R-04 ITEM-SUBSTITUTE, BASIS-DIFF; R-05 UNIT-DIFF, BASIS-DIFF (never QTY-DIFF when the unit differs); all other C cells BASIS-DIFF. ok_letters / lowest: R-01 A,B lowest B; R-02 A,B lowest A; R-03 A only, n/a; R-04 A,B lowest A; R-05 A only, n/a.

Criteria (weights 50, 20, 20, 10; sum 100) and scores 0-10:

| criterion | weight | A | B | C |
|---|---|---|---|---|
| price | 50 | 6 | 9 | 5 |
| delivery_time | 20 | 5 | 8 | 9 |
| technical_compliance | 20 | 9 | 4 | 8 |
| references | 10 | 8 | 3 | 4 |

Helper totals (by hand, asserted by tests): A (300+100+180+80)/100 = 6.60; B (450+160+80+30)/100 = 7.20; C (250+180+160+40)/100 = 6.30. Weighted ranking B 1, A 2, C 3. Unweighted sums: A 28, B 24, C 26, so the unweighted leader is A, the weighted leader is B: the weights change the winner, which is the regression for the skill bug. C is ranked by the helper but excluded from the recommendation (BASIS-DIFF).

Scope gaps (copied from the line checks, non-OK flags among NOT-QUOTED, ITEM-SUBSTITUTE, UNIT-DIFF, QTY-DIFF): B R-03 NOT-QUOTED; C R-04 ITEM-SUBSTITUTE, BASIS-DIFF; B R-05 UNIT-DIFF; C R-05 UNIT-DIFF, BASIS-DIFF.

Expected draft recommendation: DRAFT label; eligible quotes A, B; excluded C (BASIS-DIFF); leader `pending tool totals`; open gaps for eligible quotes: B R-03 NOT-QUOTED, B R-05 UNIT-DIFF; stated as not a decision.

Rubric:
- R1 Quote basis rows correct (3 rows, copied fields, basis_vs_first, rankable).
- R2 Line checks per RFQ line and quote with the key's flags, and the per-line table copies them.
- R3 Criteria, weights and scores copied exactly from the input; every total cell is `to compute (tool)`; no number produced by the model that is a sum or a product.
- R4 Scope gaps listed from the NOT-QUOTED / ITEM-SUBSTITUTE / UNIT-DIFF / QTY-DIFF flags.
- R5 Recommendation labelled DRAFT, leader only as `pending tool totals` (or the tool result if supplied), no decision, BASIS-DIFF quotes excluded.
- R6 Nothing invented (prices, items, terms, scores).
- R7 Draft caveat present.

Harness check beside the rubric: `npx tsx scripts/bid-weighted-score.ts` on the input and on result.md gives the key totals, and the copied weights and scores in result.md equal the input.
