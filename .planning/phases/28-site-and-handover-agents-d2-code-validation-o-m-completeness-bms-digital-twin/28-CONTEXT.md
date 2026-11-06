# Phase 28 Context: Site and handover agents (10-12)

Gathered unattended (auto mode). Inherits Phases 25-27 contexts, summaries and lessons (small scope per run, one row per input item, per-item Y/N checks plus lookup verdicts, no model arithmetic, one result.md, label synthetic data, entry limits as gaps).

## Scope and interpretations (assumptions; confirm with Ville/Jussi, recorded as gaps)
- A-01 Agent 10 "D2 code validation": "D2" is read as the Finnish National Building Code part D2 (indoor climate and ventilation) — an assumption, because the term is not defined in the task. The agent checks a ventilation design/commissioning data extract (room, airflow rates, ventilation rates, SFP, etc.) against requirement rows supplied as an excerpt. Requirement values in the sample are synthetic placeholders labelled as such, NOT quotes of the regulation; the real regulation text (public, on the Finnish government/ympäristö.fi/Finlex) is named as the data source and a gap. If "D2" means something else (e.g. a different code), record the alternative in the gaps list.
- A-02 Agent 11 "O&M completeness": reads a handover document index (list of delivered documents per system/equipment) and a required-documents checklist (synthetic), and flags missing/incomplete items per equipment; draft for the handover engineer.
- A-03 Agent 12 "BMS digital twin": reads a BMS point list (point names/descriptions/units) and an equipment/space list (as from the model) and drafts a point-to-equipment/space mapping with an ontology-style tag proposal (e.g. Brick-like class names), flagging unmappable/ambiguous points. No live BMS connection; text only. Real BMS/BACnet/twin integration is a gap.
- A-04 Real data are consortium-confidential: synthetic samples only; labelled.
- A-05 Same harness, procedure, done bar, bump list, evidence files as phases 25-27. One plan per agent plus aggregation; container runs sequential. DDC skills: look for O&M, handover, commissioning, BMS, ventilation, building code skills (MIT; no cwicr/book).

## Corrected 2026-10-15 (Phase 31)

This context was reviewed for the DDC/MCP mixing: it contains none. The only open item is A-01, the reading of "D2" as the Finnish building code part D2: it stays an unconfirmed assumption (the entry says so; no DDC skill covers it, attribution is "no DDC basis"). The phrase "consortium-confidential" in A-04 was removed from the entries in Phase 31 (D-634); the text above is kept as history.
