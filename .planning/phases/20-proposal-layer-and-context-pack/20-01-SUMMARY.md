---
phase: 20-proposal-layer-and-context-pack
plan: 01
subsystem: mcpgen
tags: [proposals, context-pack, evaluation, deterministic-generator]
execution: outside-gsd-flow
status: complete
requires: [14, 15, 19]
provides:
  - data-only ProposalSet format with 13 op types, gates, fingerprint
  - context pack export (spec, samples, domain docs, deterministic baseline)
  - CLI modes --proposals, --validate-only, --context-pack; npm run mcp-propose-eval
  - docs/mcp-generator-proposals.md
key-files:
  created:
    - src/lib/mcpgen/proposals/
    - docs/mcp-generator-proposals.md
    - .planning/exploration/E14-proposals.md
decisions: [D-580..D-596]
requirements: [CUST-02]
completed: 2026-10-14
---

# Phase 20: Proposal Layer and Context Pack Summary

**Executed outside the normal GSD flow** (decided by Ville, 2026-10-14: stages 0-2, designed so that an external agent session with full context writes the proposals; directly launched agents; notes E14). No PLAN files by design.

**Stages 1 and 2 are built: a data-only proposal format with gates, and a context pack for an external agent session. There are no model calls inside the platform.**

## Accomplishments

- **Proposal layer (D-580..D-586):** `ProposalSet` schema and selector grammar; 13 op types including rename, hide, defaults, pin, merge, split, composite and derived filter; gates; fingerprint; apply and evaluate wired into the pipeline; emitter support for argument edits, merge, split and composite tools (D-581).
- **Context pack (D-587..D-592):** export of spec, samples, domain docs and the deterministic baseline, plus a review summary; CLI modes `--proposals`, `--validate-only`, `--context-pack`.
- **Evaluation (D-593):** `npm run mcp-propose-eval` compares baseline and proposal-assisted packages with the Phase 15 scorer.
- Tests: proposal gates and goldens over the Acme fixtures, emitter invariants, signatures, determinism, examples, context pack, CLI modes, evaluation.
- Proposal-assisted generated packages (Acme OpenAPI and SQL, 5 tests each) and OData with proposals (5 each) pass pytest on FastMCP 3.4.8 and 4.1.0.

## Deviations from the GSD flow

No plan/verify cycle. Stage 0 (description cleanup, annotations, outputSchema, ordering) is NOT part of this phase: it became the planned Phase 21. The unfinished parts of stages 1-2 are the planned Phase 22.

## Next

Phase 21 (stage 0), Phase 22 (follow-ups), Phase 23 (code review of the new generator code).
