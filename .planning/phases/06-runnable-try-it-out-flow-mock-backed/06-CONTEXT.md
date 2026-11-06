# Phase 6: Runnable Try It Out Flow (mock-backed) - Context

**Gathered:** 2026-08-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Give the `runnable` mode of the Try It Out affordance (currently a disabled placeholder button from Phase 5) a working, demoable-end-to-end UI backed entirely by a mock — no real backend, no real `pi`/GAISE execution. The mock's data shapes are frozen to `docs/job-api-contract.md` so that when the real backend lands later (see [[try-it-out-runtime-architecture]] memory — in-process pi/GAISE module, later phase), swapping mock → real touches only `src/lib/tryItOut.ts`, never any UI component.

</domain>

<decisions>
## Implementation Decisions

### Client API surface (frozen, per docs/job-api-contract.md)
- **D-01:** Exactly three exported functions in `src/lib/tryItOut.ts`, no more, no fewer:
  - `submitJob(agentId: string, task: string, file?: File | null): Promise<SubmitResult>`
  - `subscribeProgress(jobId: string, onUpdate: (u: JobUpdate) => void): () => void` — returns an unsubscribe function
  - `downloadArtifact(jobId: string): Promise<void>`
- **D-02:** These signatures are frozen. UI components (`TryItOutPanel.svelte`) import ONLY these three functions — nothing in the UI references `fetch`, `EventSource`, endpoints, or any transport detail directly.
- **D-03:** Types (`JobStatus`, `JobEvent`, `JobUpdate`, `SubmitResult`) exactly as specified in `docs/job-api-contract.md` (see canonical_refs) — copy them verbatim, do not redesign.

### Mock behavior (implement now, delete wholesale later)
- **D-04:** `submitJob`: ~400ms artificial delay, returns a mock `jobId` with `status: 'queued'`.
- **D-05:** `subscribeProgress`: emits `running` immediately, then timestamped `JobEvent`s on a timer, terminal `succeeded` at ~4s. Event summaries modeled on real observed `pi` `tool_execution` output — e.g. `read data/sample.csv`, `read data/sample.csv (12 lines)`, `count rows in data/sample.csv`, `write output/result.txt`. Timestamps in `"10:46:48"`-style format (see `JobEvent.ts` field).
- **D-06:** Fail path: when `task` matches `/(^|\W)fail(\W|$)/i` (word-boundary match on "fail", not a substring match — so e.g. "failure" or "failing" also trigger it, but "hardfailover" as one token would not under a strict `\W` boundary — use the exact regex from the contract doc), the job ends in `status: 'failed'` with a realistic `error` string (e.g. `"pi exited non-zero: required input file missing"`).
- **D-07:** `downloadArtifact`: generates and triggers download of a small text blob referencing the submitted task (no real file storage).
- **D-08:** All mock internals (timers, fake job store, fake event generation) must be isolated within `tryItOut.ts` so they can be deleted wholesale when the real backend lands — no mock state or logic leaking into other files.
- **D-09:** Completion semantics: `succeeded` corresponds to `pi`'s `agent_settled` event plus a clean exit (per [[try-it-out-runtime-architecture]] — do NOT key success off `agent_end`, which can fire mid-retry, even though this phase only mocks it). `failed` is any non-zero exit, timeout, or error, always carrying a non-null `error` string.

### TryItOutPanel.svelte (Svelte 5, runes — project uses `svelte@^5.54.0`)
- **D-10:** Elements: task `<textarea>`, optional file `<input type="file">`, a "Run" button, a live auto-scrolling progress feed (renders `JobEvent.summary` lines as they arrive, newest at bottom, auto-scrolls to keep the latest visible), a "Download results" button shown only on `succeeded`, and a red failed-state block showing `JobUpdate.error` shown only on `failed`.
- **D-11:** Use Svelte 5 runes (`$state`, `$effect`, etc.) consistent with the rest of the codebase — this project has no Svelte 4 `export let`/`$:` legacy to match.
- **D-12:** The panel calls `submitJob` on Run, then `subscribeProgress` to drive the feed, and calls the returned unsubscribe function on component destroy / job terminal state to avoid leaked timers.
- **D-13:** The panel must work in two contexts: (a) wired into the agent detail page when `agent.tryItOutMode === 'runnable'`, using `agent.slug` (or equivalent) as `agentId`; (b) standalone, with a hardcoded `agentId` (e.g. for isolated dev/demo use) — same component, no fork.

### Wiring into the detail page
- **D-14:** In `src/routes/agents/[slug]/+page.svelte`, the existing disabled-button block for `runnable` mode (currently lines ~71-79: a `disabled` `<button>` with `title="Try it out is not yet available for this agent"`) is REPLACED by `<TryItOutPanel agentId={agent.slug} />` (or equivalent prop). The `external` mode link block (lines ~62-70) and the `none`/missing no-render behavior from Phase 5 are UNCHANGED.
- **D-15:** No changes to `drizzle/schema.ts`, `scripts/ingest.ts`, or any file under `src/lib/spec/` — this phase is purely client-side (mock client + Svelte component + one detail-page wiring change). The `try_it_out_*` columns and their semantics are already fully built by Phase 5.

### Claude's Discretion
- Exact visual styling of the progress feed (monospace log box vs. styled list) — should read as a live tool-call log, consistent with the rest of the app's Tailwind conventions.
- Whether `subscribeProgress`'s timer-driven events use `setInterval`/`setTimeout` chains or a single scheduled sequence — implementation detail, not contract-visible.
- Exact polling/timer cadence for individual mock events between `running` and the terminal state, as long as total time to terminal is ~4s per D-05.
- Whether `TryItOutPanel` is a single file or splits a sub-component for the progress feed — no decision was made on internal component decomposition.

</decisions>

<specifics>
## Specific Ideas

- "Mock progress events modeled on real pi tool_execution output (timestamped lines like 'read data/sample.csv', 'read (12 lines)', 'write output/result.txt')" — the contract doc's exact example lines should appear in the mock, not generic placeholder text, so the demo reads as authentic.
- "A task containing the word 'fail' triggers the failed path so both outcomes can be demoed" — this is a deliberate, documented demo hook, not a bug; both the success and failure UI states must be reachable without code changes during a live demo.
- The whole phase exists so a future runtime phase (real pi/GAISE integration, per [[try-it-out-runtime-architecture]]) can swap in cleanly — treat the contract-shape discipline (D-01/D-02/D-08) as the most important constraint in this phase, more important than any mock implementation elegance.

</specifics>

<canonical_refs>
## Canonical References

### Job API contract (MANDATORY — read before planning or implementing)
- `docs/job-api-contract.md` — the frozen client function signatures, types (`JobStatus`, `JobEvent`, `JobUpdate`, `SubmitResult`), mock behavior spec, fail-path regex, and completion semantics. This phase's entire scope is "implement this document." Do not deviate from its signatures or type shapes.

### Related architecture memory (not a repo file — session/project memory)
- The `try-it-out-runtime-architecture` project memory (in the assistant's persistent memory, topic: in-process pi/GAISE sandbox module) explains WHY the mock is contract-shaped this way: a future phase will replace this mock with an in-process module calling `pi --mode rpc`, keying completion off the `agent_settled` event and streaming `tool_execution_start`/`tool_execution_end` events — which is exactly what `JobEvent`'s `tool_start`/`tool_end` types and the `agent_settled`-not-`agent_end` completion semantics (D-09) are modeling now, ahead of time.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/routes/agents/[slug]/+page.svelte` lines 62-80 — the existing `external`/`runnable`/none conditional block from Phase 5. Only the `runnable` branch (lines 71-79, currently a disabled `<button>`) changes; the `external` branch and the executive-summary layout are untouched.
- `src/lib/components/CustomizationPanel.svelte` — nearest existing example of a `$lib/components/*.svelte` component in this codebase's style (plain `<script lang="ts">`, Tailwind utility classes, no external UI library).

### Established Patterns
- Components live in `src/lib/components/`; `TryItOutPanel.svelte` should follow that location convention (`src/lib/components/TryItOutPanel.svelte` — the user's phase description gives this exact path).
- The project uses Svelte 5.54 runes-mode throughout — no legacy `export let` reactive-declaration style exists anywhere to accidentally mimic.
- `src/routes/agents/try-it-out.test.ts` (added in Phase 5) is the existing jsdom test pattern for this route — a new mock-client/panel test suite should follow the same `// @vitest-environment jsdom` + `@testing-library/svelte`-style convention if that's what Phase 5 used (read the file to confirm before writing new tests).

### Integration Points
- `agent.tryItOutMode`, `agent.tryItOutUrl` (unused here) — already flow from `+page.server.ts`'s `db.select()` into the page, per Phase 5. This phase adds no new server-side data; `agentId` for the panel is just `agent.slug`, already available client-side.

</code_context>

<deferred>
## Deferred Ideas

- The real backend implementation (in-process `pi --mode rpc` execution, actual file upload handling, real artifact packaging) — explicitly out of scope; tracked as a future phase per [[try-it-out-runtime-architecture]]. Do NOT let this phase grow into that one.
- Any change to `external` or `none` mode behavior — unchanged from Phase 5.
- Any change to `drizzle/schema.ts`, `scripts/ingest.ts`, or `src/lib/spec/*` — none needed or authorized in this phase (D-15).

</deferred>

---

*Phase: 06-runnable-try-it-out-flow-mock-backed*
*Context gathered: 2026-08-19*
