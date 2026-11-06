# Phase 32 verification

## Agent 3 Clash (plan 32-01), redesign retry
STILL ATTEMPTED-NOT-COUNTED (3 more live runs, all FAIL, each one cell short; the retry limit of 3 is used). Not counted as verified; no evidence is claimed.

- Redesign (commits bc2e2cb, ae8d1af, then the revision commit): the Try It Out step is per-clash classification only, 14 cells per row (`clash_id | status | type | pen | disc_a | disc_b | T1 | T2 | T3 | T4 | priority | resolution_type | responsible_discipline | flag`), priority read from a 16-line truth table of the four test answers, resolution/responsible from a 36-line ordered pair list. Element index, pattern label, `fired:` text, pattern groups and findings table are gone from the step. They come from the tested helper `scripts/clash-patterns.ts` (src/lib/clash/clashPatterns.ts, 6 unit tests, transitive grouping, validation, exact 8-column findings format for agent 4; agent 4's sample and test needed no change, its test still reads the header from this SKILL hand-off text). Spec sections 9-11 (rubric R1-R7 now checks the helper on the agent table) were rewritten before the runs.
- Option A, gpt-4.1-mini, Pi container, usage observed (countable), label synthetic, 8-row sample. Spend 0.0740 USD for the three runs (fix-run total about 0.331 of 5 USD); three ledger rows after the marker.
- Run 1 (redesign v1), job 917eb36a-cb84-4c2b-af8d-fee75533f0a6, 15349 tokens, 3 requests, est. 0.0246 USD: FAIL. 7 of 8 rows right. CL-003 `type` copied as hard instead of soft, so T1=Y and CRITICAL instead of LOW (R3/R4).
- Run 2 (rev 1: type copy rule), job fd61a009-88d5-4381-95e3-0abcb6a2ba03, 15467 tokens, 3 requests, est. 0.0247 USD: FAIL. CL-003 fixed (soft, LOW). CL-008 responsible discipline Sähkö instead of Sprinkler (nested pair matrix mis-read, R5).
- Run 3 (rev 2: flat `disc_a + disc_b -> ...` pair lines, worked row with the responsible = first label case), job c1822385-f536-44a9-8732-7c5c27e2089c, 15449 tokens, 3 requests, est. 0.0247 USD: FAIL. CL-008 fixed, but CL-003 again T1=Y and CRITICAL (type copied soft correctly in the cell, yet T1 answered Y for a soft clash with Rakenne; R3/R4). Priority was consistent with its own T cells in all three runs, and the pattern work (which failed all four earlier runs) is no longer in the model step: run 3 piped through the helper gives PAT-CL-001 (CL-001..003) and PAT-CL-004 (CL-004, CL-005) and findings F-01..F-04 exactly as the key.
- Judgement: clear improvement (7 of 8 rows right in every run versus 4-5 cells of mixed errors; no priority-cell/fired-text contradiction, no pattern failure), but each run had one wrong cell on a key row, so rubric R1-R7 is not met in any run. A passing rerun would be luck, not evidence, so it is not counted. Remaining model weakness: the T1 rule (soft with Rakenne must be N) is evaluated wrongly on a row whose neighbours are hard Rakenne clashes (CL-001, CL-002 vs CL-003); a candidate next step is two Try It Out passes or putting the per-row test in separate columns (rak, hard) before T1.
- Excerpt of the last output (wrong cell marked): `CL-003 | assigned | soft | 35 | Ilmanvaihto | Rakenne | Y | N | N | Y | CRITICAL | ...` (T1 should be N, priority LOW).
- Teardown: stack down, `podman ps -a --filter label=aic.tryitout` empty.

### Earlier design (first four runs)
ATTEMPTED-NOT-COUNTED (4 live runs, all FAIL; revision cap of 2 plus one scope-shrink retry reached). Superseded by the redesign above; kept as history. The aligned entry, SKILL.md, sample and spec stay in the repo, but agent 3 is NOT counted as verified against the aligned rubric. No evidence is claimed.

- Spec written from the full skill text before any agent change: docs/ddc-alignment/clash-prioritization.md (commit c7b3487). Answer key and rubric R1-R7 written before the runs; only the id set changed for the shrink retry (recorded in spec section 10).
- Option A, gpt-4.1-mini, Pi container, usage observed (countable by infrastructure), input label synthetic. Total spend 0.1203 USD (ledger rows after the fix-run marker).
- Run 1 (SKILL v1, 16 rows), job 4f18541b-1f25-416e-bef8-7ca3a0eed09a, 18796 tokens, 3 requests, est. 0.0301 USD: FAIL. others=none on every row, so no pattern groups at all (R3); T1 not Y for struct-hard rows (CL-002..005, CL-013 wrong); priority cell contradicts the fired text (CL-011, CL-014); 13 single-clash findings. R1/R2/R6/R7 format fine.
- Run 2 (revision 1: element index section, explicit T1 wording), job f4376fb6-83d6-4411-bfc0-51c09f719655, 18820 tokens, 3 requests, est. 0.0301 USD: FAIL. Element index fully correct, duct group found, but riser others=none, CL-012 pattern missing, CL-011 and CL-013 priority cells contradict the tests, findings wrong for ungrouped patterns.
- Run 3 (revision 2: idx_a/idx_b per-row lookup fields, first-Y rule, EX-7 worked row), job 977ecb72-fc36-44fb-9efb-06483b113da9, 20129 tokens, 3 requests, est. 0.0322 USD: FAIL. Index and idx_a/idx_b copied correctly and others right for the duct and riser, yet the pattern cell was `-` for riser and ceiling rows; priority cells contradict the fired text on CL-002, CL-003, CL-005, CL-013 (T1=Y rows ranked HIGH/MEDIUM, all-N rows ranked CRITICAL).
- Run 4 (scope-shrink retry, 8-row sample, SKILL unchanged), job bd86fcac-ed85-43dc-ae7e-3022c28caa9b, 17434 tokens, 3 requests, est. 0.0279 USD: FAIL. CL-002 HIGH instead of CRITICAL (its own T1=Y, fired CRITICAL), CL-004/CL-005 riser pattern missed (idx lists were right per row for the duct group but not for the riser; others=none), CL-007 MEDIUM despite struct hard (T1=N), CL-008 LOW with fired MEDIUM. R1, R2, R5 (lookup) and R7 format held; R3 and R4 failed.
- Reason: gpt-4.1-mini does not reliably (a) take the priority cell from its own fired text and (b) turn an index lookup into a pattern label in one pass over 8-16 rows with a 7-column row. The structured per-row checklist that passed in phase 25 (a single P1-P3 rule plus a hand-made location_key) became too heavy once the skill's four-level scale, pattern labels, resolution type and responsible discipline were added. Not a defect of the spec or the key (the key was verified by an independent derivation in scripts/ddc-alignment.clash-prioritization.test.ts).
- Excerpt of the last output (wrong cells marked):
  ```
  CL-002 | open | HIGH | PAT-CL-001 | ... | T1=Y T2=N T3=N T4=N; fired: CRITICAL because T1=Y   (priority cell should be CRITICAL)
  CL-004 | in_progress | MEDIUM | - | ...   (pattern should be PAT-CL-004; Riser RS-3 shared with CL-005)
  CL-007 | open | MEDIUM | ... struct=Y; type=hard ... T1=N   (T1 should be Y, priority CRITICAL)
  Draft for engineer review. Priorities, resolution types and responsible disciplines are proposals from the report columns only; the model was not consulted.
  ```
- Mitigation idea (not done, cap reached): a deterministic pre-step for the element index and pattern label (script), with the model writing only priority tests and prose; or two Try It Out steps (index, then rows).
- Teardown: stack down, `podman ps -a --filter label=aic.tryitout` empty (see below).
- Ledger: four 32-01 rows after the fix-run marker in .planning/spend-log.md.
- Phase 25 evidence for the previous (P1-P3, location_key) design stays valid for that design only; it no longer describes the entry.

## Agent 4 RFI (plan 32-02)
COUNTED (1 live run, SKILL v1, no revision needed). Aligned with DDC skill 1_DDC_Toolkit/Document-Control/rfi-management; spec docs/ddc-alignment/rfi-generation-from-findings.md written first (commit 6b1afdd).

- Option A, Pi container, usage observed (countable), input label synthetic (6 findings in agent 3 findings format, Finnish labels).
- Job 8c98cb89-f805-44d4-9bfb-7e041406585e, model gpt-4.1-mini, 16287 tokens, 3 requests, est. 0.0261 USD (ledger row after the fix-run marker).
- Answer key (spec section 8) vs result: ids RFI-DRAFT-01..06 in order, index 6 rows, 6 blocks (R1); all 20 field lines in every block, checked by script (R2); Date, Response required by, CC, Submitted by exact placeholder in all 6, no date pattern anywhere in the file (R3); Assigned to matches the key incl. TO BE DECIDED BY COORDINATOR for F-04 and F-05 (R4); Question copied for F-01, F-02, F-04, F-06 and `(derived)` exactly for F-03 and F-05 (R5); impact lines placeholders, suggested resolution matches the lookup (route around, raise or lower, resize, route around, route around, none proposed for the model-data finding F-06), no invented names/sections/amounts (R6); caveat footer, checklist by ids with no count line (R7). Missing information matches the key in all 6 blocks. Verdict: PASS, rubric R1-R7 met.
- Minor: the checklist ids are one per line instead of one line; the index table has uneven column padding. Neither is a rubric failure.
- Excerpt (RFI-DRAFT-05 and RFI-DRAFT-06 abbreviated, impact/date lines are the placeholders):
  ```
  ### RFI-DRAFT-03
  Source finding: F-03 (clash_ids: CL-005, CL-006)
  Status: DRAFT
  Priority: MEDIUM
  Subject: Coordination: Ilmanvaihto, L3 grid B/2
  Question: Please confirm which element at L3 grid B/2 shall change and whether the proposal is acceptable. (derived)
  Suggested resolution: Proposal: resize one element
  Assigned to: Ilmanvaihto
  Date: to be set by coordinator
  Response required by: to be set by coordinator
  Missing information: spec section, drawing reference, cost and schedule basis, open question
  ### RFI-DRAFT-04
  Assigned to: TO BE DECIDED BY COORDINATOR
  Missing information: spec section, drawing reference, cost and schedule basis, assigned party
  Draft for engineer review. RFIs are written only from the findings table; nothing was checked in the model.
  ```
- Draft caveat: output is a draft for engineer review; nothing was checked in the model.
- Teardown: stack down, `podman ps -a --filter label=aic.tryitout` empty.
- Ledger: one 32-02 row after the fix-run marker. Fix-run spend so far 0.1464 USD (0.1203 + 0.0261).
- Lesson confirmed: a one-block-per-finding layout of fixed lines (copy, constant placeholder or one lookup, worked examples, no cross-section dependency) passes first time on the small model, unlike the agent 3 output.

## Agent 6 Quote comparison (plan 32-03)
COUNTED (4th run, after 2 SKILL revisions and 1 scope-shrink retry). Aligned with DDC skill 1_DDC_Toolkit/Procurement/bid-analysis-comparator; spec docs/ddc-alignment/quote-comparison.md written first. Skill weighting claims verified in its code: `total_weighted_score` is an unweighted sum (dead property), `calculate_weighted_scores` uses score*weight*10 (weights applied but hidden x10 scale, no normalisation or validation, missing score silent zero, unknown criterion weight 0, no ties/rank); nine items in spec section 6. Corrected helper src/lib/procurement/weightedScore.ts (sum(score*weight)/sum(weights), typed validation errors, ranking with shared tie ranks) with unit tests and CLI scripts/bid-weighted-score.ts (A-02: helper run by the harness evidence step, Try It Out job stays text in/text out, no app change).

- Option A, Pi container, usage observed (countable), label synthetic, gpt-4.1-mini, 3 requests per run.
- Runs: 2fe1fc21-bda9-4e4a-9366-78384864aedc 16847 tok 0.0270 FAIL (draft recommendation open gaps omitted B R-03 NOT-QUOTED; R4/R5); ddfc55a5-0116-4fa8-b149-46fd22819072 17366 tok 0.0278 FAIL (SKILL rev 1: gaps fixed, but lowest_comparable n/a on four lines with two ok letters, R-05 C wrongly QTY-DIFF; R2/R5); 0afa91f2-305c-4437-aa3b-aef685865512 17594 tok 0.0282 FAIL (SKILL rev 2: QTY-DIFF fixed, lowest still n/a on four lines; R2/R5); counted: fb302e31-f63a-442b-a9d7-e3b4d2c8cc9f 17192 tok 0.0275 (scope-shrink retry, 5 RFQ lines instead of 6). Total 0.1105 USD, four ledger rows after the fix-run marker. Fix-run spend so far 0.2569 USD.
- Verdict for fb302e31 against the answer key (spec section 8): R1 basis rows right (A first Y, B same Y, C differs: currency, vat, delivery_terms N); R2 all line checks and flags equal the key (B R-03 NOT-QUOTED, B R-05 UNIT-DIFF, C R-04 ITEM-SUBSTITUTE+BASIS-DIFF, C R-05 UNIT-DIFF+BASIS-DIFF, no QTY-DIFF where the unit differs), lowest R-01 B, R-02 A, R-03 n/a, R-04 A, R-05 n/a; R3 criteria, weights and scores copied exactly (diff equal to input), every total cell `to compute (tool)`, no model sum or product; R4 four gap lines plus the basis line for C; R5 DRAFT label, eligible A,B, C excluded, leader `pending tool totals`, open gaps B R-03 and B R-05 (equal the key), no decision; R6 all 17 prices digit-identical, nothing invented; R7 caveat present. PASS.
- Helper output (npx tsx scripts/bid-weighted-score.ts on the input and on result.md, identical): weights price=50, delivery_time=20, technical_compliance=20, references=10; B 7.20 rank 1, A 6.60 rank 2, C 6.30 rank 3. The unweighted sums are A 28, C 26, B 24, so the unweighted leader (A) differs from the weighted leader (B): the corrected weighting changes the winner. C is ranked by the helper but excluded from the recommendation (BASIS-DIFF). The draft recommendation reads `Leader among eligible quotes: pending tool totals`, i.e. the engineer reads B from the tool output, as a draft.
- Excerpt of the counted output:
  ```
  R-04 | Circulation pump 25-60 | 2 | pcs | 289.00 | OK | 301.00 | OK | 3350.00 | ITEM-SUBSTITUTE, BASIS-DIFF | A
  price | 50 | 6 | 9 | 5
  total | - | to compute (tool) | to compute (tool) | to compute (tool)
  DRAFT recommendation for engineer review. This is not a decision.
  Eligible quotes (rankable=Y): A,B
  Excluded as non-comparable (BASIS-DIFF): C
  Leader among eligible quotes: pending tool totals
  gap: R-03 B NOT-QUOTED | not quoted by this supplier
  gap: R-05 B UNIT-DIFF | unit differs from RFQ
  ```
- Caveats: draft for engineer review; synthetic data; counted for 5 RFQ lines x 3 quotes after a scope shrink; reliability on this small model is limited (the first three runs on 6 lines each failed one rubric item, notably lowest_comparable on lines with two ok letters, which had passed in Phase 26 with the shorter SKILL); weights and scores are engineer-supplied and invented in the sample; totals come from the helper outside the model, not from the Try It Out job.
- Teardown: stack down, `podman ps -a --filter label=aic.tryitout` empty.

## Phase result (aggregated)
Agent 4 RFI: counted (aligned, 1 run). Agent 6 Quote comparison: counted (aligned, 4th run after scope shrink; weighting helper corrected and tested). Agent 3 Clash: aligned entry/spec/helper in the repo, 7 live runs across two designs, NOT counted (last design: 7 of 8 rows right in every run, one wrong cell per run). RETURN LATER with a further reduction. `npm run check` green.
