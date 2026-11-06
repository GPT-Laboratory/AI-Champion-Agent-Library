# Alignment spec: agent 12 BMS digital twin

Source skill (untrusted data, read in full, SKILL.md and instructions.md, 2026-10-15): `5_DDC_Innovative/digital-twin-sync` of the DDC skills repository (MIT, (c) 2026 DataDrivenConstruction). The skill's method, data model and rules are the spec; its code is not packaged or run (no WebSocket, MQTT, IoT or live feed is used). instructions.md is a generic wrapper (gather input, process per SKILL.md, tables, constraints) and adds no rules. No book text and no CWICR data are used. Written before the agent files were changed.

Match quality (recorded honestly): this is a LOOSE match. The skill is about construction-progress digital twins (BIM element status from schedule and field updates, IoT sensors on site). It has no BMS, BACnet, Brick or building-services content, no point naming scheme and no tag model. What it does contain and what this agent adopts: the element-to-sensor binding model, the sensor value record (id, value, unit, timestamp, quality), the min/max threshold check with a status, and the idea of one binding per element and property. What it does not contain: point-to-asset name matching, ontology tags, unit expectations per sensor type (those are our own adaptation, marked below).

## 1. Skill method

1. A twin holds elements (element_id, ifc_guid, element_type, name, status planned / in_progress / completed / issue, properties, sensor bindings). A property value carries value, unit, timestamp, source (bim, iot, schedule, field, drone, manual), confidence and a short history.
2. Binding: an element is bound to a sensor either as a plain list of sensor ids (SimpleTwin) or as a map from property name to sensor id (DigitalTwinCore.bind_sensor_to_property), optionally with a transform function.
3. Sync: an incoming sensor reading (sensor_id, value, unit, timestamp) is applied to every element bound to that sensor id: the property is updated, the previous value goes to history, an event is emitted.
4. Status: element construction status follows schedule progress (0 percent planned, below 100 in progress, 100 completed) or a field update.
5. Thresholds and anomalies: a threshold per `element_id:property` has min, max and a standard-deviation multiplier. A reading below min is `below_minimum`, above max is `above_maximum` (severity warning); with at least 10 prior values a z-score above 3 is a `statistical_outlier` (critical above 5).
6. Schedule variance, WebSocket broadcast, MQTT hook and snapshots are outside the BMS use.

## 2. Data model and rules (own words)

| Entity | Skill field | Agent field | Meaning / enumeration |
|---|---|---|---|
| Element | element_id, element_type, name | asset_id, kind, name | asset from the model export (equipment or space) |
| Sensor / point | sensor_id, unit, value | point_id, point_name, unit, reading | one BMS point with an optional reading as text |
| Binding | sensor_bindings (property to sensor) | asset_id + tag on a point | a point is bound to ONE asset (exact id prefix of the point name) and carries ONE tag (the property) |
| Property | property_name | tag | proposed tag from the supplied hint table |
| Threshold | min, max | low, high | numeric band per tag, empty side = unbounded |
| Status | below_minimum, above_maximum, (normal) | status | threshold status; extended below with the cases the skill leaves undefined |

Binding statuses (agent vocabulary, own, fixed first-match order): `unbound` (no asset with the prefix), `ambiguous` (two or more asset lines with the prefix), `untagged` (no tag hint matches), `unit-mismatch` (point unit text differs from the expected unit), `bound`.

Threshold statuses (helper only): `not-bound` (binding unbound or ambiguous), `untagged`, `unit-mismatch` (no comparison is made), `no-data` (reading empty or not a number), `no-limits` (both low and high empty), `below_minimum` (reading < low), `above_maximum` (reading > high), `normal` (inside the band, the boundary values low and high are inside, as in the skill's strict comparisons).

## 3. Outputs

Skill: element and project snapshots, event list, variance report, anomaly records. Agent (one `output/result.md`): `## Point checks` (one line per point), `## Point mapping` (one row per point, 11 cells: point_id, asset_id, tag, unit, reading, low, high, binding, status, review, note; the status cell is `to compute (tool)` for every row), `## Open items for the engineer`, draft caveat. The tested helper `scripts/bms-point-status.ts` (module `src/lib/bms/pointStatus.ts`) derives binding and status for every point from the same input and can check the model's mapping table cell by cell.

## 4. Adapted to Finnish MEP (own adaptation, not from the skill)

Assets are ilmanvaihtokone (AHU), puhallin (FAN), pumppu (PMP) and huone / tila (RM) as in a model export; asset id and kind come from the asset list. A BMS point name is `<asset id>.<signal>` (exact id prefix before the first dot). Tag hints are a supplied table (keyword contained in the description, first match in table order, expected unit, synthetic low and high). Tag names are invented synthetic strings in a Brick-like style, not validated ontology classes. All limits are invented and labelled synthetic; nothing is a real setpoint, alarm limit or comfort criterion. Units are copied and compared as text (`C`, `%`, `ppm`, `kPa`, `rpm`), never converted.

## 5. Deliberate differences (small-model design)

- Text only: point list, asset list, tag hints and a `reading` column are input text. No live feed, no BACnet, no IoT, no write-back, no history, no events, no WebSocket or MQTT. Reading values in the sample are synthetic text.
- Binding by exact id prefix and keyword lookup in table order; the model copies lines and ticks checks. Statuses are derived by the tested helper, never by the model (the model never compares numbers).
- Not adopted: element construction status and schedule progress, properties history, confidence, statistical outliers (z-score needs a window of live values), transforms, geometry, parent/children, drone and field sources.
- Proposals only for engineer review; no claim that the twin is valid, complete or in sync.
- Staleness: the skill stores a timestamp and a confidence but never uses them (finding 7); the agent input has no timestamp, so a stale reading cannot be detected. Recorded as a gap in the entry; the helper treats an empty reading as `no-data`.

## 6. Skill bugs and inconsistencies found, and how handled

Checked `SimpleTwin` (bind_sensor, update_sensor, get_element_state), `DigitalTwinElement.update_property`, `DigitalTwinCore` (import_from_ifc, bind_sensor_to_property, process_sensor_update, update_status), `ScheduleTwinIntegrator`, `TwinAnomalyDetector`.

1. Two incompatible binding models: `sensor_bindings` is a list of sensor ids in `TwinElement` and a map property-to-sensor in `DigitalTwinElement`; a point cannot say which property it measures in the first. Fixed: a binding is always asset + tag.
2. `bind_sensor` silently does nothing when the element id is unknown, and appends the same sensor twice when called twice. Fixed: an unknown prefix is `unbound` and reported; two asset lines with the same id are `ambiguous`, never merged.
3. `import_from_ifc` stores elements in a dict keyed by element_id, so a duplicate id silently overwrites the earlier element, and a missing id gets a count-based default that can collide. Handled: duplicate asset ids are `ambiguous` and listed, never overwritten.
4. `process_sensor_update` reassigns the `value` variable when a transform exists, so with several elements bound to one sensor the transform is applied again and again to the already transformed value. Not reused (no transforms); recorded so it is not copied.
5. Transform functions are stored inside `sensor_bindings` next to sensor ids under a `<property>_transform` key; a property literally named `x_transform` collides and the map mixes strings and callables (not serialisable). Not reused.
6. Units are ignored in the threshold check: `check_value(element_id, property_name, value)` takes a bare float, and `update_property` keeps the OLD unit when the new unit is empty (`unit or prev.unit`) and silently accepts a changed unit. Fixed in the helper: the point unit must equal the expected unit of the tag, otherwise `unit-mismatch` and no comparison.
7. A missing, NaN or non-numeric value is judged `normal`: all comparisons with NaN are false, `monitor_element` skips non-numeric properties without any record, and `quality`, `confidence` and timestamps are stored but never used, so stale or low-quality data counts as normal. Fixed: empty or non-numeric reading is `no-data`, never `normal`.
8. Threshold boundaries are implicit (strict `<` and `>` against min and max). Made explicit: the boundary values are inside the band (`normal`).
9. The statistical outlier branch overwrites the type and severity set by the threshold branch, and every checked value (anomalous or not) enters the window, so a persistent fault contaminates the baseline; `np.std` is the population deviation. Not adopted (no window); recorded.
10. No guard for min greater than max (an impossible band flags every reading). Fixed: a hint row with low greater than high is a typed error.
11. `_determine_status` uses `percent == 0` on floats, treats negative percent as in progress and never returns `issue`, which is only set by hand. Not adopted (no element status).
12. `calculate_schedule_variance` skips zero-duration activities silently and calls any positive variance `ahead`, however small. Not adopted.
13. `get_element_state` returns `{}` for an unknown element, indistinguishable from an element without data. Handled by `unbound`.

## 7. Helper decision

Decision: KEEP a `reading` column and a tested helper `src/lib/bms/pointStatus.ts` plus CLI `scripts/bms-point-status.ts`. Why: the skill's core value beyond binding is the threshold/status logic (findings 6 to 8 are real defects worth fixing in tested code), and an input with readings lets the key include one out-of-threshold point. The model never compares: it copies the tag's low/high cells and writes `to compute (tool)` in the status cell; the engineer or the harness runs the helper on the input (and optionally the result table). No code of the skill is copied; the logic is reimplemented from the method (min/max against a reading, status words below_minimum / above_maximum).

Helper evaluation order for a point (first match): binding unbound or ambiguous gives `not-bound`; untagged gives `untagged`; unit mismatch gives `unit-mismatch`; reading empty or not a plain decimal number gives `no-data`; both limits empty gives `no-limits`; reading < low gives `below_minimum`; reading > high gives `above_maximum`; otherwise `normal`. Typed errors (CLI exit 2): malformed sections, a non-numeric non-empty limit, low greater than high, a row with the wrong number of cells.

## 8. Answer key (synthetic sample, derived by hand from the rules)

Hint table order: supply air temperature (SYN-Supply_Air_Temperature_Sensor, C, 12, 24), fan speed command (SYN-Fan_Speed_Command, %, 0, 100), co2 (SYN-CO2_Sensor, ppm, 400, 1000), discharge pressure (SYN-Discharge_Pressure_Sensor, kPa, 100, 400). Assets: AHU-01, FAN-03, RM-201, PMP-05 (twice, same id).

| point_id | point_name | asset_id | tag | unit | reading | low | high | binding | status (helper) | review |
|---|---|---|---|---|---|---|---|---|---|---|
| P-01 | AHU-01.SAT | AHU-01 | SYN-Supply_Air_Temperature_Sensor | C | 18.5 | 12 | 24 | bound | normal | NO |
| P-02 | RM-201.CO2 | RM-201 | SYN-CO2_Sensor | ppm | 1350 | 400 | 1000 | bound | above_maximum | NO |
| P-03 | AHU-09.SAT | UNMAPPED | SYN-Supply_Air_Temperature_Sensor | C | 17.0 | 12 | 24 | unbound | not-bound | YES |
| P-04 | AHU-01.RAT | AHU-01 | UNTAGGED | C | 21.0 | - | - | untagged | untagged | YES |
| P-05 | FAN-03.SPD | FAN-03 | SYN-Fan_Speed_Command | rpm | 1200 | 0 | 100 | unit-mismatch | unit-mismatch | YES |
| P-06 | PMP-05.DP | AMBIGUOUS | SYN-Discharge_Pressure_Sensor | kPa | 250 | 100 | 400 | ambiguous | not-bound | YES |

Branch per point: P-01 clean bind, P-02 out-of-threshold reading (above the high limit), P-03 unmapped asset, P-04 no tag hint (description "return air temp" contains no keyword; abbreviations are not guessed), P-05 unit mismatch (rpm vs %), P-06 ambiguous prefix (two asset lines PMP-05). Model cells: the `asset_id` cell is the copied asset id, `UNMAPPED` or `AMBIGUOUS`; `tag` copied or `UNTAGGED`; `low` and `high` copied from the hint line or `-`; `status` always `to compute (tool)`. `review` is NO only when binding is `bound`; the out-of-threshold finding of P-02 comes from the helper, not from the model's open-items list. Open items (model): P-03, P-04, P-05, P-06.

## 9. Rubric R1-R7

- R1: each point appears exactly once, in input order, in the checks and in the table.
- R2: the asset is only by exact id prefix from the asset table; zero lines give UNMAPPED, two or more give AMBIGUOUS (copy rule), never a fuzzy match (AHU-09 is not AHU-01).
- R3: the tag is only from the hint table, first matching keyword in table order; no keyword contained gives UNTAGGED; no synonyms or abbreviations.
- R4: the unit check compares the copied point unit with the copied expected unit as text, never converts; binding follows the first-match order unbound, ambiguous, untagged, unit-mismatch, bound.
- R5: low and high are copied from the hint line (or `-`); the status cell is `to compute (tool)` on every row; no model comparison or judgement of readings (no normal, above or below written by the model).
- R6: no invented assets, tags, classes, points or readings; readings copied as written.
- R7: format as specified (11 cells per row), open items list exactly the review=YES rows, closing draft caveat, no claim that the twin is valid, complete or in sync, no connection claims.
