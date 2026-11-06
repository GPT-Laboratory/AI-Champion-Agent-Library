---
phase: 26
status: human_needed
---

# Phase 26 Human UAT

Items an engineer should confirm. All agent outputs are drafts for engineer review; inputs are synthetic or public only.

## Pending on Ville

- Agent 5 (Product sourcing): counted on a scoped-down step (job 41f820ae, 6 E-BOM lines x 6 catalog rows, see 26-VERIFICATION.md). Skim the draft; confirm exact-equality matching is an acceptable default and that batching larger BOMs (G-037) is acceptable, or decide whether to build a deterministic matching tool to lift the limit.
- Decide whether stk-mcp / lvi-info-mcp should be reachable from Try It Out (links the live catalog access gap).
- Agent 6 (Quote comparison): counted (job eaee09d8, see 26-VERIFICATION.md). Skim the comparison draft; confirm that "no arithmetic, flag only" is the wanted division of labour and decide whether a deterministic normalising script (units, currency, VAT, totals) should follow.
- Agent 7 (Carbon and EPD enrichment): counted (job c61b9914, see 26-VERIFICATION.md; all EPD values synthetic). Skim the mapping draft; confirm map-and-flag with the calculation left to a script is the wanted split; decide which real EPD source (EPD Finland / Rakennustieto, EPD Norway, ECO Platform) to wire first and check its reuse terms.
