# Phase 13: Multi-Agent and Multi-Format Hosting (flagged) - Context

**Gathered:** 2026-10-12
**Status:** Ready for planning
**Mode:** Auto (unattended overnight run)

<domain>
## Phase Boundary
Implement the Phase 12 recommendations behind a feature flag (`AGENT_KINDS`, default OFF): canonical model extension (kind, framework, topology, members, extras...), adapters (ranks 1-6 of the memo: Oracle AgentSpec multi-agent first), `npm run validate-submission -- <path>` CLI, and detail-page rendering of systems. Source of truth: docs/agent-hosting-decision-memo.md (section "Concrete minimal proposal for Phase 13"), docs/agent-types.md, docs/agent-capability-matrix.md, .planning/phases/12-*/12-PHASE13-HANDOFF.md, 12-RESEARCH.md.
</domain>

<decisions>
## Implementation Decisions
- Flag OFF: behaviour, schema output, UI and existing tests byte-for-byte unchanged. DB changes additive (nullable columns / new tables only; push-safe with existing db; no destructive migration). Each data-model decision logged D-NNN with revert steps (alternatives, why, how to revert).
- Handoff defaults apply (members inline with optional slug link; catalog.yaml convention; Try It Out none/external for non-agent kinds; edges deferred; adapters rank 1-6 only).
- Task 0: no web at execution; AgentSpec multi-agent YAML shapes: use research notes; if `$component_ref`/Swarm `relationships` shape can't be confirmed offline, parse opaquely into `extras`; accept both `type` and `component_type`.
- Security: never execute/import author code, never fetch author URLs at ingest, never render extras as HTML, secret denylist scan, size caps. Fixtures synthetic ("Example"/"Acme"), never from reference repos.
- validate-submission never throws on unknown formats; outputs ingestible / partial / missing-from-author, plus JSON mode.
- Detail page renders members and topology only with flag on; follow Phase 10 a11y conventions (axe tests); related agents / search text changes only with flag on.
- Unknown fields preserved, not dropped; each adapter documents assumptions (doc comment + docs).
- No new deps unless logged (prefer none; `yaml` and `zod` exist).

### Claude's Discretion
All else.
</decisions>
<code_context>Gathered in planning.</code_context>
<specifics>None.</specifics>
<deferred>Adapters rank 7+, edges, systems Try It Out.</deferred>
