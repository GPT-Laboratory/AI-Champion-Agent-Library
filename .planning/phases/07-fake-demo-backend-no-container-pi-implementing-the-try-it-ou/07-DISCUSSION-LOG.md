# Phase 7: No-Container Demo Backend for Try It Out - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-19
**Phase:** 07-fake-demo-backend-no-container-pi-implementing-the-try-it-ou
**Areas discussed:** Demo agent scope & skill.md content, LLM provider/SDK/model source, jobId client persistence, Progress feed during running

---

## Demo agent scope & skill.md content

| Option | Description | Selected |
|--------|-------------|----------|
| hvac-load-calculator only, re-scoped task | Keep the agent already left in `runnable` mode (Phase 5); write a skill.md that simplifies the real job to text-only reasoning over the uploaded file | |
| hvac-load-calculator, generic file task | Keep hvac-load-calculator but make skill.md domain-agnostic (summarize/analyze) | |
| Pick a different/simpler agent | Choose a catalog agent whose real job is naturally read-file/write-file shaped | (superseded — user proposed a new option) |

**User's choice (free text):** Don't demo-enable `hvac-load-calculator` or any agent whose real tools can't run. Add a new demo-only agent `data/agents/demo-rfi-triage.yaml` with a pure read → reason → write job: classify an uploaded RFI by urgency and discipline (structural/MEP/architectural), write a triage result with classification, routing, and a one-line rationale. Revert `hvac-load-calculator` to `try_it_out_mode: none`. Mark the new agent clearly as demo-only. One agent is enough.
**Notes:** User rejected all three presented options in favor of a fourth, better-fitting option (new purpose-built demo agent) — this keeps the demo honest (no agent claims to do something the LLM-only backend can't actually do).

---

## LLM provider, SDK, and model source

| Option | Description | Selected |
|--------|-------------|----------|
| (no discrete options presented — combined into the same free-text turn) | | |

**User's choice (free text):** Add `@anthropic-ai/sdk`. Use one fixed model + fixed low temperature for all runnable agents, not per-agent `llm_config` from YAML (reading per-agent config is unneeded generality and a failure mode if a YAML names an unreachable model). Model: a current Claude Sonnet, exact API model-id string to be confirmed against what the deployed key actually accepts. API key via server-side env var only, never exposed to the client.
**Notes:** Reversibility noted in CONTEXT.md as "costly" — switching to per-agent model config later touches every call site assuming the fixed constant.

---

## jobId client persistence

| Option | Description | Selected |
|--------|-------------|----------|
| URL query param (`?job=<jobId>`) | Survives refresh, shareable link | ✓ |
| Cookie | Survives refresh, not shareable via URL | |

**User's choice:** URL query param.
**Notes:** Shareability to a stakeholder mid-demo was the deciding factor.

---

## Progress feed during running

| Option | Description | Selected |
|--------|-------------|----------|
| Synthetic staged lines ("reading input…", "calling model…", "writing output…") | Preserves the live-feed feel from Phase 6's mock | ✓ |
| Leave `events: []` empty until terminal | Matches "no live tool-event feed" literally but the feed looks inert while waiting | |

**User's choice:** Synthetic staged lines, but typed as `info` processing-stage events (not `tool_start`/`tool_end`) and emitted as real execution actually reaches each stage — not on a fixed fake timer like Phase 6's mock.
**Notes:** User was explicit about not misrepresenting a tool-call stream that doesn't exist under a single LLM call.

---

## Claude's Discretion

- Exact fixed temperature value (low, e.g. 0.1–0.3).
- Fallback behavior when no file is uploaded — use `task` text as the RFI content.
- `failed`-status error strings describe the real failure (LLM API error, missing input, etc.) rather than a fabricated `pi`-style message.
- Uploaded file assumptions (plain text/UTF-8, reasonable size cap).
- Exact SvelteKit `+server.ts` route layout for the three job endpoints (no existing `src/routes/api/*` precedent in this codebase).
- In-memory job-store shape and `.tryitout-work/<jobId>/{input,output}/` layout.
- `ANTHROPIC_API_KEY` as the env var name (SDK default) unless research finds a reason to deviate.

## Deferred Ideas

- Real in-process `pi`/GAISE runtime execution — tracked under the `try-it-out-runtime-architecture` memory as a future phase, not this one.
- Re-enabling `hvac-load-calculator` or any other existing catalog agent as `runnable` in this phase.
- A second demo agent.
