# Phase 27 Context: Manufacturing-stage agents (8, 9)

Gathered unattended (auto mode). Inherits Phase 25 and 26 contexts, summaries and lessons (see their SUMMARY files).

## Scope
Agent 8 Cut-sheet QA (partial coverage by submittal-review-router; new entry checks a product cut sheet / data sheet against a specification excerpt), agent 9 Spooling & cutting (reads a pipe/duct/cable-tray prefab spool description or isometric text extract and drafts a cut list and spool grouping for the fabricator to review).

## Assumptions
- A-01: Same harness, procedure, done bar, bump list (flag-off golden, set-try-it-out-mode tests, Phase 15 guard) as Phase 26. One plan per agent plus an aggregation plan; container runs sequential.
- A-02: Design lessons: one row per input item in input order; per-item check section with Y/N equality tests and lookup verdicts; no model arithmetic; scope each step small enough for gpt-4.1-mini (<= ~6 items x ~6 checks) and state the batch limit as a gap; one output file result.md.
- A-03: Agent 8 inputs: a synthetic cut-sheet text (product, ratings, dimensions, certifications) and a specification excerpt (required values); output: per-requirement row compliant / deviation / not-stated, with the quoted source text. Text only; PDF parsing is a gap.
- A-04: Agent 9 inputs: a synthetic text list of pipe segments with lengths, nominal diameter, material, stock length; the agent drafts a cut list and spool grouping. Cutting-length arithmetic is the weak point of the model: the agent must NOT compute; it only groups, lists lengths copied from input, and marks segments requiring a computed cut optimisation as "to compute (tool)". Optionally supply remainders as copied values. Real nesting/optimisation and isometric/IFC parsing are recorded as gaps; propose a deterministic cut-optimiser as future tool.
- A-05: Prefab/cut-sheet real data are consortium-confidential: only synthetic samples; names of products/standards generic; real catalog access is a gap (MCP servers cannot be called from the container).
- A-06: DDC skills: look for cut-list, spool, prefab, submittal/data-sheet skills; MIT attribution; no book/CWICR.
