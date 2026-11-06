# Third-party notices

## DDC Skills for AI Agents in Construction

- Source: https://github.com/datadrivenconstruction/DDC_Skills_for_AI_Agents_in_Construction
- License: MIT
- Retrieved: 2026-10-14 (LICENSE and NOTICE.md read from the `main` branch; the live text matched the earlier check)

License text, reproduced verbatim:

```
MIT License

Copyright (c) 2026 DataDrivenConstruction

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### What the MIT license covers (per the repository's NOTICE.md)

- Covered by MIT: the `SKILL.md` instruction files and the documentation.
- Not covered, all rights reserved by the author (Artem Boiko): the "Data-Driven Construction" book (`Books/`) and the GuideBook PDF.
- Not MIT: the DDC CWICR cost database is CC BY-NC 4.0 for the DDC compilation, plus a separate DDC commercial license for commercial use.
- Trademarks: product names such as Revit, Autodesk, Procore belong to their owners and are used for identification only.
- Curated skills in the DDC repository (category `4_DDC_Curated`) come from other public collections and keep those sources' licenses; do not adapt those from the DDC repository without checking the source license.

### Policy for this repository

- a. `SKILL.md` instructions and documentation may be adapted, with the copyright notice retained (this file).
- b. Never copy the book, the PDF or CWICR data into the repo, into agent prompts or into samples.
- c. A DDC-based entry sets `metadata.attribution` to the exact skill path with "adapted from" or "inspired by" and the MIT notice, or to "no DDC basis", and gets a row in the table below.
- d. Trademarks (Revit, Autodesk, Procore and so on) are used for identification only.

### DDC agents and their skill paths

Paths are relative to the DDC repository root. "Built on the skill" means the skill's method, data model and rules are the specification, adapted to Finnish MEP; no skill code is packaged or run, and the skills' own defects are not copied. Working mapping (2026-10-15), to be confirmed.

| Entry slug | DDC skill path | Relation |
| --- | --- | --- |
| etim-classification-repair | 1_DDC_Toolkit/BIM-Analysis/bim-classification-ai | inspired by 1_DDC_Toolkit/BIM-Analysis/bim-classification-ai (own design for ETIM-style mapping); weak match |
| qto-normalization | 2_DDC_Book/3.2-QTO-Auto-Estimates/bim-qto (primary; qto-report in the same folder as secondary) | adapted (method only; grouping and unit defects fixed in an own tested helper, no skill code copied) |
| clash-prioritization | 2_DDC_Book/4.3-BIM-Validation-Pipeline/clash-resolution-analyzer | adapted |
| rfi-generation-from-findings | 1_DDC_Toolkit/Document-Control/rfi-management | adapted |
| product-sourcing-mbom | 1_DDC_Toolkit/CWICR-Database/cwicr-material-procurement | inspired by 1_DDC_Toolkit/CWICR-Database/cwicr-material-procurement (method only; no CWICR data) |
| quote-comparison | 1_DDC_Toolkit/Procurement/bid-analysis-comparator | adapted (concepts; weighted-score defects fixed in an own tested helper, no skill code copied) |
| carbon-epd-enrichment | 2_DDC_Book/3.3-4D-BIM-CO2-Simulation/lifecycle-carbon-calculator | adapted (stage structure, data model and comparison logic; calculation defects fixed in an own tested helper, no factors or skill code copied) |
| cut-sheet-qa | 1_DDC_Toolkit/Document-Control/submittal-tracker; 2_DDC_Book/2.4-PDF-CAD-to-Data/specification-extractor | inspired by 1_DDC_Toolkit/Document-Control/submittal-tracker (+ 2_DDC_Book/2.4-PDF-CAD-to-Data/specification-extractor); weak match |
| spooling-and-cutting | none | no DDC basis (own design); the DDC prefab-optimization skill is not a pipe-spool or cut-list skill |
| d2-code-validation | none | no DDC basis (own design); D2 = Finnish National Building Code part D2 (indoor climate and ventilation), unconfirmed; alternatives open (Alok/Jussi to confirm) |
| om-completeness | 5_DDC_Innovative/as-built-documentation; 1_DDC_Toolkit/Project-Closeout/project-closeout-checklist | adapted |
| bms-digital-twin | 5_DDC_Innovative/digital-twin-sync | adapted |
| daily-report-cross-check | 1_DDC_Toolkit/Field-Operations/daily-report-generator; 3_DDC_Insights/Automation-Workflows/n8n-daily-report | loosely related to 1_DDC_Toolkit/Field-Operations/daily-report-generator (+ 3_DDC_Insights/Automation-Workflows/n8n-daily-report); weak match, topic only; own design |
| punch-list-closure-check | 1_DDC_Toolkit/Field-Operations/punch-list-manager; 1_DDC_Toolkit/Project-Closeout/punch-list-manager | inspired by 1_DDC_Toolkit/Field-Operations/punch-list-manager (+ 1_DDC_Toolkit/Project-Closeout/punch-list-manager); idea only, closure rules own design |
| change-order-consistency-check | 1_DDC_Toolkit/Cost-Management/change-order-processor | inspired by 1_DDC_Toolkit/Cost-Management/change-order-processor; idea only, log-versus-form check own design; change-order-manager and change-order-analysis read, not the basis |
| safety-observation-classification | 1_DDC_Toolkit/Field-Operations/safety-inspection; 3_DDC_Insights/Safety-Quality/safety-inspection-checklist | loosely related to 1_DDC_Toolkit/Field-Operations/safety-inspection (+ 3_DDC_Insights/Safety-Quality/safety-inspection-checklist); weak match, topic only; keyword lookup own design |
| procurement-lead-time-check | 1_DDC_Toolkit/Procurement/material-procurement-tracker | built on 1_DDC_Toolkit/Procurement/material-procurement-tracker (data model, must-order-by rule, late-to-order rule, 14-day window, status words; dates computed by an own tested helper with the skill's date.today() and window defects fixed; no skill code copied, no book text) |
| material-delivery-check | 1_DDC_Toolkit/Cost-Management/material-delivery-tracker | built on 1_DDC_Toolkit/Cost-Management/material-delivery-tracker (delivery data model, status words, quantity ordered versus received, completeness rule received >= ordered; quantities and dates computed by an own tested helper with the skill's date.today(), status-versus-quantity and late-partial defects fixed; storage planning not adopted; no skill code copied, no book text) |
| qc-inspection-record-check | 3_DDC_Insights/Safety-Quality/quality-control-workflow | built on 3_DDC_Insights/Safety-Quality/quality-control-workflow (ITP, hold-point, defect and NCR data model, status and severity words and the hold-point sign-off rule; record completeness only, no helper because no date or numeric test is adopted; the skill's string-compared pass/fail, never-set sign-off and date.today() defects not copied; no skill code copied, no book text) |
| warranty-register-check | 1_DDC_Toolkit/Closeout/warranty-tracker | built on 1_DDC_Toolkit/Closeout/warranty-tracker (warranty data model, warranty type and building system words, expiry status rule with the 90-day window; dates computed by an own tested helper with the skill's date.today(), years*365 drift, unchecked end date and always-empty expiring list defects fixed; claim workflow not adopted; no skill code copied, no book text) |

Notes:

- qto-normalization uses `bim-qto` as the primary skill (Phase 33). `qto-report` quotes the DDC book, so only its method ideas are used and no book text is copied; `ifc-qto-extraction` is not used.
- product-sourcing-mbom is inspired by a `cwicr-*` skill as a method only. No CWICR data (CC BY-NC 4.0 plus commercial licence) is used; the catalog sample is invented.
- procurement-lead-time-check (Phase 35) is built on `material-procurement-tracker`: the item data model, the rule must order by = required date minus lead time and the late and 14-day rules are the skill's; its code is not copied.
- material-delivery-check (Phase 35) is built on `material-delivery-tracker`: the delivery and item data model, the status words and the completeness rule (received >= ordered) are the skill's; its code is not copied and its storage planning is not adopted.
- qc-inspection-record-check (Phase 35) is built on `quality-control-workflow`: the inspection, defect and NCR data model, the status and severity words and the hold-point sign-off rule are the skill's; its code is not copied and its scheduling, metrics and report are not adopted.
- warranty-register-check (Phase 35) is built on `warranty-tracker`: the warranty record, the type and system words and the status rule (expired, expiring within 90 days, active) are the skill's; its code is not copied and its claim workflow is not adopted.
- Agents 13-20 (Phases 29 and 35): the label of each entry (built on, inspired by, loosely related to) is worded identically in the entry attribution, this file, the inventory and docs/ddc-alignment/<slug>.md; the selection and the rejected candidates are in docs/ddc-agent-candidates.md.
- Phase 34: labels for agents 1, 5, 8, 9 and 10 are worded identically in each entry, this file and the inventory (own designs; none claims to follow a skill).
- spooling-and-cutting and d2-code-validation have no DDC counterpart and keep the library repository as their `github_url`.
- The nine older entries (airo, demo-rfi-triage and seven seed entries) are not adapted from DDC skills.
