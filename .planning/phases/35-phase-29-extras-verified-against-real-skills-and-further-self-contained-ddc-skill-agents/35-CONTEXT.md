# Phase 35 Context: Phase 29 extras verified against real skills, plus further self-contained DDC skill agents

Read first: .planning/research/ddc-fix-run-rules.md; docs/ddc-agent-candidates.md (the phase 29 selection and the not-built table); the Phase 29 summaries; the Phase 32-34 summaries (lessons: simple output, helper does arithmetic, ~6 items, spec first).

## Scope
1. Verify that each Phase 29 extra (13 daily-report-cross-check, 14 punch-list-closure-check, 15 change-order-consistency-check, 16 safety-observation-classification) follows a REAL skill: read the full SKILL.md of the claimed skill(s) in the DDC repo, record the exact path (verify it exists with gh api), state what was taken vs own design, and relabel honestly ('built on' vs 'inspired by'); where an agent is only loosely related, say so. Write docs/ddc-alignment/<slug>.md for each (short spec, as in 32-33) and set `metadata.attribution` + third-party notices + `github_url` (DDC skill URL). Light alignment to the skill's data model where cheap (fields/status words); live rerun for each CHANGED entry (one run each; judge honestly).
2. Add further agents where a skill has a self-contained method: text/CSV in, reviewed draft out; no Windows converters, no CWICR database, no IoT feeds, no code execution, no network, no proprietary data. Survey the DDC repo (gh api; 238 SKILL.md; the candidates list in docs/ddc-agent-candidates.md is the starting point), choose 3-4 new ones (quality over count; different from the 16 existing and from the 12 slide agents), build each to the done bar: alignment spec first (read the whole skill; adopt method/data model/rules/outputs; fix the skill's bugs; arithmetic in tested helpers), complete entry (metadata.attribution exact path, github_url = the DDC skill URL), synthetic labelled sample, answer key, rubric R1-R7, tests, golden, one live Try It Out run, evidence in 35-VERIFICATION.md/35-HUMAN-UAT.md. 
3. Update docs/ddc-agent-candidates.md: remaining candidates with reason not built.
4. No MCP/LVI/STK/Prysmian/Rakennustieto text anywhere in these agents (scripts/check-ddc-decoupling.sh clean; extend its file lists to the new agents).

## Assumptions
- A-01: Max 2 revisions + 1 scope-shrink retry per agent; never rerun for a lucky pass; spend <$0.50/run, fix-run total $5 (~$0.45 used), ledger after the fix-run marker. Slugs must not contain '&' or 'and'.
- A-02: Candidate skills must have a method that fits the proven one-step pattern: choose after reading, record rejected ones with reasons.
