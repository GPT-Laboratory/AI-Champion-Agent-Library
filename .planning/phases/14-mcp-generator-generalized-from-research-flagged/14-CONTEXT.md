# Phase 14: MCP Generator (generalized from research, flagged) - Context

**Gathered:** 2026-10-12
**Status:** Ready for planning
**Mode:** Auto (unattended overnight run)

<domain>
## Phase Boundary
Deterministic MCP generator behind flag `MCP_GENERATOR` (default OFF). Design basis: RESEARCH-SYNTHESIS.md in this directory (committed first; every plan and the design doc must cite it). Adapters (v1 per synthesis): openapi, tabular-catalog (schema/sample headers only), sql-ddl (CUST-02). Core emits Python FastMCP stdio server source (generated text; this repo is TypeScript and NEVER runs the Python except as "pending human"). Success criteria in ROADMAP Phase 14 (7 items) are binding.
</domain>

<decisions>
## Implementation Decisions
- TS modules: `SourceModel` + `InputAdapter` interface; adapters separate; core never changes when adapters are added; unsupported/ambiguous input reported (diagnostics), never guessed.
- Emitter checklist from RESEARCH-SYNTHESIS section 3 (task-oriented tool names, trimmed responses, pagination clamp + ceiling warning, honest empty-result message, structured errors with no raw envelope/secrets (<3 of timestamp/status/error/path keys), read-only unless write opted in, synthesized in-memory filter where nested array has no request param) implemented as deterministic templates; golden-file tests per adapter with synthetic inputs (invented OpenAPI doc, invented tabular header sample, invented DDL: "Acme"/"Example" names only).
- Credentials never accepted/stored/logged: input scanner rejects credential-looking fields/strings; generated config uses env-var placeholders only.
- Python syntax validation of generated code: only if `python3` exists locally, use `python3 -m py_compile` on a temp file in a test guarded by availability (skip otherwise); never install packages; never run the generated server. Live runs = pending human with exact commands.
- Flag-gated entry points: (a) library API + `npm run generate-mcp -- --adapter <name> <input> --out <dir>` CLI, (b) Phase 4 Customize menu gains a working "Generate MCP" entry when flag on (flag off: placeholder unchanged; golden/regression test), served by a flag-gated API route that takes schema/spec TEXT only and returns the generated files as a zip (fflate exists) or JSON; size caps; no persistence of inputs.
- Document extension point for synthesized capabilities (docs/mcp-generator.md). Log decisions D-NNN with revert notes (check file for next free number). No new deps unless logged. A11y: follow Phase 10 conventions for the new UI (axe test).
- Nothing copied from reference repos beyond ideas; synthetic fixtures only.

### Claude's Discretion
All else (module layout, UI details).
</decisions>
<code_context>Gathered in planning.</code_context>
<specifics>None.</specifics>
<deferred>LLM-assisted synthesis; further adapters (docs-only, data dumps, repos).</deferred>
