---
phase: 25
status: human_needed
---

# Phase 25 Verification

All outputs are drafts for engineer review. Inputs are synthetic or public only.

## Live run harness

- Option used: A (compose stack, internal network `aic-pi-internal`, image `localhost/aic-agent-library:tryitout` built from this checkout, catalog and prompts bind-mounted)
- Agent: demo-rfi-triage (existing demo entry)
- Job id: 1e15df20-234c-4c3f-9def-4b2417fe39ff
- Model: gpt-4.1-mini
- Total tokens: 7652, requests: 3 (proxy-observed, so the Pi container path was used, not the direct-call fallback)
- Estimated cost: 0.0122 USD (upper bound, all tokens at output rate); duration 10.5 s
- Input label: synthetic (data/tryitout-prompts/demo-rfi-triage/sample-rfi.txt)
- Output excerpt (result.txt):
  ```
  Urgency: high
  Discipline: structural
  Routing: structural engineer of record
  Rationale: The RFI concerns a conflict between ceiling-mounted ductwork and a structural beam with only 3 inches clearance, requiring prompt resolution to avoid delaying scheduled drywall ceiling work and sequencing.
  ```
- Caveat: draft for engineer review
- Teardown check: `podman ps -a --filter label=aic.tryitout` empty, stack down, port 3000 free
- Ledger: `.planning/spend-log.md` (one 0.0000 row for a 403 Origin mismatch before any job existed, one 0.0122 row for the run)

## Agent evidence

### Agent 1: ETIM and classification repair
Status: COUNTED (entry validated, real-model container run, rubric met after one SKILL revision).

- Entry: data/agents/etim-classification-repair.yaml (validate-submission and validate-entries exit 0); SKILL.md and synthetic sample in data/tryitout-prompts/etim-classification-repair/
- Counted run: job ca984d20-c703-4138-9b52-691d6c092add, model gpt-4.1-mini, 10568 tokens, 3 requests (proxy-observed, Pi container path, Option A), estimated cost 0.0169 USD (upper bound)
- Earlier run with SKILL v1: job 49e4e911-bf7b-45de-b2b3-255d56e3a441, 9980 tokens, 0.0160 USD, NOT counted. Findings: all rows present, no invented codes, wrong/unknown-code correct, but the two ambiguous elements and the no-match element were typed `missing` (the ambiguity was put in the proposed-class cell as free text), rows missing/wrong carried review NO, and the Counts line contradicted the list. SKILL revision 1 added a first-match decision order, a strict proposed-class cell (code or NONE) and an explicit review rule.
- Input label: synthetic (invented rows and invented SYN- codes, no real project or ETIM data)
- Answer key vs returned (counted run):

| Category | Seeded elements | Returned |
|---|---|---|
| missing (clear fit) | E-101, E-102, E-103 | missing, SYN-EC001/002/003 |
| wrong class | E-104, E-105 | wrong, proposed SYN-EC001 and SYN-EC005 |
| unknown code | E-106, E-107 | unknown-code, NONE |
| ambiguous | E-111, E-112 | ambiguous, review YES |
| no fitting class | E-113 | no-match, NONE |
| correct (control) | E-108, E-109, E-110, E-114 | ok, review NO |

- Rubric: 14 table rows for 14 CSV rows; every code in the output is in the input excerpt; no lookup claimed; all seeded categories matched; draft caveat present in the output footer and in the entry system prompt. Verdict: pass.
- Output excerpt (output/result.md):
  ```
  element_id | issue | current | proposed class | confidence | evidence | review
  E-104 | wrong | SYN-EC002 | SYN-EC001 | high | Pump but classified as LED luminaire | YES
  E-106 | unknown-code | SYN-EC099 | NONE | low | LED luminaire with unknown code SYN-EC099 | YES
  E-111 | ambiguous |  | SYN-EC008 | low | Actuated unit could be motorised damper or others | YES
  E-112 | ambiguous |  | SYN-EC005 | low | Ceiling unit could be fan coil or air handling unit | YES
  E-113 | no-match |  | NONE | low | Wall-mounted charger not in excerpt | YES
  ...
  Draft for engineer review. Classes come only from the supplied synthetic excerpt; no ETIM lookup was made.
  ```
- Quality note: confidence for E-106/E-107 is low although the element type is obvious; harmless, review is YES.
- Caveat: draft for engineer review; classes are synthetic SYN- codes, not ETIM.
- Teardown: stack down, `podman ps -a --filter label=aic.tryitout` empty, port 3000 free.
- Ledger: two 25-02 rows in .planning/spend-log.md (0.0160 not counted, 0.0169 counted)

### Agent 2: QTO normalization
COUNTED (SKILL revision 1).

- Entry: data/agents/qto-normalization.yaml (validate-submission INGESTIBLE, validate-entries 0 errors). Option A, gpt-4.1-mini, Pi container.
- Run 1 (SKILL v1), job 5ecd9f99-c1e2-4253-b78d-ac4ce366c66e, 10958 tokens, 3 requests, est. 0.0175 USD. All 20 rows and all conversions correct, but the totals section was wrong (m2 1769.2 vs 2020.1, m3 42.845 vs 43.145, m -0 vs 8.505, pcs list included a merged duplicate) and one original_unit contained a NUL character (m-squared). Not counted.
- Run 2 (SKILL revision 1: explicit addend lists in totals, ASCII units), job af4663e3-f128-4272-9b77-e0eace2acc6c, gpt-4.1-mini, 11384 tokens, 3 requests, est. 0.0182 USD. Input label: synthetic (data/tryitout-prompts/qto-normalization/sample-qto-table.txt, 20 rows).
- Answer key vs result: duplicates Q-004/Q-020 (merged-duplicate, both ids logged); conversions Q-008 mm 0.001, Q-009 cm 0.01 plus decimal comma, Q-010/Q-011 l 0.001, Q-012 t 1000 (all numerically correct: 12.5, 8.505, 0.3, 0.045, 2000); decimal comma Q-001/Q-009, thousands separator Q-006; missing unit Q-015 and bag Q-016 -> UNRESOLVED and logged; zero Q-018 and negative Q-019 flagged; group labels wall/WALLS -> Walls mapped.
- Rubric: 20 normalised rows for 20 input ids; unchanged-unit rows keep identical digits; every converted row states its factor and original*factor == quantity (checked Q-008, Q-009, Q-010, Q-011, Q-012); UNRESOLVED rows not guessed; draft caveat in the output footer and entry system prompt. Totals recomputed by hand and correct: m2 2020.1, m3 43.145, m 8.505, kg 3850, pcs 59. Verdict: pass.
- Quality notes: Q-017 (cable tray in pcs, a length item) not flagged as ambiguous; the original_unit column shows normalised spelling for Q-006 (m2 instead of m^2) and the spelling change is not logged for Q-001/Q-006; a spurious group-label change Cable tray -> Cable trays was logged. No quantity was altered wrongly.
- Output excerpt (output/result.md):
  ```
  Q-008 | Pipes | Copper pipe DN22 | 12.5 | m | 12500 | mm | unit conversion
  Q-009 | Pipes | Copper pipe DN15 | 8.505 | m | 850,5 | cm | unit conversion, number format
  Q-012 | Rebar | Reinforcement steel B500 | 2000 | kg | 2 | t | unit conversion
  Q-015 | Windows | Window 1200x1500 | 18 | UNRESOLVED | 18 |  | missing unit
  Q-016 | Masonry mortar | 40 | UNRESOLVED | 40 | bag | unknown unit
  Q-020 | Doors | Single door 900x2100 | 24 | pcs | 24 | pcs | merged-duplicate
  ## Totals (re-check required)
  m2: Q-001 245.5 + Q-002 310.2 + Q-003 128 + Q-006 1250 + Q-014 86.4 = 2020.1
  m: Q-008 12.5 + Q-009 8.505 + Q-018 0 + Q-019 -12.5 = 8.505
  Draft for engineer review. Synthetic input; quantities were not checked against any model geometry.
  ```
- Caveat: draft for engineer review; model-computed totals must be re-checked; synthetic input only.
- Teardown: stack down, `podman ps -a --filter label=aic.tryitout` empty.
- Ledger: two 25-03 rows in .planning/spend-log.md (0.0175 not counted, 0.0182 counted)

### Agent 3: Clash prioritization
COUNTED after redesign (retry 2026-10-15). History: three earlier runs (below) were attempted-not-counted; the SKILL was then redesigned and two further live runs made (run 4 FAIL on rule application, run 5 PASS).

- Entry: data/agents/clash-prioritization.yaml (validate-submission INGESTIBLE, validate-entries 0 errors). Option A, gpt-4.1-mini, Pi container (usage observed, runs were countable by infrastructure). Input label: synthetic (data/tryitout-prompts/clash-prioritization/sample-clash-report.txt, 16 rows, invented building).
- Answer key: cluster A CL-001..004 (duct SD-12 across beams, P1); cluster B CL-005..007 (riser RS-3, 3 clashes, P1); resolved CL-008, CL-015 (excluded); CL-009 hard 210 mm Structural (P1); soft CL-010, CL-011, CL-012, CL-016 (P3, separate); CL-013 isolated architectural/HVAC (P2); CL-014 missing penetration, Structural (P1 by the stated rule).
- Run 1 (SKILL v1), job 57e5c2cc-f130-47b7-96af-755ece27e18c, 10561 tokens, 3 requests, est. 0.0169 USD: CL-012 lost entirely, a phantom "cluster 4" repeated ids CL-005..007 with no priority, summary counts wrong (4 P1). FAIL.
- Run 2 (revision 1: one-by-one assignment, counts must match, coverage check), job ab20a259-c5c6-40c5-86fd-7406d918a43c, 13244 tokens, 3 requests, est. 0.0212 USD: every id covered exactly once, resolved excluded, findings table with the exact 8-column header. But CL-013 (Architectural/HVAC) rationale falsely said "hard clash with Structural" and was ranked P1, CL-014 (Structural) under-ranked P2, and four unrelated soft clashes across L0-L3 were merged into one cluster with a false "level/grid" reason. FAIL.
- Run 3 (revision 2: literal Structural test, no unrelated merges), job 2141f80e-2c6b-4b00-b48f-36bc84206bf4, 11678 tokens, 3 requests, est. 0.0187 USD: CL-012 listed in the coverage check under cluster 4 but missing from the ranked table and from the findings table (lost finding), the 3-clash riser cluster ranked P2 (rule says P1), soft CL-016 ranked P2. CL-009, CL-014 correctly P1, resolved ids excluded, coverage check claims 14 + 2 = 16 although only 13 open ids are in ranked rows. FAIL.
- Reason for the first three failures: gpt-4.1-mini in one call did not reliably apply the P1-P3 rule or keep every id in the multi-section output.

#### Retry with redesigned SKILL (agent 3, counted)
- Redesign: output ONE ROW PER INPUT CLASH in input order (clash_id | status | cluster_label | priority | reason, reason = fixed checklist plus the rule that fired); clusters only by copying the `location_key`; cluster and findings tables copy from the rows; no summary counts. Input adaptation (assumption, gap G-029): the synthetic sample got a hand-made `location_key` column (SD-12, RS-3, otherwise level-grid); real clash exports need a preprocessing step. The 8-column findings format is kept and was produced exactly.
- Run 4 (redesign v1), job 50656bb4-0cbc-4f96-81e9-d312ab561ddf, 13427 tokens, 3 requests, est. 0.0215 USD: all 16 ids once, in order, clusters correct, resolved excluded, findings header exact; but the model contradicted its own checklist (wrote "P2 hard clash with Structural element") so CL-002..004, CL-006, CL-007 and CL-014 got P2 instead of P1 per row. FAIL, not counted. Fix: explicit tests A-E whose Y/N answers decide the priority.
- Run 5 (redesign v2 with A-E tests), job 1aa6f1be-baf2-465a-8b4a-a101a2bc5d20, 14239 tokens, 3 requests, est. 0.0228 USD, Option A, gpt-4.1-mini, Pi container, usage observed, countable by infrastructure. Input label: synthetic. Retry total 0.0443 USD.
- Rubric: every input id appears once in the per-clash table, in input order (diff against the input id list identical, 16 rows); resolved CL-008 and CL-015 are `excluded` and absent from cluster and findings tables; CL-001..004 grouped (CLU-SD-12, P1), CL-005..007 grouped (CLU-RS-3, P1 via 3 members); CL-009 (210 mm Structural) P1; CL-014 (Structural, penetration unknown) P1 with "confidence lower: penetration missing"; soft CL-010, 011, 012, 016 each P3 and separate; CL-013 P2; exact 8-column findings header, 9 rows for 9 clusters; no invented ids, elements or numbers; caveat present. PASS.
- Minor imperfections (not rubric failures): F-01 location rendered `L2, C/3/C/4/C/5/C/6`; F-02 disciplines list omits Structural although CL-005 is Plumbing/Structural; owners are proposals only.
- Excerpt:
  ```
  CL-006 | open | CLU-RS-3 | P1 | resolved=N; type=hard; struct=N; pen=40; pen100=N; A=N B=N C=Y D=Y E=N; key=RS-3; others=CL-005,CL-007; fired: P1 because C=Y
  CL-009 | open | CLU-L0-B/2 | P1 | resolved=N; type=hard; struct=Y; pen=210; pen100=Y; A=Y B=Y C=N D=Y E=N; key=L0-B/2; others=none; fired: P1 because A=Y
  CL-014 | open | CLU-L1-A/3 | P1 | ...pen=unknown; pen100=N; confidence lower: penetration missing; A=Y B=N C=N D=Y E=N; ...fired: P1 because A=Y
  CL-016 | open | CLU-L0-C/1 | P3 | ... A=N B=N C=N D=N E=N; ... fired: P3 because A-E all N
  F-01 | CL-001,CL-002,CL-003,CL-004 | P1 | HVAC, Structural | L2, C/3/C/4/C/5/C/6 | Supply duct and Beam clashes (multiple) | Structural engineer | none
  F-08 | CL-014 | P1 | Electrical, Structural | L1, A/3 | Conduit bank and Wall clash | Structural engineer | penetration missing
  Draft for engineer review. Priorities use only the report columns and a generic P1-P3 rule; the model was not consulted.
  ```
- Caveat: draft for engineer review; synthetic input only; single sample, reliability on larger reports unproven.
- Teardown: stack down, `podman ps -a --filter label=aic.tryitout` empty.
- Ledger: rows 50656bb4 (not counted) and 1aa6f1be (counted) in .planning/spend-log.md.

#### Original attempted-not-counted record
- Reason: gpt-4.1-mini in one call does not reliably apply the P1-P3 rule or keep every id in the ranked and findings tables; losing a clash silently is exactly the failure a coordinator cannot catch. No evidence is claimed. Mitigation idea (not done, cap reached): a deterministic pre-processing step (script tool) for clustering and ranking, with the model only writing rationale and findings.
- Excerpt of the last output (for the record, wrong rows marked): `2 | CL-005, CL-006, CL-007 | P2 | ... (Rule: cluster of 2)` (should be P1); `CL-012: cluster 4` but no cluster 4 row in the ranked or findings tables.
- Caveat: draft for engineer review; synthetic input only.
- Teardown: stack down, `podman ps -a --filter label=aic.tryitout` empty, port 3000 free.
- Ledger: three 25-04 rows in .planning/spend-log.md (0.0169, 0.0212, 0.0187; total 0.0568 USD, all not counted)

### Agent 4: RFI generation
COUNTED (rubric met on the first run, SKILL v1).

- Entry: data/agents/rfi-generation-from-findings.yaml (validate-submission INGESTIBLE, validate-entries 0 errors); rfi-triage-assistant.yaml and demo-rfi-triage unchanged. Option A, gpt-4.1-mini, Pi container.
- Job a5ef49db-1061-440b-bbce-72a522f20e0c, 11393 tokens, 3 requests, est. 0.0182 USD, 28.6 s, usage observed (countable). Input label: synthetic (data/tryitout-prompts/rfi-generation-from-findings/sample-findings.txt, 6 findings F-01..F-06, invented building, shared 8-column format).
- Answer key: F-06 has empty open_question and unclear owner, so it needs `TO BE DECIDED BY COORDINATOR`, a `(derived)` question and a Missing information entry; F-04/F-05 are model-data findings (clash_ids `-`).
- Rubric check: 6 findings, 6 index rows, 6 RFI blocks, each F-xx exactly once, ids RFI-DRAFT-01..06 (no final numbers); response date `to be set by coordinator` in all six; no date, sheet, project or person name beyond the input (grep: only ids and names present in the input); F-06 flagged as expected; options labelled `Proposal:`, none decided; caveat in the footer. PASS. Minor: blocks F-01..F-05 say Missing information `none` though no drawing references exist in the input (acceptable, not a rubric item).
- Excerpt:
```
### RFI-DRAFT-06
Source finding: F-06 (CL-016)
Priority: P3
Subject: Clearance conflict between cable tray and duct in L0 plant room
To: TO BE DECIDED BY COORDINATOR
Question: What is the required clearance or resolution for the cable tray and duct conflict? (derived)
Options proposed: none proposed
Requested response date: to be set by coordinator
Missing information: no suggested owner, no open question
```
- Caveat: draft for engineer review; synthetic input only.
- Teardown: stack down, `podman ps -a --filter label=aic.tryitout` empty.
- Ledger: one 25-05 row in .planning/spend-log.md (0.0182 USD, counted)

## Phase result (aggregated 2026-10-14)
All four design-stage agents counted (1 ETIM & classification repair, 2 QTO normalization, 3 Clash prioritization (after a redesign, 2 of 5 runs passed), 4 RFI generation from findings). Spend for the phase ~0.20 USD (upper-bound estimate, see .planning/spend-log.md). `npm run check`: 273 files passed (1 skipped), 3118 tests passed. Status human_needed: engineer review of rubric defaults and quality notes is in 25-HUMAN-UAT.md.
