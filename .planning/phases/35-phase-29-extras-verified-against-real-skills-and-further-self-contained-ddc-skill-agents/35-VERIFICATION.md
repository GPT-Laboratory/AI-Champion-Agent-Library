---
phase: 35
status: human_needed
---

# Phase 35 Verification

All outputs are drafts for engineer review. Inputs are synthetic only. Harness, procedure and ledger as in Phases 25-34: Option A (compose stack, internal network `aic-pi-internal`, image `localhost/aic-agent-library:tryitout`, catalog and prompts bind-mounted), `scripts/tryout-run.ts`, model gpt-4.1-mini in the Pi container, ledger `.planning/spend-log.md` (rows after the fix-run marker). Specs: docs/ddc-alignment/<slug>.md, written from full reads of the real DDC skills before any entry changed.

## Summary: agents 13-20

| Agent | Label | Result | Jobs (tokens, est. cost USD) | Revisions |
|---|---|---|---|---|
| 13 Daily Report Cross Check (35-01) | loosely related to daily-report-generator (+ n8n-daily-report) | COUNTED (relabel rerun) | 33c64dfb (13506, 0.0216) counted | 0 |
| 14 Punch List Closure Check (35-01) | inspired by punch-list-manager Field-Operations (+ Project-Closeout) | COUNTED after revision 1 | d9a413e5 (13236, 0.0212) not counted; edc60b32 (12817, 0.0205) counted | 1 |
| 15 Change Order Consistency Check (35-01) | inspired by change-order-processor | COUNTED (relabel rerun) | bb72743d (13804, 0.0221) counted | 0 |
| 16 Safety Observation Classification (35-01) | loosely related to safety-inspection (+ safety-inspection-checklist) | COUNTED with one noted tick deviation | a121094f (11217, 0.0179) counted | 0 |
| 17 Procurement Lead Time Check (35-02, new) | built on material-procurement-tracker | COUNTED | e32b588b (7787, 0.0125) counted | 0 |
| 18 Material Delivery Check (35-03, new) | built on material-delivery-tracker | COUNTED after revision 1 | 9902ee53 (12966, 0.0207) not counted; ad96ec03 (13343, 0.0213) counted | 1 |
| 19 QC Inspection Record Check (35-04, new) | built on quality-control-workflow | COUNTED after revision 1 | f9f76250 (11989, 0.0192) not counted; 174d6166 (12418, 0.0199) counted | 1 |
| 20 Warranty Register Check (35-05, new) | built on warranty-tracker | COUNTED after revision 1 | 3dcb94e7 (8558, 0.0137) not counted; 01156eba (8863, 0.0142) counted | 1 |

Agents 13-16 were not changed beyond label, attribution and notes (relabel reruns on the old samples). No agent is ATTEMPTED-NOT-COUNTED; no scope-shrink retry was needed; no agent used more than 1 of the 2 allowed revisions. 12 runs in total, 8 counted, 4 not counted (each failed one rubric point; the reason is in the per-plan sections).

Spend: phase 35 (ledger rows of plans 35-01 to 35-05) 0.2248 USD; fix-run total after the marker 0.7519 USD of 5 USD (34 rows). No run above 0.50 USD (largest 0.0221). Costs are an upper bound; the OpenAI dashboard is ground truth.

Scope checklist against 35-CONTEXT.md:
- [x] Each Phase 29 extra (13-16) read against the real skill in full, paths verified with gh api (35-01; change-order-manager and change-order-analysis also read)
- [x] Labels per entry honest (built on / inspired by / loosely related to) and github_url set, identical in entry, notices, inventory and spec (label test scripts/ddc-labels.extras.test.ts)
- [x] docs/ddc-alignment/<slug>.md for agents 13-20, specs written before the entries, key and rubric before the runs
- [x] Live rerun for each changed entry (13-16, all counted)
- [x] Four new agents chosen after reading the skills, rejected candidates recorded with reasons (docs/ddc-agent-candidates.md), each built to the done bar: spec first, skill defects fixed in tested helpers (17, 18, 20; 19 by decision without helper), complete entry, labelled synthetic sample, key and rubric R1-R7, tests, golden, one counted live run
- [x] docs/ddc-agent-candidates.md updated: built agents with exact paths, relabel results of 13-16, remaining candidates with reasons
- [x] scripts/check-ddc-decoupling.sh clean, lists all 20 slugs and scans the alignment docs; no MCP, LVI, STK, Prysmian or Rakennustieto text in the agent files
- [x] Arithmetic only in helpers (dates and quantities); the model copies and looks up
- [ ] Human UAT items pending (see 35-HUMAN-UAT.md, one item per agent 13-20)

npm run check (run alone, stack down, no Podman, `free -m` 1.9 GB available), plan 35-06: exit 0, 318 test files passed and 1 skipped, 3867 tests passed and 1 skipped (319 files, 3868 tests), once, no rerun needed. `bash scripts/check-ddc-decoupling.sh`: `ddc-decoupling: clean`.

Status human_needed: the eight UAT items are pending for Ville / engineers.

## Plan 35-01: Phase 29 extras verified against the real skills

Label test: scripts/ddc-labels.extras.test.ts (written first, 18 of 26 failed, then green). check-ddc-decoupling.sh now also scans docs/ddc-alignment/<slug>.md and is clean (one existing hit fixed: the Finnish abbreviation for HVAC in docs/ddc-alignment/quote-comparison.md, reworded). Golden regenerated: diff limited to the four entries. Light alignment: none adopted for any agent (reasons in each spec section on alignment); SKILL bodies unchanged except footer wording and, for agent 14, revision 1. Phase 29 answer keys and rubric R1-R7 stay valid (no sample or column change).

Findings of the full reads (details in the specs):
- 13: the DDC skills generate reports from timesheets; none reconciles a report against a timesheet. Label downgraded from "adapted" to "loosely related".
- 14: the two punch-list-manager skills are different (7 statuses and back-charges versus 5 statuses and a forecast), not duplicates. Idea shared (assignee, due date, completion plus verification, overdue); rules own design. "inspired by".
- 15: processor shares the approval fields and status idea; no log-versus-form check in any of the three change-order skills. change-order-analysis (ML prediction) is not closer. The Phase 29 claim that change-order-manager was left out because of a "third-party source licence" is not supported by NOTICE.md (section 4 names sources none of which this skill cites); the claim was dropped and the skill recorded as read, not the basis.
- 16: both safety skills are checklist inspections; neither classifies free-text observations. Keyword lookup is own design. "loosely related".

### Agent 13 (plan 35-01)
COUNTED (SKILL v1, footer wording only; rubric R1-R7 met). Job 33c64dfb-3141-4d03-9026-60768d5399cc, gpt-4.1-mini, 13506 tokens, 3 requests, est. 0.0216 USD, label synthetic, usage observed (countable true), no direct-call fallback.
- Key vs result: D-01 consistent, D-02 consistent, D-03 mismatch (workers differ 5 vs 6), D-04 mismatch (hours differ 48 vs 44), D-05 delay-unexplained, D-06 not-in-timesheet (NONE): all six match.
- R1 pass (6 check lines and 6 rows in order, 8 cells); R2 pass (timesheet lines verbatim); R3 pass; R4 pass (review NO only D-01, D-02); R5 pass (no row for the crane line; open items D-03 to D-06); R6 pass; R7 pass. Minor: the open-item reasons are shortened ("workers differ" without the numbers), still one clause.
- Excerpt:
  ```
  D-03 | 2026-03-02 | plumbing | 5 workers, 40 h | 2026-03-02,plumbing,6,40 | mismatch | YES | workers differ 5 vs 6
  D-04 | 2026-03-02 | concrete | 6 workers, 48 h | 2026-03-02,concrete,6,44 | mismatch | YES | hours differ 48 vs 44
  D-05 | 2026-03-02 | hvac | 3 workers, 24 h | 2026-03-02,hvac,3,24 | delay-unexplained | YES | delay hours given, no reason
  D-06 | 2026-03-02 | scaffolding | 2 workers, 16 h | NONE | not-in-timesheet | YES | not in timesheet
  Draft for site manager review. Verdicts come only from the supplied report lines and timesheet extract.
  ```
- Ledger: one 35-01 row.

### Agent 14 (plan 35-01)
COUNTED (SKILL revision 1, second run).
- Run 1: job d9a413e5-2735-4565-8881-fde7aea749fa, SKILL v1 (footer wording), 13236 tokens, est. 0.0212 USD. FAIL (R4/R5): all six verdicts right, but P-04 (open-ok) got review YES and was listed in the open items with note `-`. Not counted. Fix (revision 1): the review rule states that BOTH closed-ok and open-ok are NO, a worked row for open-ok, and the open-items rule excludes closed-ok and open-ok rows.
- Run 2 (counted): job edc60b32-c8c2-4e21-b276-5b542005f717, SKILL revision 1, 12817 tokens, 3 requests, est. 0.0205 USD, label synthetic, countable true. No scope-shrink retry.
- Key vs result: P-01 closed-ok, P-02 closed-unverified (verified_by missing), P-03 overdue (due 2026-04-10 before as_of 2026-05-01), P-04 open-ok (NO), P-05 no-responsible, P-06 closed-unverified (closed_date missing): all six match; open items P-02, P-03, P-05, P-06.
- R1 to R7 pass.
- Excerpt:
  ```
  P-03 | Level 2 office | Carpenter Oy | 2026-04-10 | open | overdue | YES | due 2026-04-10 before as_of 2026-05-01
  P-04 | Level 2 roof | Roof Oy | 2026-05-20 | open | open-ok | NO | -
  P-06 | Level 3 stair | Electric Oy | 2026-04-30 | closed | closed-unverified | YES | closed_date missing
  Draft for engineer review. Verdicts come only from the supplied punch list and as_of date using placeholder closure rules.
  ```
- Ledger: two 35-01 rows. The revision is a regression-type fix of a rule the Phase 29 SKILL already held; the Phase 29 counted run passed it, so the model is not fully stable on the open-ok review cell (note for UAT).

### Agent 15 (plan 35-01)
COUNTED (SKILL v1, footer wording only). Job bb72743d-0d97-4d53-9a2c-d01f5f5ecc8c, 13804 tokens, 3 requests, est. 0.0221 USD, label synthetic, countable true.
- Key vs result: CO-01 consistent, CO-02 amount-mismatch (amount differs 8400 vs 8040), CO-03 approval-incomplete (approved_by missing), CO-04 consistent (pending, unsigned form), CO-05 amount-mismatch (currency differs EUR vs SEK), CO-06 no-form (CO-60 not used): all six match; R1 to R7 pass.
- Excerpt:
  ```
  CO-02 | Revised duct routing | 8400 EUR | CO-02,8040,EUR,2,yes | amount-mismatch | YES | amount differs 8400 vs 8040
  CO-05 | Extra cable tray | 3000 EUR | CO-05,3000,SEK,0,yes | amount-mismatch | YES | currency differs EUR vs SEK
  CO-06 | Relocated riser | 7100 EUR | NONE | no-form | YES | no form line
  Draft for reviewer. Verdicts come only from the supplied log and forms; no pricing or contract assessment was made.
  ```
- Ledger: one 35-01 row.

### Agent 16 (plan 35-01)
COUNTED with a noted deviation (SKILL v1, footer wording only). Job a121094f-f826-4952-9e5c-d657e718fb61, 11217 tokens, 3 requests, est. 0.0179 USD, label synthetic, countable true. The category table of the sample is an invented placeholder, not a safety standard.
- Key vs result: S-01 fall-protection/high matched, S-02 electrical/high multi-match (also matches wet (housekeeping)), S-03 housekeeping/low matched, S-04 UNCLASSIFIED no-match, S-05 ppe/medium matched, S-06 excavation/high matched: all six table rows and review flags match; open items S-01, S-02, S-04, S-06.
- Deviation: in the check line of S-02 the model wrote `high=N` although sev is `high` (the Phase 29 run wrote `high=Y`). No table cell or open item is affected (multi-match forces review YES), so the rubric rows R1 to R7 are met; recorded, not rerun.
- Excerpt:
  ```
  S-02 | Level 1 plant room | electrical | high | cord | multi-match | YES | also matches wet (housekeeping)
  S-04 | Yard | UNCLASSIFIED | NONE | NONE | no-match | YES | -
  S-05 | Gate | ppe | medium | hard hat | matched | NO | -
  Draft for safety officer review. Categories and severity hints come only from the supplied placeholder table; no safety assessment was made.
  ```
- Ledger: one 35-01 row.

Teardown: `podman-compose ... down`, `podman ps -a --filter label=aic.tryitout -q` empty, no containers left. Spend plan 35-01: 0.1033 USD (5 runs); fix-run total 0.6304 USD of 5 USD.

## Agent 17 Procurement lead time (plan 35-02)

Label: built on 1_DDC_Toolkit/Procurement/material-procurement-tracker (spec docs/ddc-alignment/procurement-lead-time-check.md, committed before any agent file; key and rubric R1-R7 written before the run). Helper: src/lib/procurement/leadTime.ts (32 unit tests written first; boundaries day 0 and day 14, leap day, year boundary, typed errors, disjoint flags, explicit as_of), CLI scripts/procurement-lead-time.ts (exit 2 on validation errors; compares a result.md cell by cell). Skill defects fixed in the helper: date.today() in four places, overlapping late and to-order window, no validation, blank lead time unrepresentable, PO status without vendor or PO number accepted (10 items in the spec, section 6). Entry limit: validate-entries agent_no range raised from 16 to 20.

COUNTED (SKILL v1). Job e32b588b-8f96-41ec-8ee1-88e5e0ff1f33, gpt-4.1-mini, 7787 tokens, 2 requests, est. 0.0125 USD, label synthetic, countable true, usage observed, Option A (compose stack, tagged image), no direct-call fallback.
- Key vs result: P-01 ordered-ok, P-02 order-now (-29 days), P-03 order-soon (4 days), P-04 ordered-ok (pre-po, 94 days), P-05 order-data-incomplete (blank lead time, all `-`), P-06 ordered-ok (delivered, -70 days not late), P-07 order-data-incomplete (no PO number). All 7 rows match the key; `npx tsx scripts/procurement-lead-time.ts <sample> <result>` reports "result table matches the helper on every cell". Attention list P-02, P-03, P-05, P-07 as required. R1 to R7 pass: no recomputed dates, no invented values, no ordering instruction.
- Excerpt:
  ```
  ## Lead time check
  as_of: 2026-03-02
  | P-01 | po_issued | ordered | 2026-04-14 | 43 | N | N | Y | Y | ordered-ok |
  | P-02 | quoted | pre-po | 2026-02-01 | -29 | Y | N | N | N | order-now |
  | P-03 | rfq_sent | pre-po | 2026-03-06 | 4 | N | Y | N | N | order-soon |
  | P-05 | quoted | pre-po | - | - | - | - | N | N | order-data-incomplete |
  | P-07 | in_production | ordered | 2026-05-05 | 64 | N | N | N | Y | order-data-incomplete |
  ## Items needing attention
  P-02: order-now / P-03: order-soon / P-05: order-data-incomplete / P-07: order-data-incomplete
  Draft for engineer review. Synthetic input; dates were calculated by a tool, not by this agent, and no order was placed or approved.
  ```
- Caveat: the input already contains the helper's columns (the user must run the helper first); the pre-po comfortably early item gets ordered-ok by the spec rule (status column shows it is not ordered).
- Ledger: one 35-02 row. Spend plan 35-02: 0.0125 USD (1 run); fix-run total 0.6429 USD of 5 USD. Teardown: `podman-compose ... down`, `podman ps -a --filter label=aic.tryitout -q` empty.

## Agent 18 Material delivery (plan 35-03)

Label: built on 1_DDC_Toolkit/Cost-Management/material-delivery-tracker (spec docs/ddc-alignment/material-delivery-check.md, committed before any agent file; key and rubric R1-R7 written before the runs; SKILL.md 399 lines and instructions.md 28 lines read in full). Helper: src/lib/delivery/deliveryCheck.ts (32 unit tests written first: quantity balance and complete/short/over per the skill's received >= ordered, point and comma decimals, days late from an explicit as_of with month, year and leap-day boundaries, never negative, conflict rules K1-K6, typed errors, verdict lookup rows 1-7, key sample), CLI scripts/delivery-check.ts (exit 2 on validation errors; compares a result.md cell by cell). Skill defects fixed in the helper (14 items in spec section 6): date.today() in three places, status never checked against quantities or dates (delivered with received < ordered accepted), late partial deliveries ignored by get_delayed_deliveries, empty delivery counted as delivered, receive_delivery assuming full receipt and overwriting totals, over-delivery invisible, no validation, cancelled lines with goods. Not adopted: storage capacity, tracking, vendor contact, on-time rate, export. No validate-entries range change needed (agent_no 18 <= 20).

COUNTED on run 2 (SKILL revision 1). Option A (compose stack, tagged image), usage observed, countable true, no direct-call fallback, synthetic label.
- Run 1: job 9902ee53-7e50-4386-88a9-1594dac3d758, gpt-4.1-mini, 12966 tokens, 3 requests, est. 0.0207 USD, SKILL v1. All 7 rows, copied cells, ticks, verdicts and the attention list matched the key, but the table had no leading pipes and no separator row, so it is not a markdown table and the CLI comparison could not parse it: R7 FAIL. Not counted. Revision 1: SKILL.md now shows the header and separator row verbatim.
- Run 2: job ad96ec03-c272-46c7-a46b-9c0d6875870d, gpt-4.1-mini, 13343 tokens, 3 requests, est. 0.0213 USD, SKILL v2 (revision 1). Key vs result: D-01 received-complete, D-02 partial (120 m, first-receipt date not used), D-03 late (10 days, reason Y), D-04 late-no-reason (3 days), D-05 not-yet-due, D-06 data-incomplete (conflict Y although late), D-07 data-incomplete (days_late and late_flag are `-`). All 7 rows match the key; `npx tsx scripts/delivery-check.ts <sample> <result>` reports "result table matches the helper on every cell". Attention list D-02 to D-07 as required. R1 to R7 pass: no recomputed quantities or dates, no invented values, no accept/reject/chase instruction. Minor: no blank line between the as_of line and the table.
- Excerpt:
  ```
  ## Delivery check
  as_of: 2026-03-02
  | line_id | status | balance | balance_flag | days_late | late_flag | conflict | reason_present | verdict |
  |---|---|---|---|---|---|---|---|---|
  | D-02 | partial | 120 m | short | 0 | N | N | N | partial |
  | D-03 | delayed | 2 kpl | short | 10 | Y | N | Y | late |
  | D-04 | in_transit | 200 m | short | 3 | Y | N | N | late-no-reason |
  | D-06 | delivered | 2 kpl | short | 4 | Y | Y | N | data-incomplete |
  | D-07 | in_transit | 80 m | short | - | - | N | N | data-incomplete |
  ## Lines needing attention
  D-02: partial / D-03: late / D-04: late-no-reason / D-05: not-yet-due / D-06: data-incomplete / D-07: data-incomplete
  Draft for engineer review. Synthetic input; quantities and dates were calculated by a tool, not by this agent, and no delivery was accepted, rejected or chased.
  ```
- Caveat: the input already contains the helper's columns (the user must run the helper first); a complete delivery that arrived late is received-complete by decision (days_late shows it); over-delivery, cancelled and blank-quantity lines are covered by helper tests and SKILL worked rows, not by the live sample.
- Ledger: two 35-03 rows. Spend plan 35-03: 0.0420 USD (2 runs); fix-run total 0.6849 USD of 5 USD. Teardown: `podman-compose ... down`, `podman ps -a --filter label=aic.tryitout -q` empty.

## Agent 19 QC inspection records (plan 35-04)

Label: built on 3_DDC_Insights/Safety-Quality/quality-control-workflow (spec docs/ddc-alignment/qc-inspection-record-check.md, committed before any agent file; key and rubric R1-R7 written before the runs; SKILL.md 396 lines and instructions.md 28 lines read in full; path verified with gh api). 11 skill defects recorded in the spec (hold point only a flag and never enforced, sign_off_by never set, pass/fail by exact string comparison, statuses never set, response treated as acceptance, verify_remediation unchecked, silent drops, second-resolution ids, datetime.now() everywhere, unused fields, misleading metrics). Decision: no helper (no date or numeric test adopted; record completeness by text Y/N ticks and a lookup); the consistency test contains a reference implementation of the lookup and checks the key, the sample and the worked rows against it (8 tests). Verdicts are completeness only; nothing judges workmanship.

COUNTED on run 2 (SKILL revision 1). Option A (compose stack, tagged image), usage observed, countable true, no direct-call fallback, synthetic label.
- Run 1: job f9f76250-5b0d-4ab9-a994-824be9be301d, gpt-4.1-mini, 11989 tokens, 3 requests, est. 0.0192 USD, SKILL v1. 6 of 7 rows matched the key; Q-06 had defect_complete N (severity minor and corrective action present, so Y) and therefore verdict defect-incomplete instead of ncr-no-response. R3 FAIL, not counted.
- Run 2: job 174d6166-3aee-44b6-9e11-82e2627d51a2, gpt-4.1-mini, 12418 tokens, 3 requests, est. 0.0199 USD, SKILL v2 (revision 1: explicit two-field rule for defect_complete plus worked row W-10). Key vs result: Q-01 record-ok, Q-02 still-open, Q-03 result-missing, Q-04 hold-point-unsigned, Q-05 defect-incomplete, Q-06 ncr-no-response, Q-07 record-ok; copied fields, all four ticks, verdicts and the attention list equal the key cell by cell. R1-R7 met (R7: header and separator row present; the model left out the blank line after the heading, harmless).
- Excerpt:
  ```
  ## QC record check
  | record_id | hold_point | status | sign_off_present | result_present | defect_complete | ncr_status | ncr_response_present | verdict |
  |---|---|---|---|---|---|---|---|---|
  | Q-04 | Y | passed | N | Y | - | - | - | hold-point-unsigned |
  | Q-05 | N | failed | N | Y | N | - | - | defect-incomplete |
  | Q-06 | Y | failed | N | Y | Y | accepted | N | ncr-no-response |
  | Q-07 | N | failed | N | Y | Y | in_remediation | Y | record-ok |
  ## Records needing attention
  Q-02: still-open / Q-03: result-missing / Q-04: hold-point-unsigned / Q-05: defect-incomplete / Q-06: ncr-no-response
  Draft for engineer review. Synthetic input; only the presence of fields was checked, no work was approved, rejected or closed.
  ```
- Caveat: the revision added worked row W-10, which has the same shape as sample record Q-06 (minor defect with action, accepted NCR without response); the pass on run 2 therefore shows the model can follow that pattern, not that it generalises. No numeric or date test (overdue NCR response not detected); record-ok does not mean the work is acceptable.
- Ledger: two 35-04 rows. Spend plan 35-04: 0.0391 USD (2 runs); fix-run total 0.7240 USD of 5 USD. Teardown: `podman-compose ... down`, `podman ps -a --filter label=aic.tryitout -q` empty.

## Agent 20 Warranty register (plan 35-05)

Label: built on 1_DDC_Toolkit/Closeout/warranty-tracker (spec docs/ddc-alignment/warranty-register-check.md, committed before any agent file; key and rubric R1-R7 written before the runs; SKILL.md 446 lines and instructions.md 28 lines read in full; path verified with gh api). 12 skill defects recorded in the spec; the main ones: date.today() in seven places, end date as start plus years*365 days (drifts a day or more across leap days), end_date never checked against start plus duration, get_expiring_warranties filters status ACTIVE (more than 90 days left) and then end <= today+90, so with the default window it is always empty and expiring_soon in the summary is always 0, no check for a missing document or contact, claimed and void statuses unreachable. Helper src/lib/warranty/warrantyStatus.ts (19 tests written first, regression tests for the drift, the 90-day boundaries 0/90/91, the 29 February rule and the dates check) and CLI scripts/warranty-status.ts; the helper also computes the three text-presence checks so the model has no ticks of its own. Verdicts are register-completeness only; nothing reads coverage or claim eligibility.

COUNTED on run 2 (SKILL revision 1). Option A (compose stack, tagged image), usage observed, countable true, no direct-call fallback, synthetic label.
- Run 1: job 3dcb94e7-a873-4585-91f5-763143c54085, gpt-4.1-mini, 8558 tokens, 2 requests, est. 0.0137 USD, SKILL v1. All 7 table rows matched the key and the helper cell by cell, but the attention list named only 4 of the 6 required warranties (W-02 expiring-soon and W-03 expired were left out). R7 FAIL, not counted.
- Run 2: job 01156eba-c010-407e-ad8a-e5694bd94506, gpt-4.1-mini, 8863 tokens, 2 requests, est. 0.0142 USD, SKILL v2 (revision 1: attention rule states that every verdict except register-ok is listed, plus a worked attention list). Key vs result: W-01 register-ok, W-02 expiring-soon, W-03 expired, W-04 documents-missing, W-05 contact-missing, W-06 dates-inconsistent, W-07 data-incomplete; the 7 rows and the 6-line attention list equal the key; `npx tsx scripts/warranty-status.ts <sample> <result>` reports "result table matches the helper on every cell". R1-R7 met (R7: header and separator row present; the model left out the blank line after the as_of line, harmless).
- Excerpt:
  ```
  ## Warranty register check
  as_of: 2026-03-02
  | warranty_id | status_class | days_remaining | dates_consistent | document_present | contact_present | coverage_present | verdict |
  |---|---|---|---|---|---|---|---|
  | W-02 | expiring-soon | 12 | Y | Y | Y | Y | expiring-soon |
  | W-03 | expired | -20 | Y | Y | Y | Y | expired |
  | W-06 | active | 761 | N | Y | Y | Y | dates-inconsistent |
  | W-07 | - | - | - | Y | Y | Y | data-incomplete |
  ## Warranties needing attention
  W-02: expiring-soon / W-03: expired / W-04: documents-missing / W-05: contact-missing / W-06: dates-inconsistent / W-07: data-incomplete
  Draft for engineer review. Synthetic input; dates were calculated by a tool, not by this agent, and nothing is said about what a warranty covers or whether a claim is possible.
  ```
- Caveat: the input already contains the helper columns (the user must run the helper first); the sample has no blank-coverage row and no 29 February start (helper tests and SKILL worked rows V-8 to V-10 cover those); the revision added a worked attention list, so the pass shows the model can follow that pattern. Durations in months are not supported (whole years only).
- Ledger: two 35-05 rows. Spend plan 35-05: 0.0279 USD (2 runs); fix-run total 0.7519 USD of 5 USD. Teardown: `podman-compose ... down`, `podman ps -a --filter label=aic.tryitout -q` empty, no containers left.
