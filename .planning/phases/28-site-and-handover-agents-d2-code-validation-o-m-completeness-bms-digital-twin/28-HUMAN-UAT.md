---
phase: 28
status: human_needed
---

# Phase 28 Human UAT

All outputs are drafts for engineer review. Inputs are synthetic or public only.

## Agent evidence

- Agent 10 (D2 code validation): counted (job 2231091f, see 28-VERIFICATION.md). Skim the draft; confirm the D2 interpretation (Finnish National Building Code part D2, indoor climate and ventilation) or name the intended code; decide whether the real regulation requirement rows should be loaded from the public text (and by whom, with legal review of wording); whether commissioning data feeds or BIM extract parsing are wanted; whether a deterministic unit tool should be a follow-up.
- Agent 11 (O&M completeness): counted (job 20b66bce, see 28-VERIFICATION.md). Skim the draft; provide or approve the real required-documents sets per equipment class (contract or standard based); decide whether document content checks (PDF reading) or document management system / COBie export access are wanted.
- Agent 12 (BMS digital twin): counted (job 187e5446, see 28-VERIFICATION.md). Skim the draft; decide the ontology to target (Brick or other) and whether its real class list should be loaded; whether a BMS/BACnet export or twin platform connection is wanted; whether a deterministic mapping script should replace the model for large point lists.
