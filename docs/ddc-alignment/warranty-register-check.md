# Alignment spec: agent 20 Warranty register check

Source skill (untrusted data, read in full, SKILL.md (446 lines) and instructions.md (28 lines), 2026-10-15), DDC skills repository (MIT, (c) 2026 DataDrivenConstruction): `1_DDC_Toolkit/Closeout/warranty-tracker`. Path verified with gh api (SKILL.md and instructions.md present). The skill's code is not packaged or run. instructions.md is the generic wrapper (gather input, process per SKILL.md, tables, constraints) and adds no rules. No book text (the skill only points to a book chapter and an AIA form number), no CWICR data. Written before any agent file existed.

## 1. Source skill and label

Label: built on 1_DDC_Toolkit/Closeout/warranty-tracker

Taken: the warranty record (item description, building system, warranty type, start date, end date, duration in years, coverage details, contact, documents), the warranty type words (manufacturer, contractor, installer, extended, performance), the building system words (the skill's 13 words), the status rule of `Warranty.status` (expired when today is after the end date, expiring soon when at most 90 days remain, otherwise active) and `days_remaining` (end date minus today). Not taken: the claim workflow (`WarrantyClaim`, `ClaimStatus`, `file_claim`, `update_claim_status`), the statuses `claimed` and `void`, the expiration report, the summary counts, the spreadsheet export, the document upload log, exclusions text. The method is the skill's; the code is an own tested helper. MIT notice kept in docs/third-party-notices.md.

## 2. Skill method in own words

1. A warranty is added with a duration in years, a start date (default: the project's substantial completion date) and the end date is computed as start plus years times 365 days.
2. Documents are attached to a warranty afterwards (a list that starts empty).
3. `status` is derived from today's date: expired, expiring soon (within 90 days) or active; `days_remaining` is the day difference.
4. A claim can be filed against a warranty that is not expired; claims have a draft-to-resolved status flow and a covered cost.
5. Lists: expiring warranties, active warranties, warranties by building system, a summary (counts by status and system, open claims, cost recovered), an expiration report for n months ahead and an Excel export.
6. Outputs of the skill: warranty records, expiring list, summary, expiration report, export.

## 3. Data model and rules

One input line is one warranty (one register row of a handover warranty register, takuurekisteri). Fields have no commas.

| Field | Type | Values / rule |
|---|---|---|
| warranty_id | text | register id, copied |
| item | text | item description, copied |
| system | enum | structural, roofing, hvac, electrical, plumbing, elevators, fire_protection, glazing, flooring, painting, appliances, exterior, other (the skill's words, copied) |
| warranty_type | enum | manufacturer, contractor, installer, extended, performance |
| start_date | ISO date | may be blank (then end-date consistency is unknown) |
| end_date | ISO date | the end date as the register states it; may be blank (then status is unknown) |
| duration_years | integer >= 1 | may be blank (then end-date consistency is unknown) |
| documents | text | file names or reference; blank = no document attached |
| contact | text | contact e-mail or name; blank = no contact |
| coverage | text | coverage text as in the contract; blank = no coverage text |
| end_date_expected | ISO date or `-` | helper: start_date plus duration_years calendar years (rule below); `-` when start_date or duration_years is blank |
| dates_consistent | Y/N/- | Y when end_date equals end_date_expected or the day before it; N otherwise; `-` when start_date, duration_years or end_date is blank |
| days_remaining | integer or `-` | end_date minus as_of in calendar days; negative when expired; `-` when end_date is blank |
| status_class | enum or `-` | `expired` when days_remaining < 0; `expiring-soon` when 0 <= days_remaining <= 90; `active` when days_remaining > 90; `-` when end_date is blank |
| document_present | Y/N | Y when the documents field has text |
| contact_present | Y/N | Y when the contact field has text |
| coverage_present | Y/N | Y when the coverage field has text |

End-date rule (a choice, the skill has an ambiguity): the skill adds `duration_years * 365` days, which drifts against the calendar (five years from 2025-06-01 gives 2030-05-31 because 2028 has a leap day; ten years drift up to three days). The helper adds calendar years: the same month and day N years later; a start on 29 February moves to 28 February when the target year is no leap year. Contracts differ on whether the last day is the anniversary or the day before it, so the register end date is accepted when it equals the anniversary or the day before (dates_consistent Y), and anything else is N. days_remaining and status_class always use the register end_date as stated (the skill does the same), not the expected one. 0 days remaining is the last day and is still expiring-soon (the skill: expired only when today is AFTER the end date); 90 days remaining is expiring-soon (the skill: <= 90); 91 is active.

## 4. Adapted to Finnish MEP handover

- A handover warranty register for MEP systems: ilmanvaihtokone (hvac), putkisto and pumput (plumbing), sähkö and pääkeskus (electrical), sprinkleri (fire_protection). The Finnish words are only an own mapping to the skill's system words; the check reads the English system word in the register.
- The warranty period (takuuaika) is whatever the contract states and is copied from the register as duration_years and the two dates. No legal minimum or standard period is assumed or looked up. Periods stated in months (for example 24 months) must be written as years by the user; the skill's model is whole years and this is a recorded gap.
- ISO dates, `as_of: YYYY-MM-DD` supplied in the input, nothing reads a clock. Days are CALENDAR days (the skill subtracts dates).
- Claim handling, claim deadlines and coverage or exclusion reading are not adopted: the check is on the register, not on what a warranty covers. The coverage field is only tested for presence; nobody is told what is or is not covered or whether a claim is possible.

## 5. Deliberate differences (small-model design)

- The tested helper `src/lib/warranty/warrantyStatus.ts` (CLI `scripts/warranty-status.ts`) computes end_date_expected, dates_consistent, days_remaining and status_class and also the three text-presence checks document_present, contact_present and coverage_present, and writes them into the input as the last seven columns. The user (or harness) runs it before the agent. Reason: the lesson of agents 18 and 19 is that a model reading empty comma-separated fields makes tick mistakes; the helper columns come last so they can be read from the end and the model never has to count empty fields.
- The model copies the seven columns and reads the verdict off a lookup table. No ticks of its own, no dates, no counts.
- One row per warranty in input order, 8 cells. No counts, no totals, no summary.
- Statuses are derived by the helper from dates; the skill's hand-set `claimed` and `void` are not used.

## 6. Skill bugs and inconsistencies

Checked `WarrantyType`, `WarrantyStatus`, `ClaimStatus`, `BuildingSystem`, `WarrantyDocument`, `Warranty`, `WarrantyClaim`, `WarrantyTracker` and instructions.md.
1. `status`, `days_remaining`, `add_document` (upload date), `file_claim` (reported date), `update_claim_status` (resolution date), `get_expiring_warranties` and `generate_expiration_report` read `date.today()`: the same register gives different answers on different days and cannot be tested. Helper: explicit `asOf`, no clock, UTC date arithmetic only.
2. `add_warranty` computes the end as start plus `duration_years * 365` days: leap days make it drift (five years from 2025-06-01 ends 2030-05-31, a day early; ten years can be three days early), so a warranty that still runs is reported expired a day or more early. Helper: calendar-year addition with a stated 29 February rule.
3. `end_date` is a stored field and is never checked against start plus duration; a register row built by hand or imported can say 3 years of end date and 5 years of duration without anyone noticing (the `Warranty` dataclass accepts any values). Helper: dates_consistent.
4. `get_expiring_warranties` filters `status == ACTIVE` and then `end_date <= today + 90`, but ACTIVE means MORE than 90 days remain, so with the default 90 the result is always empty and the warranties that are expiring soon (status EXPIRING_SOON) are excluded; `get_summary['expiring_soon']` is therefore always 0. Helper: status_class expiring-soon is the 0 to 90 day class, tested at 0, 90 and 91.
5. `days or self.EXPIRING_THRESHOLD_DAYS` treats `days=0` as "not given" and uses 90. Not adopted (no variable window); recorded.
6. `WarrantyStatus.CLAIMED` and `VOID` are never produced by the `status` property or any method; they exist but are unreachable, and `update_claim_status` never changes the warranty status. Not adopted; the helper's classes are only expired, expiring-soon, active.
7. `file_claim` blocks only an expired warranty; a `void` or already claimed one passes, and a claim status can jump to any other (no transition check); `cost_covered > 0` cannot reset to zero. Not adopted (claim workflow out of scope).
8. A warranty with no document attached is never flagged: `documents` starts as an empty list and nothing tests it, although the skill's own business case names missing documentation as the first problem. Helper: document_present, verdict documents-missing.
9. No validation: `duration_years` of 0 or negative, a blank `contact_email` (a required parameter that accepts an empty string), an invalid system or type text outside the enums, a `start_date` that is not a date. Helper: typed errors (bad-date, bad-as-of, bad-duration, bad-system, bad-type, missing-field), CLI exit 2; blank optional fields are shown as `-` or N, never as zero or a default (the skill silently defaults the start date to the completion date).
10. `generate_expiration_report` uses `months_ahead * 30` days for months and includes already expired warranties (no lower bound). Not adopted.
11. `to_dict` and the Excel export drop coverage, exclusions, documents and the contact name; `contact` is the e-mail only. Not adopted.
12. The skill does not say calendar or working days and has whole years only (no months): calendar days chosen, months recorded as a gap.

## 7. Lookup table (verdict)

Inputs are the copied `dates_consistent`, `status_class`, `document_present`, `contact_present` and `coverage_present`. Evaluate top to bottom, first line that fits wins. Priority order of the verdicts: data-incomplete, dates-inconsistent, expired, documents-missing, contact-missing, expiring-soon, register-ok.

| # | if | verdict |
|---|---|---|
| 1 | `status_class` is `-`, or `dates_consistent` is `-`, or `coverage_present` is N | data-incomplete |
| 2 | `dates_consistent` is N | dates-inconsistent |
| 3 | `status_class` is expired | expired |
| 4 | `document_present` is N | documents-missing |
| 5 | `contact_present` is N | contact-missing |
| 6 | `status_class` is expiring-soon | expiring-soon |
| 7 | otherwise (active, all present, dates consistent) | register-ok |

Every combination of the keys falls on exactly one line (the table is exhaustive: line 7 holds the remaining case status_class active, dates consistent, all three presence checks Y).

Verdict meanings: `data-incomplete` = the end date, the start date or duration, or the coverage text is blank, so the record cannot be judged (the engineer completes the register). `dates-inconsistent` = the register end date does not match start plus duration. `expired` = the end date has passed at as_of. `documents-missing` = no warranty document is attached to a live warranty. `contact-missing` = no contact for a live warranty. `expiring-soon` = at most 90 days remain and the record is otherwise complete. `register-ok` = a live warranty with a consistent record, complete documents, contact and coverage text and more than 90 days left. These are register-completeness words only: nothing is said about what the warranty covers, whether a claim is possible, or whom to call. The words are drafts for the engineer to check.

## 8. Answer key (synthetic sample, as_of 2026-03-02)

Computed by hand (calendar days; 2028 is a leap year, 2026 is not), then confirmed by the helper test.

| warranty_id | system / type | start | end | years | doc / contact / coverage | end_date_expected | dates_consistent | days_remaining | status_class | verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| W-01 | hvac / manufacturer | 2025-06-01 | 2030-06-01 | 5 | Y / Y / Y | 2030-06-01 | Y | 1552 | active | register-ok |
| W-02 | plumbing / installer | 2024-03-15 | 2026-03-14 | 2 | Y / Y / Y | 2026-03-15 | Y | 12 | expiring-soon | expiring-soon |
| W-03 | fire_protection / contractor | 2023-02-10 | 2026-02-10 | 3 | Y / Y / Y | 2026-02-10 | Y | -20 | expired | expired |
| W-04 | plumbing / contractor | 2025-09-01 | 2027-09-01 | 2 | N / Y / Y | 2027-09-01 | Y | 548 | active | documents-missing |
| W-05 | electrical / manufacturer | 2025-11-20 | 2030-11-20 | 5 | Y / N / Y | 2030-11-20 | Y | 1724 | active | contact-missing |
| W-06 | hvac / extended | 2025-04-01 | 2028-04-01 | 5 | Y / Y / Y | 2030-04-01 | N | 761 | active | dates-inconsistent |
| W-07 | plumbing / installer | 2025-08-15 | blank | 2 | Y / Y / Y | 2027-08-15 | - | - | - | data-incomplete |

Hand checks: W-01 2026-03-02 to 2030-03-02 is four years with one leap day (2028-02-29), 4*365+1 = 1461, plus 2030-03-02 to 2030-06-01 = 29 (to Mar 31) + 30 (April) + 31 (May) + 1 = 91, total 1552. W-02 end 2026-03-14 is the day before the anniversary 2026-03-15, so consistent; 14 minus 2 is 12 days, at most 90, so expiring-soon. W-03 anniversary 2026-02-10 equals the end; as_of is 20 days later (18 days to Feb 28, 2 more), so -20 and expired. W-04 2026-03-02 to 2027-03-02 is 365, plus 2027-03-02 to 2027-09-01 = 183 (31+30+31+30+31+30... Mar 2 to Apr 2 is 31, to May 2 30, to Jun 2 31, to Jul 2 30, to Aug 2 31, to Sep 1 30), total 548; documents blank, so documents-missing (line 4). W-05 1461 + (2030-03-02 to 2030-11-20: 245 + 18 = 263) = 1724; contact blank, so contact-missing. W-06 five years from 2025-04-01 is 2030-04-01, the register says 2028-04-01 so N (line 2 wins although the warranty is also active); days 365 + 366 + 30 = 761. W-07 has no end date, so dates_consistent, days_remaining and status_class are `-` and line 1 applies; end_date_expected is still shown (2027-08-15) because start and duration are known.

Branches covered: register-ok (W-01), expiring-soon (W-02, also the day-before end-date convention), expired (W-03), documents-missing (W-04), contact-missing (W-05), dates-inconsistent (W-06), data-incomplete through a blank end date (W-07). Coverage blank, the 29 February start, the 0, 90 and 91 day boundaries and the leap-day drift are covered by helper tests and worked rows in SKILL.md, not by the live sample.

## 9. Rubric R1-R7 (written before the live run)

- R1: each warranty appears once, in input order, none dropped, none invented (7 rows).
- R2: the copied helper columns (dates_consistent, days_remaining, status_class, document_present, contact_present, coverage_present) equal the input exactly in every row.
- R3: verdict equals the lookup for the copied columns (key in section 8).
- R4: W-07 (`-` cells) is data-incomplete; no end date, day count or status is invented or filled in for it.
- R5: no model arithmetic and no legal reading: no recomputed date, day count or end date; no statement of what a warranty covers, excludes or whether a claim is possible; no claim or contact advice.
- R6: no invented warranties, manufacturers, contacts, documents or dates.
- R7: one result.md in the specified format (heading, as_of line, one markdown table with header and separator row, short list of warranties needing attention copied by id and verdict, the draft caveat as last line).
