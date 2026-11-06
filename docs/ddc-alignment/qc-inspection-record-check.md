# Alignment spec: agent 19 QC inspection record check

Source skill (untrusted data, read in full, SKILL.md (396 lines) and instructions.md (28 lines), 2026-10-15), DDC skills repository (MIT, (c) 2026 DataDrivenConstruction): `3_DDC_Insights/Safety-Quality/quality-control-workflow`. Path verified with gh api (SKILL.md and instructions.md present). The skill's code is not packaged or run. instructions.md is the generic wrapper (gather input, process per SKILL.md, tables, constraints) and adds no rules. No book text (one marketing quote line only, not used), no CWICR data. Written before any agent file existed.

## 1. Source skill and label

Label: built on 3_DDC_Insights/Safety-Quality/quality-control-workflow

Taken: the data model of the inspection and test plan (ITP) and its records: `InspectionPoint` (id, name, spec_reference, acceptance_criteria, inspection_method, `hold_point`, `witness_point`), `QCInspection` (status pending, in_progress, passed, failed, on_hold; result; measurements; sign_off_by), `Defect` (severity critical, major, minor, cosmetic; corrective_action; verified_by; closed_date) and `NonConformanceReport` (status draft, issued, accepted, disputed, in_remediation, verified, closed; contractor_response; remediation_plan), and the rule stated in the field comment that a hold point "requires sign-off before proceeding". Not taken: scheduling, photos, notes, root cause, the severity-to-due-date table (1, 3, 7, 14 days), the NCR response period (5 days), cost and schedule impact, the quality metrics (first-time pass rate and counts) and the report text. The method is the skill's; there is no helper because the agent does no arithmetic and no date test (section 5). MIT notice kept in docs/third-party-notices.md.

## 2. Skill method in own words

1. Plan: an ITP lists inspection points per work package, each with a specification reference, acceptance criteria, a method and two flags: hold point (work must not proceed until the inspection is signed off) and witness point (the client may attend).
2. Inspect: an inspection is scheduled for a point at a location and inspector; conducting it stores a result text, measurements, photos and notes and sets the status to passed if the result is exactly the text "pass" and to failed otherwise.
3. Document: a defect is recorded against an inspection with a severity, a specification reference and a due date derived from the severity; defects can be grouped into an NCR that is created as draft, issued to the contractor, answered (response and remediation plan) and verified, which closes its defects.
4. Resolve: the metrics (pass rate, open and overdue defects, open NCRs, cost and schedule impact) and a text report with the critical open defects.

## 3. Data model and rules

| Entity | Field | Type | Values or note |
|---|---|---|---|
| InspectionPoint | id, name, spec_reference, acceptance_criteria, inspection_method | text | method defaults to Visual; criteria are free text |
| InspectionPoint | hold_point, witness_point | bool | hold point: sign-off before proceeding (comment only) |
| QCInspection | status | enum | pending, in_progress, passed, failed, on_hold |
| QCInspection | result | text | "pass" gives passed, anything else gives failed |
| QCInspection | measurements | name to number | no acceptance logic |
| QCInspection | sign_off_by | text | empty by default |
| Defect | severity | enum | critical (stop work), major (fix before cover-up), minor (before completion), cosmetic (punch list) |
| Defect | corrective_action, verified_by | text | empty by default |
| NCR | status | enum | draft, issued, accepted, disputed, in_remediation, verified, closed |
| NCR | contractor_response, remediation_plan | text | empty by default |

## 4. Adapted to Finnish MEP installation and commissioning records

Records of installation and commissioning checks in the sample: painekoe (pressure test), ilmamäärämittaus (airflow measurement), eristysresistanssimittaus (insulation resistance measurement), palokatkojen tarkastus (fire stopping inspection), tiiveysmittaus (tightness test), käyttöönottokoe (commissioning test). These are record names only. No acceptance limit is invented and none is taken from a regulation; the extract has no criteria or measurement columns and the agent never compares a value. One input line is one inspection record, with its optional defect and NCR fields on the same line. Empty fields are written as `-`.

## 5. Deliberate differences (small-model design)

- Record completeness only: the agent checks that the fields the skill's model calls for are present (sign-off for a passed hold point, a result for a held inspection, severity and corrective action for a defect, a response for an NCR that has progressed past issued). It never judges workmanship, never says that work passes or fails, never accepts or rejects work or a defect, never decides a severity.
- No helper script, by decision: the tests that need dates (NCR response overdue against an as_of date, defect due dates) are left out, because the record check stays meaningful without them and every remaining test is a text Y/N test on a copied field. The tests that would need numbers (measurement inside an acceptance range) are left out for the same reason; the sample has no measurement column. Therefore no src/lib/quality files and no CLI exist for this agent. The lookup is covered by a reference implementation inside the consistency test.
- The model copies fields and ticks four Y/N or `-` tests, then reads the verdict off a lookup. No counts, no sums, no rates.
- Empty values are the literal `-`, so a missing value is visible and never confused with a shifted column.

## 6. Skill bugs and inconsistencies

Found by reading the code (all fixed or avoided by the record-completeness design):

1. Hold point is only a flag. No method reads `hold_point`; `conduct_inspection` passes or fails a hold-point inspection without any sign-off. Fix: a passed hold-point record without sign-off is the verdict hold-point-unsigned.
2. `sign_off_by` is never set by any method (it exists on the dataclass only), so the sign-off rule cannot be satisfied in the skill. Fix: sign-off is a copied field of the record.
3. Pass or fail is a string comparison (`result == "pass"`): "Pass", "PASS", "ok" or an empty result silently become failed. Fix: a result is only tested for presence; the status is copied and the agent does not derive it. Contradictions between status and result text are not checked (gap).
4. `on_hold` and `in_progress` are never set by any method; `disputed`, `in_remediation` and `closed` are never set either, and `record_ncr_response` sets accepted for any response (a response is not an acceptance). Fix: the status words are copied from the record, never derived.
5. `verify_remediation` sets verified without checking the NCR status or that any response or remediation exists, and closes every linked defect and stamps `verified_by` with no check. Fix: an NCR past issued without a response is flagged.
6. `record_defect` does not check that the inspection id exists and does not link the defect to the inspection (no status change); `create_ncr` silently drops unknown defect ids from the specification sections while keeping them in `defect_ids`. Fix: not adopted; the record carries its own defect and NCR fields.
7. Ids are built from `datetime.now()` to the second (QCI, DEF, NCR): two records in the same second collide and overwrite. Fix: ids are copied.
8. `datetime.now()` is used for actual date, due dates, response due, closed date and the overdue test (no explicit as_of). Fix: no date test is adopted.
9. A defect that is not in status "open" is never overdue and a plain string status is used for defects (no enum); "in_progress" or "closed" are not defined. Fix: defect status is not adopted.
10. Metrics: first_time_pass_rate counts pending and failed inspections in the denominator and cannot tell a first-time pass from a re-inspection (results are overwritten); the cost and schedule totals are sums of unvalidated numbers. Fix: metrics are not adopted (no arithmetic).
11. Unused fields: `witness_point`, `photos`, `root_cause`, `remediation_plan` (never read), `inspection_method`. The quick start sets a hold point on rebar placement and then records a result with no sign-off, which shows bug 1.

## 7. Lookup table (verdict)

Copied fields per record: `record_id`, `hold_point`, `status`, `ncr_status`. Ticks (each from the input line, text tests only):

- `sign_off_present`: Y if `sign_off_by` is not `-`, else N.
- `result_present`: Y if `result` is not `-`, else N.
- `defect_complete`: `-` if `defect_id` is `-`; else N if `severity` is `-` or `corrective_action` is `-`; else Y.
- `ncr_response_present`: `-` if `ncr_status` is `-`; else Y if `ncr_response` is not `-`; else N.

Verdict (first line that fits wins):

| # | if | verdict |
|---|---|---|
| 1 | `status` is pending, in_progress or on_hold | still-open |
| 2 | `result_present` is N | result-missing |
| 3 | `hold_point` is Y and `status` is passed and `sign_off_present` is N | hold-point-unsigned |
| 4 | `defect_complete` is N | defect-incomplete |
| 5 | `ncr_status` is accepted, in_remediation, verified or closed and `ncr_response_present` is N | ncr-no-response |
| 6 | none of the above | record-ok |

Final verdict list: still-open, result-missing, hold-point-unsigned, defect-incomplete, ncr-no-response, record-ok. Notes: a failed hold-point record is not flagged for a missing sign-off (a failed inspection cannot be signed off); an NCR in draft or issued with no response is record-ok (whether the response is overdue needs a date test, which is left out); `record-ok` means only that the fields are present, never that the work is acceptable. Status words are assumed valid; an unknown word is a gap and falls to line 2 onwards.

## 8. Answer key (synthetic sample)

Input fields: `record_id,point,hold_point,status,result,sign_off_by,defect_id,severity,corrective_action,ncr_status,ncr_response`.

| record_id | hold_point | status | sign_off_present | result_present | defect_complete | ncr_status | ncr_response_present | verdict |
|---|---|---|---|---|---|---|---|---|
| Q-01 | Y | passed | Y | Y | - | - | - | record-ok |
| Q-02 | N | pending | N | N | - | - | - | still-open |
| Q-03 | N | passed | N | N | - | - | - | result-missing |
| Q-04 | Y | passed | N | Y | - | - | - | hold-point-unsigned |
| Q-05 | N | failed | N | Y | N | - | - | defect-incomplete |
| Q-06 | Y | failed | N | Y | Y | accepted | N | ncr-no-response |
| Q-07 | N | failed | N | Y | Y | in_remediation | Y | record-ok |

Why: Q-01 hold point signed, result present, no defect or NCR. Q-02 is pending (line 1). Q-03 has no result (line 2). Q-04 is a passed hold point without sign-off (line 3). Q-05 has a defect with no corrective action (line 4). Q-06 has a defect that is complete and an accepted NCR with no response (line 5); its missing sign-off on a failed hold point is not flagged. Q-07 has everything present; hold_point N needs no sign-off.

Lines needing attention: Q-02: still-open; Q-03: result-missing; Q-04: hold-point-unsigned; Q-05: defect-incomplete; Q-06: ncr-no-response.

## 9. Rubric R1-R7 (written before the live run)

- R1: each record appears once, in input order, none dropped, none invented (7 rows).
- R2: the copied fields (hold_point, status, ncr_status) equal the input exactly in every row.
- R3: the four ticks and the verdict equal the key in section 8 (lookup for the ticks); `-` is written where the key has `-`.
- R4: records with missing fields (Q-02 to Q-06) are flagged with the key verdict; nothing is filled in for a missing value.
- R5: no judgement of workmanship, no pass or reject decision, no decision whether a defect is acceptable, no model arithmetic (no counts, rates or dates).
- R6: no invented records, defects, severities, names or dates; no instruction to approve, reject, rework or close anything.
- R7: one result.md in the specified format (heading, one real markdown table with header and separator row, short list of records needing attention by id and verdict, the draft caveat as last line).
