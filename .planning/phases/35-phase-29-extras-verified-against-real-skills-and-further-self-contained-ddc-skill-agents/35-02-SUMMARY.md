# 35-02 Summary: agent 17 Procurement Lead Time Check

Skill: 1_DDC_Toolkit/Procurement/material-procurement-tracker (SKILL.md 181 lines and instructions.md 28 lines read in full; path verified with gh api). Label: built on (item data model, status and priority words, must order by = required date minus lead time, late-to-order rule, 14-day window are the skill's; code not copied). Spec docs/ddc-alignment/procurement-lead-time-check.md committed first, with 10 skill defects (date.today() in four places, overlapping late and to-order window, no validation, blank lead time unrepresentable, PO status without vendor or PO number, others), lookup table, hand-computed key (7 items, as_of 2026-03-02) and rubric R1-R7.

Helper: src/lib/procurement/leadTime.ts (explicit as_of, UTC calendar-day maths, typed errors, disjoint late/soon flags) with 32 tests written first; CLI scripts/procurement-lead-time.ts (exit 2 on validation error, compares a result.md cell by cell); consistency test scripts/ddc-alignment.procurement-lead-time-check.test.ts. Sample is the helper's own output (a test asserts this).

Bump list: set-try-it-out-mode (+ gaps test), golden (diff only the new entry), decoupling gate (slug added, clean), notices, inventory row 17, gaps G-115 to G-118, validate-entries agent_no range 1-20 (+ test now uses 21), entry template note.

Run: e32b588b-8f96-41ec-8ee1-88e5e0ff1f33, 7787 tokens, 2 requests, est. 0.0125 USD, SKILL v1, COUNTED (all 7 rows and attention list match key and helper). Fix-run total 0.6429 USD of 5. Stack down, no containers left. npm run check (alone): exit 0, 313 files, 3787 tests. No pushes.
