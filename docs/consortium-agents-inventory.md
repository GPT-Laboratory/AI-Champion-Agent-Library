# Consortium agents: inventory against data/agents

Audit date: 2026-10-14 (Phase 24). Compared the 12 consortium agents with every entry in `data/agents/*.yaml`.

## Principle

Agents do the semantic steps: read, interpret, map, draft. Engineers review and decide. Every agent output is a draft for engineer review, never a final decision.

## Confidentiality

Only the agent names are used here, with our own wording. The source slide is TUNI-confidential and is not in this repository.

## Status legend

- full: an existing entry covers the agent's purpose.
- partial: an existing entry covers part of the purpose or a neighbouring task.
- missing: no existing entry covers it.

## Inventory

| No | Agent | Stage | Status | Evidence | Notes / what is missing | Target phase |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | ETIM & classification repair | Design | partial | data/agents/etim-classification-repair.yaml | Label: inspired by 1_DDC_Toolkit/BIM-Analysis/bim-classification-ai (own design for ETIM-style mapping). Counted: entry plus one container run with a synthetic sample (Phase 25, 25-02). Classification lookup and real ETIM data missing. Phase 34 relabel rerun on the same sample counted (job 17137e7b, label unchanged). | 25, 34 |
| 2 | QTO normalization | Design | partial | data/agents/qto-normalization.yaml | Aligned in Phase 33 with the DDC skill bim-qto (qto-report secondary, no book text): row-by-row lookup normalisation (group, unit, factor, duplicate, issue code), grouped totals by group and level from a tested helper (scripts/qto-group-totals.ts). Counted: one container run on 6 synthetic rows (33-01, job ab6e8dcd). No model access, no cost mapping. | 25 |
| 3 | Clash prioritization | Design | partial | data/agents/clash-prioritization.yaml | Aligned in Phase 32 with the DDC skill clash-resolution-analyzer (CRITICAL/HIGH/MEDIUM/LOW from a truth table, resolution type, responsible discipline, Finnish MEP labels; location_key removed). Try It Out step is per-clash classification only; pattern groups and findings come from the helper scripts/clash-patterns.ts run afterwards. Not counted: seven live runs failed (first design jobs 4f18541b, f4376fb6, 977ecb72, bd86fcac; redesign jobs 917eb36a, fd61a009, c1822385, each one wrong cell); the Phase 25 counted run covered the earlier P1-P3 design only. No model access. | 32 |
| 4 | RFI generation | Design | partial | data/agents/rfi-triage-assistant.yaml, data/agents/demo-rfi-triage.yaml, data/agents/rfi-generation-from-findings.yaml | Counted: new entry driven by findings plus one container run on synthetic findings (Phase 25, 25-05). The assistant and demo entries stay as they were (conversational drafting/routing, single-RFI triage); no RFI log or numbering, no attachments. | 25 |
| 5 | Product sourcing E-BOM to M-BOM | Sourcing | partial | data/agents/product-sourcing-mbom.yaml | Label: inspired by 1_DDC_Toolkit/CWICR-Database/cwicr-material-procurement (method only; no CWICR data). Counted: entry plus one container run on a synthetic 6-line E-BOM and 6-row catalog excerpt (Phase 26, 26-01, step scoped down after six failed runs on 12 x 13); handles up to about 6 lines x 6 rows per run, larger BOMs must be batched; no live catalog access, exact-equality matching only. Phase 34 relabel rerun on the same sample counted (job 7b1a2993, label unchanged). | 26, 34 |
| 6 | Quote comparison | Sourcing | partial | data/agents/quote-comparison.yaml | Phase 26 counted flag-only run (26-02); Phase 32 (32-03) aligned with bid-analysis-comparator: criteria table copied from engineer input with totals `to compute (tool)` (tested helper), scope gaps, DRAFT recommendation pending tool totals. | 26, 32 |
| 7 | Carbon & EPD enrichment | Sourcing | partial | data/agents/carbon-epd-enrichment.yaml | Aligned in Phase 33 with the DDC skill lifecycle-carbon-calculator: lifecycle-stage columns (A1-A3 to D, ND for not declared) copied by the model, stage totals, A-C total and option comparison from a corrected tested helper (scripts/carbon-lifecycle.ts). Counted: one container run on 6 synthetic products and 6 synthetic EPD rows (33-02, job 83fc51d0). No live EPD register access, no real factor data. | 26 |
| 8 | Cut-sheet QA | Manufacturing | partial | data/agents/cut-sheet-qa.yaml, data/agents/submittal-review-router.yaml (related) | Label: inspired by 1_DDC_Toolkit/Document-Control/submittal-tracker (+ 2_DDC_Book/2.4-PDF-CAD-to-Data/specification-extractor). Counted: entry plus one container run on a synthetic cut sheet and specification excerpt (Phase 27, 27-01); text only, about 6 requirements per run, no unit conversion. The submittal router stays as it was (submittal routing). Phase 34 relabel rerun on the same sample counted (job 8ae1ff62, label unchanged). | 27, 34 |
| 9 | Spooling & cutting | Manufacturing | partial | data/agents/spooling-and-cutting.yaml | Label: no DDC basis (own design); the DDC prefab-optimization skill is not a pipe-spool or cut-list skill. Counted: entry plus one container run on a synthetic segment list (Phase 27, 27-02); copy and group only, cutting arithmetic and nesting left to a tool (to compute); no isometric/IFC parsing. Phase 34 relabel rerun on the same sample counted (job 90a8c8c2, label unchanged). | 27, 34 |
| 10 | D2 code validation | Site and handover | partial | data/agents/d2-code-validation.yaml | Label: no DDC basis (own design); D2 = Finnish National Building Code part D2 (indoor climate and ventilation), alternatives open (Alok/Jussi to confirm). Counted: entry plus one container run on a synthetic ventilation extract with placeholder requirement rows (Phase 28, 28-01); D2 read as Finnish code part D2 (assumption); real regulation values not loaded; text only, about 6 rows per run, no unit conversion. Phase 34 relabel rerun on the same sample counted (job 8e666054, label unchanged). | 28, 34 |
| 11 | O&M completeness | Site and handover | partial | data/agents/om-completeness.yaml | Aligned in Phase 33 with the DDC skills as-built-documentation and project-closeout-checklist: handover document types, asset register columns (copied), skill status words mapped to complete/incomplete/missing plus closeout words, superseded lines skipped; counted live run 73ac51f8 (33-03) on a synthetic index and placeholder checklist; index only, content not checked, about 6 rows per run. | 28 |
| 12 | BMS digital twin | Site and handover | partial | data/agents/bms-digital-twin.yaml | Aligned with DDC skill digital-twin-sync (loose match: binding model and threshold/status logic; statuses from tested helper scripts/bms-point-status.ts); text only, no live BMS, about 6 points per run. Run evidence in 33-VERIFICATION.md (Phase 33, 33-04). | 33 |

Summary: 0 full, 12 partial (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12), 0 missing.

Stage names: Design (IFC/BIM), Sourcing, Manufacturing (prefab and cut sheets), Site and handover (O&M, BMS).

## Other existing entries (not among the 12)

airo, electrical-panel-scheduler, energy-model-sync, hvac-load-calculator, mep-scope-planner, plumbing-fixture-unit-counter. These stay unchanged.

## DDC-derived agents (Phase 29)

These agents were chosen from the DDC skills; they are not among the 12 consortium agents (see docs/ddc-agent-candidates.md).

| No | Agent | Stage | Status | Evidence | Notes |
| --- | --- | --- | --- | --- | --- |
| 13 | Daily Report Cross Check | Site and handover | partial | data/agents/daily-report-cross-check.yaml | Label: loosely related to 1_DDC_Toolkit/Field-Operations/daily-report-generator (+ 3_DDC_Insights/Automation-Workflows/n8n-daily-report) (spec docs/ddc-alignment/daily-report-cross-check.md). Counted: entry plus one container run on a synthetic daily report and timesheet (Phase 29, 29-01); text only, about 6 lines per run. Phase 35 relabel rerun on the same sample counted (job 33c64dfb). |
| 14 | Punch List Closure Check | Site and handover | partial | data/agents/punch-list-closure-check.yaml | Label: inspired by 1_DDC_Toolkit/Field-Operations/punch-list-manager (+ 1_DDC_Toolkit/Project-Closeout/punch-list-manager) (spec docs/ddc-alignment/punch-list-closure-check.md). Counted: entry plus one container run on a synthetic punch list with placeholder closure rules (Phase 29, 29-02); text only, about 6 items per run. Phase 35 relabel rerun on the same sample counted (job edc60b32 after one SKILL revision). |
| 15 | Change Order Consistency Check | Site and handover | partial | data/agents/change-order-consistency-check.yaml | Label: inspired by 1_DDC_Toolkit/Cost-Management/change-order-processor (spec docs/ddc-alignment/change-order-consistency-check.md). Counted: entry plus one container run on a synthetic change-order log and forms (Phase 29, 29-03); text only, identical-text amount comparison, about 6 rows per run. Phase 35 relabel rerun on the same sample counted (job bb72743d). |
| 16 | Safety Observation Classification | Site and handover | partial | data/agents/safety-observation-classification.yaml | Label: loosely related to 1_DDC_Toolkit/Field-Operations/safety-inspection (+ 3_DDC_Insights/Safety-Quality/safety-inspection-checklist) (spec docs/ddc-alignment/safety-observation-classification.md). Counted: entry plus one container run on synthetic observations with a placeholder category table (Phase 29, 29-04); label-only, keyword lookup, about 6 observations per run. Phase 35 relabel rerun on the same sample counted (job a121094f). |
| 17 | Procurement Lead Time Check | Sourcing | partial | data/agents/procurement-lead-time-check.yaml | Label: built on 1_DDC_Toolkit/Procurement/material-procurement-tracker (spec docs/ddc-alignment/procurement-lead-time-check.md). Phase 35: item data model and must-order-by rule from the skill; dates computed by the tested helper src/lib/procurement/leadTime.ts (the agent only copies and looks up); text only, about 7 items per run. Live run result: see 35-VERIFICATION.md. |
| 18 | Material Delivery Check | Site and handover | partial | data/agents/material-delivery-check.yaml | Label: built on 1_DDC_Toolkit/Cost-Management/material-delivery-tracker (spec docs/ddc-alignment/material-delivery-check.md). Phase 35: delivery data model, status words and completeness rule from the skill; quantities and dates computed by the tested helper src/lib/delivery/deliveryCheck.ts (the agent only copies and looks up); text only, about 7 lines per run. Live run result: see 35-VERIFICATION.md. |
| 19 | QC Inspection Record Check | Site and handover | partial | data/agents/qc-inspection-record-check.yaml | Label: built on 3_DDC_Insights/Safety-Quality/quality-control-workflow (spec docs/ddc-alignment/qc-inspection-record-check.md). Phase 35: inspection, defect and NCR data model, status words and hold-point sign-off rule from the skill; record completeness only (text Y/N ticks and lookup), no helper, no date or numeric test; text only, about 7 records per run. Live run result: see 35-VERIFICATION.md. |
| 20 | Warranty Register Check | Site and handover | partial | data/agents/warranty-register-check.yaml | Label: built on 1_DDC_Toolkit/Closeout/warranty-tracker (spec docs/ddc-alignment/warranty-register-check.md). Phase 35: warranty data model and expiry status rule (expired, expiring within 90 days, active) from the skill; dates computed by the tested helper src/lib/warranty/warrantyStatus.ts (the agent only copies and looks up); register-completeness verdicts only, no coverage or claim reading; text only, about 7 rows per run. Live run result: see 35-VERIFICATION.md. |

## MCP servers

MCP servers are separate work and are not part of this inventory or of the DDC-based agents (decision D-634, phase 31). They are handled in phase 36 of the fix run: three `kind: mcp-server` entries stay behind the `AGENT_KINDS` flag, off by default, and exactly one agent using the LVI-INFO MCP server is planned there. Their former table was removed from this file.
