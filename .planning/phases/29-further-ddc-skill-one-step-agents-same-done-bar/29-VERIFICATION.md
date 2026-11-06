---
phase: 29
status: human_needed
---

# Phase 29 Verification

All outputs are drafts for engineer review. Inputs are synthetic or public only.

Harness, procedure and ledger as in Phases 25-28 (see ../28-*/28-VERIFICATION.md): Option A (compose stack, internal network `aic-pi-internal`, image `localhost/aic-agent-library:tryitout`, catalog and prompts bind-mounted), `scripts/tryout-run.ts`, model gpt-4.1-mini in the Pi container, ledger `.planning/spend-log.md`. Selection record: docs/ddc-agent-candidates.md.

## Agent evidence

### Agent 13: Daily report cross-check
COUNTED (SKILL v1, first run, rubric R1-R7 met).

- Entry: data/agents/daily-report-cross-check.yaml (validate-submission INGESTIBLE, validate-entries 0 errors; stage site-handover, agent_no 13; name "Daily Report Cross Check" so the slug is daily-report-cross-check). The validate-entries range for agent_no was widened from 1-12 to 1-16 (deviation; its negative test now uses 17). Input label: synthetic (data/tryitout-prompts/daily-report-cross-check/sample-daily-report-timesheet.txt: 6 invented daily report lines, 7-line invented timesheet extract). Option A, gpt-4.1-mini, Pi container, 3 requests, usage observed (countable).
- Run: job fdf1b5e2-880f-4f69-b209-ca89e963aeeb, SKILL v1, 12696 tokens, est. 0.0203 USD, 14.5 s. No FAILed runs, no revisions.
- Answer key vs result: D-01 consistent, D-02 consistent, D-03 mismatch (workers differ 5 vs 6), D-04 mismatch (hours differ 48 vs 44), D-05 delay-unexplained, D-06 not-in-timesheet (NONE, the 2026-03-03 scaffolding line not used): all six match.
- Verdict: R1 pass (one result.md; 6 check lines and 6 table rows D-01..D-06 in order, 8 cells each); R2 pass (every non-NONE timesheet_line verbatim from the extract); R3 pass (all six verdicts equal the key); R4 pass (notes as key; D-06 NONE; review NO only D-01, D-02); R5 pass (no row for the crane line; open items D-03, D-04, D-05, D-06); R6 pass (no counts, totals, approval statement); R7 pass (draft caveat present).
- Excerpt:
  ```
  D-03 date=2026-03-02 trade=plumbing rep_workers=5 rep_hours=40 delay_hours=0 reason=EMPTY | ts_line="2026-03-02,plumbing,6,40" ts_workers=6 ts_hours=40 | workers_same=N | hours_same=Y | delay_open=N | verdict=mismatch
  D-06 date=2026-03-02 trade=scaffolding rep_workers=2 rep_hours=16 delay_hours=0 reason=EMPTY | ts_line=NONE ts_workers=NONE ts_hours=NONE | workers_same=- | hours_same=- | delay_open=N | verdict=not-in-timesheet
  D-03 | 2026-03-02 | plumbing | 5 workers, 40 h | 2026-03-02,plumbing,6,40 | mismatch | YES | workers differ 5 vs 6
  D-04 | 2026-03-02 | concrete | 6 workers, 48 h | 2026-03-02,concrete,6,44 | mismatch | YES | hours differ 48 vs 44
  D-05 | 2026-03-02 | hvac | 3 workers, 24 h | 2026-03-02,hvac,3,24 | delay-unexplained | YES | delay hours given, no reason
  D-06 | 2026-03-02 | scaffolding | 2 workers, 16 h | NONE | not-in-timesheet | YES | not in timesheet
  Draft for site manager review. Verdicts come only from the supplied report lines and timesheet extract.
  ```
- Caveat: draft for site manager review; counted for the scoped step only (6 report lines, one synthetic sample, first run).
- Teardown: stack down, `podman ps -a --filter label=aic.tryitout` empty.
- Ledger: one 29-01 row (0.0203 USD).

### Agent 14: Punch list closure check
COUNTED (SKILL revision 1, second run; rubric R1-R7 met).

- Entry: data/agents/punch-list-closure-check.yaml (validate-submission INGESTIBLE, validate-entries 0 errors; stage site-handover, agent_no 14; name "Punch List Closure Check" so the slug is punch-list-closure-check, confirmed by tryout:configure). DDC paths 1_DDC_Toolkit/Field-Operations/punch-list-manager and 1_DDC_Toolkit/Project-Closeout/punch-list-manager both verified present with gh api. Input label: synthetic (data/tryitout-prompts/punch-list-closure-check/sample-punch-list.txt: 6 invented items, as_of=2026-05-01, placeholder closure rules). Option A, gpt-4.1-mini, Pi container, 3 requests per run, usage observed (countable).
- Run 1: job e9cef5f5-a822-4549-a3b1-912d37d00950, SKILL v1, 11980 tokens, est. 0.0192 USD, 12.5 s. FAIL (R4): all six verdicts right, but the notes for P-02 (`verified_by missing`) and P-06 (`closed_date missing`) and P-05 were `-`; not counted. Fix: explicit per-verdict note rule and three worked rows with notes (revision 1).
- Run 2 (counted): job 4100e229-7b71-43b5-8803-f7f823ec5f95, SKILL revision 1, 12641 tokens, est. 0.0202 USD. No scope-shrink retry needed.
- Answer key vs result: P-01 closed-ok, P-02 closed-unverified (verified_by missing), P-03 overdue (due 2026-04-10 before as_of 2026-05-01), P-04 open-ok, P-05 no-responsible, P-06 closed-unverified (closed_date missing): all six match.
- Verdict: R1 pass (one result.md; 6 check lines and 6 table rows in order, 8 cells each); R2 pass (responsible, due, status copied verbatim; empty responsible shown as `-`); R3 pass; R4 pass (notes as key; review NO only P-01, P-04); R5 pass (open items P-02, P-03, P-05, P-06); R6 pass (no counts, percent complete, readiness or acceptance statement, nothing invented); R7 pass (draft caveat present).
- Excerpt:
  ```
  P-03 status=open resp=Carpenter Oy due=2026-04-10 as_of=2026-05-01 closed_date=EMPTY verified_by=EMPTY | resp_empty=N | closure_missing=- | due_before_asof=Y | verdict=overdue
  P-02 | Level 1 lobby | Floor Oy | 2026-04-28 | closed | closed-unverified | YES | verified_by missing
  P-03 | Level 2 office | Carpenter Oy | 2026-04-10 | open | overdue | YES | due 2026-04-10 before as_of 2026-05-01
  P-05 | Level 3 hall | - | 2026-05-15 | open | no-responsible | YES | responsible missing
  P-06 | Level 3 stair | Electric Oy | 2026-04-30 | closed | closed-unverified | YES | closed_date missing
  Draft for engineer review. Verdicts come only from the supplied punch list and as_of date using placeholder closure rules.
  ```
- Caveat: draft for engineer review; counted for the scoped step only (6 items, one synthetic sample, placeholder closure rules that are not a contract requirement).
- Teardown: stack down, `podman ps -a --filter label=aic.tryitout` empty.
- Ledger: two 29-02 rows (0.0192 + 0.0202 USD).

### Agent 15: Change order consistency check
COUNTED (SKILL v1, first run, rubric R1-R7 met).

- Entry: data/agents/change-order-consistency-check.yaml (validate-submission INGESTIBLE, validate-entries 0 errors; stage site-handover, agent_no 15; name "Change Order Consistency Check" so the slug is change-order-consistency-check, confirmed by tryout:configure). DDC paths 1_DDC_Toolkit/Cost-Management/change-order-processor and 4_DDC_Curated/Contract-Legal/change-order-manager both verified present with gh api. Input label: synthetic (data/tryitout-prompts/change-order-consistency-check/sample-change-orders.txt: 6 invented log rows, 6 invented form lines including the distractor CO-60). Option A, gpt-4.1-mini, Pi container, 3 requests, usage observed (countable). SKILL stated each verdict's note content with worked lines and rows (lesson from 29-02).
- Run: job 8746152c-5930-4df9-afb4-d113e7b41482, SKILL v1, 13208 tokens, est. 0.0211 USD, 14.5 s. No FAILed runs, no revisions, no scope-shrink retry.
- Answer key vs result: CO-01 consistent, CO-02 amount-mismatch (amount differs 8400 vs 8040), CO-03 approval-incomplete (approved_by missing), CO-04 consistent (pending, unsigned form, no approval requirement), CO-05 amount-mismatch (currency differs EUR vs SEK), CO-06 no-form (NONE, CO-60 not used): all six match.
- Verdict: R1 pass (one result.md; 6 check lines and 6 table rows CO-01..CO-06 in order, 7 cells each); R2 pass (every non-NONE form_line verbatim from the forms section); R3 pass; R4 pass (notes as key; review NO only CO-01, CO-04); R5 pass (no row for CO-60; open items CO-02, CO-03, CO-05, CO-06); R6 pass (no sums, totals, validity, approval or payment statement, no price opinion); R7 pass (draft caveat present).
- Excerpt:
  ```
  CO-02 amount=8400 cur=EUR status=approved approved_by=Project Manager A approval_date=2026-02-14 | form_line="CO-02,8040,EUR,2,yes" f_amount=8040 f_cur=EUR f_signed=yes | amount_same=N | cur_same=Y | approval_gap=N | verdict=amount-mismatch
  CO-02 | Revised duct routing | 8400 EUR | CO-02,8040,EUR,2,yes | amount-mismatch | YES | amount differs 8400 vs 8040
  CO-03 | Added fire damper | 3200 EUR | CO-03,3200,EUR,0,yes | approval-incomplete | YES | approved_by missing
  CO-05 | Extra cable tray | 3000 EUR | CO-05,3000,SEK,0,yes | amount-mismatch | YES | currency differs EUR vs SEK
  CO-06 | Relocated riser | 7100 EUR | NONE | no-form | YES | no form line
  Draft for reviewer. Verdicts come only from the supplied log and forms; no pricing or contract assessment was made.
  ```
- Caveat: draft for reviewer; counted for the scoped step only (6 log rows, one synthetic sample, first run).
- Teardown: stack down, `podman ps -a --filter label=aic.tryitout` empty.
- Ledger: one 29-03 row (0.0211 USD).

### Agent 16: Safety observation classification
COUNTED (SKILL v1, first run, rubric R1-R7 met). Caveat: the category table in the sample is an invented placeholder, not a safety standard.

- Entry: data/agents/safety-observation-classification.yaml (validate-submission INGESTIBLE, validate-entries 0 errors; stage site-handover, agent_no 16; name "Safety Observation Classification" so the slug is safety-observation-classification, confirmed by tryout:configure). DDC paths 1_DDC_Toolkit/Field-Operations/safety-inspection and 3_DDC_Insights/Safety-Quality/safety-inspection-checklist both verified present with gh api; incident-reporting deliberately not used. Input label: synthetic (data/tryitout-prompts/safety-observation-classification/sample-safety-observations.txt: 6-line placeholder category table, 6 invented observations, no persons). Option A, gpt-4.1-mini, Pi container, 3 requests, usage observed (countable).
- Run: job c5bc6732-80ee-424f-aa80-e1b276eb3008, SKILL v1, 11149 tokens, est. 0.0178 USD, 12.5 s. No FAILed runs, no revisions, no scope-shrink retry.
- Answer key vs result: S-01 fall-protection/high matched, S-02 electrical/high multi-match (also matches wet (housekeeping)), S-03 housekeeping/low matched, S-04 UNCLASSIFIED/NONE no-match, S-05 ppe/medium matched, S-06 excavation/high matched: all six match.
- Verdict: R1 pass (one result.md; 6 check lines and 6 table rows S-01..S-06 in order, 8 cells each); R2 pass (every first_line verbatim from the table); R3 pass; R4 pass (review NO only S-03, S-05); R5 pass (open items S-01, S-02, S-04, S-06); R6 pass (no counts, ranking, advice, danger, incident or reporting statement, no category outside the table, no persons); R7 pass (draft caveat present).
- Excerpt:
  ```
  S-02 text="Extension cord frayed near wet area" | hits=cord,wet | first_line="cord,electrical,high" cat=electrical sev=high | multi=Y | high=Y | status=multi-match
  S-02 | Level 1 plant room | electrical | high | cord | multi-match | YES | also matches wet (housekeeping)
  S-04 | Yard | UNCLASSIFIED | NONE | NONE | no-match | YES | -
  S-05 | Gate | ppe | medium | hard hat | matched | NO | -
  Draft for safety officer review. Categories and severity hints come only from the supplied placeholder table; no safety assessment was made.
  ```
- Caveat: draft for safety officer review; counted for the scoped step only (6 observations, one synthetic sample, placeholder table, first run).
- Teardown: stack down, `podman ps -a --filter label=aic.tryitout` empty.
- Ledger: one 29-04 row (0.0178 USD).

## Phase result (aggregated)
Agents 13-16 counted (13 and 16 and 15 first run, 14 after one revision). Candidates not built are in docs/ddc-agent-candidates.md. `npm run check` green (273 files, 3118 tests).
