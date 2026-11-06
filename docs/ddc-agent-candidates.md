# DDC-derived agent candidates (Phases 29 and 35)

Selection record for the agents 13-20, chosen from the DDC skills after the 12 consortium agents (13-16 in Phase 29, re-checked against the real skills in Phase 35; 17-20 built in Phase 35). All outputs of these agents are drafts for engineer review. Inputs are synthetic or public only.

## Purpose and criteria

Source: github.com/datadrivenconstruction/DDC_Skills_for_AI_Agents_in_Construction (MIT, (c) 2026 DataDrivenConstruction). The Phase 29 survey covered 221 skills; the Phase 35 survey covered all 238 SKILL.md files of the repository (paths re-verified with the GitHub tree listing on 2026-10-15; the LICENSE file is present at the repository root).

A skill is built as a one-step agent only if all four criteria hold:

1. Useful to the consortium stages (design, sourcing, manufacturing, site and handover, compliance) or adjacent to them.
2. Fits the proven pattern: per-item check lines with copied texts and Y/N tests, verdict by lookup on those checks, no model arithmetic.
3. Not a duplicate of the 12 consortium agents or of an existing entry in data/agents.
4. A synthetic sample can be written without confidential data.

Exclusions: `cwicr-*` skills (cost database under a data licence), book content (all rights reserved), anything that needs code execution, network access, image or audio input, and anything beyond about 6 items per run for a small model. No DDC text or code is copied. How close each agent is to its skill is stated per agent by a label (built on, inspired by, loosely related to); see the sections below and the specs in docs/ddc-alignment/.

## Selected (built in Phase 29)

| No | Slug | Name | DDC skills adapted | One-step task | Lookup design | Why it qualifies |
| --- | --- | --- | --- | --- | --- | --- |
| 13 | daily-report-cross-check | Daily Report Cross Check | 1_DDC_Toolkit/Field-Operations/daily-report-generator; 3_DDC_Insights/Automation-Workflows/n8n-daily-report | Reconcile daily report lines (trade, workers, hours, delay) with a timesheet extract (two-source cross-check). | Per report line: copy the timesheet line with the same date and trade (or NONE), tick workers_same, hours_same and delay_open as Y/N by identical-text tests, verdict by lookup (consistent, mismatch, delay-unexplained, not-in-timesheet). | Site stage; two plain CSV inputs; no arithmetic; new (no consortium agent compares site reports with time recording). |
| 14 | punch-list-closure-check | Punch List Closure Check | 1_DDC_Toolkit/Field-Operations/punch-list-manager; 1_DDC_Toolkit/Project-Closeout/punch-list-manager | Check punch-list items against closure rules and an as-of date (status and date rules). | Per item: copy status, due date and closure evidence, tick rule tests as Y/N, verdict by lookup. | Handover stage; rules are exact-text tests; complements O&M completeness (documents) with defect closure. |
| 15 | change-order-consistency-check | Change Order Consistency Check | 1_DDC_Toolkit/Cost-Management/change-order-processor; 4_DDC_Curated/Contract-Legal/change-order-manager | Reconcile a change-order log with the change-order forms (document consistency). | Per log row: copy the matching form line, tick id, title, status and amount text equality as Y/N, verdict by lookup. | Contract administration adjacent to site and handover; amounts compared as identical text only, never summed. |
| 16 | safety-observation-classification | Safety Observation Classification | 1_DDC_Toolkit/Field-Operations/safety-inspection; 3_DDC_Insights/Safety-Quality/safety-inspection-checklist | Classify site safety observations with a supplied keyword table (lookup classification; categories are placeholders). | Per observation: copy the first table keyword found in the text (or NONE), category read off the table line. | Site stage; the model only copies and looks up; categories are not a regulation. |

Stage placement: all four are `site-handover`, because the entry template allows only four stages (design, sourcing, manufacturing, site-handover). Change orders are commercial; this is recorded as a gap in plan 29-03.

## Phase 29 agents re-checked in Phase 35

Each skill below was read in full (SKILL.md and instructions.md) in Phase 35 and each path verified with the tree listing; the label is the result, written in docs/ddc-alignment/<slug>.md, the entry attribution, docs/third-party-notices.md and the inventory. Light alignment to the skills' fields was not adopted (renames would be cosmetic; reasons in the specs). The Phase 29 statement that these agents are "own design" is replaced by the labels. Changed entries were rerun once on their old samples and all runs counted (35-01 in 35-VERIFICATION.md).

| No | Slug | Label | Skill path(s) | What changed |
| --- | --- | --- | --- | --- |
| 13 | daily-report-cross-check | loosely related to | 1_DDC_Toolkit/Field-Operations/daily-report-generator (+ 3_DDC_Insights/Automation-Workflows/n8n-daily-report) | The skills generate reports; none reconciles them with a timesheet, so only the topic is shared. Label, attribution, github_url and spec added; rerun counted (job 33c64dfb). |
| 14 | punch-list-closure-check | inspired by | 1_DDC_Toolkit/Field-Operations/punch-list-manager (+ 1_DDC_Toolkit/Project-Closeout/punch-list-manager) | Item fields and status idea shared; the closure rule checks are own design. Label, attribution and spec added; SKILL revised once (open-ok review rule); rerun counted (job edc60b32 after a failed first rerun d9a413e5). |
| 15 | change-order-consistency-check | inspired by | 1_DDC_Toolkit/Cost-Management/change-order-processor | The log-versus-form check is own design; the Phase 29 claim of a third-party source licence for change-order-manager was not supported by the repository and was dropped. Rerun counted (job bb72743d). |
| 16 | safety-observation-classification | loosely related to | 1_DDC_Toolkit/Field-Operations/safety-inspection (+ 3_DDC_Insights/Safety-Quality/safety-inspection-checklist) | Weak match, topic only; the keyword lookup with a placeholder category table is own design. Rerun counted with one noted tick deviation (job a121094f). |

## Selected (built in Phase 35)

These four are built on their skill: the skill's data model and rules are the spec (docs/ddc-alignment/<slug>.md, written from a full read before any agent file), the skill's defects are fixed rather than copied, and dates are computed by a tested helper with an explicit as_of date, so the model only copies and looks up. No skill code is packaged or run. Label for all four: built on.

| No | Slug | Name | Stage | DDC skill path (exact) | Helper | Why it qualifies | Live result (35-VERIFICATION.md) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 17 | procurement-lead-time-check | Procurement Lead Time Check | sourcing | 1_DDC_Toolkit/Procurement/material-procurement-tracker | src/lib/procurement/leadTime.ts: must-order-by date (required date minus lead time), days to order, late and 14-day-window flags | Typed item model with a defined ordering rule; long-lead MEP equipment; not a duplicate of product-sourcing-mbom or quote-comparison | COUNTED, job e32b588b, 1 run |
| 18 | material-delivery-check | Material Delivery Check | site-handover | 1_DDC_Toolkit/Cost-Management/material-delivery-tracker | src/lib/delivery/deliveryCheck.ts: quantity balance, completeness (received >= ordered), days late, status-versus-quantity conflict | Delivery line model with status words and a completeness rule; site logistics, no agent covered it; resolves the former "could be built later" row | COUNTED, job ad96ec03 after revision 1 (first run 9902ee53 not counted) |
| 19 | qc-inspection-record-check | QC Inspection Record Check | site-handover | 3_DDC_Insights/Safety-Quality/quality-control-workflow | none by decision (no date or number test adopted; the consistency test holds a reference lookup) | ITP, inspection, defect and NCR record model with hold-point sign-off rule; completeness only, no workmanship judgement; resolves the former overlap row | COUNTED, job 174d6166 after revision 1 (first run f9f76250 not counted) |
| 20 | warranty-register-check | Warranty Register Check | site-handover | 1_DDC_Toolkit/Closeout/warranty-tracker | src/lib/warranty/warrantyStatus.ts: expected end date (calendar years), end-date consistency, days remaining, status class (90-day window), presence checks | Typed warranty record with an explicit status rule; handover data no agent covered (om-completeness checks O&M documents, punch-list-closure-check checks defects) | COUNTED, job 01156eba after revision 1 (first run 3dcb94e7 not counted) |

Stage placement: 17 is `sourcing`; 18-20 are `site-handover`.

## Not built (remaining candidates)

| Candidate (DDC path) | Reason not built | Could be built later? |
| --- | --- | --- |
| 1_DDC_Toolkit/Document-Control/submittal-tracker | Already adapted by cut-sheet-qa (duplicate) | No |
| 1_DDC_Toolkit/Document-Control/meeting-minutes-generator | Action-item rows (owner, due, status) repeat the punch-list-closure-check pattern; discussion topics and decisions are free text, not a per-item lookup | Yes, only if minutes arrive one action per line |
| 1_DDC_Toolkit/Field-Operations/daily-report-generator (beyond the cross-check) | PDF generation and weather API: code and network | No |
| 1_DDC_Toolkit/Analytics/daily-progress-report | Aggregation arithmetic | No (script) |
| 1_DDC_Toolkit/Document-Control/contract-clause-analyzer; 4_DDC_Curated/Contract-Legal/contract-clause-extractor | Legal interpretation and risk judgement cannot be checked reliably; needs legal review | Unlikely |
| 4_DDC_Curated/Contract-Legal/claims-documentation; lien-waiver-tracker | Legal and jurisdiction-specific | Unlikely |
| 1_DDC_Toolkit/Cost-Management/material-delivery-tracker | Built in Phase 35 as agent 18 (see Selected) | Done |
| 1_DDC_Toolkit/Procurement/material-tracker | Overlaps product-sourcing-mbom | No |
| 1_DDC_Toolkit/Procurement/subcontractor-prequalification | Weighted scoring is arithmetic; company financial and safety data are confidential | No |
| 1_DDC_Toolkit/Schedule-Management/schedule-delay-analyzer; 3_DDC_Insights/Schedule-Optimization/delay-analysis, critical-path-analyzer | Day arithmetic and critical path calculation need a deterministic script, not a model | As a tool |
| 1_DDC_Toolkit/Cost-Management/budget-variance-analyzer, cash-flow-forecaster, payment-application-generator, subcontractor-payment-tracker; 4_DDC_Curated/Financial-Management/* | Money arithmetic, which Phase 25 showed the model gets wrong | As a tool |
| 1_DDC_Toolkit/BIM-Analysis/bim-validation-report; 2_DDC_Book/4.3-BIM-Validation-Pipeline/bim-consistency-checker, bim-validation-pipeline | Need IFC or model parsing; ids-checker is already adapted by d2-code-validation | As a tool |
| 3_DDC_Insights/Safety-Quality/incident-reporting | Injury and personal data, statutory reporting duties; not for a small model | No |
| 3_DDC_Insights/Safety-Quality/toolbox-talk-generator | Free generation, no checkable verdicts | No |
| 3_DDC_Insights/Safety-Quality/quality-control-workflow | Built in Phase 35 as agent 19 (see Selected) | Done |
| 3_DDC_Insights/Safety-Quality/compliance-tracker | Expiry and status pattern is the same as warranty-register-check, and it tracks licences, insurance and worker certificates (personal data) | No |
| 1_DDC_Toolkit/Field-Operations/progress-photo-analyzer; 2_DDC_Book/2.4-PDF-CAD-to-Data/image-to-data, drawing-analyzer; 3_DDC_Insights/Field-Automation/voice-to-report, telegram-field-bot | Image, audio or messaging network input | No (text only) |
| 1_DDC_Toolkit/CAD-Converters/* | Executable converters (code execution) | No |
| 2_DDC_Book/2.2-Open-Data-Standards/weather-api, price-api | Network access | No |
| 1_DDC_Toolkit/Analytics/*; 2_DDC_Book/4.5-ML-Cost-Prediction/*, 4.1-Analytics-KPI-Dashboard/* | Statistics and model training (code execution) | No |
| 1_DDC_Toolkit/Resource-Management/* | Arithmetic on hours and fleet data | No |
| 2_DDC_Book/2.6-Data-Quality-Validation/* | Generic statistics, no domain checks | No |
| 1_DDC_Toolkit/CWICR-Database/*; cost and QTO skills of 2_DDC_Book/3.1 and 3.2 that use CWICR or quote the book | Excluded by licence and scope | No |
| 4_DDC_Curated/Document-Generation/*; Prompt-Engineering/* | Generic tooling, not construction agents | No |
| 1_DDC_Toolkit/Procurement/material-procurement-tracker | Built in Phase 35 as agent 17 (see Selected) | Done |
| 1_DDC_Toolkit/Closeout/warranty-tracker | Built in Phase 35 as agent 20 (see Selected) | Done |
| 5_DDC_Innovative/permit-tracking-automation | Required-versus-submitted document sets repeat om-completeness; jurisdiction and municipal-portal integration is network access; Finnish permit document lists would be own invention, not the skill's | Yes, as a variant of om-completeness |
| 1_DDC_Toolkit/Closeout/as-built-tracker; 1_DDC_Toolkit/Document-Control/as-built-documentation | Duplicate of om-completeness (as-built-documentation is its DDC basis, agent 11) | No |
| 1_DDC_Toolkit/Project-Closeout/project-closeout-checklist | Already used as a source of agent 11; its standard checklist is a US item list | No |
| 5_DDC_Innovative/safety-compliance-checker | Regulation-specific (US OSHA style rules); regulatory judgement is not checkable by a small model | No |
| 4_DDC_Curated/Financial-Management/retention-tracker, payment-application-processor; 1_DDC_Toolkit/Cost-Management/payment-application-generator | Money arithmetic | As a tool |
| 5_DDC_Innovative/change-order-analysis | Overlaps change-order-consistency-check (agent 15) and adds cost and schedule impact judgement | No |
| 5_DDC_Innovative/document-classification-nlp | NLP model code; its classification-by-keyword idea is already covered by safety-observation-classification and etim-classification-repair | No |
| 2_DDC_Book/2.4-PDF-CAD-to-Data/specification-extractor | Free extraction from PDF specifications; cut-sheet-qa already reads specification text | No |
| 3_DDC_Insights/Schedule-Optimization/look-ahead-scheduler (and the other schedule skills) | Date and resource arithmetic, list generation | As a tool |
| 2_DDC_Book/2.6-Data-Quality-Validation/validation-rules-builder; 4_DDC_Curated/Data-Validation/input-validation, schema-validation; 2_DDC_Book/2.5-Data-Modeling-Standards/standards-compliance-checker | Generic data validation code, no construction domain checks | No |
| 6_OpenConstructionERP/* (oce-validation-engine, oce-tendering, oce-estimate-boq and others) | Bound to the OpenConstructionERP platform and its API (network, platform data) | No |

## Next candidates if more are wanted

- meeting-minutes-generator: a row-per-action check. Precondition: the minutes arrive as one action per line with owner and date columns.
- permit-tracking-automation as a variant of om-completeness. Precondition: the required document list is supplied by the user, not invented.

## Attribution

The DDC skill repository is MIT licensed, (c) 2026 DataDrivenConstruction. Agents 17-20 are built on their skill (data model, rules and outputs; skill defects fixed; no skill code copied). Agents 14 and 15 are inspired by a skill (idea and fields only) and agents 13 and 16 are loosely related to a skill (topic only); the labels of the other agents are in docs/third-party-notices.md. No DDC book text and no CWICR data is used anywhere. Licence text, the adapted-entries table and the per-agent labels are in docs/third-party-notices.md.
