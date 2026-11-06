# Phase 7: No-Container Demo Backend for Try It Out - Context

**Gathered:** 2026-08-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace Phase 6's mock-backed Try It Out client with a real (but "cheating") demo backend: plain SvelteKit server routes that call an LLM directly — no Docker, no `pi`, no parallelism, no worker containers. One demo-only agent is wired end to end: upload a text file → server reads it, loads a hardcoded base prompt + `skill.md`, calls the LLM, writes a result file, and reports staged status (`queued → running → succeeded/failed`). `src/lib/tryItOut.ts`'s three frozen function signatures (`submitJob`/`subscribeProgress`/`downloadArtifact`) get real `fetch()`-backed bodies; the UI (including Phase 6's `TryItOutPanel.svelte` and the Phase-quick disclosure control) is unchanged.

</domain>

<decisions>
## Implementation Decisions

### Demo agent scope & skill.md content
- **D-01:** Do NOT demo-enable `hvac-load-calculator` or any existing catalog agent whose real tools (BIM extraction, ASHRAE calculations, etc.) can't actually run in this phase. Instead, add a brand-new demo-only agent: `data/agents/demo-rfi-triage.yaml`. Its name and description must clearly mark it as demo-only so it's never mistaken for a real WP5 catalog agent later.
- **D-02:** The demo agent's job is pure read → reason → write (honest to what a single LLM call can actually do): read an uploaded RFI (Request for Information) text file, classify it by urgency and by discipline (e.g. structural / MEP / architectural), and write a short triage result file containing the classification, recommended routing, and a one-line rationale. `skill.md` for this agent encodes exactly this task.
- **D-03:** `hvac-load-calculator`'s `try_it_out_mode` reverts from `runnable` back to `none` (it was left `runnable` in Phase 6 only so that phase's mock demo had something to point at).
- **D-04:** One demo agent is enough for this phase — no second demo agent needed.
- **D-05:** `try_it_out_mode`/`try_it_out_url`/`try_it_out_task_template` are DB columns that ingest deliberately never overwrites (Phase 5 D-05/D-06/D-07) — they are NOT sourced from the YAML. So `demo-rfi-triage.yaml`'s frontmatter has no `try_it_out` field; setting its row to `mode: 'runnable'` (and reverting `hvac-load-calculator`'s row to `mode: 'none'`) happens via the same one-off DB `UPDATE` mechanism Phase 5 used (D-13 pattern) — not via ingest or YAML.

### LLM provider, SDK, and model source
- **D-06:** Add `openai` (the official OpenAI SDK) as a new dependency (not currently in `package.json`). — **Changed 2026-08-19:** originally `@anthropic-ai/sdk`; user redirected to OpenAI mid-session, before any implementation started.
- **D-07:** Use a single fixed model + fixed low temperature for ALL runnable demo agents — do NOT read `llm_config` per-agent from the YAML. Reading per-agent config is generality this demo doesn't need and adds a failure mode (a YAML naming a model the deployed key can't reach). — **Reversibility:** costly — **rationale:** switching to per-agent model config later means touching every call site that currently assumes one fixed model/temperature constant.
- **D-08:** Resolve the exact OpenAI API model ID during research/implementation (verify against the actual API — confirm what the deployed key/account actually accepts before hardcoding it, e.g. via the OpenAI models list endpoint or current API docs).
- **D-09:** The API key is supplied via a server-side-only env var, never sent to or read by client code. Use the SDK's standard `OPENAI_API_KEY` env var name (the `openai` client reads this by default) unless research surfaces a reason to deviate.

### jobId client persistence
- **D-10:** Persist `jobId` via a URL query param (`?job=<jobId>`), NOT a cookie. It survives a refresh the same as a cookie would and makes a running/finished job's URL shareable — a small plus for a stakeholder demo.

### Progress feed during `running`
- **D-11:** Do NOT leave `events: []` empty until the terminal state (technically closer to "no live tool-event feed" but makes the panel's feed look inert). Instead emit synthetic staged `JobEvent`s as real execution actually reaches each stage: "reading input…" → "calling model…" → "writing output…" → terminal succeeded/failed. These stages must be labeled/typed as processing-stage `info` events, NOT as `tool_start`/`tool_end` — we are not pretending there's a real tool-call stream, unlike Phase 6's mock which faked `pi`-style tool_execution lines.
- **D-12:** Stage lines are emitted as each phase of REAL execution actually begins (not on a fixed fake timer like Phase 6's mock) — e.g. "calling model…" is emitted right when the Anthropic API request is issued, not at a hardcoded offset.

### Claude's Discretion
- Exact fixed temperature value (a low value, e.g. 0.1–0.3, consistent with D-07's intent).
- Behavior when no file is uploaded (submitJob's `file` param is optional per the frozen contract): reasonable fallback is to treat the `task` text itself as the RFI content to classify, and skip/adjust the "reading input…" stage line accordingly.
- `failed`-status error strings should describe the REAL failure (LLM API error, missing/unreadable input, etc.) — do NOT fabricate a fake `pi exited non-zero`-style message like Phase 6's mock did, since this phase isn't pretending to run `pi` at all and D-11's principle (don't misrepresent what's happening) applies to errors too.
- Uploaded file handling: assume plain text (UTF-8) input for the demo; no requirement to support binary/PDF/etc. Reasonable size cap left to implementation.
- Exact SvelteKit route file layout for `POST /api/tryitout/jobs`, `GET /api/tryitout/jobs/:id`, `GET /api/tryitout/jobs/:id/artifact` (standard `+server.ts` conventions — no existing `src/routes/api/*` precedent in this codebase to match against).
- In-memory job-store data shape (keyed by `jobId`) and working-directory layout under `.tryitout-work/<jobId>/{input,output}/` — per the ROADMAP phase description, isolation is by UUID prefix only, file-collision risk knowingly accepted for the demo.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Client contract (frozen — this phase implements the "real" side of it)
- `docs/job-api-contract.md` — frozen `submitJob`/`subscribeProgress`/`downloadArtifact` signatures, `JobStatus`/`JobEvent`/`JobUpdate`/`SubmitResult` types. This phase's server routes must produce exactly these shapes.
- `src/lib/tryItOut.ts` — current mock implementation; only the function bodies below the "MOCK IMPLEMENTATION" banner get replaced with real `fetch()` calls. Exported signatures/types (lines 1–25) are frozen and must not change.

### Prior phase context (locked decisions this phase must respect)
- `.planning/phases/05-add-an-optional-try-it-out-field-to-the-agent-catalog-shape/05-CONTEXT.md` — `try_it_out_*` DB-column architecture (D-04 through D-08, D-13): flat nullable Drizzle columns, never sourced from YAML, never overwritten by ingest's `onConflictDoUpdate`, set via one-off DB `UPDATE` (see D-05 above).
- `.planning/phases/06-runnable-try-it-out-flow-mock-backed/06-CONTEXT.md` — frozen client API (D-01–D-03), mock isolation discipline (D-08), completion semantics keyed off `agent_settled` not `agent_end` (D-09 — informs D-11/D-12's real terminal-status logic even though this phase has no real `pi` process).

### Related architecture memory (not a repo file — session/project memory)
- The `try-it-out-runtime-architecture` project memory explains this phase is a deliberate interim "cheat" step before the eventual real in-process `pi`/GAISE runtime phase (still not on the ROADMAP) — this phase must NOT be confused with or grow into that one.

### Schema/format examples for the new demo agent
- `data/agents/hvac-load-calculator.yaml` and `data/agents/rfi-triage-assistant.yaml` — existing Oracle AgentSpec YAML shape (`component_type`, `id`, `name`, `description`, `metadata`, `system_prompt`, `llm_config`, `tools`, `human_in_the_loop`) to follow for `data/agents/demo-rfi-triage.yaml`'s frontmatter (note: `llm_config` in the YAML is present for schema-shape consistency only — D-07 says the backend ignores it and uses a fixed model).
- `drizzle/schema.ts` — existing `try_it_out_mode`/`try_it_out_url`/`try_it_out_task_template` column definitions.
- `scripts/ingest.ts` — `flattenRecord()` / `onConflictDoUpdate` pattern that must continue excluding `try_it_out_*` columns.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/tryItOut.ts` — frozen exports/types (lines 1–25); everything below the mock-implementation banner (lines ~51+) is what gets replaced.
- `src/lib/components/TryItOutPanel.svelte` (Phase 6) — unchanged; already renders `JobEvent.summary` lines from `subscribeProgress` and a download button on `succeeded` / error block on `failed`. The new staged `info` events (D-11) render through this existing path with no component changes.
- `src/routes/agents/[slug]/+page.svelte` — unchanged; already gates `TryItOutPanel` rendering on `agent.tryItOutMode === 'runnable'`.
- `data/agents/hvac-load-calculator.yaml`, `data/agents/rfi-triage-assistant.yaml` — format reference for the new `demo-rfi-triage.yaml`.

### Established Patterns
- Drizzle flat-nullable-column pattern (`drizzle/schema.ts`) for `try_it_out_*` — no JSON blobs.
- `scripts/ingest.ts`'s `flattenRecord()`/`onConflictDoUpdate` explicitly omits `try_it_out_*` columns from the update `set` clause — new code must not add these columns to that list.
- No existing `src/routes/api/*` directory or `+server.ts` file exists anywhere in this codebase yet — this phase establishes that pattern from scratch (standard SvelteKit server-route conventions apply, no local precedent to match).
- No `skill.md` or LLM-prompt files exist anywhere in the repo yet — this phase establishes the "base prompt + skill.md loaded from files shipped with the app" pattern from scratch.
- No LLM SDK is currently a dependency (`package.json` has `better-sqlite3`, `drizzle-orm`, `yaml`, `zod` — no `openai` or similar). D-06 adds it.

### Integration Points
- `agent.tryItOutMode` / `agent.slug` already flow from `+page.server.ts`'s `db.select()` into the page (Phase 5); `agentId` passed into `TryItOutPanel` is `agent.slug`. The new job routes must map an incoming `agentId` (the slug) to the correct base-prompt/`skill.md` files shipped in the app package — this mapping mechanism (e.g. a fixed directory keyed by slug) is left to research/planning.

</code_context>

<specifics>
## Specific Ideas

- New demo agent slug: `demo-rfi-triage` (file `data/agents/demo-rfi-triage.yaml`) — name/description must read as obviously demo-only.
- `skill.md` behavior, verbatim intent: "read the uploaded RFI text, classify it by urgency and by discipline (structural / MEP / architectural), write a short triage result file containing the classification, recommended routing, and a one-line rationale."
- Staged progress line texts (exact wording intent, not necessarily verbatim strings): "reading input…", "calling model…", "writing output…", then a terminal succeeded/failed line — typed as `info`, not `tool_start`/`tool_end`.
- `jobId` shows up in the URL as `?job=<jobId>` — should be shareable/bookmarkable to a stakeholder mid- or post-demo.

</specifics>

<deferred>
## Deferred Ideas

- Real in-process `pi`/GAISE runtime execution (RPC mode, `agent_settled` completion, real tool-call streaming) — tracked as its own future phase per the `try-it-out-runtime-architecture` memory. This phase's LLM-only "cheat" backend must not grow into that.
- Re-enabling `hvac-load-calculator` (or any other existing catalog agent) as `runnable` — explicitly deferred; would require real tool execution this phase doesn't provide.
- A second demo agent — explicitly not needed for this phase.

</deferred>

---

*Phase: 07-fake-demo-backend-no-container-pi-implementing-the-try-it-ou*
*Context gathered: 2026-08-19*
