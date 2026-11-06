# Phase 33 human UAT

## Agent 2 QTO (plan 33-01)
- [ ] Skim docs/ddc-alignment/qto-normalization.md: is bim-qto (not qto-report) the right primary skill, and are the unit lookup table (mm/cm/l/t/g and spellings) and the groups (Ilmanvaihto, Putkisto, Sähkö) acceptable defaults for Finnish MEP take-offs?
- [ ] Run `npx tsx scripts/qto-group-totals.ts data/tryitout-prompts/qto-normalization/sample-qto-table.txt .tryitout-runs/ab6e8dcd-04f0-46e0-94cf-e281eccf170a/result.md` (local run output): do the totals by group and level and the excluded list suit your estimating practice?
- [ ] Decide whether the helper should be wired into the app (post-processing of the job result) or stay a harness/engineer step, and whether duplicates should be merged (summed) instead of excluded.
- [ ] Confirm the ambiguous-number rule (`1,250` is not guessed) and that imperial units stay UNRESOLVED.

## Agent 7 Carbon and EPD (plan 33-02)
- [ ] Skim docs/ddc-alignment/carbon-epd-enrichment.md: are the stage grouping (A1-A3, A4, A5, B, C, D), module D kept out of the A-C total, and the 12 listed skill defects with their fixes right for your carbon practice?
- [ ] Run `npx tsx scripts/carbon-lifecycle.ts data/tryitout-prompts/carbon-epd-enrichment/sample-products-epd.txt .tryitout-runs/83fc51d0-ad72-459b-b883-8a8eb838cf79/result.md` (add `--convert` to see the kg/t conversion): do the stage totals and the option comparison suit you?
- [ ] Decide whether the kg/t table should be the only conversion, whether comparison should default to A1-A3, and whether the helper should be wired into the app or stay an engineer step.
- [ ] Confirm that biogenic carbon, scenarios, intensity per area and benchmarks stay out of scope (listed gaps), and that real EPD data must come from a licensed or public register you choose (the sample values are invented).

## Agent 11 O and M (plan 33-03)
- [ ] Skim docs/ddc-alignment/om-completeness.md: are the generic Finnish document terms mapped to the skill's types (manual, commissioning, test_report, drawing, warranty, submittal, certificate) and the systems acceptable for a MEP handover?
- [ ] Confirm the status rule: only `final` counts as complete (the skill's rule), everything else (draft, reviewed, approved, as_built) is incomplete. Should `approved` or `as_built` count as complete in your practice?
- [ ] Decide how superseded versions should be signalled in real document-management exports (status word `superseded` was assumed) and whether asset registry fields (manufacturer, serial, warranty) should be added as further copied columns.
- [ ] Confirm that the required-document checklist always comes from your contract and that the agent never derives it; read `.tryitout-runs/73ac51f8-4eb4-41cb-8bb6-a67a9b871b8e/result.md` for the draft format.

## Agent 12 BMS twin (plan 33-04)
- [ ] Skim docs/ddc-alignment/bms-digital-twin.md: the skill (digital-twin-sync) is only a loose match for a BMS (no BMS content); are the adopted parts (element-to-sensor binding, min/max threshold status, 13 listed skill defects) and our own adaptation (id-prefix binding, hint table, expected units) right for your point lists?
- [ ] Run `npx tsx scripts/bms-point-status.ts data/tryitout-prompts/bms-digital-twin/sample-bms-points.txt .tryitout-runs/a59a358d-a449-474a-88a2-73ab5c4a8553/result.md`: do the statuses (normal, above_maximum, not-bound, untagged, unit-mismatch) and the inclusive band boundaries suit your practice?
- [ ] Decide whether the helper should be wired into the app or stay an engineer step, whether staleness (timestamp or age per reading) should become an input column, and whether real point naming schemes need more than the exact id prefix.
- [ ] Confirm all limits must come from your own commissioning data (sample limits are invented) and that ontology validation (Brick or other) stays out of scope.
