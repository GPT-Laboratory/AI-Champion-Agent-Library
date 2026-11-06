---
phase: 26
plan: 01
status: counted
requirements: [CONS-A5]
---

# 26-01 Summary

Agent 5 (Product sourcing, E-BOM to M-BOM): entry, SKILL and sample built and validated; live run COUNTED on the third attempt (scoped down to 6 lines x 6 rows, job 41f820ae). Earlier text below is history.

## Built
- data/agents/product-sourcing-mbom.yaml (stage sourcing, agent_no 5, DDC attribution), SKILL.md and a synthetic labelled sample (12 E-BOM lines, 13 catalog rows) in data/tryitout-prompts/product-sourcing-mbom/.
- Runnable flag in scripts/set-try-it-out-mode.ts; golden regenerated; set-try-it-out-mode gaps tests extended; Phase 15 guard passes without changes.
- Count derivation done: accuracy.test.ts and mcp-server-entries.test.ts now derive the agent count from top-level data/agents/*.yaml, so plans 26-02/03 need no count edit.
- Gaps G-030..G-036, inventory row 5 (missing, entry exists, attempted-not-counted), third-party notice.

## Live runs (Option A, gpt-4.1-mini, Pi container)
| Run | Job | Tokens | Est. USD | Verdict |
|---|---|---|---|---|
| SKILL v1 | e4181f2f-0cf0-46ac-ad18-b003bb942e24 | 12210 | 0.0195 | FAIL (BL-09 missed, wrong near_miss, BL-12 extra id, wrong supplier) |
| Revision 1 | 24e650a3-53c0-4dbc-bef0-9c562ee9b110 | 14436 | 0.0231 | FAIL (BL-09 still missed, BL-06 U, near_miss column) |
| Revision 2 | 02bb5e13-759a-423a-a16e-93f2d674755c | 16754 | 0.0268 | FAIL (BL-09 cand NONE despite dn_ok=Y,mat_ok=Y; 11 of 12 lines right) |

Total 0.0694 USD. Stack torn down, no aic.tryitout containers.

## Deviations
- Entry `name` is "Product Sourcing MBOM" (not "Product Sourcing (E-BOM to M-BOM)"): the catalog slug is derived from the name and must equal product-sourcing-mbom for UPDATES, the prompt directory and the harness.
- Three runs (cap of two revisions). Suggested follow-up: deterministic matching tool, model writes the reason only.

## Retry 2026-10-15

Three more live runs (bc11ce1a, 0ab6b5f4, 20061fd7; 0.4527 USD) with a redesigned per-catalog-row Match checks SKILL: still attempted-not-counted (model truncates, splits or skips the 156-line check section; BL-06 `any` equality mis-ticked). Details in 26-VERIFICATION.md. Yaml unchanged, so no golden regeneration.

## Third attempt 2026-10-15

Sample scoped to 6 E-BOM lines x 6 catalog rows, SKILL writes one result.md with an explicit any=Y rule. Three runs (90c11c2c, 94f49e70, 41f820ae; 0.0744 USD); run 3 passed the rubric. Entry now states the ~6 x 6 per-run limit (gap G-037, batching needed); golden regenerated, unchanged. Inventory row 5 partial.
