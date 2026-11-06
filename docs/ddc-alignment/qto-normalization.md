# Alignment spec: agent 2 QTO normalization

Source skills (untrusted data, read in full, SKILL.md and instructions.md of each, 2026-10-15), DDC skills repository, MIT, (c) 2026 DataDrivenConstruction: `2_DDC_Book/3.2-QTO-Auto-Estimates/bim-qto` (PRIMARY) and `2_DDC_Book/3.2-QTO-Auto-Estimates/qto-report` (secondary). Their method, data model and rules are the spec; their code is not packaged or run. Both instructions.md files are the generic wrapper (gather input, process per SKILL.md, tables, constraints) and add no rules. Written before the agent files were changed.

Primary choice, and the difference from the working mapping: the working mapping named `qto-report` first. `qto-report` opens with a quotation from the DDC book (chapter 3.2) and a book reference, and is otherwise generic pandas snippets (group by category, pivot, price merge, waste factor, design vs as-built). `bim-qto` has no book text beyond a chapter pointer and carries the concrete data model (QTOItem, column mapping, group by type / category / level, level-by-type matrix, report object). `bim-qto` is the closer match and is primary. Pieces of `qto-report` are used only as ideas (multi-level grouping, waste and price steps are out of scope, see section 5).

## 1. Skill method

1. Load a BIM or CAD export as a table of elements with columns for type, category, level, volume, area, length, count, material. A column-mapping step finds the actual column names from several variants.
2. Group the rows: by type name, by category, by level (sum of one quantity column plus the row count per group); a level-by-type count matrix; optional filters by category or level.
3. Build a report: one item per type with category, description, quantity, unit, level, material, element count; totals of elements and categories.
4. Export to a spreadsheet with one sheet per grouping (by category, by type, level matrix, walls, doors, windows).
`qto-report` adds: multi-level grouping (level, category, material), a pivot with margins, calculation rules per category, unit prices, waste factors, and a Revit cubic-feet to cubic-metre factor.

## 2. Data model and rules (own words)

| Entity | Field | Meaning |
|---|---|---|
| QTO item | category / group | trade or element group of the row |
| QTO item | type_name / description | what is measured |
| QTO item | quantity, unit | measured amount and its unit (enumeration below) |
| QTO item | level | building storey or zone |
| QTO item | material, element_count | optional |
| Unit enumeration of the skill | ea, m, m2, m3, kg, lf, sf, cy | count, length, area, volume, weight, and three imperial units |
| Grouping | by group, by level (by type, by category) | sum of quantity per group, row count |
| Report | items, totals | one line per type, grand counts |

Rules the agent keeps: one row is one item with a category, a description, a quantity with a unit and a level; the grouping key is a copied field (group, level); quantity is summed per group only within one unit.

## 3. Outputs

Skill: grouped summaries per type, category and level, level matrix, item report, spreadsheet. Agent (one `output/result.md`): `## Normalised rows` table, `## Grouped totals` with a `to compute (tool)` line, the draft caveat. The grouped totals by group and by level come from the deterministic helper `src/lib/qto/groupTotals.ts` (CLI `scripts/qto-group-totals.ts`), not from the model.

## 4. Adapted to Finnish MEP

Groups are MEP systems and trades: Ilmanvaihto (ventilation), Putkisto (piping), Sähkö (electrical); the sample uses invented rows for an invented building. Canonical units: `m`, `m2`, `m3`, `kg`, `pcs` (the skill's `ea` is written `pcs`; imperial units are not accepted, see section 6).

Unit lookup table (every accepted spelling and every factor; lookup is case-sensitive on the copied unit text, spellings differ in case on purpose):

| copied unit | canonical unit | factor | kind |
|---|---|---|---|
| m | m | 1 | canonical |
| M | m | 1 | spelling |
| m2 | m2 | 1 | canonical |
| M2, m², sqm, m^2 | m2 | 1 | spelling |
| m3 | m3 | 1 | canonical |
| M3, m³, cum | m3 | 1 | spelling |
| kg | kg | 1 | canonical |
| pcs | pcs | 1 | canonical |
| pc, ea, kpl | pcs | 1 | spelling |
| mm | m | 0.001 | convert |
| cm | m | 0.01 | convert |
| l, L | m3 | 0.001 | convert |
| t | kg | 1000 | convert |
| g | kg | 0.001 | convert |
| anything else, including empty (roll, bag, set, ft, sf, cy, lf, ...) | UNRESOLVED | - | unconvertible |

Number format rule (copy rule for the model, parse rule for the helper): spaces (also non-breaking) inside the number are removed; a single comma is a decimal comma and becomes a decimal point; a number with both comma and point uses the last separator as the decimal one and removes the other; a single comma followed by exactly three digits with one to three digits before it (for example `1,250`) is ambiguous: the helper raises `ambiguous-number`, the model must not guess (not in the sample). Empty quantity is `missing-quantity`; anything not numeric is `bad-number`.

Group label rule: lowercase the copied group; labels are `Ilmanvaihto`, `Putkisto`, `Sähkö` (lookup on the lowercase text; `sahko` also means `Sähkö`); any other group is written with the first letter uppercase and the rest lowercase.

## 5. Deliberate differences (small-model design)

- The model normalises row by row via the lookup (one row in, one row out, 8 cells), flags and copies. It does NOT multiply: the table carries the number text (decimal-point fixed) and the lookup factor; the canonical quantity is `qty x factor` and is computed by the helper. Grouped totals by group and by level are `to compute (tool)`.
- Duplicates: a row is a duplicate when an EARLIER row has the same description, quantity text, unit text and level (group compared ignoring case); the later row gets `dup_of=<earlier row_id>` and `issue=DUPLICATE`, and is excluded from totals by the helper. Never deleted.
- One issue code per row, first match in this order: MISSING-QTY, UNRESOLVED-UNIT, DUPLICATE, UNIT-CONV, NUMFMT, UNIT-SPELL, OK.
- Draft only for engineer review; no geometry, no model, no IFC or Excel parsing, no prices, no waste factors, no cost mapping, no CWICR.
- Not adopted from the skills: unit prices, waste factors, design vs as-built comparison, spreadsheet export, level-by-type matrix, category filters, percentage columns. The agent normalises a take-off table; it is not an estimating agent.

## 6. Book-text exclusion, bugs and weaknesses found in the skills' grouping and unit code

Book-text exclusion: `qto-report` quotes the DDC book (chapter 3.2) and the book title. No book text, quotation or title text is copied into the agent, the sample or this spec beyond the chapter pointer; no CWICR data is used (none appears in either skill); nothing from other licences or repositories.

| # | Finding | Verified in code | Fix in the helper |
|---|---|---|---|
| 1 | bim-qto `generate_report` picks ONE quantity per type (volume if the column exists, else area, else count) and sums it; if the volume column exists but is empty for a type, the sum is 0 and the unit still says m3 (silent zero with a wrong unit) | verified: `if vol_col and vol_col in group.columns` tests the column, not the values | missing quantity is an error and the row is excluded and reported, never a zero |
| 2 | bim-qto `generate_report` takes `level = group[level_col].iloc[0]`: a type on several levels is reported on the first level only | verified | totals are kept per (group, level) and per (group, unit); no first-value shortcut |
| 3 | Quantities of one group are summed without looking at the unit (mixed m and m2 rows would be added) | verified in `group_by_*` and `generate_qto` (sum of one column, units never compared) | totals are keyed on canonical unit; different units are never added |
| 4 | `groupby` drops rows whose key is missing (NaN level or category) silently | verified (pandas default dropna) | a row without a group or level is a typed error, reported not dropped |
| 5 | Column mapping `count` includes `Quantity`, so a column named Quantity is treated as an element count | verified in COLUMN_MAPPINGS | the agent's table has one `quantity` column plus one `unit` column; the unit decides |
| 6 | qto-report `formula_type == 'count'` gives `groupby(...).ngroup() + 1`, a group index, not a count | verified | not adopted; counts are not produced by the model |
| 7 | QTOUnit lists lf, sf, cy next to metric units with no conversion factor; qto-report converts Revit volume with 0.0283168 and nothing else | verified | imperial units are UNRESOLVED (no factor invented); only the lookup in section 4 converts |
| 8 | `to_excel` swallows every error with a bare `except: pass` on the level matrix | verified | not applicable (no export); helper errors are typed |
| 9 | qto-report `apply_excel_rules` silently drops categories that have no rule | verified (concat of rule categories only) | not applicable; rows without a unit rule are UNRESOLVED and listed |
| 10 | Rounding: `round(qty, 2)` per item before any further use, so rounded values are summed later | verified | per-row canonical value rounded to 6 decimals only to remove float noise, totals rounded to 3 decimals once at output |
| 11 | `group_by_type` renames columns by length of the result, fragile | verified | not applicable |

## 7. Helper decision

Grouped totals are computed by a tested, deterministic helper: `src/lib/qto/groupTotals.ts` (own code, TypeScript; corrects findings 1 to 4, 7 and 10), CLI `scripts/qto-group-totals.ts <input.csv> [result.md]`. It parses the input CSV, normalises every row with the lookup, detects duplicates, and prints totals by group and unit and by level and unit, the excluded rows with reasons, and, when a result.md is given, a row-by-row check of the model's unit, factor, dup_of and issue cells against its own. The Try It Out job stays text in, text out; the model writes `to compute (tool)` in the totals section. No change to the app, job API or runner.

## 8. Answer key (synthetic sample, 6 rows) and expected helper totals

Input (invented): all rows `row_id,group,description,quantity,unit,level`.

| row_id | group (input) | quantity (input) | unit (input) | level | branch |
|---|---|---|---|---|---|
| Q-01 | Putkisto | 48.5 | m | Level 1 | already canonical |
| Q-02 | ilmanvaihto | "36,4" | m | Level 1 | decimal comma |
| Q-03 | Putkisto | 2400 | mm | Level 2 | convertible unit |
| Q-04 | Sähkö | 3 | roll | Level 1 | unconvertible unit |
| Q-05 | PUTKISTO | 48.5 | m | Level 1 | duplicate of Q-01 (same description) |
| Q-06 | Ilmanvaihto | (empty) | pcs | Level 2 | missing quantity |

Expected normalised rows (row_id | group | level | qty | unit | factor | dup_of | issue), computed by hand from the lookup:

| row_id | group | level | qty | unit | factor | dup_of | issue | canonical quantity (helper) |
|---|---|---|---|---|---|---|---|---|
| Q-01 | Putkisto | Level 1 | 48.5 | m | 1 | - | OK | 48.5 m |
| Q-02 | Ilmanvaihto | Level 1 | 36.4 | m | 1 | - | NUMFMT | 36.4 m |
| Q-03 | Putkisto | Level 2 | 2400 | m | 0.001 | - | UNIT-CONV | 2.4 m |
| Q-04 | Sähkö | Level 1 | 3 | UNRESOLVED | - | - | UNRESOLVED-UNIT | excluded |
| Q-05 | Putkisto | Level 1 | 48.5 | m | 1 | Q-01 | DUPLICATE | excluded |
| Q-06 | Ilmanvaihto | Level 2 | - | pcs | 1 | - | MISSING-QTY | excluded |

Expected helper totals: by group and unit: Putkisto m 50.9 (48.5 + 2.4), Ilmanvaihto m 36.4; by level and unit: Level 1 m 84.9 (48.5 + 36.4), Level 2 m 2.4. Excluded: Q-04 (unresolved-unit), Q-05 (duplicate of Q-01), Q-06 (missing-quantity). Sähkö and Ilmanvaihto pcs have no total.

## 9. Rubric R1 to R7 (written before the live run)

- R1 Each input row appears exactly once in input order in `## Normalised rows`, 8 cells per row, none dropped or invented.
- R2 Unit and factor cells are copied from the lookup table (Q-01 m/1, Q-02 m/1, Q-03 m/0.001, Q-06 pcs/1); qty is the number text with a decimal point, no multiplication (Q-03 qty stays 2400).
- R3 Group labels follow the label rule (Putkisto, Ilmanvaihto, Sähkö) and the duplicate is found by copying rule: Q-05 `dup_of` Q-01, no other row has a dup_of.
- R4 Unconvertible and missing cases are flagged, not guessed: Q-04 unit UNRESOLVED, factor `-`, issue UNRESOLVED-UNIT; Q-06 qty `-`, issue MISSING-QTY.
- R5 Issue codes follow the key (OK, NUMFMT, UNIT-CONV, UNRESOLVED-UNIT, DUPLICATE, MISSING-QTY) and no model totals: the totals section says `to compute (tool)` and holds no sums or converted quantities.
- R6 No invented rows, numbers, units or factors.
- R7 Format as specified (one table, the totals line, no code fence) and the draft caveat at the end.

Harness check beside the rubric: `npx tsx scripts/qto-group-totals.ts <input> <result.md>` shows the key totals above and zero mismatches against the model's cells.
