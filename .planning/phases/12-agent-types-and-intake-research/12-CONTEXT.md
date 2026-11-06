# Phase 12: Agent Types and Intake Research - Context

**Gathered:** 2026-10-12
**Status:** Ready for research
**Mode:** Auto (unattended overnight run)

<domain>
## Phase Boundary
Deliver docs: `docs/agent-types.md` (taxonomy), a capability matrix (per type/format: what AgentSpec expresses, needs extension, library must store/display, Try It Out suitability runnable/external/not runnable), `docs/agent-intake-guide.md` (what authors send, minimum metadata, readiness checklist, ready-to-send reply template answering "do you need config files or the GitHub repo?"), and a decision memo (recommended canonical-model changes, ranked adapter list, trade-offs, open questions for the human). Docs only: no code.
</domain>

<decisions>
## Implementation Decisions
- Use WebSearch/WebFetch for current framework formats (LangGraph, CrewAI, AutoGen/AG2, OpenAI Agents SDK, Google ADK, Semantic Kernel, LlamaIndex, Pydantic AI, smolagents, Claude Agent SDK / skills, MCP servers, Oracle AgentSpec/Open Agent Spec, n8n/Flowise-style workflow agents, A2A, others found). Docs/specs only; cite source URLs; mark date accessed 2026-10-12.
- Reference projects ~/projects/mcp-gen-comparison and -2 are READ-ONLY and relevant only to the MCP-based agent type; never read .env, API keys, Excel or real data; never modify. Synthetic examples only; no invented company/customer data.
- Platform is technology agnostic with first-class adapters where useful; existing canonical model is AgentRecord (src/lib/... and Oracle AgentSpec adapter in the ingest pipeline) - read it to ground the matrix.
- Phase 13 will build behind a flag from the memo; the memo should therefore give a concrete, minimal, additive data-model proposal (each choice with revert story).

### Claude's Discretion
All else.
</decisions>
<code_context>Gathered in research.</code_context>
<specifics>None.</specifics>
<deferred>None.</deferred>
