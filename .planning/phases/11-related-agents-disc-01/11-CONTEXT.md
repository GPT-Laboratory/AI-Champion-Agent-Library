# Phase 11: Related Agents (DISC-01) - Context

**Gathered:** 2026-10-12
**Status:** Ready for planning
**Mode:** Auto (unattended overnight run)

<domain>
## Phase Boundary
Detail page shows up to 4 related agents (excluding itself), computed from Phase 3 stored embeddings (cosine), with a tag/category overlap fallback when embeddings are unavailable. Validated against the Phase 2.2 scale set and labeled topic clusters. Requirement DISC-01.
</domain>

<decisions>
## Implementation Decisions
- Pure function `relatedAgents(slug, agents, vectors?, k=4)` in src/lib/server/search or a sibling module, reusing cosine from Phase 3 and vectors loading from the search service (respect the content-hash check and the cache fingerprint added in review fixes).
- Fallback: Jaccard on tags + category match + shared tools/LLM small weight; deterministic tie-break by slug.
- Blend optional: embeddings first; if an agent lacks a vector, use the fallback for that agent.
- UI: "Related agents" section on the detail page using the existing AgentCard-like compact links; accessible (heading, list, links); hidden when none. Follow Phase 10 a11y conventions (axe test).
- Validate on scale set: for synthetic topic-clustered agents, assert related agents mostly share the topic (precision@4 threshold) using fake embedder AND fallback paths; no real model downloads.
- No new deps, no schema changes.

### Claude's Discretion
All else.
</decisions>
<code_context>Gathered in planning.</code_context>
<specifics>None.</specifics>
<deferred>None.</deferred>
