# Alignment spec: agent 17 Procurement lead time check

Source skill (untrusted data, read in full, SKILL.md (181 lines) and instructions.md (28 lines), 2026-10-15), DDC skills repository (MIT, (c) 2026 DataDrivenConstruction): `1_DDC_Toolkit/Procurement/material-procurement-tracker`. Path verified with gh api (SKILL.md, instructions.md present). The skill's code is not packaged or run. instructions.md is the generic wrapper (gather input, process per SKILL.md, tables, constraints; its opening line talks about cost estimates, which the skill does not do) and adds no rules. No book text (the skill only points to a book chapter), no CWICR data. Written before any agent file existed.

## 1. Source skill and label

Label: built on 1_DDC_Toolkit/Procurement/material-procurement-tracker

Taken: the item data model (item id, description, required date, lead time in days, status, priority, vendor, PO number), the status enumeration (requisitioned, rfq_sent, quoted, po_issued, in_production, shipped, delivered), the priority words (critical, high, normal, low), the rule `must_order_by = required_date - lead_time_days`, the late-to-order rule (not yet ordered and past must_order_by) and the items-to-order window (not yet ordered and must_order_by within 14 days). Not taken: the tracker class with item creation, PO issue and status updates, the spreadsheet export, the status summary and counts, PO amounts, quantity, unit and spec section (outside the check). The method is the skill's; the code is an own tested helper. MIT notice kept in docs/third-party-notices.md.

## 2. Skill method in own words

1. An item starts as `requisitioned` and moves through the status flow requisitioned, rfq_sent, quoted, po_issued, in_production, shipped, delivered. Items carry a priority.
2. For each item: must order by = required date minus lead time.
3. An item is late to order when it has NOT reached po_issued (so requisitioned, rfq_sent or quoted) and today is after must_order_by. Items that are po_issued, in_production, shipped or delivered are never late.
4. "Items to order" lists the not-yet-ordered items whose must_order_by is on or before today + 14 days (this includes the late ones).
5. Other methods (not adopted): issue a PO (sets vendor, PO number, amount, expected delivery), update status (delivered stamps an actual delivery date), summary (counts by status, total PO value, counts of items to order and late), spreadsheet export.
6. Output of the skill: item list, items to order, late items, summary, export log.

## 3. Data model and rules

| Field | Type | Values / rule |
|---|---|---|
| item_id | text | copied |
| description | text | copied, no commas |
| priority | enum | critical, high, normal, low (copied) |
| status | enum | requisitioned, rfq_sent, quoted, po_issued, in_production, shipped, delivered |
| required_date | ISO date | on-site date; may be blank (then incomplete) |
| lead_time_days | integer >= 0 | CALENDAR days; may be blank (then incomplete) |
| vendor | text | blank = not given |
| po_number | text | blank = not given |
| must_order_by | ISO date | required_date minus lead_time_days; `-` when either is blank |
| days_to_order | integer | must_order_by minus as_of in days; negative = already past; `-` when must_order_by is `-` |
| status_class | enum | pre-po (requisitioned, rfq_sent, quoted), ordered (po_issued, in_production, shipped), delivered |
| late_flag | Y/N/- | Y: pre-po and as_of is after must_order_by (days_to_order < 0); `-` for a pre-po item whose must_order_by is `-`; N otherwise |
| soon_flag | Y/N/- | Y: pre-po and 0 <= days_to_order <= 14; `-` as late_flag; N otherwise |

## 4. Adapted to Finnish MEP sourcing

- Items are long-lead MEP equipment: ilmanvaihtokone, jäähdytyskone, pääkeskus, hissi, pumppu.
- Lead time is in CALENDAR days. The skill does not say calendar or working days (it subtracts `timedelta(days=...)`, which is calendar); recorded as an assumption, listed in the entry gaps.
- Dates are ISO text (YYYY-MM-DD). required_date is the on-site date.
- `as_of` is supplied in the input (a line `as_of: YYYY-MM-DD`); nothing reads a clock.
- The skill's 14-day window is kept; the 14 is a constant of the helper.

## 5. Deliberate differences (small-model design)

- The tested helper `src/lib/procurement/leadTime.ts` (CLI `scripts/procurement-lead-time.ts`) computes must_order_by, days_to_order, status_class, late_flag and soon_flag and writes them into the input as columns. The user (or harness) runs it before the agent; the agent never calculates a date.
- The model copies those columns, ticks two Y/N field checks (po_present, vendor_present) and reads the verdict off a lookup table. The skill's `lead_time_present` check is not a model tick: a blank lead time or required date shows up as `-` in the precomputed columns.
- One row per item in input order, 10 cells. No counts, no summary, no totals.
- Statuses and priorities are copied words; the model does not map free text.

## 6. Skill bugs and inconsistencies

Checked `ProcurementItem`, `MaterialProcurementTracker` and instructions.md.
1. `is_late_to_order`, `get_items_to_order`, `issue_po` (order_date) and `update_status` (actual_delivery) read `date.today()`. The same list gives different answers on different days and cannot be tested or reproduced. Helper: explicit `asOf` parameter, no clock, UTC date arithmetic only.
2. Window semantics: `get_items_to_order` uses `must_order_by <= today + 14`, so it includes the late items; late and to-order overlap and the "soon" population is not separable. Helper: late (days_to_order < 0) and soon (0 <= days_to_order <= 14) are disjoint; day 0 (must order today) is soon, not late (the skill's late test is a strict `>`); day 14 is soon (the skill's `<=`).
3. A required_date that has already passed is not special in the skill: a not-yet-ordered item is late because must_order_by is earlier still (lead time >= 0). Kept; the test covers it.
4. No validation: lead_time_days can be negative (must_order_by after the required date), a string date or a non-integer breaks the arithmetic with a generic exception. Helper: typed validation errors (bad-date, bad-lead-time, bad-status, bad-priority, bad-as-of, missing-field); CLI exit 2.
5. Blank lead time or required date cannot be represented (`int` and `date` are required); a blank is not "zero days". Helper: a typed incomplete marker (`-` columns), never NaN and never zero.
6. A PO status does not require vendor or PO number: `po_issued` with vendor `""` and po_number `""` passes unnoticed (the same default `""` cannot tell "none yet" from "blank"). Helper and lookup: an ordered or delivered item without po_number or vendor is order-data-incomplete.
7. `update_status` allows any change (delivered back to requisitioned) and the status is a free enum with no flow check. Not adopted (the agent reads one snapshot); recorded.
8. `expected_delivery` is stored but unused: a PO whose expected delivery is after required_date is not flagged. `priority` and `quantity` are stored but not used in any rule. Not adopted; recorded as gaps (no delivery-date risk check, priority is copied only).
9. `get_summary` counts statuses and sums `po_amount` where 0.0 means both "zero" and "unset". Not adopted (no counts or sums by the model; no amounts).
10. The skill does not say whether lead time is calendar or working days. Decision above: calendar.

## 7. Lookup table (verdict)

Keys are the copied `class`, `late_flag`, `soon_flag` and the two ticks. Evaluate top to bottom, first line that fits wins. Every combination appears once.

| class | late_flag | soon_flag | po_present AND vendor_present | verdict |
|---|---|---|---|---|
| pre-po | - | - | any | order-data-incomplete |
| pre-po | Y | N | any | order-now |
| pre-po | N | Y | any | order-soon |
| pre-po | N | N | any | ordered-ok |
| ordered | N | N | both Y | ordered-ok |
| ordered | N | N | at least one N | order-data-incomplete |
| delivered | N | N | both Y | ordered-ok |
| delivered | N | N | at least one N | order-data-incomplete |

(late Y with soon Y cannot occur: the flags are disjoint. For ordered and delivered items the helper always writes N and N.)

Verdict meanings: `ordered-ok` = nothing to order now. The status column shows whether the item is really ordered; a pre-po item that is still comfortably early (more than 14 days before must_order_by) gets ordered-ok by decision (no fifth verdict word). `order-now` = the order date has passed for a not-yet-ordered item. `order-soon` = the order date is within 14 days. `order-data-incomplete` = the lead time or required date is missing for a not-yet-ordered item, or an ordered/delivered item lacks po_number or vendor. The words are suggestions for the buyer to check; the agent never places or approves an order.

## 8. Answer key (synthetic sample, as_of 2026-03-02)

Computed by hand (calendar days; 2026 is not a leap year), then confirmed by the helper test.

| item_id | status | class | required_date | lead | vendor | po | must_order_by | days_to_order | late | soon | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| P-01 | po_issued | ordered | 2026-09-15 | 154 | yes | yes | 2026-04-14 | 43 | N | N | ordered-ok |
| P-02 | quoted | pre-po | 2026-06-01 | 120 | no | no | 2026-02-01 | -29 | Y | N | order-now |
| P-03 | rfq_sent | pre-po | 2026-05-15 | 70 | no | no | 2026-03-06 | 4 | N | Y | order-soon |
| P-04 | requisitioned | pre-po | 2026-12-01 | 180 | no | no | 2026-06-04 | 94 | N | N | ordered-ok |
| P-05 | quoted | pre-po | 2026-10-01 | blank | no | no | - | - | - | - | order-data-incomplete |
| P-06 | delivered | delivered | 2026-02-20 | 60 | yes | yes | 2025-12-22 | -70 | N | N | ordered-ok |
| P-07 | in_production | ordered | 2026-08-03 | 90 | yes | no | 2026-05-05 | 64 | N | N | order-data-incomplete |

Hand checks: P-01 2026-09-15 minus 154 days = 2026-04-14 (Sep 15 to Aug 31 is 15, to Jul 31 46, to Jun 30 77, to May 31 107, to Apr 30 138, then 16 more). Days 2026-03-02 to 2026-04-14 = 29 + 14 = 43. P-02 minus 120 days = 2026-02-01 (to May 31 is 1, Apr 30 32, Mar 31 62, Feb 28 93, then 27 more); days Feb 1 to Mar 2 = 29 before, so -29. P-03 minus 70 days = 2026-03-06; 4 days after as_of. P-04 minus 180 days = 2026-06-04; 94 days. P-06 minus 60 days = 2025-12-22; 70 days before as_of. P-07 minus 90 days = 2026-05-05; 64 days. P-06 is delivered, so its negative days_to_order does not make it late. P-07 is ordered but has no po_number, so it is incomplete.

Branches covered: ordered-ok ordered (P-01), order-now (P-02), order-soon (P-03), pre-po comfortably early (P-04, ordered-ok by the rule in section 7), incomplete because lead time is blank (P-05), delivered (P-06), incomplete because po_number is blank on an ordered item (P-07).

## 9. Rubric R1-R7 (written before the live run)

- R1: each item appears once, in input order, none dropped, none invented (7 rows).
- R2: the copied precomputed columns (must_order_by, days_to_order, late_flag, soon_flag) and class equal the input exactly in every row.
- R3: verdict equals the lookup for the copied class, flags and ticks (key in section 8).
- R4: the two incomplete items (P-05, P-07) are flagged order-data-incomplete; no value is invented for blank fields (P-05 shows `-` columns).
- R5: no model arithmetic: no recomputed date, day count, total or count.
- R6: no invented items, vendors, dates or amounts; no instruction to order, approve or place an order.
- R7: one result.md in the specified format (heading, one table, short list of items needing attention copied by id and verdict, the draft caveat as last line).
