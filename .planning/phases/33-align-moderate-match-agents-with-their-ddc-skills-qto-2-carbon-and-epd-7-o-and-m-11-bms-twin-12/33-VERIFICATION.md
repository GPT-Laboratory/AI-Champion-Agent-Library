# Phase 33 verification

## Agent 2 QTO (plan 33-01)

Status: COUNTED (first run, SKILL v1, no revision needed).

- Skill: primary `2_DDC_Book/3.2-QTO-Auto-Estimates/bim-qto`, secondary `qto-report` (quotes the DDC book: method ideas only, book-text exclusion recorded in docs/ddc-alignment/qto-normalization.md). Spec committed before any agent file (b384e8b).
- Run (Option A, compose stack with override.tryitout.yml, image tag tryitout): job `ab6e8dcd-04f0-46e0-94cf-e281eccf170a`, model gpt-4.1-mini, 11067 tokens, 3 requests, est. cost 0.0177 USD, input label synthetic (6 invented rows), countable true (Pi ran, usage observed, no direct-call fallback). Ledger row present in .planning/spend-log.md (after the fix-run marker). Local artifact: `.tryitout-runs/ab6e8dcd-04f0-46e0-94cf-e281eccf170a/result.md`.
- Key vs result: all 6 rows match the spec section 8 key (issue codes OK, NUMFMT, UNIT-CONV, UNRESOLVED-UNIT, DUPLICATE, MISSING-QTY; Q-03 qty stays 2400 with factor 0.001; Q-05 dup_of Q-01; Q-04 UNRESOLVED; Q-06 qty `-`). Rubric: R1 met (6 rows, input order, 8 cells), R2 met, R3 met, R4 met, R5 met (totals section is `to compute (tool)`, no numbers), R6 met, R7 met (format, draft caveat).
- Helper evidence: `npx tsx scripts/qto-group-totals.ts data/tryitout-prompts/qto-normalization/sample-qto-table.txt <result.md>` exit 0, "result table matches the helper on every cell". Totals by group: Ilmanvaihto m 36.4, Putkisto m 50.9; by level: Level 1 m 84.9, Level 2 m 2.4; excluded Q-04 (unresolved-unit), Q-05 (duplicate of Q-01), Q-06 (missing-quantity).
- Excerpt of result.md:

```
## Normalised rows
| row_id | group | level | qty | unit | factor | dup_of | issue |
| Q-01 | Putkisto | Level 1 | 48.5 | m | 1 | - | OK |
| Q-02 | Ilmanvaihto | Level 1 | 36.4 | m | 1 | - | NUMFMT |
| Q-03 | Putkisto | Level 2 | 2400 | m | 0.001 | - | UNIT-CONV |
| Q-04 | Sähkö | Level 1 | 3 | UNRESOLVED | - | - | UNRESOLVED-UNIT |
| Q-05 | Putkisto | Level 1 | 48.5 | m | 1 | Q-01 | DUPLICATE |
| Q-06 | Ilmanvaihto | Level 2 | - | pcs | 1 | - | MISSING-QTY |
## Grouped totals
to compute (tool): totals by group and by level and unit, from this table with scripts/qto-group-totals.ts. No sums were calculated by the model.
Draft for engineer review. Synthetic input; quantities were not checked against any model geometry.
```

- Caveat: draft for engineer review; synthetic input; quantities not checked against geometry. One passing run on 6 rows is evidence that the design is workable, not a reliability claim.
- Teardown: `podman-compose ... down` done, `podman ps -a --filter label=aic.tryitout -q` empty.
- Tests: src/lib/qto/groupTotals.test.ts (29 tests), scripts/ddc-alignment.qto-normalization.test.ts, validators, scripts/check-ddc-decoupling.sh clean, golden diff limited to this entry.

## Agent 7 Carbon and EPD (plan 33-02)

Status: COUNTED (first run, SKILL v1, no revision needed).

- Skill: `2_DDC_Book/3.3-4D-BIM-CO2-Simulation/lifecycle-carbon-calculator` (SKILL.md and instructions.md read in full). Spec committed before any agent file (d21ae1f): stages, data model, comparison logic, 12 verified skill defects, helper contract, key, rubric. The skill's built-in material factor table is not copied or treated as data; sample values are invented and labelled synthetic.
- Run (Option A, compose stack with override.tryitout.yml, image tag tryitout): job `83fc51d0-ad72-459b-b883-8a8eb838cf79`, model gpt-4.1-mini, 15390 tokens, 3 requests, est. cost 0.0246 USD, input label synthetic (6 invented products, 6 invented EPD rows), countable true (Pi ran, usage observed, no direct-call fallback). Ledger row present. Local artifact `.tryitout-runs/83fc51d0-ad72-459b-b883-8a8eb838cf79/result.md`.
- Key vs result: all 6 rows match the spec section 8 key: X-01 ambiguous (EPD-01,EPD-06), X-02 no-epd, X-03 unit-mismatch (kg vs t), X-04 expired (2025/2026), X-05 matched with 4.2 | 0.3 | 0.1 | ND | 0.2 | ND, X-06 matched with 3.5 and ND. Rubric R1 met, R2 met, R3 met, R4 met (ND kept, `-` for non-matched), R5 met (totals and comparison `to compute (tool)`, no numbers), R6 met, R7 met. Minor: the option line is `option A: X-05 option B: X-06` on one line (accepted).
- Helper evidence: `npx tsx scripts/carbon-lifecycle.ts data/tryitout-prompts/carbon-epd-enrichment/sample-products-epd.txt <result.md>` exit 0, "result table matches the helper on every cell". Stage totals from the model's matched rows: A1-A3 462.00 (2 products), A4 18.00, A5 6.00, B not declared, C 12.00, D not declared, A-C total 498.00; excluded X-01 ambiguous, X-02 no-epd, X-03 unit-mismatch, X-04 expired. Option A vs B: A1-A3 252.00 vs 210.00, B lower by 42.00 (-16.67 %); A-C 288.00 vs 210.00, difference 78.00 (-27.08 %), warning declared stages differ. All equal the hand-computed numbers in the spec. (The CLI table parser first required leading pipes; it now accepts the model's pipe-separated rows without them, with a test.)
- Excerpt of result.md:

```
## Per-product rows
product_id | option | qty | unit | epd | declared_unit | A1-A3 | A4 | A5 | B | C | D | unit_ok | expired | status
X-01 | - | 85 | m3 | EPD-01,EPD-06 | - | - | - | - | - | - | - | - | - | ambiguous
X-02 | - | 40 | m3 | NONE | - | - | - | - | - | - | - | - | - | no-epd
X-03 | - | 3850 | kg | EPD-02 | t | - | - | - | - | - | - | N | N | unit-mismatch
X-04 | - | 120 | m | EPD-03 | m | - | - | - | - | - | - | Y | Y | expired
X-05 | A | 60 | m2 | EPD-04 | m2 | 4.2 | 0.3 | 0.1 | ND | 0.2 | ND | Y | N | matched
X-06 | B | 60 | m2 | EPD-05 | m2 | 3.5 | ND | ND | ND | ND | ND | Y | N | matched
## Totals and comparison
stage totals A1-A3, A4, A5, B, C, D and A-C total: to compute (tool)
option comparison (A vs B): to compute (tool)
Draft for engineer review. All EPD values in this run are synthetic and not authoritative; no EPD register lookup or calculation was made.
```

- Caveat: draft for engineer review; all EPD values synthetic and non-authoritative; no register lookup. One passing run on 6 products is evidence that the design is workable, not a reliability claim.
- Teardown: `podman-compose ... down` done, `podman ps -a --filter label=aic.tryitout -q` empty.
- Tests: src/lib/carbon/lifecycleCarbon.test.ts (22 tests incl. a regression per fixed skill defect), scripts/ddc-alignment.carbon-epd-enrichment.test.ts (8), validators, scripts/check-ddc-decoupling.sh clean, golden diff limited to this entry.

## Agent 11 O and M (plan 33-03)

Status: COUNTED (first run, SKILL v1, no revision needed).

- Skills: `5_DDC_Innovative/as-built-documentation` (primary) and `1_DDC_Toolkit/Project-Closeout/project-closeout-checklist` (SKILL.md and instructions.md of both read in full). Spec committed before any agent file: docs/ddc-alignment/om-completeness.md (document types, status enums, asset registry fields, Finnish generic term mapping, 13 verified skill defects, key, rubric).
- Run (Option A, compose stack with override.tryitout.yml, image tag tryitout): job `73ac51f8-4eb4-41cb-8bb6-a67a9b871b8e`, model gpt-4.1-mini, 12009 tokens, 3 requests, est. cost 0.0192 USD, input label synthetic (6 invented required rows with asset columns, 7 invented index lines), countable true (Pi ran, usage observed, no direct-call fallback). Ledger row present. Local artifact `.tryitout-runs/73ac51f8-4eb4-41cb-8bb6-a67a9b871b8e/result.md`.
- Key vs result: all 6 rows match the spec section 7 key: H-01 complete, H-02 incomplete (reviewed), H-03 missing (same equipment, other types only), H-04 missing (equipment absent), H-05 complete via SYN-DOC-302 with the superseded line SYN-DOC-301 skipped, H-06 missing (only AHU-02 has the type). Rubric R1 met, R2 met, R3 met (index lines copied exactly), R4 met (NONE, not in delivered index), R5 met (no counts, percentages or overall verdict), R6 met (asset columns copied exactly), R7 met. Minor: open-item reasons are terse (`not in delivered index`), less specific than the key's reasons for H-03/H-04/H-06 (accepted).
- Excerpt of result.md:

```
## Document rows
req_id | asset_tag | asset_name | system | location | doc_type | skill_type | index_line | status | closeout | review | note
H-01 | AHU-01 | Air handling unit 1 | ilmanvaihto | Plant room 1 | operating-manual | manual | AHU-01,operating-manual,SYN-DOC-101,final | complete | complete | NO | -
H-02 | AHU-01 | Air handling unit 1 | ilmanvaihto | Plant room 1 | maintenance-plan | manual | AHU-01,maintenance-plan,SYN-DOC-102,reviewed | incomplete | in_progress | YES | status reviewed not final
H-03 | PMP-02 | Heating pump 2 | lämmitys | Plant room 1 | warranty-certificate | warranty | NONE | missing | not_started | YES | not in delivered index
H-04 | FAN-03 | Exhaust fan 3 | ilmanvaihto | Roof | as-built-drawing | drawing | NONE | missing | not_started | YES | not in delivered index
H-05 | PMP-02 | Heating pump 2 | lämmitys | Plant room 1 | operating-manual | manual | PMP-02,operating-manual,SYN-DOC-302,final | complete | complete | NO | superseded line skipped
H-06 | AHU-01 | Air handling unit 1 | ilmanvaihto | Plant room 1 | commissioning-report | commissioning | NONE | missing | not_started | YES | not in delivered index
## Open items for the handover engineer
H-02, incomplete, status reviewed not final
H-03, missing, not in delivered index
Draft for handover engineer review. Statuses come only from the supplied checklist and index; document content was not checked.
```

- Caveat: draft for engineer review; synthetic input; the checklist is an invented placeholder; document content not checked. One passing run on 6 rows is evidence that the design is workable, not a reliability claim.
- Teardown: `podman-compose ... down` done, `podman ps -a --filter label=aic.tryitout -q` empty.
- Tests: scripts/ddc-alignment.om-completeness.test.ts (6, includes the rule table applied to the sample), validators, scripts/check-ddc-decoupling.sh clean, golden unchanged (no catalog-visible field change).

## Agent 12 BMS twin (plan 33-04)

Status: COUNTED (first run, SKILL v1, no revision needed).

- Skill: `5_DDC_Innovative/digital-twin-sync` (SKILL.md and instructions.md read in full). LOOSE match, recorded in the spec: the skill is about construction-progress digital twins and IoT, it has no BMS, BACnet or tag content; the element-to-sensor binding model, sensor value fields and the min/max threshold status are adopted, point naming and tag hints are our own adaptation. Spec committed before any agent file: docs/ddc-alignment/bms-digital-twin.md (binding model, status words, 13 verified skill defects, helper decision, key, rubric).
- Helper: kept. `src/lib/bms/pointStatus.ts` (13 tests incl. a regression per fixed defect: NaN/empty reading is no-data, unit checked before comparison, boundaries inclusive, duplicate asset id ambiguous, unknown prefix unbound, low greater than high is an error) and CLI `scripts/bms-point-status.ts` (exit 2 on bad input, no network, no writes). The model never compares numbers: the status cell is `to compute (tool)`.
- Run (Option A, compose stack with override.tryitout.yml, image tag tryitout): job `a59a358d-a449-474a-88a2-73ab5c4a8553`, model gpt-4.1-mini, 13497 tokens, 3 requests, est. cost 0.0216 USD, input label synthetic (6 invented points with readings, 5 asset lines, 4 tag hints with invented limits), countable true (Pi ran, usage observed, no direct-call fallback). Ledger row present. Local artifact `.tryitout-runs/a59a358d-a449-474a-88a2-73ab5c4a8553/result.md`.
- Key vs result: all 6 rows match the spec section 8 key on every checked cell (`npx tsx scripts/bms-point-status.ts <sample> <result.md>` exit 0): P-01 bound, P-02 bound (helper: above_maximum, 1350 over 1000), P-03 unbound (AHU-09 not in list), P-04 untagged ("return air temp" matches no keyword), P-05 unit-mismatch (rpm vs %), P-06 ambiguous (PMP-05 listed twice). Rubric R1 met, R2 met, R3 met, R4 met, R5 met (low/high copied, status `to compute (tool)` on all rows, no model judgement of readings), R6 met, R7 met (11 cells per row, open items exactly P-03 to P-06, caveat).
- Helper output on the sample: statuses normal, above_maximum, not-bound, untagged, unit-mismatch, not-bound; threshold finding P-02 above_maximum.
- Excerpt of result.md:

```
## Point mapping
point_id | asset_id | tag | unit | reading | low | high | binding | status | review | note
P-01 | AHU-01 | SYN-Supply_Air_Temperature_Sensor | C | 18.5 | 12 | 24 | bound | to compute (tool) | NO | -
P-02 | RM-201 | SYN-CO2_Sensor | ppm | 1350 | 400 | 1000 | bound | to compute (tool) | NO | -
P-03 | UNMAPPED | SYN-Supply_Air_Temperature_Sensor | C | 17.0 | 12 | 24 | unbound | to compute (tool) | YES | asset AHU-09 not in asset list
P-04 | AHU-01 | UNTAGGED | C | 21.0 | - | - | untagged | to compute (tool) | YES | no tag hint matches description
P-05 | FAN-03 | SYN-Fan_Speed_Command | rpm | 1200 | 0 | 100 | unit-mismatch | to compute (tool) | YES | unit differs rpm vs %, not converted
P-06 | AMBIGUOUS | SYN-Discharge_Pressure_Sensor | kPa | 250 | 100 | 400 | ambiguous | to compute (tool) | YES | asset PMP-05 listed twice
## Open items for the engineer
P-03, asset AHU-09 not in asset list
P-06, asset PMP-05 listed twice
Draft for engineer review. Bindings and tags are proposals from the supplied hint table; thresholds and statuses are computed by a tool; no BMS was contacted and no ontology was validated.
```

- Caveat: draft for engineer review; synthetic input, readings and limits invented; no live BMS, no staleness check; tags are proposals, not validated ontology classes. One passing run on 6 points is evidence that the design is workable, not a reliability claim.
- Teardown: `podman-compose ... down` done, `podman ps -a --filter label=aic.tryitout -q` empty.
- Tests: src/lib/bms/pointStatus.test.ts (13), scripts/ddc-alignment.bms-digital-twin.test.ts (8), validators, scripts/check-ddc-decoupling.sh clean, golden diff limited to this entry.

## Phase result (aggregated)
All four moderate-match agents aligned and counted on the first live run: 2 QTO (bim-qto primary), 7 Carbon & EPD (lifecycle-carbon-calculator, tested helper), 11 O&M (as-built-documentation + project-closeout-checklist), 12 BMS twin (digital-twin-sync, loose match; tested helper). `npm run check` green (309 files, 3707 tests). Reliability: one run each on synthetic samples.
