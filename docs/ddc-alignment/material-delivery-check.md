# Alignment spec: agent 18 Material delivery check

Source skill (untrusted data, read in full, SKILL.md (399 lines) and instructions.md (28 lines), 2026-10-15), DDC skills repository (MIT, (c) 2026 DataDrivenConstruction): `1_DDC_Toolkit/Cost-Management/material-delivery-tracker`. Path verified with gh api (SKILL.md and instructions.md present). The skill's code is not packaged or run. instructions.md is the generic wrapper (gather input, process per SKILL.md, tables, constraints) and adds no rules. No book text (the skill only points to a book chapter), no CWICR data. Written before any agent file existed.

## 1. Source skill and label

Label: built on 1_DDC_Toolkit/Cost-Management/material-delivery-tracker

Taken: the delivery and item data model (PO number, vendor, scheduled date, actual date, priority, status, delay reason, item description, quantity ordered, quantity received, unit), the status words (scheduled, in_transit, delivered, partial, delayed, cancelled), the priority words (critical, high, normal, low), the completeness rule of `MaterialItem.is_complete` (received >= ordered), the rule of `receive_delivery` that a delivery with everything received is delivered and otherwise partial, and the rule of `get_delayed_deliveries` that a not-yet-received delivery whose scheduled date has passed is overdue. Not taken: the storage area class and its capacity fields, tracking number, carrier, vendor contact and phone, receiver, location, material category and spec section, the vendor search, the status counts and on-time delivery rate, the spreadsheet export and the 7-day upcoming list (outside the check). The method is the skill's; the code is an own tested helper. MIT notice kept in docs/third-party-notices.md.

## 2. Skill method in own words

1. A delivery is scheduled for a date with a priority, a status (starting at `scheduled`) and a list of items; each item has an ordered quantity and a received quantity (starting at 0).
2. `update_status` sets the status by hand (for example in_transit, delayed with a delay reason, tracking number, carrier).
3. `receive_delivery` stamps the actual date and the received quantities (or assumes full receipt when none are given). If every item is complete (received >= ordered) the status becomes delivered, otherwise partial.
4. `get_delayed_deliveries`: status scheduled, in_transit or delayed and scheduled date before today. `get_upcoming_deliveries`: status scheduled or in_transit and scheduled date on or before today + n days.
5. Other methods (not adopted): vendor search, summary (counts by status, priority, vendor, on-time rate), storage areas, Excel export.
6. Output of the skill: delivery records, upcoming list, delayed list, summary, export.

## 3. Data model and rules

One input line is one delivery line (one item of one delivery; the skill's delivery with several items is flattened, the PO number repeats). A Finnish delivery note (lähetyslista) line is the model.

| Field | Type | Values / rule |
|---|---|---|
| line_id | text | delivery note line id, copied |
| po_number | text | copied (may repeat across lines) |
| description | text | item, no commas, copied |
| priority | enum | critical, high, normal, low (copied) |
| status | enum | scheduled, in_transit, delivered, partial, delayed, cancelled |
| unit | text | copied (m, kpl, ...) |
| qty_ordered | number > 0 | point or comma decimal, parsed by the helper |
| qty_received | number >= 0 | may be blank (then incomplete) |
| scheduled_date | ISO date | may be blank (then incomplete) |
| actual_date | ISO date | blank = nothing received yet |
| delay_reason | text | blank = none given |
| balance | text | qty_ordered minus qty_received as a number, a space and the unit (`120 m`, `0 kpl`, `-2 kpl` for over-delivery); `-` when a quantity is blank |
| balance_flag | enum | `complete` (received = ordered), `short` (received < ordered), `over` (received > ordered); `-` when a quantity is blank |
| days_late | integer or `-` | see below, never negative |
| late_flag | Y/N/- | Y when days_late > 0; `-` when days_late is `-` |
| conflict | Y/N | Y when status and quantities or dates contradict each other (rules K1-K6 below) |

days_late reference day: for a `short` line the outstanding quantity is measured at as_of (`as_of` minus scheduled_date), for a `complete` or `over` line it is the day the goods arrived (actual_date minus scheduled_date; as_of when actual_date is blank). A negative difference is written as 0 (the line is early or not yet due). The helper writes `-` for days_late and late_flag when scheduled_date is blank, when status is cancelled (not judged), or when the balance is unknown (qty_received blank).

Conflict rules (checked only where the inputs exist): K1 status delivered and balance short; K2 status partial and (balance not short or qty_received is 0); K3 status delivered or partial and actual_date blank; K4 status scheduled, in_transit or delayed and (qty_received > 0 or actual_date present); K5 status cancelled and qty_received > 0; K6 actual_date later than as_of.

## 4. Adapted to Finnish MEP site delivery

- Deliveries of ducts (spiraalikanava), pipes, cable trays (kaapelihylly), pumps, AHUs (ilmanvaihtokone), dampers to a site, quantities with units copied exactly (m, kpl), ISO dates, `as_of` supplied in the input (`as_of: YYYY-MM-DD`); nothing reads a clock.
- Days are CALENDAR days (the skill subtracts dates; no working-day calendar).
- Storage capacity (StorageArea) is not adopted: the check reads delivery lines, and a text list has no site layout, laydown area or capacity figures; invented figures would be fake precision. Tracking numbers, carrier and vendor contact logic are not adopted either (no vendor contact is looked up, none is invented, nobody is told to chase a vendor).

## 5. Deliberate differences (small-model design)

- The tested helper `src/lib/delivery/deliveryCheck.ts` (CLI `scripts/delivery-check.ts`) computes balance, balance_flag, days_late, late_flag and conflict and writes them into the input as the last five columns. The user (or harness) runs it before the agent; the agent never calculates a quantity or a date.
- The model copies the columns, ticks one Y/N field check (`reason_present`: the delay_reason field has text) and reads the verdict off a lookup table.
- One row per delivery line in input order, 9 cells. No counts, no totals, no summary.
- Statuses and priorities are copied words; the model does not map free text.
- Whether a status word fits the quantities is decided by the helper (`conflict`), not by the model.

## 6. Skill bugs and inconsistencies

Checked `MaterialItem`, `Delivery`, `StorageArea`, `MaterialDeliveryTracker` and instructions.md.
1. `get_upcoming_deliveries`, `get_delayed_deliveries` and the default actual date in `receive_delivery` read `date.today()`: the same list gives different answers on different days and cannot be tested; a receipt silently gets the day it was typed in as its arrival date. Helper: explicit `asOf`, no clock, UTC date arithmetic only.
2. Status is set by hand and never derived from data: `delayed` is never set by any date rule and `update_status` accepts any status for any quantities, so `delivered` with received < ordered, or `scheduled` with goods already received, passes unnoticed. `receive_delivery` derives delivered/partial from quantities only at the moment of receipt. Helper: `conflict` (K1-K5) shows the contradiction; the verdict for such a line is data-incomplete.
3. `get_delayed_deliveries` ignores `partial` deliveries: a delivery with 60 percent received and the rest weeks overdue is not reported late. Helper: for a short line days_late is measured at as_of whatever the status (partial included).
4. A delivery with no items passes `all(item.is_complete ...)` (empty list is True) and becomes `delivered` with nothing received. The flat line format has no empty delivery; a line with blank qty_received is incomplete, never complete.
5. `receive_delivery` without quantities assumes FULL receipt for every item, and a quantities dict that lacks an item silently leaves its old value. Helper: blank received is `-`, never 0 and never full.
6. `receive_delivery` overwrites received quantities instead of adding to them (a second partial receipt replaces the first); the model has one snapshot (qty_received is the running total), recorded.
7. Over-delivery: `is_complete` is `>=`, so an over-delivery is complete and nothing shows the excess. Helper: balance_flag `over` with a negative balance; verdict received-complete by the skill's rule, the excess stays visible in the balance column.
8. No validation: negative quantities, non-numeric quantities, `scheduled_date` as text, empty delivery id; a string breaks the arithmetic with a generic exception. Helper: typed errors (bad-date, bad-as-of, bad-quantity, bad-status, bad-priority, missing-field); CLI exit 2. Blank is not zero.
9. `get_summary` on-time rate: only `delivered` lines count and the rate is 0 when none are delivered (the same 0 as "all late"); a delivery completed late through partial receipts is not distinguished. Not adopted (no rates, no counts).
10. A `cancelled` delivery is excluded from upcoming and delayed but counts in the summary; it can still hold received quantities. Helper: cancelled lines are not judged (late columns `-`), received > 0 on a cancelled line is a conflict (K5).
11. `get_deliveries_by_vendor` is a substring match (vendor "ABC" also finds "ABC Steel" and "XABCY"). Not adopted.
12. `StorageArea.current_usage_sqm` is stored but never updated by any method and no method checks capacity against deliveries; `Delivery.storage_area` is a free string not tied to `storage_areas`. Not adopted (see section 4).
13. `to_dict` drops delay_reason, quantities and the PO items; `item_id` generation `len(items)+1` is fine. Not adopted.
14. The skill does not say calendar or working days: calendar chosen.

## 7. Lookup table (verdict)

Inputs are the copied `status`, `balance_flag`, `late_flag`, `conflict` and the model's tick `reason_present`. Evaluate top to bottom, first line that fits wins. Every combination of the keys appears once.

| # | balance_flag or late_flag is `-` | conflict | balance_flag | late_flag | status | reason_present | verdict |
|---|---|---|---|---|---|---|---|
| 1 | yes (either one) | any | any | any | any | any | data-incomplete |
| 2 | no | Y | any | any | any | any | data-incomplete |
| 3 | no | N | complete or over | any | any | any | received-complete |
| 4 | no | N | short | Y | any | Y | late |
| 5 | no | N | short | Y | any | N | late-no-reason |
| 6 | no | N | short | N | partial | any | partial |
| 7 | no | N | short | N | not partial | any | not-yet-due |

Verdict meanings: `received-complete` = received at least the ordered quantity and the record is consistent (arrived late or on time is shown by days_late; an `over` balance stays visible in the balance column). `partial` = part of the quantity is received, the rest is not yet due. `late` = the outstanding quantity is past its scheduled date and a reason is on record. `late-no-reason` = past its date with no reason on record. `not-yet-due` = nothing or part of it outstanding but the date has not passed. `data-incomplete` = a needed field is blank, the line is cancelled, or the status contradicts the quantities or dates (the engineer checks the record). The words are drafts for the site manager to check; the agent does not accept, reject or chase a delivery. A cancelled line gets data-incomplete by decision (no extra verdict word): it is not judged.

## 8. Answer key (synthetic sample, as_of 2026-03-02)

Computed by hand (calendar days; 2026 is not a leap year), then confirmed by the helper test.

| line_id | status | qty ordered / received | scheduled | actual | reason | balance | balance_flag | days_late | late_flag | conflict | reason_present | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| D-01 | delivered | 120 / 120 m | 2026-02-24 | 2026-02-24 | none | 0 m | complete | 0 | N | N | N | received-complete |
| D-02 | partial | 300 / 180 m | 2026-03-05 | 2026-02-27 | none | 120 m | short | 0 | N | N | N | partial |
| D-03 | delayed | 2 / 0 kpl | 2026-02-20 | blank | Tehdasviive | 2 kpl | short | 10 | Y | N | Y | late |
| D-04 | in_transit | 200 / 0 m | 2026-02-27 | blank | none | 200 m | short | 3 | Y | N | N | late-no-reason |
| D-05 | scheduled | 1 / 0 kpl | 2026-03-16 | blank | none | 1 kpl | short | 0 | N | N | N | not-yet-due |
| D-06 | delivered | 10 / 8 kpl | 2026-02-26 | 2026-02-26 | none | 2 kpl | short | 4 | Y | Y | N | data-incomplete |
| D-07 | in_transit | 80 / 0 m | blank | blank | none | 80 m | short | - | - | N | N | data-incomplete |

Hand checks: D-01 120 minus 120 is 0; arrival day equals scheduled day, 0 days late. D-02 300 minus 180 is 120; the line is short so the reference is as_of: 2026-03-02 minus 2026-03-05 is -3, written as 0; first receipt on 2026-02-27 is not used. D-03 as_of minus 2026-02-20: February has 28 days, so 8 days to Feb 28 plus 2 is 10. D-04 2026-02-27 to 2026-03-02: 1 plus 2 is 3. D-05 scheduled is 14 days after as_of, so 0 and N. D-06 10 minus 8 is 2, short, so reference is as_of: 2026-02-26 to 2026-03-02 is 2 plus 2 is 4, late Y; delivered with a short balance is conflict K1, so data-incomplete by row 2 although it is also late. D-07 has no scheduled date, so days_late and late_flag are `-` and row 1 applies.

Branches covered: received-complete (D-01), partial (D-02), late with reason (D-03), late-no-reason (D-04), not-yet-due (D-05), data-incomplete through a status/quantity conflict (D-06), data-incomplete through a blank field (D-07). Over-delivery, cancelled and a missing received quantity are covered by helper tests and worked rows in SKILL.md, not by the live sample.

## 9. Rubric R1-R7 (written before the live run)

- R1: each delivery line appears once, in input order, none dropped, none invented (7 rows).
- R2: the copied helper columns (balance, balance_flag, days_late, late_flag, conflict) and status equal the input exactly in every row.
- R3: verdict equals the lookup for the copied columns and the reason_present tick (key in section 8); reason_present equals Y exactly when the line has delay_reason text (D-03 only).
- R4: D-06 (conflict) and D-07 (`-` columns) are data-incomplete; no value is invented or filled in for blank fields (D-07 shows `-` cells).
- R5: no model arithmetic: no recomputed quantity balance, date, day count, total or count.
- R6: no invented lines, vendors, dates, quantities or reasons; no instruction to accept, reject, return or chase a delivery or to contact a vendor.
- R7: one result.md in the specified format (heading, as_of line, one table, short list of lines needing attention copied by id and verdict, the draft caveat as last line).
