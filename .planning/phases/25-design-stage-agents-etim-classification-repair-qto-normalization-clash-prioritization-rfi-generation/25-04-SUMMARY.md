---
phase: 25
plan: 04
status: complete
requirements: [CONS-A3]
---

# 25-04 Summary

Agent 3 (Clash prioritization): COUNTED on retry (redesigned SKILL, 2026-10-15). The first three runs were attempted-not-counted; see Retry below.

## Built
- data/agents/clash-prioritization.yaml (stage design, agent_no 3, DDC attribution), SKILL.md and a synthetic labelled 16-row clash report in data/tryitout-prompts/clash-prioritization/.
- Runnable flag; gaps tests, flag-off golden and agent counts (12) updated; Phase 15 guard passes.
- Gaps G-018..G-023, inventory row 3 (missing, entry exists, attempted-not-counted), third-party notice.

## Live runs (Option A, gpt-4.1-mini, Pi container)
- SKILL v1, job 57e5c2cc-f130-47b7-96af-755ece27e18c, 10561 tokens, 0.0169 USD: CL-012 lost, phantom cluster, wrong counts. FAIL.
- Revision 1, job ab20a259-c5c6-40c5-86fd-7406d918a43c, 13244 tokens, 0.0212 USD: all ids covered but false "Structural" claim, mis-ranks, unrelated clashes merged. FAIL.
- Revision 2, job 2141f80e-2c6b-4b00-b48f-36bc84206bf4, 11678 tokens, 0.0187 USD: CL-012 missing from ranked and findings tables, riser cluster and CL-016 mis-ranked. FAIL.
- Revision cap (2) reached; recorded attempted-not-counted, no evidence claimed. Stack torn down, no aic.tryitout containers.

## Deviations
- Three runs instead of one (two SKILL revisions allowed). Total 0.0568 USD.
- Suggested follow-up: deterministic clustering/ranking tool with the model writing rationale only. The shared findings format is unchanged for Plan 25-05.

## Retry (redesigned SKILL, counted)
- SKILL redesigned: one row per input clash with a fixed checklist (tests A-E), clusters by copying a `location_key` column, cluster and findings tables copied from the rows, no counts. Sample gained a `location_key` column (assumption, gap G-029). 8-column findings format kept.
- Run 4 job 50656bb4-0cbc-4f96-81e9-d312ab561ddf (0.0215 USD): FAIL, priority rule mis-applied on 6 rows. Run 5 job 1aa6f1be-baf2-465a-8b4a-a101a2bc5d20 (14239 tokens, 0.0228 USD): rubric PASS, counted. Inventory row 3 now partial.
