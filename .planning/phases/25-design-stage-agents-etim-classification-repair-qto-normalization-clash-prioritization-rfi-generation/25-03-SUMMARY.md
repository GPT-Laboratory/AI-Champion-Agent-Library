---
phase: 25
plan: 03
status: complete
requirements: [CONS-A2]
---

# 25-03 Summary

Agent 2 (QTO normalization): COUNTED.

## Built
- data/agents/qto-normalization.yaml (stage design, agent_no 2, DDC ifc-qto-extraction attribution), SKILL.md and a synthetic labelled 20-row sample with seeded defects in data/tryitout-prompts/qto-normalization/.
- Runnable flag in scripts/set-try-it-out-mode.ts; set-try-it-out-mode.gaps.test.ts extended; flag-off golden regenerated; agent counts bumped to 11 in accuracy.test.ts and mcp-server-entries.test.ts.
- Gaps G-013..G-017, inventory row 2 (partial), third-party notice.

## Live runs (Option A, gpt-4.1-mini, Pi container)
- SKILL v1: job 5ecd9f99-c1e2-4253-b78d-ac4ce366c66e, 10958 tokens, 0.0175 USD. Table and conversions correct, but model-computed totals wrong and a NUL char in one unit. Not counted.
- SKILL revision 1: job af4663e3-f128-4272-9b77-e0eace2acc6c, 11384 tokens, 3 requests, 0.0182 USD. Rubric met, totals recomputed by hand and correct. Counted.
- Stack torn down, no aic.tryitout containers left.

## Deviations
- Two runs instead of one (one allowed SKILL revision, each logged).
- Quality notes recorded in 25-VERIFICATION.md (pcs-for-length row Q-017 not flagged, original_unit shows normalised spelling in places).
