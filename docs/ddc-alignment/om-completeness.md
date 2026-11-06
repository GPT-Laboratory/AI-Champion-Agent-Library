# Alignment spec: agent 11 O&M completeness

Source skills (untrusted data, read in full, SKILL.md and instructions.md of both, 2026-10-15), DDC skills repository (MIT, (c) 2026 DataDrivenConstruction):
- primary: `5_DDC_Innovative/as-built-documentation`
- secondary: `1_DDC_Toolkit/Project-Closeout/project-closeout-checklist`

The method, data model, rules and outputs below are the spec; the skills' code is not packaged or run. Both instructions.md files are a generic wrapper (gather input, process per SKILL.md, tables, constraints) and add no rules. No book text, CWICR or data from other projects is used. Written before the agent files were changed.

## 1. Method

as-built-documentation: (a) a requirement list per building system (document type, mandatory flag, quantity); (b) uploaded project documents carrying type, system, version, status and the requirement they answer; (c) a document lifecycle draft, reviewed, approved, as_built, final (upload creates draft, approve and finalize move forward); (d) completeness: a requirement is satisfied only by documents with status final, `missing` lists unsatisfied mandatory requirements; (e) an asset registry (one record per equipment with identification, location, installation, warranty, document links, BIM reference); (f) an O&M manual generator that assembles a manual from documents and assets; (g) a handover checklist with the categories Documents, Asset Registration, Training and an overall status.

project-closeout-checklist: a list of closeout items, each with category (documentation, financial, inspections, training, warranties, punchlist, turnover), responsible party, due date and a status; completion percentage and outstanding list; export.

## 2. Data model and rules (own words)

HandoverDocument types (DocumentType):

| Skill type | Meaning |
|---|---|
| drawing | as-built drawing |
| specification | specification or schedule |
| submittal | submitted product data |
| warranty | warranty document |
| certificate | certificate, inspection document |
| manual | operation and maintenance manual |
| test_report | test, adjusting and balancing report |
| commissioning | commissioning report |
| photo | photo record |

Document status (DocumentStatus): draft, reviewed, approved, as_built, final. Rule in the skill: only `final` satisfies a requirement.

Asset registry fields (AssetDetails): asset id and tag, name, type, category, manufacturer, model number, serial number, part number, building, floor, room, install date, installed by, cost, warranty start/end/provider/terms, specifications, linked manuals/drawings/photos, maintenance schedules (task, frequency, next due, responsible, duration), service contacts, BIM reference (IFC guid, element id).

Requirement fields (DocumentRequirement): requirement id, document type, system, description, mandatory, quantity, format.

Closeout item fields: item id, description, category, responsible party, due date, status, completed date, notes, attachments. Closeout statuses (ItemStatus): not_started, in_progress, complete, not_applicable.

Building systems (BuildingSystem): architectural, structural, mechanical, electrical, plumbing, fire_protection, controls, elevator, civil, landscape.

## 3. Outputs of the skills

Completeness dict (complete flag, missing types, counts), per-requirement completion (required, submitted, complete), missing-document list, warranty report, CMMS export, system manual structure (overview, equipment schedule, operation, maintenance, warranty, contacts, reference documents), handover checklist with overall status, closeout completion percentage and outstanding list.

## 4. Adapted to Finnish MEP O&M

Language stays English with generic Finnish terms. Systems: ilmanvaihto (ventilation), lämmitys (heating), vesi ja viemäri (water and drain), sähkö (electrical), automaatio (controls), sprinkler. Generic document terms mapped to the skill types (the agent copies the `doc_type` text of the checklist and reads the skill type off this table; the table is a label, matching is on the exact doc_type text):

| doc_type text (generic) | Finnish generic term | Skill type |
|---|---|---|
| operating-manual | käyttö- ja huolto-ohje | manual |
| maintenance-plan | huolto-ohjelma | manual |
| commissioning-report | käyttöönottopöytäkirja (asennus- ja käyttöönottopöytäkirja) | commissioning |
| balancing-report | mittaus- ja säätöpöytäkirja | test_report |
| as-built-drawing | toteumapiirustukset | drawing |
| warranty-certificate | takuutodistus | warranty |
| product-data | tuotetiedot, CE-merkintä | submittal |
| conformity-certificate | vaatimustenmukaisuus-/tarkastustodistus | certificate |

Types outside the table (for example spare-parts-list) keep working for matching; their skill type is `other`. No real standard, contract or authority requirement text is used; the sample checklist is an invented placeholder. Building system mapping for labels only: ilmanvaihto and lämmitys to mechanical, vesi ja viemäri to plumbing, sähkö to electrical, automaatio to controls, sprinkler to fire_protection.

## 5. Deliberate differences

- Index only: the agent reads two texts (required rows, delivered index) and never judges content; `final` in the index is taken at face value.
- Status mapping: index status `final` gives complete; any other status word (draft, reviewed, approved, as_built, or other text) gives incomplete; no matching line gives missing. This is the skill's final-only rule with the skill's non-final states collapsed into one. The skill's own words are carried as the copied index status; the closeout word is read off: complete to `complete`, incomplete to `in_progress`, missing to `not_started`. `not_applicable` is not produced (the engineer decides applicability; the checklist simply would not list the row).
- No counts, quantities, percentage complete or overall handover status (the model does no arithmetic; the skill's counts are dropped). No quantity per requirement (always one document).
- Asset registry fields are carried as copied columns of the checklist (equipment id as asset tag, equipment as asset name, system, location) and copied into the output row; no registry is derived, no warranty report, no maintenance schedules, no CMMS export, no manual generation, no training category.
- Supersession: the skill points to the earlier version (`supersedes`). The agent form is the index status word `superseded` on the older line; such a line is skipped when matching (same exclusion).
- Proposals only: open items are listed for the engineer; no acceptance or rejection.

## 6. Skill bugs and inconsistencies found, and how handled

Checked `check_handover_completeness`, `DocumentManager` (status summary, missing documents, finalize), `AssetRegistry`, `generate_handover_checklist` and the closeout class.

1. `check_handover_completeness` compares document TYPES only: a manual for one system satisfies a manual requirement of every other system. Fixed: the agent matches equipment id AND document type.
2. It reports `total_present` as the number of distinct FINAL types, not a count of requirements met; `complete` ignores quantity. Dropped (no counts).
3. A requirement is `missing` whether nothing was delivered or the document exists but is not final; the two cases are not distinguished. Fixed: missing versus incomplete.
4. `finalize_document` requires status approved, so status `as_built` can never be reached through the skill's own transitions and is never counted: an as-built drawing in as_built is reported missing. Handled: as_built is read as non-final (incomplete) and reported as such.
5. In `generate_handover_checklist` the Training category is hard-coded pending, so `overall_status` can never be complete. Not reused (no overall status, no training).
6. The Asset Registration category is complete when at least one asset exists, regardless of how many are registered. Not reused.
7. `get_status_summary` lists a requirement as complete when `submitted >= quantity`, but `submitted` only counts documents carrying the requirement id; documents without it never count. Not reused; matching uses equipment and type.
8. `generate_system_manual` selects assets by substring match of the system name inside asset type or category, which is unreliable (for example "plumbing" never matches "pump"). Not reused.
9. `add_warranty` uses 365 days per year (leap days lost). Not reused (no dates).
10. `export_to_cmms` writes `///` when building, floor and room are empty. Not reused.
11. Closeout: `update_status` sets completed_date on complete but never clears it when status moves back; `get_completion_percentage` returns 0 when every item is not_applicable, indistinguishable from nothing done. Not reused (no percentage).
12. Closeout items are all assigned responsible party "Contractor" and a due date equal to substantial completion by default; no owner ever differs unless set by the caller. Not reused (no owner or due dates; the engineer sets them).
13. `ProjectDocument.requirement_id` is Optional, so a document can satisfy nothing; the enum DocumentStatus word `as_built` is not used by any rule (see 4).

## 7. Answer key (synthetic sample, derived by hand from the rule table)

Rule table: line = first index line with the same eq_id AND doc_type, skipping lines whose status is `superseded`; none gives missing; status text `final` gives complete; any other text gives incomplete.

| req_id | eq_id | doc_type | status | quoted index line | closeout | open-item reason |
|---|---|---|---|---|---|---|
| H-01 | AHU-01 | operating-manual | complete | AHU-01,operating-manual,SYN-DOC-101,final | complete | none (no open item) |
| H-02 | AHU-01 | maintenance-plan | incomplete | AHU-01,maintenance-plan,SYN-DOC-102,reviewed | in_progress | status reviewed not final |
| H-03 | PMP-02 | warranty-certificate | missing | NONE | not_started | equipment has other documents, none of this type (wrong document type delivered) |
| H-04 | FAN-03 | as-built-drawing | missing | NONE | not_started | equipment not in delivered index at all |
| H-05 | PMP-02 | operating-manual | complete | PMP-02,operating-manual,SYN-DOC-302,final | complete | none; line SYN-DOC-301 is superseded and skipped |
| H-06 | AHU-01 | commissioning-report | missing | NONE | not_started | only another equipment (AHU-02) has this document type |

Open items: H-02, H-03, H-04, H-06.

## 8. Rubric R1-R7

- R1: each required row appears exactly once, in input order, in the checks and in the table; index lines no required row names do not become rows.
- R2: status and closeout word follow the rule table for every row (key above).
- R3: the quoted index line is copied exactly from the index (cell text and order), the superseded line is not quoted.
- R4: missing rows say NONE / not in delivered index; no invented references or document ids.
- R5: no counts, percentages, totals or overall handover verdict; no claim that content was checked.
- R6: no invented documents, equipment or requirements; asset columns (equipment, system, location) copied exactly.
- R7: format as specified, closing draft caveat present, no approval or rejection of the handover; open items list exactly the review=YES rows.
