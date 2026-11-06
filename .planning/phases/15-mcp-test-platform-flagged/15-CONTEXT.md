# Phase 15: MCP Test Platform (flagged) - Context

**Gathered:** 2026-10-12
**Status:** Ready for planning
**Mode:** Auto (unattended overnight run)

<domain>
## Phase Boundary
Flag `MCP_TESTER` (default OFF). Port the benchmark harness semantics into the TypeScript platform per 15-RESEARCH.md (port-fidelity map is binding input and itself a deliverable: docs/mcp-test-port-fidelity.md). ROADMAP Phase 15 success criteria (6) binding.
</domain>

<decisions>
## Implementation Decisions
- Follow 15-RESEARCH.md recommendations by default: hand-written minimal MCP client (no new dependency), Node mock upstream with seeded fault injection and request log, in-process fake MCP server + flawed variants proving the scorer discriminates, case/rubric/golden formats compatible with the source (x- prefixed extensions), `mcptest-report/1` JSON schema + human summary, in-memory job store with TTL (Phase 8 job patterns), `/mcp-test` page + flag-gated API.
- Scoring: Tier 1 gate (fail => score null, disqualified), Tier 2+3 carry the score (unweighted mean of per-case pass rates, NA excluded, coverage shown - log as decision), Tier 4 raises blocker/warning flags (blocker => BLOCKED). Fix the documented source quirks deliberately (strict not-found, deterministic tie-break, env scrub for subprocess, leak-guard compare threshold) and record each in the fidelity map.
- All 12 cases: implement with synthetic offline fixtures where feasible; remaining listed designed-only gaps with reasons. Fixtures strictly invented ("Acme"/"Example"); nothing copied from the reference repos; never use the tokens mcp-gen-comparison, LVI, ETIM, TT0, STK in code/docs/fixtures (generic wording; the case-name T2-STK-API may appear ONLY in the fidelity map table as a source-case identifier... prefer generic names 'T2-catalog-api').
- No credentials ever; runner never touches real APIs/keys; subject = fake server in CI; generated Python server runs only via container = pending human with exact commands (15-HUMAN-UAT.md). No new deps unless logged. Existing test files not edited (new files only). Flag-off: route/page 404, UI hidden, no behaviour change (regression test).
- Phase 14's generated servers are subjects only as black boxes; do not run Python in CI (py_compile guarded is the existing precedent).
- A11y per Phase 10 conventions for the page (axe test).
- Decisions D-NNN with revert notes (check file for next free number).

### Claude's Discretion
Module layout, UI details.
</decisions>
<code_context>Gathered in research/planning.</code_context>
<specifics>None.</specifics>
<deferred>Legacy SSE transport; uploading third-party server code; real container runs.</deferred>
