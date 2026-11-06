# Phase 21 Context: Generator Stage 0

Gathered unattended (auto mode). Runs after the consortium-agent and release phases (24-30). Works on the working branch only: the release branch `release/agents-2026-10` is already cut and does NOT receive Phase 21-23 changes (list as a follow-up in PENDING-HUMAN: a later PR can carry them). No pushes, no PRs.

## Scope
ROADMAP.md Phase 21: description hygiene filter on spec-derived text, read-only tool annotations, `outputSchema`/`structuredContent`, deterministic tool order; applies to every generated server; goldens regenerated in a dedicated commit; generated packages' pytest pass on FastMCP 3.4.8 and 4.1.0.

## Assumptions
- A-01: The generator code lives in src/lib/mcpgen (docs/mcp-generator.md, docs/mcp-generator-design.md, docs/mcp-generator-proposals.md); read them first. The hygiene filter extends the existing description cleaning (D-585 mentions hygiene false positives in proposals; reuse that filter where it exists).
- A-02: FastMCP 3.4.8 and 4.1.0 verification uses throwaway venvs outside the repo (as Phase 18 did, D-479): create under the scratchpad/tmp area, not in the repo, and delete after. pip network access is assumed available; if not, record as pending-human.
- A-03: FastMCP annotation API: use `annotations={"readOnlyHint": True, ...}` on tools; outputSchema via return type annotations/structured output per the pinned FastMCP versions; check both versions behave (4.x API differences) and document any version-conditional code.
- A-04: Deterministic order: sort tools by a stable key (operation id / path+method) independent of input ordering; add tests with shuffled inputs.
- A-05: Goldens: regenerate in ONE dedicated commit (`UPDATE_GOLDEN=1`), separate from logic commits, so the churn is reviewable.
- A-06: No real-model calls needed in this phase. Machine limits: no parallel heavy runs; npm run check alone.
