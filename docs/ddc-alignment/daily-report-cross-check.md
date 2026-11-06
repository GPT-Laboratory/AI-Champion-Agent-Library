# Alignment spec: agent 13 Daily report cross check

Source skills (untrusted data, read in full, SKILL.md and instructions.md of both, 2026-10-15), DDC skills repository (MIT, (c) 2026 DataDrivenConstruction). Paths verified with gh api (SKILL.md, instructions.md and claw.json present):
- `1_DDC_Toolkit/Field-Operations/daily-report-generator`
- `3_DDC_Insights/Automation-Workflows/n8n-daily-report`

No book text, no CWICR data. The skills' code is not packaged or run. Both instructions.md files are the generic wrapper (gather input, process per SKILL.md, tables, constraints) and add no rules. Written before the agent files were changed.

## 1. Label

Label: loosely related to 1_DDC_Toolkit/Field-Operations/daily-report-generator (+ 3_DDC_Insights/Automation-Workflows/n8n-daily-report)

Both skills GENERATE a daily report (weather, workforce table, work done and planned, issues, safety, photos, PDF, distribution) from a timesheet, a task sheet and a weather API. Neither reconciles a report against a timesheet. The only overlap with this agent is the topic and two column ideas (trade, hours). The method (line-by-line verdict by exact-text lookup of the timesheet line) is own design. Phase 29 said "adapted from"; that overstated it.

## 2. What the skills contain

| Skill | Data model and rules | Outputs |
|---|---|---|
| daily-report-generator | Timesheet columns trade, worker_name, hours_worked, planned_hours; per trade it counts rows (actual workers), sums hours, derives planned count as planned_hours / 8; task table (date, trade, description, status Completed / Partial, notes); issue log (category, description, impact, resolution_date, status Open); safety log (Incident, Near Miss, Toolbox Talk, Observation) | PDF report with weather, workforce table (planned, actual, hours, total), work completed, work planned, issues, safety, signature block; n8n schedule, Telegram and e-mail distribution |
| n8n-daily-report | n8n nodes: schedule and webhook trigger, weather and photo HTTP calls, labour sheet (trade, company, workers, hours, activities), a code node that totals workers and hours | PDF through a PDF service, e-mail and SharePoint upload |

Neither has a timesheet-versus-report comparison, a mismatch status or a delay-reason check.

## 3. Taken versus own

| Item | Status | Note |
|---|---|---|
| trade, hours as report and timesheet fields | taken (field idea) | skill timesheet has trade and hours_worked per worker; the agent compares per-trade lines (workers, hours) |
| worker count | adapted | skill derives actual count by counting worker rows; the agent reads a workers column as text |
| delay hours and reason | own | the skill has an issue log (category, impact, resolution date), not delay hours with a reason |
| verdicts consistent / mismatch / delay-unexplained / not-in-timesheet | own | |
| exact-text date and trade match, identical-text number test | own | no arithmetic by the model |
| weather, photos, PDF, distribution, work completed and planned, safety | not adopted | outside the check |

## 4. Skill bugs and inconsistencies found

Checked `DailyReportGenerator` and the n8n code node.
1. `report_date` defaults to `date.today()`; the report date is not an input, so a re-run next day changes the report. The agent takes the date from each report line.
2. `planned_count = planned_hours / 8` truncated with `astype(int)`: 12 planned hours gives 1 worker. Not used.
3. The workforce count is the number of timesheet rows, so a worker with two rows counts twice; hours are summed with no per-worker cap. Not used (no counts or sums).
4. Dates are compared as `%d.%m.%Y` strings against the task sheet; a sheet stored as dates or ISO text never matches and the report silently shows no work. The agent states the date format by exact text and says NONE when no line matches.
5. `get_issues` selects Open OR reported today with an OR, so closed issues reported today appear as active. Not used.
6. In `generate_daily_report` the safety block is hard-coded (0 incidents, toolbox talk "Fall Protection") and `issues` is `[]`; the generated report says "No incidents" regardless of data. Not used; the agent never claims a safety state.
7. The n8n code node reads `items[2].json` as the labour array and calls `.reduce` on it; one n8n item holds one row, so the totals are wrong for more than one trade. The temperature conversion subtracts 273.15 but the request sets no units, which is right only by accident. Not used.
8. The n8n sheet column is `workers` but the Python helper formats it from `worker_count`/`total_hours`; the two skills disagree on names. Not used.

The agent avoids all of these by taking no date from the clock, no counts and no sums.

## 5. Light alignment decision

None. The skill's timesheet is per worker (`worker_name`, `hours_worked`), the agent's timesheet extract is per trade and date; renaming `hours` to `hours_worked` would be a cosmetic change that does not make the data model the skill's. Not adopted: skill column names, per-worker rows, planned versus actual.

## 6. Impact on rerun

SKILL body changes: no (footer wording only: "Ideas adapted from" becomes "Loosely related to"). Sample changes: no. Rubric/key changes: no (Phase 29 key and R1-R7 stay valid). One footer-change rerun on the existing sample, as in Phase 34.
