# Alignment spec: agent 14 Punch list closure check

Source skills (untrusted data, read in full, SKILL.md and instructions.md of both, 2026-10-15), DDC skills repository (MIT, (c) 2026 DataDrivenConstruction). Paths verified with gh api (SKILL.md, instructions.md, claw.json present):
- `1_DDC_Toolkit/Field-Operations/punch-list-manager` (primary; 25 KB)
- `1_DDC_Toolkit/Project-Closeout/punch-list-manager` (14 KB)

They are NOT the same skill duplicated: same name, different content (see section 2). No book text, no CWICR data. Code not packaged or run. Both instructions.md are the generic wrapper and add no rules. Written before the agent files were changed.

## 1. Label

Label: inspired by 1_DDC_Toolkit/Field-Operations/punch-list-manager (+ 1_DDC_Toolkit/Project-Closeout/punch-list-manager)

The idea is the skill's: a punch item has a responsible party, a due date, a completion date and a verification step by a second person, and an item that is not done by its due date is overdue. The agent's statuses (open, closed), the closure rule (closed needs a closed date and a verifier) and the five verdicts are own design, and the check is made against a supplied as-of date instead of today. Method and rules are not the skill's, so this is "inspired by", not "built on".

## 2. What the skills contain

| | Field-Operations | Project-Closeout |
|---|---|---|
| Status enumeration | Open, Assigned, In Progress, Ready for Verification, Verified, Rejected, Accepted | open, in_progress, completed, verified, rejected |
| Priority | Critical, High, Medium, Low, Observation | critical, high, medium, low |
| Item fields | item_id, punch_list_id, description, location, building/floor/room, trade, priority, assigned_to, assigned/due date, photos before and after, status, completed_by/date/notes, verified_by/date/notes, back-charge (flag, amount, ref), history | item_id, location, description, category, priority, status, assigned_to, created/due/completed/verified date, verified_by, photos, notes |
| Rules | default due date by priority from today; mark_complete sets Ready for Verification; verify accepts or rejects; reject re-assigns with 3 days; overdue = Open, Assigned or In Progress with due date before today; completion rate = Accepted / total | default due by priority from today; completed then verified; reassign resets to open; overdue = due before today and status not verified or completed; completion rate = verified / total; forecast from verification rate |
| Outputs | trade report, dashboard, Excel, Telegram bot | summary, contractor report, forecast, Excel |

## 3. Taken versus own

| Item | Status | Note |
|---|---|---|
| responsible party, due date | taken (concept) | skill assigned_to / due_date; agent columns responsible, due |
| completion date plus verifier as the closure evidence | adapted | skill has completed_date, verified_by, verified_date as two steps; agent collapses to status closed with closed_date and verified_by |
| closed-unverified | own, derivable | the skill's completed-but-not-verified state; the agent derives it from missing closed_date or verified_by |
| overdue = not done and due before the as-of date | adapted | the skill uses today; the agent uses the as_of line and an ISO text comparison, no day counting |
| open / closed status words | own | skill uses a longer enumeration; other words become status-unknown |
| no-responsible, open-ok, closed-ok verdicts | own | |
| priority, trade, photos, back-charge, dashboard, completion rate, forecast | not adopted | |

## 4. Skill bugs and inconsistencies found

Field-Operations:
1. Overdue ignores `Rejected`: a rejected item gets a new due date (3 days) but stays Rejected and never shows as overdue; `Ready for Verification` items are never overdue even if verification is late.
2. `completion_rate` counts only Accepted; Verified (a status the skill defines and sets in no method) is excluded, while by-trade "open" excludes both. Verified is never produced.
3. `In Progress` is defined and used in the overdue filter but no method ever sets it.
4. Due dates and all dates use `date.today()`, so a past walk or a re-run gives different results; there is no as-of date.
5. `item_num = len(items) + 1` gives duplicate ids if an item is ever removed.
6. Item ids and list ids come from second-resolution timestamps and collide for two lists created in one second.

Project-Closeout:
7. `overdue` and `by_assignee` treat Completed as done, while `completion_rate` and `by_category` treat only Verified as done; the same item is overdue-exempt but still counted as open work.
8. `reassign_item` always sets status back to open, even for a verified or rejected item, and does not clear completed or verified dates.
9. `update_status(..., VERIFIED)` does not require the item to be Completed first.
10. `forecast_completion` rate = verified items / days between first and last verification, so one verified day gives rate 1 per day regardless of volume; `projected_completion` uses today.
11. `add_item` with a due date earlier than the created date is accepted without a check.

The agent avoids these by taking the as-of date from the input, deriving overdue only for open items, not producing counts, and reporting status text other than open or closed as status-unknown instead of guessing.

## 5. Light alignment decision

None. The skill's closure words are `completed` and `verified` (two steps) and `Ready for Verification`; mapping the agent's two-state `closed` onto them would need a third status and new rubric rows, and renaming `closed_date` to `completed_date` only changes a column label. Not adopted, recorded as own design: open/closed vocabulary, collapsed closure evidence. The placeholder closure rules stay explicit in the entry.

## 6. Impact on rerun

SKILL body changes: no for the label (footer wording only: "Ideas adapted from" becomes "Inspired by"); the footer-change rerun failed on the open-ok review cell and revision 1 (explicit review rule and a worked open-ok row) was needed, see 35-VERIFICATION.md. Sample changes: no. Rubric/key changes: no.
