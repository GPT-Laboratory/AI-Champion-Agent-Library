# 31-02 Summary: planning and docs corrections, decoupling gate

Status: done.

- ROADMAP Phase 24 and 26 goal text corrected (MCP-first and "MCP servers for catalog data" removed; points to Phase 36); checked boxes kept.
- Contexts 24, 25, 26, 28: original text kept, wrong assumptions marked "(superseded)", and a "Corrected 2026-10-15 (Phase 31)" section appended (28: only the D2 reading remains an open assumption).
- AUTONOMOUS-DECISIONS.md: D-634 (separation, what changed, revert steps) and an index row; AUTONOMOUS-BLOCKERS.md: B-004 note; STATE.md: phase 31 progress and decision line.
- docs/consortium-agents-gaps.md: chose deletion over "removed" placeholder rows. Deleted G-003, G-004, G-005, G-006, G-007, G-008, G-010, G-030, G-031, G-044 (10 rows; no other rows contained MCP/LVI/STK/Prysmian/Rakennustieto text); IDs not renumbered; changelog section added. G-001 and G-002 judged by content and kept.
- docs/consortium-agents-inventory.md: MCP table replaced by a "separate work" note; agent 5 row and the stage-name line cleaned.
- scripts/check-ddc-decoupling.sh: greps the 16 DDC entries, their prompt dirs and the gap table rows; word-boundary patterns (so "resolving" does not match). Output: `ddc-decoupling: clean`.
- MCP entry directories untouched.
