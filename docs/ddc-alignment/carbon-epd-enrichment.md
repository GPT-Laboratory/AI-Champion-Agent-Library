# Alignment spec: agent 7 Carbon and EPD enrichment

Source skill (untrusted data, read in full, SKILL.md and instructions.md, 2026-10-15): `2_DDC_Book/3.3-4D-BIM-CO2-Simulation/lifecycle-carbon-calculator` of the DDC skills repository (MIT, (c) 2026 DataDrivenConstruction). The skill's method, data model and calculation logic are the spec; its code is not packaged or run. instructions.md is a generic wrapper (gather input, process per SKILL.md, tables, constraints) and adds no rules. No book text, no CWICR data, no emission factor from the skill is used: the skill's built-in material table (concrete, steel, timber, gypsum, glass, aluminium values with named sources) is NOT copied and is not treated as data; every value in this agent's sample is invented and labelled synthetic. Written before the agent files were changed.

## 1. Skill method

1. A material record carries a unit and one emission factor (kgCO2e per unit) for each lifecycle stage: product stage A1-A3, transport A4, construction A5, use B1-B7, end of life C1-C4, and module D (beyond the lifecycle, a credit, usually negative), plus density, category and source / EPD link.
2. Material carbon = quantity x factor per stage; the total of a material is the sum over the selected stages.
3. An assembly is a list of materials with quantities; its total and per-stage values are the sums of its materials. A project sums assemblies and direct materials into total embodied carbon, per stage and per category, and divides by gross area for an intensity (kgCO2e per m2), then compares the intensity with building-type benchmarks and gives a rating.
4. Alternatives are compared by recalculating each alternative project and reporting total (t), intensity, percentage change against the base design and rating.
5. Reduction suggestions by category and a text report close the skill.

## 2. Data model and rules (own words)

| Entity | Field | Meaning / enumeration |
|---|---|---|
| Stage | A1-A3, A4, A5, B, C, D | product, transport to site, construction, use, end of life, beyond lifecycle (credit) |
| Factor record (EPD row) | epd_id, material_key, product_name, declared_unit, gwp_a1_a3, gwp_a4, gwp_a5, gwp_b, gwp_c, gwp_d, valid_until, source | one declared unit; one value per stage in kgCO2e per declared unit; a stage that is not declared is `ND`, never 0 |
| Product row | product_id, description, material_key, qty, unit, option | the item to be assessed; `option` is `-` or a letter (A, B) marking alternatives of the same function |
| Stage value | product, stage, value | qty x factor, only when the units agree and the EPD is valid |
| Totals | per stage, total A-C | sums of the declared values; module D is reported on its own and is not part of the A-C total |
| Comparison | option A, option B, basis, lower, absolute and percentage difference | for two alternatives on one stage basis |

Rules: units must agree between product and declared unit before any multiplication; an EPD past its valid_until date (against the supplied reference_date) is not used; a missing, ambiguous, expired or unit-mismatched product is excluded and reported, never counted as zero; a total only covers what is declared and says so.

## 3. Outputs

Skill: material, assembly and project carbon, by stage and category, intensity, benchmark rating, alternatives table, suggestions, report. Agent (one `output/result.md`): `## Product checks` (one line per product), `## Per-product rows` (one row per product, 15 cells: product_id, option, qty, unit, epd, declared_unit, the six stage cells, unit_ok, expired, status; stage cells copied for matched rows, `-` otherwise), `## Totals and comparison` (all `to compute (tool)` plus the option lists), `## Open items for the engineer`, caveat. The tested helper `scripts/carbon-lifecycle.ts` computes stage values, stage totals, the A-C total and the alternative comparison from the input and can check the model's mapping cells.

## 4. Adapted to Finnish MEP

Products are ducts, pipes, valves, pumps, insulation, cables and fittings with declared units kg, m, m2, pcs (and m3 for concrete). The material_key is a short code supplied in the product list (for example from the classification agent). The synthetic EPD excerpt is invented and says so in its first line; no real EPD, register entry or factor table is used (public registers are a connected-setup source only). reference_date validity is kept. Intensity per gross area, benchmarks and ratings are not adopted (the skill's benchmark values are not authoritative and no gross area exists in a product list).

Status vocabulary (fixed, first matching rule): `no-epd` (no EPD row with the same material key), `ambiguous` (two or more), `unit-mismatch` (product unit text differs from declared_unit text), `expired` (valid_until before reference_date), `matched`.

## 5. Deliberate differences (small-model design)

- The model maps and copies: exact material_key lookup, status by the rule above, stage values copied from the one matched EPD row (`ND` stays `ND`). It never multiplies, adds, converts units, counts or ranks. Totals and comparison are `to compute (tool)`.
- The calculation is done by the tested helper outside the Try It Out job; the job stays text in, text out.
- Unit conversion is not done by the model. The helper has one explicit table (kg and t only), applied only when the engineer asks for it; any other mismatch (m2 vs kg, m vs m3) stays an error.
- Draft for engineer review. Biogenic carbon, scenarios, generic-data fallback, assemblies, categories, intensity per area, benchmarks and reduction suggestions are gaps, not adopted.
- Values in the sample are synthetic and non-authoritative; nothing is quoted from a real EPD, register or database.

## 6. Bugs and weaknesses verified in the skill code, and the fix

Every function was checked: `calculate_material_carbon`, `create_assembly`, `calculate_project_carbon`, `_get_rating`, `compare_alternatives`, `suggest_reductions`, `generate_report`, `add_material`.

| # | Finding | Verified in code | Fix in the helper (regression test) |
|---|---|---|---|
| 1 | Lookup keys do not match: defaults are stored under names such as `concrete_30mpa` while each record has `material_id='C30'`, and `add_material` stores under `material_id`; the quick start uses the names, so a material added by id and a default are looked up by different keys | verified (`DEFAULT_MATERIALS` keys vs `self.materials[material.material_id]`) | one identifier (epd_id) lists and resolves a record; an unknown id is a typed error, not a KeyError |
| 2 | No unit check: `calculate_material_carbon` multiplies the quantity by the factor without knowing the quantity's unit (kg vs t, m2 vs m3); `density` is stored but never used | verified (the function takes a bare float) | the product unit must equal the declared unit; otherwise a typed unit-mismatch error; only the explicit kg/t table converts, on request |
| 3 | Module D (a negative credit beyond the lifecycle) is added into `total` together with A-C, so the headline total mixes burdens and credits | verified (`total += carbon` for every stage, D included) | D is reported separately and is not part of the A-C total |
| 4 | Project aggregation is inconsistent: a predefined assembly adds to `total_carbon` but not to `carbon_by_stage` or `carbon_by_category`, so the stage sums no longer equal the total; an unknown assembly id and an item with neither key are silently skipped | verified (the assembly branch does not update the dicts; no else branch) | stage totals and the A-C total are built from the same values (invariant: sum of A, A4, A5, B, C totals equals the A-C total); unknown or unusable items are excluded and reported |
| 5 | A stage that is not declared is 0.0 (dataclass floats) and is summed as a real value, so an undeclared stage looks like a zero burden | verified (`carbon_b=0` in the sample table; no null) | undeclared is `ND` (null), never summed and never 0; stage totals count the products declared per stage |
| 6 | Division by zero: `generate_report` computes `carbon / total_embodied_carbon`, `compare_alternatives` divides by the base total; `carbon_per_area` returns 0 silently when the area is 0 | verified | percentage difference with a zero baseline is `undefined` (not a crash, not 0 %) |
| 7 | Sign error with a negative baseline: `(alt - base) / base * 100` flips the sign when the base total is negative (timber with a negative A1-A3 is in the sample table), so a worse alternative looks better | verified | the baseline in the denominator is `abs(base)` |
| 8 | Suggestion formula: `suggest_reductions` reports a "potential reduction" of `abs(vs_typical)` percent of the total, but getting from 150 % of typical down to typical needs a 33 % reduction, not 50 % | verified | not adopted (no benchmark, no suggestions); recorded so it is not copied |
| 9 | Alternatives with a different gross area are compared by total and intensity under one "vs Base" column that only uses the total | verified | the helper compares like for like: same stage basis, and warns when exclusions or declared stages differ between options |
| 10 | The stage selection parameter silently drops unselected stages but the result field is still called `total_carbon` | verified | the helper names the basis of every total (A1-A3 or A-C) |
| 11 | Display rounding `:,.0f` tCO2e hides small totals (a total of 400 kg prints as 0 t); float noise (60 x 4.2 = 252.00000000000003) | verified (report formatting) | noise removed at 6 decimals, totals shown with 2 decimals once at output, unit kgCO2e |
| 12 | Negative stage values (the biogenic timber A1-A3 of -500) are summed without any disclosure | verified | a warning is attached to every product with a negative stage value; biogenic treatment is a stated gap |

## 7. Helper contract

`src/lib/carbon/lifecycleCarbon.ts` (own code, no I/O), CLI `scripts/carbon-lifecycle.ts`.

- Input: product rows (product_id, description, material_key, qty, unit, option), EPD rows (epd_id, material_key, product_name, declared_unit, gwp per stage, valid_until, source), reference_date.
- `mapProducts`: exact material_key lookup and the status vocabulary of section 4 (the key for the model's job).
- `calcProduct`: stage value = qty x factor, only for declared stages; typed errors: `unit-mismatch`, `missing-factor` (no EPD, or A1-A3 not declared), `expired-epd`, `bad-number`, `bad-date`. Option: kg/t conversion.
- `runCarbon`: maps, calculates matched rows (and unit-mismatched kg/t rows only with the conversion option), returns per-product values, excluded rows with codes, stage totals with the number of products declared, the A-C total, the D total and warnings.
- `compareOptions`: option A (baseline) against option B on basis `A1-A3` (default) or `A-C`: totals, lower option (`A`, `B` or `equal`), absolute difference, percentage of the baseline (`undefined` when the baseline is 0, `abs(baseline)` in the denominator), warnings when something is excluded or declared stage sets differ. Nothing to compare is a typed error.
- Rounding: values cleaned of float noise at 6 decimals, displayed with 2 decimals; exit code 2 on validation errors in the CLI; no network, no writes.

## 8. Answer key (synthetic sample, 6 products) and expected helper numbers

reference_date 2026-10-15. EPD excerpt (invented, SYNTHETIC): EPD-01 CONC-C30 m3 A1-A3 310 valid 2029-12-31; EPD-02 REBAR t 720 valid 2028-06-30; EPD-03 CU-PIPE m 6.1 valid 2025-06-30; EPD-04 MW-INS m2 A1-A3 4.2, A4 0.3, A5 0.1, C 0.2, valid 2028-03-31; EPD-05 WW-INS m2 3.5 valid 2029-01-31; EPD-06 CONC-C30 m3 335 valid 2027-01-31.

| product_id | material_key | qty unit | option | cand | status | branch |
|---|---|---|---|---|---|---|
| X-01 | CONC-C30 | 85 m3 | - | EPD-01,EPD-06 | ambiguous | two EPDs with the same key |
| X-02 | CONC-C25 | 40 m3 | - | NONE | no-epd | missing |
| X-03 | REBAR | 3850 kg | - | EPD-02 | unit-mismatch | kg vs t |
| X-04 | CU-PIPE | 120 m | - | EPD-03 | expired | valid_until 2025-06-30 |
| X-05 | MW-INS | 60 m2 | A | EPD-04 | matched | multi-stage: A1-A3 4.2, A4 0.3, A5 0.1, B ND, C 0.2, D ND |
| X-06 | WW-INS | 60 m2 | B | EPD-05 | matched | clean map, A1-A3 3.5 only (A4 to D ND) |

Expected helper numbers (by hand): X-05 A1-A3 60 x 4.2 = 252, A4 60 x 0.3 = 18, A5 60 x 0.1 = 6, C 60 x 0.2 = 12; A-C total 288. X-06 A1-A3 60 x 3.5 = 210; A-C total 210. Stage totals: A1-A3 462 (2 products), A4 18 (1), A5 6 (1), B not declared, C 12 (1), D not declared; A-C total 498. Excluded: X-01 ambiguous, X-02 no-epd, X-03 unit-mismatch, X-04 expired. Comparison option A vs B on A1-A3: A 252, B 210, lower B, difference 42 (-16.67 % of the baseline). On A-C: A 288, B 210, difference 78 (-27.08 %), warning: declared stage sets differ. With the kg/t option X-03 becomes 3.85 t x 720 = 2772 and the A1-A3 total 3234.

## 9. Rubric R1 to R7 (written before the live run)

- R1 Each product appears exactly once, in input order, in `## Product checks` and in `## Per-product rows`.
- R2 EPD mapping by exact material key only: candidates X-01 EPD-01,EPD-06; X-02 NONE; X-03 EPD-02; X-04 EPD-03; X-05 EPD-04; X-06 EPD-05; no mapping by name or similarity.
- R3 Status per the lookup: X-01 ambiguous, X-02 no-epd, X-03 unit-mismatch, X-04 expired, X-05 and X-06 matched; the open-items list names exactly the four problem rows.
- R4 Stage values copied exactly for matched rows (X-05 4.2, 0.3, 0.1, ND, 0.2, ND; X-06 3.5 and ND for the rest); `ND` kept for undeclared stages (written `not declared` or `ND`, never 0 or blank); `-` stage cells for non-matched rows.
- R5 No model arithmetic: no sums, products, conversions, counts or ranking; the totals and comparison lines say `to compute (tool)`.
- R6 Every value labelled synthetic; no invented EPD ids, numbers or dates.
- R7 Format as specified and the draft caveat at the end.

Harness check beside the rubric: `npx tsx scripts/carbon-lifecycle.ts <input> [result.md]` prints the helper totals and comparison above and compares the model's mapping cells with the helper.
