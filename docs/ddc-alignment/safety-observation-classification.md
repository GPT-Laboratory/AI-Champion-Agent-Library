# Alignment spec: agent 16 Safety observation classification

Source skills (untrusted data, read in full, SKILL.md and instructions.md of both, 2026-10-15), DDC skills repository (MIT, (c) 2026 DataDrivenConstruction). Paths verified with gh api (SKILL.md, instructions.md, claw.json present):
- `1_DDC_Toolkit/Field-Operations/safety-inspection` (primary)
- `3_DDC_Insights/Safety-Quality/safety-inspection-checklist`

No book text, no CWICR data, no incident reporting. Code not packaged or run. Both instructions.md are the generic wrapper (no extra rules). Written before the agent files were changed. The category table of the sample is an invented placeholder; no regulation text is used (the checklist skill cites US regulation references per item; they are not used).

## 1. Label

Label: loosely related to 1_DDC_Toolkit/Field-Operations/safety-inspection (+ 3_DDC_Insights/Safety-Quality/safety-inspection-checklist)

Both skills are checklist-based inspections: a fixed checklist per inspection type is answered pass, fail or n/a, a failed item produces a hazard or finding with a severity and an owner. Neither classifies a free-text observation into a category. The agent's method, a keyword table lookup with a first-match rule, multi-match and no-match statuses, is own design, as the Phase 29 spec guessed. What is shared is the topic and the vocabulary: severity words (Critical, High, Medium, Low, Observation) and category names (PPE, Fall Protection, Electrical, Housekeeping, Excavation) appear in the skills' checklists; the agent's table is user-supplied and only happens to use similar words.

## 2. What the skills contain

| | safety-inspection | safety-inspection-checklist |
|---|---|---|
| Records | Hazard (id, description, severity, location, photos, assigned_to, due_date, status, corrective action, corrected, verified); Inspection; Incident (type Near Miss, First Aid, Recordable, Lost Time) | InspectionFinding (item_id, status pass / fail / na, severity, description, photos, location, assigned_to, due, corrective action, finding_status); SafetyInspection |
| Enumerations | HazardSeverity Critical, High, Medium, Low, Observation; HazardStatus Open, In Progress, Corrected, Verified Closed | FindingSeverity critical, major, minor, observation; FindingStatus open, in_progress, corrected, verified |
| Rules | checklists per type (daily pre-work 15 items, scaffold 12, excavation 10) with a category per item; due date default by severity (0, 1, 3, 7, 14 days); notify for critical and high; verify only after corrected | checklist templates with regulation reference and a `critical` flag per item (daily 15, scaffold 12, excavation 10); score = pass / applicable; open findings sorted by severity |
| Outputs | daily safety briefing, statistics (TRIR, days since recordable) | inspection report, weekly summary |

## 3. Taken versus own

| Item | Status | Note |
|---|---|---|
| observation id, location, description text | adapted (field idea) | skill hazard_id, location, description; agent obs_id, location, text |
| severity vocabulary high / medium / low | adapted (words only) | the skill's HazardSeverity words in lowercase; in the agent they are values of a user-supplied table column, not an assessment |
| category names | not taken | the agent never supplies categories; the table does |
| keyword-to-category lookup, first match wins, multi-match, no-match | own | |
| review flag | own | |
| checklists, pass/fail scoring, due dates by severity, incident reports, TRIR, statistics | not adopted | |

## 4. Skill bugs and inconsistencies found

safety-inspection:
1. `get_statistics`: `period_hazards` is an empty comprehension (no filter), `hazards_identified` counts all hazards regardless of period.
2. `get_overdue_hazards` considers only Open, so an In Progress hazard past due is never overdue; In Progress is never set by any method.
3. `_days_since_recordable` returns 365 when no recordable exists; `osha_recordable` is never set by `report_incident`, so TRIR is always 0.
4. TRIR uses an assumed 50 workers and 8,800 hours per month instead of real hours.
5. Hazard, inspection and incident ids use second-resolution timestamps; two in one second overwrite each other.
6. `complete_checklist_item` silently does nothing for an unknown item id; `add_hazard` for a failed item is only a printed prompt, not enforced.
7. Critical due date is 0 days, so a critical hazard is due and overdue on the same day it is created.

safety-inspection-checklist:
8. `ChecklistItem.critical` is never used when a severity is assigned; severity is a free argument of `record_finding`, so a fail on a critical item can be recorded as minor or with no severity.
9. `calculate_score` returns 0.0 with no findings but 100 when every finding is n/a; `generate_weekly_summary` averages `overall_score`, which is 0 unless `calculate_score` was called, and the trend is a hard threshold of 85.
10. `record_finding` does not check that the item id exists in the inspection's checklist, and `create_inspection` never copies the checklist into the inspection.
11. `get_open_findings` sorts major and minor and None severity into the same non-critical tier ordering by a three-way key.

The agent avoids these by taking severity only from the user-supplied table (never a default, never from the model), by reporting unknown cases as no-match, and by not producing scores, statistics or dates.

## 5. Light alignment decision

None. The severity words already coincide with the skill's lowercase words. Adopting the skill's category names would mean putting them into the sample table, which is the user's own input and a placeholder; changing it would change the key. Not adopted: checklist categories, `major`/`minor` severity words, finding status words. Own design recorded: keyword table lookup, multi-match statuses, review flag.

## 6. Impact on rerun

SKILL body changes: no (footer wording only: "Ideas adapted from" becomes "Loosely related to"). Sample changes: no. Rubric/key changes: no. One footer-change rerun on the existing sample.
