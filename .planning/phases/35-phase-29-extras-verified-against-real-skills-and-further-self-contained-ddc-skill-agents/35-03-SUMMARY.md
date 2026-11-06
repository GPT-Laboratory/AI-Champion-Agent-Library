# 35-03 Summary: agent 18 Material Delivery Check

Skill: 1_DDC_Toolkit/Cost-Management/material-delivery-tracker (SKILL.md 399 lines and instructions.md 28 lines read in full; path verified with gh api). Label: built on (delivery and item data model, status and priority words, ordered versus received quantity, completeness rule received >= ordered, scheduled versus actual date, delay reason are the skill's; code not copied; storage planning, tracking, vendor contact, on-time rate and export not adopted). Spec docs/ddc-alignment/material-delivery-check.md committed first, with 14 skill defects (date.today() in three places, status never checked against quantities or dates, late partial deliveries ignored, empty delivery counted as delivered, full receipt assumed, over-delivery invisible, no validation, others), lookup table, hand-computed key (7 lines, as_of 2026-03-02) and rubric R1-R7.

Helper: src/lib/delivery/deliveryCheck.ts (explicit as_of, UTC calendar-day maths, typed errors, conflict rules K1-K6) with 32 tests written first; CLI scripts/delivery-check.ts (exit 2 on validation error, compares a result.md cell by cell); consistency test scripts/ddc-alignment.material-delivery-check.test.ts (also checks SKILL worked rows against the helper). Sample is the helper's own output (a test asserts this).

Bump list: set-try-it-out-mode (+ gaps test), golden (diff only the new entry and the succeeded count), decoupling gate (slug added, clean), notices, inventory row 18, gaps G-119 to G-122, entry template note. validate-entries range 1-20 already covered 18.

Runs: 9902ee53-7e50-4386-88a9-1594dac3d758 (SKILL v1, 12966 tokens, 0.0207 USD, content right but table without pipes and separator row, R7 FAIL, not counted); ad96ec03-c272-46c7-a46b-9c0d6875870d (SKILL revision 1, 13343 tokens, 0.0213 USD, all 7 rows and attention list match key and helper, COUNTED). Fix-run total 0.6849 USD of 5. Stack down, no containers left.

npm run check (alone, stack down): exit 0, 315 test files passed, 3829 tests (a type error in the helper test found by tsc was fixed first). No pushes.
