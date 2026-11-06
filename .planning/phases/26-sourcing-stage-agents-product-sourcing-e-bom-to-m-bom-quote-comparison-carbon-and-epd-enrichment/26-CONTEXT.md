# Phase 26 Context: Sourcing-stage agents (5-7)

Gathered unattended (auto mode). Inherits Phase 25 context (done bar, harness, rubric approach, lessons) — see ../25-*/25-CONTEXT.md and 25-0x-SUMMARY.md.

## Scope
Agents 5 Product sourcing (E-BOM to M-BOM), 6 Quote comparison, 7 Carbon & EPD enrichment.

## Assumptions
- A-01: Harness `scripts/tryout-run.ts` and procedure `docs/tryitout-live-run.md` are reused; one plan per agent plus an aggregation plan; container runs sequential.
- A-02: Catalog data (LVI-INFO, STK, Prysmian, Rakennustieto) is NOT callable from the Pi container (internal network). Inputs carry a catalog excerpt as text; entries name the MCP servers (stk-mcp, lvi-info-mcp) as the intended data source for a future connected setup, and record the gap. Excerpts are synthetic and labelled (STK/LVI-INFO real data are not public/confidential; never use real exports).
- A-03: Agent 5: reads an engineering BOM (design-level product requirements) and a catalog excerpt, proposes candidate product matches per BOM line with reasoning, flags no-match/ambiguous lines. Output: M-BOM draft table, one row per E-BOM line, input order.
- A-04: Agent 6: reads 2-3 synthetic supplier quotes (text/CSV) normalising units, currency, delivery terms, VAT; output a comparison table, one row per requested line, with flagged non-comparable items. No arithmetic by the model beyond copying (lesson: model fails sums); totals are listed as addend lists or omitted and marked "recompute".
- A-05: Agent 7: reads a product list and a synthetic EPD excerpt table (public EPD structure: declared unit, GWP A1-A3), maps products to EPDs, flags missing/mismatched declared units. No real EPD numbers presented as authoritative; sample values synthetic and labelled; the real EPD sources (EPD Finland/Rakennustieto, EPD Norway, ECO Platform) are named as data sources and gap.
- A-06: Design lesson applied: one output row per input item in input order, fixed per-row checklist, no model arithmetic, no cross-section id copying beyond copy.
- A-07: Same bump-list for each new agent: scripts/__golden__/flag-off.json regenerate (UPDATE_GOLDEN=1), hard-coded agent counts in src/lib/server/search/accuracy.test.ts and scripts/mcp-server-entries.test.ts, set-try-it-out-mode tests, Phase 15 guard src/lib/mcptest/criteria.test.ts exemptions. Consider asking the executor to make those counts derive from data/ to stop the churn if cheap.
- A-08: DDC skills: use relevant ones (MIT, attribution): look for BOM/procurement/quote/EPD/carbon skills; exclude CWICR data and book content.

## Corrected 2026-10-15 (Phase 31)

Wrong assumptions (text above kept as history): A-02 (superseded) named stk-mcp and lvi-info-mcp as the intended data source for agent 5 and treated STK/LVI-INFO/Prysmian/Rakennustieto data as the catalog layer; A-07 (the "MCP-servers" framing of the sourcing stage in the bump list context) and the ROADMAP phrase "LVI-INFO catalog stage" likewise. A-05 named EPD Finland/Rakennustieto as a data source; Rakennustieto is MCP-side data. Corrected: agent 5 is a generic E-BOM to M-BOM matcher on a synthetic catalog excerpt, inspired by cwicr-material-procurement (method only); agent 7 names only "public EPD registers" generically. The catalog-lookup idea belongs to the separate LVI-INFO agent (Phase 36). See D-634.
