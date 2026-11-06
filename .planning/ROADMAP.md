# Roadmap: AIC Agent Library

## Overview

The original four phases deliver a public browse-and-discovery catalog for 100+ AI agents. The data pipeline is the foundational dependency — nothing else can be built until normalized agent data flows through the shim layer. Catalog browse and agent detail pages come next, sharing the same component surface. Hybrid search follows once the detail page components and curated semantic summary fields exist. The customization placeholder closes out v1 as an isolated, low-risk addition.

Phases 5-7 were added after the fact (see "Roadmap Evolution" in STATE.md) as a self-contained "Try It Out" initiative, branching off Phase 2 rather than blocking on Phase 3/4: Phase 5 adds the optional `try_it_out` field to the catalog shape, Phase 6 builds a mock-backed runnable demo flow against a frozen client contract, and Phase 7 replaces the mock with a real (no-container) SvelteKit backend that calls an LLM directly. All three are complete. Phases 3 and 4 were built later by the autonomous run; Phases 9-15 hardened the Try It Out runtime and added agent types, the MCP generator and the MCP test platform. Phases 16-20 record work executed outside the normal GSD flow (see STATE.md "Roadmap Evolution"), and Phases 21-23 are planned.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Data Pipeline** - Canonical data model, Oracle AgentSpec ingestion, SQLite store (completed 2026-03-19)
- [ ] **Phase 2: Catalog and Detail** (code complete; only human checkpoint 02-04 pending human) - Browse page, agent detail page, responsive layout
- [x] **Phase 2.1: Green Baseline (INSERTED)** - Zero type errors, zero failing tests before further work
- [x] **Phase 2.2: Scale and Seed Data (INSERTED)** - Synthetic 150-agent fixture set for search, pagination and ingest scale tests
- [x] **Phase 3: Search** - Hybrid keyword + semantic search with live results
- [x] **Phase 4: Customization Placeholder** - Customize button and visible-but-non-functional menu
- [x] **Phase 5: Try It Out Field** - Optional try_it_out field (none/external/runnable) threaded through schema, ingest, and detail page (completed 2026-08-19)
- [x] **Phase 6: Runnable Try It Out Flow (mock-backed)** - Mock-backed job client + panel for runnable mode, contract-shaped for a later real backend swap
- [x] **Phase 7: No-Container Demo Backend for Try It Out** - Real (no-Docker/no-pi) SvelteKit server routes calling an LLM, replacing the mock client (completed 2026-08-20)
- [x] **Phase 8: Container-backed Try It Out (warm on visit)** - Pi + skill container warmed when an agent page is opened; runs behind the existing job API (completed 2026-10-12)
- [x] **Phase 9: Try It Out Hardening** - Adversarial review and chaos tests of the Phase 8 lease/proxy/container code
- [x] **Phase 10: Accessibility (UI-03)** - WCAG AA keyboard navigation and screen-reader labels across catalog and detail
- [x] **Phase 11: Related Agents (DISC-01)** - Similar-agents panel on the detail page using Phase 3 embeddings
- [x] **Phase 12: Agent Types and Intake Research** - Taxonomy of hostable agent types/systems, per-format capability matrix, author intake guide
- [x] **Phase 13: Multi-Agent and Multi-Format Hosting (flagged)** - Canonical model extension, adapters, validate-submission CLI, system detail rendering, all behind a feature flag
- [x] **Phase 14: MCP Generator (generalized from research, flagged)** - Research synthesis first, then input-adapter generator (DB schema/CUST-02 is one adapter among OpenAPI, tabular catalogs, ...) (code complete 2026-10-12, verification human_needed: see 14-HUMAN-UAT.md)
- [x] **Phase 15: MCP Test Platform (flagged)** - Port the existing benchmark harness (offline mock pattern, D1-D6 scoring, tier gates) to score any MCP server (code complete 2026-10-13, verification human_needed: see 15-HUMAN-UAT.md)
- [x] **Phase 16: Review and Hardening Pass** - Code review and fixes for 13-15, audit fixes, build fix, error states, smoke, perf, dependency health, the user's seven decisions (executed outside the GSD flow, 2026-10-14)
- [x] **Phase 17: Optional UI Features (flagged)** - UI-04 spec viewer, DISC-02 compare, UI-02 dark mode, all default off (outside the GSD flow; browser checks pending human)
- [x] **Phase 18: Live Verification and Container-Path Fixes** - Real-model search run, FastMCP 3.4.8 and 4.1.0, live Podman run and fixes, human guide (outside the GSD flow; remaining checks pending human)
- [x] **Phase 19: Generator Input Kinds** - Swagger 2.0, OAuth2, OpenAPI 3.1 audit, SQL dialects, Prisma, OData (outside the GSD flow)
- [x] **Phase 20: Proposal Layer and Context Pack** - Data-only proposals and context pack, stages 1-2 (outside the GSD flow)
- [x] **Phase 21: Generator Stage 0** - Description cleanup, tool annotations, outputSchema, deterministic tool order (complete 2026-10-15, verification passed)
- [x] **Phase 22: Proposal Layer Follow-ups** - First real proposal reviewed, baseline vs proposal run, hygiene tuning, derived_filter on OData (complete 2026-10-15, verification human_needed: Ville's review of the proposal pending)
- [x] **Phase 23: Code Review of New Generator Code** - Review, fixes and security audit of everything added since the Phase 14 review (complete 2026-10-15, verification passed, security SECURED)
- [x] **Phase 24: Agent Inventory and Catalog Template** - see details (not started; execution order 24-30 first, then 21-23)
- [x] **Phase 25: Design-stage Agents** - see details (not started; execution order 24-30 first, then 21-23)
- [x] **Phase 26: Sourcing-stage Agents** - see details (not started; execution order 24-30 first, then 21-23)
- [x] **Phase 27: Manufacturing-stage Agents** - see details (not started; execution order 24-30 first, then 21-23)
- [x] **Phase 28: Site and Handover Agents** - see details (not started; execution order 24-30 first, then 21-23)
- [x] **Phase 29: Further DDC-skill Agents** - see details (not started; execution order 24-30 first, then 21-23)
- [x] **Phase 30: Release Preparation** - see details (not started; execution order 24-30 first, then 21-23)
- [x] **Phase 31: Decouple DDC Agents from MCP Work** - see details (fix run 2026-10-15, order 31-38)
- [x] **Phase 32: Align Strong-match Agents** - see details (fix run 2026-10-15, order 31-38)
- [x] **Phase 33: Align Moderate-match Agents** - see details (fix run 2026-10-15, order 31-38)
- [x] **Phase 34: Own-design Agents Relabelled** - see details (fix run 2026-10-15, order 31-38)
- [x] **Phase 35: DDC Extras Verified and Extended** - see details (fix run 2026-10-15, order 31-38)
- [ ] **Phase 36: LVI-INFO MCP Agent (flagged)** - see details (fix run 2026-10-15, order 31-38)
- [ ] **Phase 37: DDC Mapping for Alok** - see details (fix run 2026-10-15, order 31-38)
- [ ] **Phase 38: Release Branch Rework** - see details (fix run 2026-10-15, order 31-38)

## Phase Details

### Phase 1: Data Pipeline

**Goal**: Structured, normalized agent data flows from source YAML files through the shim layer into a queryable SQLite store
**Depends on**: Nothing (first phase)
**Requirements**: PIPE-01, PIPE-02, PIPE-03, PIPE-04
**Success Criteria** (what must be TRUE):

  1. Running the ingestion script against a directory of Oracle AgentSpec YAML files produces a populated SQLite database with one `AgentRecord` row per file
  2. Re-running ingestion on the same files produces identical records — no duplicates, `last_ingested_at` timestamp updated
  3. A malformed or invalid YAML file causes Zod validation to fail with a clear error message, leaving valid records unaffected
  4. No Oracle AgentSpec field names appear in `AgentRecord` — the canonical type uses its own naming
  5. The ingestion script runs as part of the build step without manual intervention

**Plans:** 2/2 plans complete

Plans:

- [x] 01-01-PLAN.md — AgentRecord canonical type, Oracle AgentSpec Zod schema, adapter registry, and unit tests
- [x] 01-02-PLAN.md — Drizzle ORM schema, ingestion script with upsert semantics, build-step integration, and integration tests

### Phase 2: Catalog and Detail

**Goal**: Users can browse the agent catalog, filter by category and attributes, and read agent detail pages with progressive disclosure for dual audiences
**Depends on**: Phase 1
**Requirements**: BROW-01, BROW-02, BROW-03, DETL-01, DETL-02, DETL-03, UI-01
**Success Criteria** (what must be TRUE):

  1. User can browse a paginated catalog page organized by domain/function categories without layout degradation at 100+ agents
  2. User can filter the catalog by at least three attributes (e.g., LLM, tools, deployment type) and see results update without a page reload
  3. User can open an agent detail page that shows name, purpose, use cases, and a GitHub link by default — no technical details visible until expanded
  4. User can expand a collapsible technical specification section to see LLM, tools, memory system, invocation, and deployment details
  5. User can see which fields of the agent are tailorable in a customization panel on the detail page
  6. All pages are usable on desktop and tablet viewports without horizontal scrolling or broken layouts

**Plans:** 3/4 plans executed

Plans:

- [x] 02-01-PLAN.md — SvelteKit scaffold, Tailwind CSS v4, adapter-node, db singleton, tailorable fields config, Wave 0 test skeletons
- [x] 02-02-PLAN.md — Catalog browse page with AgentCard, FilterBar (3 filters: category, model, status), Pagination, responsive grid
- [x] 02-03-PLAN.md — Agent detail page with progressive disclosure, TechAccordion, CustomizationPanel
- [ ] 02-04-PLAN.md — Human verification checkpoint for catalog and detail pages (PENDING HUMAN: the only remaining Phase 2 item; not executed, not faked, Phase 2 not marked complete)

### Phase 3: Search

**Goal**: Users can find agents using natural language queries or short keywords, with results appearing live as they type
**Depends on**: Phase 2
**Requirements**: SRCH-01, SRCH-02, SRCH-03
**Success Criteria** (what must be TRUE):

  1. User can type a natural language query (e.g., "automate customer support") into a search bar and see semantically relevant agents ranked at the top
  2. User can type a short keyword (e.g., "SQL") and get reliable results that include agents with exact keyword matches even if embedding similarity is low
  3. Search results update live as the user types — no submit button required
  4. A labeled test set of 20+ query/result pairs passes with acceptable ranking accuracy before search is declared done

**Plans:** 5 plans

Plans:

- [x] 03-01-PLAN.md — Embedding storage (agent_embeddings), Embedder interface + transformers impl, ingest embedding step with staleness skip (wave 1)
- [x] 03-02-PLAN.md — Tokenizer, in-TS BM25 with prefix matching, cosine, weighted RRF hybrid ranking (wave 1)
- [x] 03-03-PLAN.md — Lazy search service, /api/search route, catalog loader `q` support (wave 2)
- [x] 03-04-PLAN.md — Debounced SearchBar, URL/q handling, no-results and live-region UI (wave 3)
- [x] 03-05-PLAN.md — Search validation: 20+ labeled queries on the 2.2 scale corpus, BM25 hit@3 gate, real-embedding test (skip by default, pending human) (wave 2)

### Phase 4: Customization Placeholder

**Goal**: The customization entry point is visible and accessible on agent detail pages, surfacing future wizard flows without implementing them
**Depends on**: Phase 2
**Requirements**: CUST-01
**Success Criteria** (what must be TRUE):

  1. User can see a "Customize" button on every agent detail page
  2. Clicking "Customize" opens a menu showing available customization options — items are clearly labeled but clicking them produces a "coming soon" or disabled state, not an error

**Plans**: 1 plan

Plans:

- [x] 04-01-PLAN.md — CustomizeMenu component (button + accessible disabled placeholder menu), wired into detail page, with tests

### Phase 5: Try It Out Field

**Goal:** Agent records support an optional `try_it_out` field (mode: none | external | runnable, url, task_template) threaded through the Drizzle schema, ingest script, and agent detail page. External mode renders a working "Try it out" link; runnable mode renders a disabled button; none/missing renders nothing. No runtime is built. One agent (e.g. rfi-triage-assistant) is set to external with a placeholder url as a working example.
**Depends on:** Phase 2
**Requirements**: none assigned (scope defined by 05-CONTEXT.md decisions D-01..D-13)
**Success Criteria** (what must be TRUE):

  1. `drizzle/schema.ts` includes a `try_it_out` field capturing mode (none|external|runnable), url, and task_template
  2. `scripts/ingest.ts` parses and writes `try_it_out` data for agents that define it
  3. Agent detail page renders: nothing for none/missing, a working link for external, a disabled button for runnable
  4. One agent (e.g. rfi-triage-assistant) has mode: external with a placeholder url visible on its detail page
  5. No runtime execution behavior is added for runnable mode

**Plans:** 2/2 plans complete

Plans:

- [x] 05-01-PLAN.md — Tracer: try_it_out_* schema columns applied to the DB, mode-conditional Try It Out affordance on the agent detail page (external link / disabled runnable button / nothing), rfi-triage-assistant set to external with a placeholder URL
- [x] 05-02-PLAN.md — Ingestion safe defaults + no-clobber onConflictDoUpdate omission with regression tests, full-build durability check, human verification of all three modes

### Phase 6: Runnable Try It Out Flow (mock-backed)

**Goal:** Build a mock-backed, contract-shaped "Try It Out" runnable flow that demos end-to-end with no real backend: a client layer (`src/lib/tryItOut.ts`) exposing exactly `submitJob`, `subscribeProgress`, and `downloadArtifact` per `docs/job-api-contract.md`'s frozen signatures, and a Svelte 5 `TryItOutPanel.svelte` wired into the agent detail page's `runnable` mode (replacing Phase 5's disabled placeholder button), also usable standalone with a hardcoded agentId. Swapping mock → real backend later must touch only `tryItOut.ts`, never the UI.
**Depends on:** Phase 5
**Requirements**: none assigned (scope defined by `docs/job-api-contract.md` and user-specified success criteria below)
**Success Criteria** (what must be TRUE):

  1. `src/lib/tryItOut.ts` exposes `submitJob`, `subscribeProgress`, `downloadArtifact` — all mock-backed and contract-shaped; a later real-backend swap touches only this file
  2. Mock progress events look like real `pi` tool_execution output, with timestamps (e.g. "read data/sample.csv", "read data/sample.csv (12 lines)", "write output/result.txt")
  3. `TryItOutPanel.svelte` renders a task textarea, optional file input, Run button, a live auto-scrolling progress feed, a "Download results" button on success, and a red failed state showing the error
  4. A task containing the word "fail" exercises the failed path so both outcomes are demoable
  5. The panel is wired into the runnable-mode agent detail page AND works standalone with a hardcoded agentId
  6. No real backend exists; the UI only ever calls the three client functions — no `fetch`/`EventSource`/endpoint references anywhere else in the UI

**Plans:** 3/3 plans complete

Plans:
**Wave 1**

- [x] 06-01-PLAN.md — Tracer: complete frozen mock client (`src/lib/tryItOut.ts` — submitJob/subscribeProgress/downloadArtifact + the 4 contract types, success and fail scripts), tracer `TryItOutPanel.svelte` (Task textarea, Run, live timestamped feed), and the runnable-mode detail-page wiring replacing Phase 5's disabled button

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 06-02-PLAN.md — Panel expansion: red "Job failed" block, "Download results" button, optional file input, bounded auto-scrolling monospace log box, plus unmount/terminal/re-run subscription-cleanup tests

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 06-03-PLAN.md — COVERAGE.md no-external-API declaration, staged runnable demo row in the dev DB, and human verification of both outcomes in a browser

### Phase 7: No-Container Demo Backend for Try It Out

**Goal:** Replace the mock-backed Try It Out client with a real (but "cheating") demo backend: no Docker, no `pi`, no parallelism, no worker containers — plain SvelteKit server routes that actually call an LLM. `POST /api/tryitout/jobs` accepts `agentId`, `task`, and an optional uploaded file; creates a session UUID that acts as a fake container ID (`jobId`); writes the uploaded file to a `jobId`-prefixed server folder (e.g. `.tryitout-work/<jobId>/input/`) — isolation is by UUID prefix only, and file-collision risk is knowingly accepted for the demo. The backend loads the agent's hardcoded base prompt and its `skill.md` from files shipped with the app (pretending to fetch a "container prompt" by container ID, but actually reading locally) — demos are restricted to agents that only need to read the input file and write an output file. It then calls a language model with the base prompt + skill.md + uploaded file contents, writes the result to `.tryitout-work/<jobId>/output/`, and updates job status `queued → running → succeeded` (or `failed` with an error string) — progress is staged status only, no live tool-event feed, since a single LLM call has no tool stream. `GET /api/tryitout/jobs/:id` returns a `JobUpdate` (`{ status, events, error }`) with staged progress lines; `GET /api/tryitout/jobs/:id/artifact` returns the output file as a download, valid only when `status: 'succeeded'`. Job state lives in server memory keyed by `jobId`; the client persists `jobId` (URL `?job=` or a cookie) so refreshing mid-session restores the view and the finished result/download stays available. `src/lib/tryItOut.ts` is rewired to call these routes via real `fetch()` — the three function signatures (`submitJob`, `subscribeProgress`, `downloadArtifact`) stay identical, and the UI components (including Phase 6's disclosure panel) are unchanged. The LLM provider and API key are supplied server-side only (env var on deploy), never sent to the client.
**Requirements**: none assigned (scope defined by user-specified success criteria below)
**Depends on:** Phase 6
**Success Criteria** (what must be TRUE):

  1. `POST /jobs` creates a `jobId` that acts as a fake container ID; no container or `pi` is started
  2. The uploaded file is written to a `jobId`-prefixed server folder
  3. For the given `agentId` the backend loads BOTH the hardcoded base prompt AND the agent's `skill.md` from the package, and passes both plus the uploaded file to the model
  4. Backend calls the language model, writes an output file, and status goes `queued → running → succeeded` (or `failed` with an error)
  5. Progress is staged status only (no live tool-event feed); download brightens on success
  6. GET status and GET artifact work; download returns the real generated result
  7. `src/lib/tryItOut.ts` calls the routes via `fetch`; UI components (incl. the Phase 6 panel) unchanged
  8. `jobId` is persisted on the client and survives a refresh in the same session; the finished result and download remain available
  9. The LLM provider/key are server-side only, never exposed to the client

**Plans:** 5/5 plans executed in 4 waves

Plans:
**Wave 1** *(parallel)*

- [x] 07-01-PLAN.md — Preflight: install the `openai` SDK, probe the deployed key with `models.list()` to resolve the model ID and whether custom `temperature` is accepted, freeze both into `src/lib/server/tryItOutModel.ts` behind a decision checkpoint (D-07 costly reversibility)
- [x] 07-02-PLAN.md — Demo assets: `data/agents/demo-rfi-triage.yaml` + shipped `skill.md` + sample RFI, one-off DB `UPDATE` flipping `demo-rfi-triage` to runnable and `hvac-load-calculator` back to none, `.tryitout-work/` gitignore

**Wave 2** *(blocked on Wave 1)*

- [x] 07-03-PLAN.md — Server core: in-memory job store with UUID-validated path helpers, base-prompt (DB) + `skill.md` (file) loader with agentId validation, and the staged runner making the single real OpenAI call

**Wave 3** *(blocked on Wave 2)*

- [x] 07-04-PLAN.md — The three `+server.ts` job routes (POST create / GET status / GET artifact) and the `src/lib/tryItOut.ts` mock-to-`fetch` rewire, with the Phase 6 test suite migrated to a fetch stub and UI components untouched

**Wave 4** *(blocked on Wave 3)*

- [x] 07-05-PLAN.md — `?job=` refresh persistence (SC-08) via a transport-free session helper plus minimal additive panel wiring, then live end-to-end human verification against the real OpenAI API

### Phase 8: Container-backed Try It Out (warm on visit)

**Goal:** Opening an agent's detail page warms a container running Pi with that agent's skill, so Try It Out runs in it behind the existing job API with no cold-start wait. Replaces the direct-LLM runner from Phase 7, which stays as fallback.
**Requirements**: Derived from 08-CONTEXT.md decisions D-01..D-22 (no REQ-IDs mapped)
**Depends on:** Phase 7
**Plans:** 8/8 plans complete

Plans:

**Wave 1**

- [x] 08-01-PLAN.md — Container runtime layer: `ContainerRuntime` contract, dockerode runtime over the Podman socket, fake runtime, env config, D-21 limits, internal-network guard; npm deps
- [x] 08-02-PLAN.md — Pi JSONL parser, event mapper and completion rule; `skill.md` -> Pi `SKILL.md` with frontmatter, fallback loader kept working
- [x] 08-03-PLAN.md — LLM proxy `/api/llm/v1/chat/completions` (per-lease token, per-job budget, server-side key, SSE pass-through) and the `/api/llm/` auth-hook exemption

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 08-04-PLAN.md — Zip artifact end to end (store, route, client `.zip`), typed `pushEvent`, `sessionKey` on jobs
- [x] 08-05-PLAN.md — Lease manager (per-session, CAS states, cap/evict/busy, TTL reaper, orphan sweep), session identity, service wiring with warm-time staging of models.json + skill

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 08-06-PLAN.md — Jobs run `pi --mode json` in the session's container; `runJob` dispatcher with fallback only on engine/start failure; timeout/budget/failure modes
- [x] 08-07-PLAN.md — Warm on visit from the agent page load (non-blocking) and service start via the `init` hook

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 08-08-PLAN.md — `pi-runner` image, smoke script, compose socket/internal network, docs; live verification checkpoint on a Podman host

### Phase 2.1: Green Baseline (INSERTED)

**Goal:** `tsc --noEmit` reports 0 errors and `vitest run` has 0 failures, so every later phase starts from a trustworthy baseline.
**Requirements**: Maintenance (no REQ-IDs)
**Depends on:** Phase 8
**Success Criteria** (what must be TRUE):

  1. `npx tsc --noEmit` exits 0 (currently 22 errors in catalog.test.ts, try-it-out.test.ts, tryItOut.test.ts, detail.test.ts)
  2. `npx vitest run` exits 0 (currently 3 failures in scripts/set-try-it-out-mode.test.ts); fixes address root cause (test isolation / typing), not deleting tests
  3. A `npm run check` script runs typecheck + tests

**Plans**: 2 plans

Plans:
- [x] 02.1-01-PLAN.md — Fix 22 tsc errors in 4 test files (typing only)
- [x] 02.1-02-PLAN.md — Fix stale test DDL (set-try-it-out-mode) and add `npm run check`

### Phase 2.2: Scale and Seed Data (INSERTED)

**Goal:** A deterministic synthetic fixture set of ~150 agents (clearly marked synthetic, never in the shipped catalog) exists so search, pagination, filtering and ingest can be tested and timed at the intended scale.
**Requirements**: BROW-03 (scale validation)
**Depends on:** Phase 2.1
**Success Criteria** (what must be TRUE):

  1. A generator produces N synthetic AgentSpec YAMLs deterministically (seeded) into a test-only directory with realistic variety of categories, tags, models, tools
  2. Ingest of 150 agents completes and is idempotent; timing recorded
  3. Catalog filter/pagination tests run against the large set
  4. Shipped `data/agents` is untouched

**Plans**: 2 plans

Plans:
- [x] 02.2-01-PLAN.md — Seeded synthetic AgentSpec generator, `fixtures:scale` script, gitignored output dir
- [x] 02.2-02-PLAN.md — 150-agent ingest/idempotency/timing test and unmocked catalog filter/pagination tests

### Phase 9: Try It Out Hardening

**Goal:** The Phase 8 container/lease/LLM-proxy code withstands adversarial and failure conditions, proven by tests using the fake runtime (no real containers).
**Requirements**: Maintenance / security (no REQ-IDs)
**Depends on:** Phase 8
**Success Criteria** (what must be TRUE):

  1. Security review of lease tokens, proxy auth, budget enforcement, path/zip handling and network guard produces findings, each fixed or logged with rationale
  2. Chaos tests cover lease races, hung engine, budget exhaustion, token reuse across leases, oversized/malformed Pi JSONL, and reaper timing
  3. Live Podman checks that cannot run unattended are listed as "pending human" with exact commands

**Plans**: 4 plans

Plans:
- [x] 09-01-PLAN.md — Security review (09-SECURITY-REVIEW.md) and fixes with tests (budget, sweep scope, tar/zip, JSONL cap)
- [x] 09-02-PLAN.md — Chaos tests: lease races, hung engine, reaper timing (fake runtime/timers)
- [x] 09-03-PLAN.md — Chaos tests: budget exhaustion, token reuse, malformed/oversized Pi JSONL
- [x] 09-04-PLAN.md — Pending-human Podman checklist (09-HUMAN-UAT.md), decision log, docs

### Phase 10: Accessibility (UI-03)

**Goal:** Catalog, search and detail pages meet WCAG AA basics: full keyboard operability, labelled controls, focus management, contrast, live-region announcements.
**Requirements**: UI-03
**Depends on:** Phase 3
**Success Criteria** (what must be TRUE):

  1. Every interactive control reachable and operable by keyboard with visible focus
  2. Accessibility assertions (roles, names, labels) pass in component tests; an axe-based check runs in jsdom where feasible
  3. Search results count and state changes announced via live region
  4. Findings that need visual/manual checks are listed as "pending human"

**Plans:** 3 plans

Plans:
- [x] 10-01-PLAN.md — Audit (10-AUDIT.md), axe-core jsdom helper, WCAG contrast calculator and test
- [x] 10-02-PLAN.md — Fixes: skip link, landmarks, titles, heading order, focus styles, labels, focus management, live regions, contrast tokens
- [x] 10-03-PLAN.md — Per-component and page-level a11y tests (axe, keyboard, live regions), 10-HUMAN-UAT.md

### Phase 11: Related Agents (DISC-01)

**Goal:** The detail page shows similar agents computed from Phase 3 embeddings (with tag/category overlap fallback when embeddings are unavailable).
**Requirements**: DISC-01
**Depends on:** Phase 3
**Success Criteria** (what must be TRUE):

  1. Detail page shows up to 4 related agents, excluding itself
  2. Works without embeddings (tag/category fallback)
  3. Related lists validated against the Phase 2.2 scale set and the labeled set

**Plans:** 2 plans

Plans:
- [x] 11-01-PLAN.md — relatedAgents algorithm (cosine + tag/category fallback), service method, scale-set precision@4 validation
- [x] 11-02-PLAN.md — RelatedAgents component, detail page load wiring, axe + load tests

### Phase 12: Agent Types and Intake Research

**Goal:** Produce the decision basis for what the platform can host: a taxonomy of agent types and systems, how each maps (or does not map) onto Oracle AgentSpec, and an intake guide so any author can know exactly what to send. The platform is technology agnostic, with first-class support for specific technologies where useful.
**Requirements**: Research (no REQ-IDs)
**Depends on:** Phase 2.1
**Success Criteria** (what must be TRUE):

  1. `docs/agent-types.md`: taxonomy covering single agents, multi-agent systems (swarm, manager/worker, pipelines), workflow agents, skill/prompt packages, MCP-based agents, and framework-native agents (LangGraph, CrewAI, AutoGen, others found in research)
  2. A capability matrix: for each type and format, what AgentSpec expresses natively, what needs extension, what the library must display/store, and Try It Out suitability (runnable / external / not runnable)
  3. `docs/agent-intake-guide.md`: what authors should send (repo link vs config files vs test-dataset notes), minimum metadata, readiness checklist, and a short ready-to-send reply template answering "do you need config files or the GitHub repo?"
  4. A decision memo with recommended canonical-model changes and a ranked adapter list, each with trade-offs; open questions flagged for the human
  5. No real company data (e.g. customer datasets) is invented or included

**Plans:** 3 plans

Plans:

- [x] 12-01-PLAN.md — Taxonomy (docs/agent-types.md) and capability matrix (docs/agent-capability-matrix.md)
- [x] 12-02-PLAN.md — Author intake guide with ready-to-send reply template (docs/agent-intake-guide.md)
- [x] 12-03-PLAN.md — Decision memo with minimal additive Phase 13 proposal, README/PROJECT links, Phase 13 handoff note

### Phase 13: Multi-Agent and Multi-Format Hosting (flagged)

**Goal:** Implement the Phase 12 recommendations behind a feature flag (default off): canonical model extension for agent kind and multi-agent topology, adapters for Oracle AgentSpec multi-agent, MCP manifests, LangGraph/CrewAI/AutoGen configs and SKILL.md packages, a validate-submission CLI, and detail-page rendering of systems.
**Requirements**: P13-FLAG, P13-SCHEMA, P13-ADAPT, P13-SECURITY, P13-SEARCH, P13-CLI, P13-UI, P13-DOCS (derived from Phase 12 memo)
**Depends on:** Phase 12, Phase 3
**Success Criteria** (what must be TRUE):

  1. With the flag off, behaviour, schema output and existing tests are unchanged; DB changes are additive and non-destructive
  2. With the flag on, synthetic fixtures in each target format ingest into canonical records with kind and members/topology
  3. `npm run validate-submission -- <path>` reports ingestible / partial / missing-from-author for any folder, never throws on unknown formats
  4. Detail page renders member agents and orchestration topology for system-type agents
  5. Each adapter documents its assumptions; unknown fields are preserved, not dropped

**Plans:** 9 plans

Plans:

- [x] 13-01-PLAN.md — Flag-off golden captured first, AGENT_KINDS flag, kind contracts, additive agent_kinds sidecar table + tolerant reader (wave 1)
- [x] 13-02-PLAN.md — Adapter registry (never throws), scanner with caps, secret scan, Oracle AgentSpec Swarm/ManagerWorkers/Flow/A2A adapter + synthetic fixtures (wave 2)
- [x] 13-06-PLAN.md — Detail page: kind badge, members, topology, Try It Out restriction, axe (wave 2)
- [x] 13-03-PLAN.md — Flag-gated ingest branch, gated search text, flag-on search loader and related weight (wave 3)
- [x] 13-04-PLAN.md — catalog.yaml manifest, SKILL.md and Claude subagent adapters (wave 3)
- [x] 13-05-PLAN.md — CrewAI, MCP server.json, langgraph.json detector adapters (wave 3)
- [x] 13-07-PLAN.md — Catalog kind badge, Type filter, ?kind= param (wave 3)
- [x] 13-08-PLAN.md — `npm run validate-submission` CLI (wave 4)
- [x] 13-09-PLAN.md — Flag-off regression suite, all-formats ingest test, docs, decisions, verification (wave 5)


### Phase 14: MCP Generator (generalized from research, flagged)

**Goal:** A general MCP generator whose design is derived from the prior comparison research, not assumed. A database schema (CUST-02) is one input adapter among several, not the scope. Behind a feature flag, default off.
**Prerequisite (first deliverable):** read `~/projects/mcp-gen-comparison` and `~/projects/mcp-gen-comparison-2` (read-only) and write `RESEARCH-SYNTHESIS.md` in the phase directory BEFORE any design or code (starting points already seen: results.csv scores per arm across handauthored, from_openapi, gsd, plain, mcpybarra, openapi-mcp-generator; the ETIM-style 'synthesize what the API lacks' discriminator; wp5-bench arm registry incl. automcp/code2mcp/bioinfomcp install failures; and the second project's FastMCP+GSD Excel/TTxxx catalog server): which approach(es) scored best on D1-D6, which input types were covered (OpenAPI, Excel/TTxxx catalogs, docs-only, data dumps, profiles, ...), and known failure modes. The generator design must cite this synthesis.
**Requirements**: CUST-02 (as one adapter)
**Depends on:** Phase 12, Phase 4
**Success Criteria** (what must be TRUE):

  1. `RESEARCH-SYNTHESIS.md` exists and is committed before design work; the design doc and plans reference it
  2. Input-adapter architecture: each input type (OpenAPI document, tabular/Excel-style catalog sample, SQL DDL incl. CUST-02, plus any others the synthesis shows were covered) is a separate adapter behind one interface; adding an adapter does not change the core
  3. Schema/spec only, never credentials: credentials and API keys are never accepted, stored or logged; generated config uses env-var placeholders
  4. Deterministic core generator (Python FastMCP stdio, as in the study) with unit tests per adapter; generated servers include the behaviours the harness rewards (task-oriented tool names, trimmed responses, pagination clamp and ceiling warning, honest empty-result message, structured errors without raw envelopes or secrets, read-only unless write is opted in)
  5. Extension point for synthesized capability the source does not expose (e.g. in-memory filtering, derived queries), documented; ambiguous or unsupported input is reported, never guessed
  6. Phase 4 Customize menu gains a working "Generate MCP" entry when the flag is on; flag off leaves the placeholder unchanged
  7. Decisions logged with revert notes; no real customer data, keys or fixtures copied from the reference projects

**Plans:** 7 plans

Plans:

- [x] 14-01-PLAN.md — Design doc (cites RESEARCH-SYNTHESIS), MCP_GENERATOR flag, SourceModel/InputAdapter contract, adapter registry, credential scanner, diagnostics
- [x] 14-02-PLAN.md — Core emitter: tool synthesis, Python FastMCP templates, checklist behaviours, derived-filter extension point, golden tests
- [x] 14-03-PLAN.md — OpenAPI adapter with fixtures and golden
- [x] 14-04-PLAN.md — Tabular-catalog and SQL DDL (CUST-02) adapters with fixtures and goldens
- [x] 14-05-PLAN.md — Pipeline, zip bundle, `generate-mcp` CLI, flag-gated /api/mcp-generate route with size caps
- [x] 14-06-PLAN.md — Customize menu "Generate MCP" panel (flag-gated), flag-off regression, axe test
- [x] 14-07-PLAN.md — docs/mcp-generator.md (extension point), 14-HUMAN-UAT.md, decisions, VERIFICATION, invariant self-check

### Phase 15: MCP Test Platform (flagged)

**Goal:** Port the existing benchmark harness (`~/projects/mcp-gen-comparison` `harness/`, `wp5-bench/`, `wp5-mcp-generator-test-suite.md`: 12 cases across Tiers 1-4, D1-D6 scoring) into the platform rather than building a new sandbox, so any MCP server (generated by Phase 14 or submitted) can be scored the same way. Behind a feature flag, default off.
**Requirements**: Derived from Phase 14 and Phase 12 (no REQ-IDs yet)
**Depends on:** Phase 14, Phase 8
**Success Criteria** (what must be TRUE):

  1. A port-fidelity map lists each existing component and case and how it was ported or why deliberately not. Ground truth from the references: `harness/harness.py` (537 lines, 10 checks, live LVI-INFO API, real key - NOT portable as-is) and `wp5-bench/` (runner.py, base.py, report.py, leak_guard.py, arm adapters + registry, offline mock T2-STK-API case with case.yaml/golden.jsonl/rubric.yaml - the portable pattern). The suite design doc defines 12 cases (T1x1, T2x3, T3x4, T4x4) but only T2-STK-API has fixtures/golden/rubric; the map separates "implemented" from "designed only", and the remaining cases are implemented with synthetic offline mock fixtures where feasible, else listed as designed-only gaps. Existing runner/harness logic is reused or wrapped where possible, not rewritten
  2. Cases and scoring match the source suite's semantics: Tier 1 gate, Tier 2+3 carry the score, Tier 4 raises risk flags; only synthetic fixtures and mock upstreams (including fault injection) are used
  3. Safety rules kept from the existing project: no credentials, fake data only, container runs are "pending human"; the runner never touches real APIs or real keys
  4. Black-box MCP client over stdio (HTTP/SSE where declared); fake runtime for CI, Phase 8 container runtime for real runs
  5. Report JSON + human-readable summary and a UI panel for progress/results; flag off hides it
  6. Container runs that cannot be verified unattended are listed as "pending human" with exact commands

**Plans:** 13 plans in 9 waves (1: 01; 2: 02, 03, 05; 3: 04, 06, 07; 4: 09; 5: 08; 6: 10; 7: 11; 8: 12; 9: 13)

Plans:

- [x] 15-01-PLAN.md — (Wave 1) Port-fidelity map (committed first), MCP_TESTER flag, shared types, source-compatible case/golden/rubric loaders
- [x] 15-02-PLAN.md — (Wave 2) Minimal MCP client (stdio + Streamable HTTP) recording protocol misbehaviour, env allowlist, exec guard
- [x] 15-03-PLAN.md — (Wave 2) Mock upstream with seeded datasets, strict params, fault injection and request log; shared contract
- [x] 15-04-PLAN.md — (Wave 3) In-process fake MCP server, good and flawed variants, process-level variants, subprocess smoke test
- [x] 15-05-PLAN.md — (Wave 2) Leak detector, walkers, tool binding, strict expect evaluator and the 10 behaviour checks
- [x] 15-06-PLAN.md — (Wave 3) Scoring rollup (gate, tiers, thresholds, flags, verdict), rerun aggregation, Tier 3/4 special checks
- [x] 15-07-PLAN.md — (Wave 3) 12 synthetic cases (case.yaml/golden.jsonl/rubric.yaml), suite loader, golden-isolation gate
- [x] 15-08-PLAN.md — (Wave 5) Runner, subjects, report JSON + human summary, scorer-discrimination proof over fake variants
- [x] 15-09-PLAN.md — (Wave 4) Phase 14 generator as in-process subject, generator-side checks (partial spec, credentials, reproducibility)
- [x] 15-10-PLAN.md — (Wave 6) `npm run mcp-test` CLI, shared DriverRequest schema, in-container driver, runner image definition (build pending human)
- [x] 15-11-PLAN.md — (Wave 7) Flag-gated run API (202, poll, report), TTL job store, container run path tested on the fake runtime
- [x] 15-12-PLAN.md — (Wave 8) /mcp-test page and panel (flag-gated), Customize entry only when flag on, flag-off regression, axe
- [x] 15-13-PLAN.md — (Wave 9) docs, 15-HUMAN-UAT.md, decision consolidation, invariant self-check, VERIFICATION

### Phase 16: Review and Hardening Pass

**Executed outside the normal GSD flow** (no PLAN files by design; directly launched agents; record: `16-01-SUMMARY.md`, `16-VERIFICATION.md`; notes in `.planning/exploration/`).
**Goal:** Review and harden what the autonomous run built: code review and fixes for Phases 13-15, milestone integration audit, build and flake fixes, error states, smoke test, performance profile, dependency health, and the user's seven code decisions.
**Requirements**: none (hardening)
**Depends on:** Phase 15
**Status:** Complete 2026-10-14; verification `human_needed` (auth-enabled and browser checks)
**Plans:** 0 plans (outside the GSD flow; 1 summary)

### Phase 17: Optional UI Features (flagged)

**Executed outside the normal GSD flow** (record: `17-01-SUMMARY.md`, `17-VERIFICATION.md`).
**Goal:** Optional UI features behind default-off flags: UI-04 raw spec viewer (`UI_SPEC_VIEWER`), DISC-02 comparison (`AGENT_COMPARE`), UI-02 dark mode (`UI_DARK_MODE`).
**Requirements**: UI-04, DISC-02, UI-02
**Depends on:** Phase 10, Phase 13
**Status:** Complete 2026-10-13 (delivered, flagged); verification `human_needed` (browser checks)
**Plans:** 0 plans (outside the GSD flow; 1 summary)

### Phase 18: Live Verification and Container-Path Fixes

**Executed outside the normal GSD flow** (record: `18-01-SUMMARY.md`, `18-VERIFICATION.md`).
**Goal:** Run for real what had only been proven offline (real-model search, FastMCP, rootless Podman), fix the defects found, and write the human verification guide.
**Requirements**: none (verification of Phases 3, 9, 14, 15)
**Depends on:** Phase 16
**Status:** Complete 2026-10-14; verification `human_needed` (check 7 paid key, check 9 re-run, cancel path, browser)
**Plans:** 0 plans (outside the GSD flow; 1 summary)

### Phase 19: Generator Input Kinds

**Executed outside the normal GSD flow** (record: `19-01-SUMMARY.md`, `19-VERIFICATION.md`).
**Goal:** Extend the Phase 14 generator with Swagger 2.0, OAuth2 bearer-from-env, an OpenAPI 3.1/3.2 audit, SQL dialects (pg_dump, SQLite, mysqldump), a hand-rolled Prisma reader and OData (CSDL JSON, EDMX XML via hardened sax), without changing the core.
**Requirements**: CUST-02 (extends)
**Depends on:** Phase 14, Phase 18
**Status:** Complete 2026-10-14; verification `human_needed` (no live OData service run; no code review yet, see Phase 23)
**Plans:** 0 plans (outside the GSD flow; 1 summary)

### Phase 20: Proposal Layer and Context Pack

**Executed outside the normal GSD flow** (record: `20-01-SUMMARY.md`, `20-VERIFICATION.md`).
**Goal:** Stages 1-2 of the proposal layer: a data-only proposal format (13 op types, gates, fingerprint) and a context pack for an external agent session; no model calls inside the platform.
**Requirements**: CUST-02 (extends)
**Depends on:** Phase 19
**Status:** Complete 2026-10-14; verification `passed` for the scoped machinery (real use is Phase 22)
**Plans:** 0 plans (outside the GSD flow; 1 summary)

### Phase 21: Generator Stage 0

**Goal:** Improve every generated server's baseline quality: description cleanup (hygiene filter on spec-derived text), tool annotations (read-only hints), `outputSchema`/`structuredContent`, deterministic tool order.
**Requirements**: CUST-02 (extends)
**Depends on:** Phase 20
**Success Criteria** (what must be TRUE):

  1. Spec-derived descriptions pass a hygiene filter (no URLs, markup, template syntax or credential-shaped text reach tool descriptions)
  2. Every generated read tool carries read-only annotations; no tool claims write behaviour
  3. Tools declare an `outputSchema` and return `structuredContent` consistent with it
  4. Tool order is deterministic and stable across runs and input orderings
  5. Applies to every generated server; goldens will churn: regenerate in a dedicated commit (proposal goldens may need `UPDATE_GOLDEN=1`); generated packages' pytest still pass on FastMCP 3.4.8 and 4.1.0

**Plans:** 5 plans

Plans:
- [x] 21-01-PLAN.md — Hygiene filter on spec-derived descriptions (wave 1)
- [x] 21-02-PLAN.md — Read-only tool annotations on every generated tool (wave 2)
- [x] 21-03-PLAN.md — outputSchema and structuredContent (wave 3)
- [x] 21-04-PLAN.md — Deterministic tool order, shuffled-input tests (wave 4)
- [x] 21-05-PLAN.md — Golden regeneration commit, FastMCP 3.4.8/4.1.0 pytest in throwaway venvs, npm run check, VERIFICATION (wave 5)

### Phase 22: Proposal Layer Follow-ups

**Goal:** Finish the parts of stages 1-2 that need real use. The agreed scope (an external agent session writes proposals; the format supports structural edits merge/split/hide/rename/defaults/composite; the context pack exports spec, samples, domain docs and the deterministic baseline; the Phase 15 scorer is the gate; no model calls inside the platform) is built in Phase 20.
**Requirements**: CUST-02 (extends)
**Depends on:** Phase 20, Phase 21
**Success Criteria** (what must be TRUE):

  1. A first real proposal from an agent session exists and has been reviewed by Ville
  2. Baseline and proposal-assisted packages have been run through `mcp-test --allow-local-exec` and compared with the Phase 15 scorer
  3. Hygiene false positives (D-585) are tuned from real proposals
  4. `derived_filter` on OData (currently `odata-unsupported-op`, skipped in examples) is supported or its limitation is documented as final

**Status:** Complete 2026-10-15; verification `human_needed` (criterion 1, review by Ville, pending; criterion 4 resolved as a final limitation, D-610)
**Plans:** 5 plans

Plans:
- [x] 22-01-PLAN.md — First real proposal from this agent session on the Acme OpenAPI fixture via the context pack; gates, findings log, review by Ville pending in 22-HUMAN-UAT.md (wave 1)
- [x] 22-02-PLAN.md — Baseline vs proposal-assisted through mcp-propose-eval and mcp-test --allow-local-exec, Phase 15 scorer, no platform model calls, spend cap $0.50 (wave 2)
- [x] 22-03-PLAN.md — Hygiene false-positive tuning from the real proposal, tests in both directions, security checks untouched (wave 2)
- [x] 22-04-PLAN.md — derived_filter on OData: spike, decide support vs final limitation, implement or document with tests (wave 3)
- [x] 22-05-PLAN.md — npm run check alone, VERIFICATION, ROADMAP/STATE, decisions with revert steps (wave 4)

### Phase 23: Code Review of New Generator Code

**Goal:** `gsd-code-review` (plus fix) and a security audit of everything added since the Phase 14 review: Swagger 2.0/OAuth2/3.1 audit, SQL dialects and Prisma, OData and sax, proposals, context pack and the evaluation script, the binding file, the container-path fixes, the CLI changes.
**Requirements**: CUST-02 (hardening)
**Depends on:** Phase 20 (best after Phases 21-22 so the review covers the final code)
**Success Criteria** (what must be TRUE):

  1. `23-REVIEW.md` covers all code added since the Phase 14 review, with severity-classified findings
  2. Critical and warning findings are fixed with tests (`23-REVIEW-FIX.md`), or explicitly accepted with a decision id
  3. Security audit of the sax reader, the proposal and context-pack file inputs, and the binding file loader concludes SECURED or lists open threats
  4. `npm run check`, `vite build` and `npm run smoke` still pass

**Status:** Complete 2026-10-15; verification `passed`; security `SECURED` (1 threat fixed, 5 accepted, 0 open); pending human: container image builds and compose hardening (`23-HUMAN-UAT.md`)
**Plans:** 4/4 plans complete

Plans:
- [x] 23-01-PLAN.md - file-set inventory and five gsd-code-reviewer passes (A adapters, B SQL/Prisma, C OData/sax, D proposals/context pack/binding, E Phase 21-22 emit/container/CLI) -> 23-REVIEW.md
- [x] 23-02-PLAN.md - fixes for critical and warning findings with tests -> 23-REVIEW-FIX.md, decisions for accepted
- [x] 23-03-PLAN.md - security audit (sax, proposal/context-pack inputs, binding loader, emitted-Python injection, container path) -> 23-SECURITY.md
- [x] 23-04-PLAN.md - final gates (check, vite build, smoke, sequential), 23-VERIFICATION.md, ROADMAP/STATE

## Progress

**Execution Order:**
Phases execute in numeric order, with decimal phases between their integers: 1, 2, 2.1, 2.2, 3, 4, 5, ... 23. Phase 4 and Phases 5-7 depend only on Phase 2 and were built ahead of Phase 3. Phases 16-20 were executed outside the normal GSD flow and recorded afterwards.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Data Pipeline | 2/2 | Complete | 2026-03-19 |
| 2. Catalog and Detail | 3/4 | In Progress (02-04 human checkpoint pending) | - |
| 2.1 Green Baseline | 2/2 | Complete | 2026-10-12 |
| 2.2 Scale and Seed Data | 2/2 | Complete | 2026-10-12 |
| 3. Search | 5/5 | Complete (human_needed: UI items 3-4) | 2026-10-12 |
| 4. Customization Placeholder | 1/1 | Complete (human_needed: browser) | 2026-10-12 |
| 5. Try It Out Field | 2/2 | Complete | 2026-08-19 |
| 6. Runnable Try It Out Flow (mock-backed) | 3/3 | Complete | 2026-08-19 |
| 7. No-Container Demo Backend for Try It Out | 5/5 | Complete | 2026-08-20 |
| 8. Container-backed Try It Out | 8/8 | Complete | 2026-10-08 |
| 9. Try It Out Hardening | 4/4 | Complete (human_needed: live Podman) | 2026-10-12 |
| 10. Accessibility | 3/3 | Complete (human_needed) | 2026-10-12 |
| 11. Related Agents | 2/2 | Complete (human_needed) | 2026-10-12 |
| 12. Agent Types and Intake Research | 3/3 | Complete | 2026-10-12 |
| 13. Multi-Agent and Multi-Format Hosting | 9/9 | Complete (human_needed) | 2026-10-12 |
| 14. MCP Generator | 7/7 | Complete (human_needed) | 2026-10-12 |
| 15. MCP Test Platform | 13/13 | Complete (human_needed) | 2026-10-13 |
| 16. Review and Hardening Pass | outside GSD flow | Complete (human_needed) | 2026-10-14 |
| 17. Optional UI Features | outside GSD flow | Complete (human_needed) | 2026-10-13 |
| 18. Live Verification and Container-Path Fixes | outside GSD flow | Complete (human_needed) | 2026-10-14 |
| 19. Generator Input Kinds | outside GSD flow | Complete (human_needed) | 2026-10-14 |
| 20. Proposal Layer and Context Pack | outside GSD flow | Complete (passed) | 2026-10-14 |
| 21. Generator Stage 0 | 5/5 | Complete (passed) | 2026-10-15 |
| 22. Proposal Layer Follow-ups | 5/5 | Complete (human_needed) | 2026-10-15 |
| 23. Code Review of New Generator Code | 4/4 | Complete (passed, security SECURED) | 2026-10-15 |

### Phase 24: Agent inventory, catalog entry template, MCP-server entries and DDC license check

**Goal:** Audit which of the 12 consortium agents already exist fully or partly in data/agents (e.g. RFI triage, HVAC, submittal review); define the catalog entry template (purpose, stage, inputs, outputs, data sources, assumptions, gaps; every output is a draft for engineer review); MCP-server entries (stk-mcp and others) are separate work, handled in Phase 36, and are not part of the DDC agent set (corrected 2026-10-15, Phase 31; the three entries were added here originally); check the DDC_Skills_for_AI_Agents_in_Construction license and record attribution; start the combined gaps list for Ville and Jussi (docs/consortium-agents-gaps.md). Source slide is TUNI-confidential: names only, own wording, slide never committed. Spend: $0.50 per agent run, $10 total, running log in STATE.md.
**Requirements**: CONS-INV, CONS-TPL, CONS-MCP, CONS-GAPS, CONS-LIC
**Depends on:** Phase 23
**Plans:** 3 plans

Plans:
- [ ] 24-01-PLAN.md - inventory, entry template, gaps list, DDC notices
- [ ] 24-02-PLAN.md - template validator (validate-entries)
- [ ] 24-03-PLAN.md - MCP-server entries (stk-mcp, stk-catalog-mcp, lvi-info-mcp)

### Phase 25: Design-stage agents (ETIM & classification repair, QTO normalization, clash prioritization, RFI generation)

**Goal:** Build or complete agents 1 ETIM & classification repair, 2 QTO normalization, 3 Clash prioritization, 4 RFI generation (IFC/BIM stage). Done bar per agent: complete catalog entry plus one concrete step run through Try it out in the Pi container with a real model, smoke-tested, evidence in VERIFICATION/UAT; otherwise the reason is recorded. Public or synthetic sample data only, labelled; gaps and assumptions recorded in the entry and the combined list.
**Requirements**: CONS-RUN, CONS-A1, CONS-A2, CONS-A3, CONS-A4, CONS-VER
**Depends on:** Phase 24
**Plans:** 6 plans

Plans:
- [ ] 25-01-PLAN.md - Try It Out run harness (scripts/tryout-run.ts), spend ledger, live-run procedure, one live run on demo-rfi-triage
- [ ] 25-02-PLAN.md - Agent 1 ETIM & classification repair
- [ ] 25-03-PLAN.md - Agent 2 QTO normalization
- [ ] 25-04-PLAN.md - Agent 3 Clash prioritization
- [ ] 25-05-PLAN.md - Agent 4 RFI generation from findings
- [ ] 25-06-PLAN.md - Verification aggregation, npm run check, STATE.md

### Phase 26: Sourcing-stage agents (product sourcing E-BOM to M-BOM, quote comparison, carbon and EPD enrichment)

**Goal:** Build or complete agents 5 Product sourcing (E-BOM to M-BOM), 6 Quote comparison, 7 Carbon & EPD enrichment (corrected 2026-10-15, Phase 31: no MCP servers or LVI-INFO/STK data; catalog and EPD data are generic synthetic excerpts, MCP work is separate, Phase 36). Same done bar, data labelling and gap recording as Phase 25.
**Requirements**: CONS-A5, CONS-A6, CONS-A7, CONS-VER
**Depends on:** Phase 25
**Plans:** 4 plans

Plans:
- [ ] 26-01-PLAN.md - Agent 5 Product sourcing (E-BOM to M-BOM), wave 1
- [ ] 26-02-PLAN.md - Agent 6 Quote comparison, wave 1 (run after 26-01)
- [ ] 26-03-PLAN.md - Agent 7 Carbon and EPD enrichment, wave 1 (run after 26-02)
- [ ] 26-04-PLAN.md - Verification aggregation, npm run check, STATE.md, wave 2

### Phase 27: Manufacturing-stage agents (cut-sheet QA, spooling and cutting)

**Goal:** Build or complete agents 8 Cut-sheet QA and 9 Spooling & cutting (prefab and cut sheets). Same done bar, data labelling and gap recording as Phase 25.
**Requirements**: CONS-A8, CONS-A9, CONS-VER
**Depends on:** Phase 26
**Plans:** 3 plans

Plans:
- [ ] 27-01-PLAN.md - Agent 8 Cut-sheet QA, wave 1
- [ ] 27-02-PLAN.md - Agent 9 Spooling & cutting, wave 1 (run after 27-01)
- [ ] 27-03-PLAN.md - Verification aggregation, npm run check, STATE.md, wave 2

### Phase 28: Site and handover agents (D2 code validation, O&M completeness, BMS digital twin)

**Goal:** Build or complete agents 10 D2 code validation, 11 O&M completeness, 12 BMS digital twin (O&M, BMS stage). Same done bar, data labelling and gap recording as Phase 25.
**Requirements**: CONS-A10, CONS-A11, CONS-A12, CONS-VER
**Depends on:** Phase 27
**Plans:** 4 plans

Plans:
- [ ] 28-01-PLAN.md - Agent 10 D2 code validation, wave 1
- [ ] 28-02-PLAN.md - Agent 11 O&M completeness, wave 1 (run after 28-01)
- [ ] 28-03-PLAN.md - Agent 12 BMS digital twin, wave 1 (run after 28-02)
- [ ] 28-04-PLAN.md - Verification aggregation, npm run check, STATE.md, wave 2

### Phase 29: Further DDC-skill one-step agents (same done bar)

**Goal:** Choose further DDC skills that make useful one-step agents and build them to the same done bar. Quality over count; list remaining candidates instead of rushing them. Attribution per the Phase 24 license check.
**Requirements**: CONS-D1, CONS-D2, CONS-D3, CONS-D4, CONS-VER
**Depends on:** Phase 28
**Plans:** 5 plans

Plans:
- [ ] 29-01-PLAN.md - Selection document docs/ddc-agent-candidates.md plus agent 13 Daily Report Cross Check, wave 1
- [ ] 29-02-PLAN.md - Agent 14 Punch List Closure Check, wave 2 (run after 29-01)
- [ ] 29-03-PLAN.md - Agent 15 Change Order Consistency Check, wave 3 (run after 29-02)
- [ ] 29-04-PLAN.md - Agent 16 Safety Observation Classification, wave 4 (run after 29-03)
- [ ] 29-05-PLAN.md - Verification aggregation, npm run check, STATE.md, wave 5

### Phase 30: Release preparation (clean release branch, production build, PR description, release notes, deploy checklist)

**Goal:** Prepare the release for the publishing repo (PR opened by Ville, published by someone else): a clean release branch with the MCP generator and test queue behind their flags and switched off, a production build with smoke passing, a PR description, release notes (including the agent count) and a deploy checklist. Do not push and do not open PRs.
**Requirements**: REL-BRANCH, REL-BUILD, REL-DOCS, REL-SWEEP
**Depends on:** Phase 29
**Plans:** 4 plans

Plans:
- [x] 30-01-PLAN.md — clean local release branch (snapshot, exclusion list) and flag-off proof for MCP_GENERATOR/MCP_TESTER
- [x] 30-02-PLAN.md — production build and smoke on the release branch in a worktree, alone, numbers recorded
- [x] 30-03-PLAN.md — confidentiality sweep of the release diff, PR-DESCRIPTION, RELEASE-NOTES, DEPLOY-CHECKLIST
- [x] 30-04-PLAN.md — verification, STATE/ROADMAP, pending-human items (AGENT_KINDS, internal docs)


## Backlog (noted, postponed, not built)

- A public agent counter for the consortium.
- A Pi orchestration layer: a manager that polls a Pi job until it is done and returns the result.
- Multi-agent systems: a manager agent that assembles a team; research on self-organization.
- Making the MCP generator and test queue ready for public release.

## Execution order (autonomous run 2026-10-14)

Phases 24-30 run first (agents, then release prep), then 21-23 (generator roadmap). Use `/gsd:autonomous --only N`.

### Phase 31: Decouple DDC agents from MCP work (strip MCP/LVI/STK/Prysmian/Rakennustieto framing, real attribution and source URLs, planning and gaps corrections)

**Goal:** Remove all MCP/LVI-INFO/STK/Prysmian/Rakennustieto framing from the DDC agents (audit: agents 1, 5, 7; 5 heaviest; use generic or synthetic catalog data); give every DDC agent its exact skill path (or 'no DDC basis') in the entry and docs/third-party-notices.md; replace the github.com/aic-consortium/ placeholder URLs (DDC skill URL for DDC agents, the library repo for the rest); correct the scope of ROADMAP phases 24 and 26 and the phase 24-26 context files, the gaps list and the decisions log so the DDC/MCP separation is recorded; remove gap entries that existed only because of the mixing. Scope note: no live runs needed except where an entry's sample changes (done in 34).
**Requirements**: TBD
**Depends on:** Phase 30
**Plans:** 3 plans

Plans:
- [x] 31-01-PLAN.md — Strip MCP/LVI/STK/Rakennustieto framing from the 16 DDC entries, prompts and samples; exact attribution paths; replace placeholder github_url; third-party notices; golden/tests; npm run check
- [x] 31-02-PLAN.md — Correct ROADMAP 24/26, contexts 24/25/26/28, gaps list, inventory, decisions, blockers, STATE; add scripts/check-ddc-decoupling.sh grep gate
- [x] 31-03-PLAN.md — Verification wave: 31-VERIFICATION.md, close phase in ROADMAP/STATE

### Phase 32: Align strong-match agents with their DDC skills (clash 3, RFI 4, quote comparison 6)

**Goal:** Align agents 3 Clash (2_DDC_Book/4.3-BIM-Validation-Pipeline/clash-resolution-analyzer), 4 RFI (1_DDC_Toolkit/Document-Control/rfi-management), 6 Quote comparison (1_DDC_Toolkit/Procurement/bid-analysis-comparator) with their skill's method, data model, rules and outputs, adapted to Finnish MEP; fix the skill's own bugs rather than copying them (e.g. bid-analysis-comparator's weighted score ignores the weights); skill code reused only for calculations. Done bar per agent: complete entry plus one real-model Try It Out container step with evidence.
**Requirements**: DDC-32-CLASH, DDC-32-RFI, DDC-32-QUOTE, DDC-32-VERIFY
**Depends on:** Phase 31
**Plans:** 4 plans

Plans:
- [ ] 32-01-PLAN.md — Agent 3 clash prioritization (aligned, 4 failed runs, retry deferred)
- [x] 32-02-PLAN.md — Agent 4 RFI generation: skill RFI schema and template, placeholder deadlines, one live run
- [x] 32-03-PLAN.md — Agent 6 quote comparison: weighted-score bug verified, tested deterministic helper (A-02), aligned entry, one live run
- [x] 32-04-PLAN.md — Aggregation, npm run check, 32-VERIFICATION, STATE and ROADMAP close

### Phase 33: Align moderate-match agents with their DDC skills (QTO 2, carbon and EPD 7, O and M 11, BMS twin 12)

**Goal:** Align agents 2 QTO (2_DDC_Book/3.2-QTO-Auto-Estimates/qto-report + bim-qto), 7 Carbon & EPD (2_DDC_Book/3.3-4D-BIM-CO2-Simulation/lifecycle-carbon-calculator), 11 O&M (5_DDC_Innovative/as-built-documentation + 1_DDC_Toolkit/Project-Closeout/project-closeout-checklist), 12 BMS twin (5_DDC_Innovative/digital-twin-sync) with their skill's method, data model, rules and outputs. Where the audit differs, note it and use the closer match. Same done bar.
**Requirements**: DDC-33-QTO, DDC-33-CARBON, DDC-33-OM, DDC-33-BMS, DDC-33-VERIFY
**Depends on:** Phase 32
**Plans:** 5 plans

Plans:
- [x] 33-01-PLAN.md — Agent 2 QTO: alignment spec (bim-qto/qto-report, book-text exclusion), tested grouping helper, aligned entry/SKILL/sample/key/rubric, one live run
- [x] 33-02-PLAN.md — Agent 7 Carbon and EPD: spec, corrected tested lifecycle-carbon helper, synthetic EPD excerpt, aligned entry, one live run
- [x] 33-03-PLAN.md — Agent 11 O and M: spec (as-built-documentation + project-closeout-checklist), handover document set and statuses, aligned entry, one live run
- [x] 33-04-PLAN.md — Agent 12 BMS twin: spec (digital-twin-sync), binding model and threshold/status helper, aligned entry, one live run
- [x] 33-05-PLAN.md — Aggregation, npm run check, 33-VERIFICATION, STATE and ROADMAP close

### Phase 34: Own-design agents relabelled and cleaned (ETIM 1, sourcing 5, cut-sheet 8, spooling 9, D2 10)

**Goal:** Keep agents 1 ETIM, 5 E-BOM to M-BOM, 8 Cut-sheet QA, 9 Spooling and cutting, 10 D2 code validation as own designs; label each 'inspired by <skill path>' or 'no DDC basis'; agent 5 loses MCP framing and uses generic or synthetic catalog data; agent 10 keeps the D2 assumption visible in the entry. Same done bar for changed entries.
**Requirements**: DDC-34-LABELS, DDC-34-ETIM, DDC-34-SOURCING, DDC-34-CUTSHEET, DDC-34-SPOOLING, DDC-34-D2, DDC-34-VERIFY
**Depends on:** Phase 33
**Plans:** 3 plans

Plans:
- [x] 34-01-PLAN.md — Labels for agents 1, 5, 8, 9, 10 in entries, third-party notices and inventory; label test, D2 assumption visible
- [x] 34-02-PLAN.md — Live reruns for agents 1 ETIM, 5 E-BOM to M-BOM, 8 Cut-sheet QA (sequential, evidence)
- [x] 34-03-PLAN.md — Live reruns for agents 9, 10; aggregation, npm run check, 34-VERIFICATION, STATE and ROADMAP close

### Phase 35: Phase 29 extras verified against real skills and further self-contained DDC skill agents

**Goal:** Verify that each Phase 29 extra follows a real skill and record the exact path; add further agents where a skill has a self-contained method (no Windows converters, no CWICR database, no IoT feeds); list remaining candidates. Same done bar.
**Requirements**: DDC-35-EXTRAS-SPEC, DDC-35-EXTRAS-LABELS, DDC-35-EXTRAS-RERUN, DDC-35-DECOUPLE, DDC-35-NEW-PROCUREMENT, DDC-35-NEW-DELIVERY, DDC-35-NEW-QC, DDC-35-NEW-WARRANTY, DDC-35-CANDIDATES, DDC-35-VERIFY
**Depends on:** Phase 34
**Plans:** 6 plans

Plans:
- [x] 35-01-PLAN.md — verify and relabel Phase 29 agents 13-16 against the real skills (specs, attribution, github_url, label test, decoupling script extended, reruns of changed entries)
- [x] 35-02-PLAN.md — new agent 17 procurement-lead-time-check (material-procurement-tracker; lead-time helper)
- [x] 35-03-PLAN.md — new agent 18 material-delivery-check (material-delivery-tracker; delivery helper)
- [x] 35-04-PLAN.md — new agent 19 qc-inspection-record-check (quality-control-workflow; record-completeness checks)
- [x] 35-05-PLAN.md — new agent 20 warranty-register-check (warranty-tracker; warranty status helper)
- [x] 35-06-PLAN.md — candidates document, verification and UAT, npm run check, ROADMAP and STATE close

### Phase 36: LVI-INFO MCP agent (flagged off, local only) and MCP-server entries behind the flag

**Goal:** One agent making a real MCP call to Ville's LVI-INFO server, local only: choose a proxy or a sidecar on the internal network, whichever changes the network guard less. The agent and the three MCP-server entries (stk-mcp, stk-catalog-mcp, lvi-info-mcp) stay behind a flag, off by default, never in the release branch. No real LVI-INFO data or API key in any commit that could reach the release; evidence from real-data runs redacted.
**Requirements**: LMCP-01, LMCP-02, LMCP-03, LMCP-04, LMCP-05
**Depends on:** Phase 35
**Plans:** 5 plans (PAUSED: Plans 36-01..36-03 done; 36-04 cut off by Anthropic rate limit)

Plans:
- [x] 36-01-PLAN.md - LOCAL_MCP_AGENTS flag, decisions D-635..D-637, relocation of the 3 MCP-server entries to data/agents-local, ingest second pass, flag-off golden proof, docs skeleton
- [x] 36-02-PLAN.md - app-side MCP proxy (route, per-lease token, per-job budget, allow-list, size caps, 404 when off, hook, upstream clients, tests with fakes)
- [x] 36-03-PLAN.md - per-agent Pi extension staged at warm time (flag-gated runner change, fake-runtime tests)
- [ ] 36-04-PLAN.md - LVI-INFO agent, synthetic mock LVI API, helper tests, one live Try It Out run through the proxy, VERIFICATION and UAT (cut off by rate limit)
- [ ] 36-05-PLAN.md - npm run check, build and smoke flag off (no change) and on, security notes, ROADMAP and STATE close

### Phase 37: DDC mapping document for Alok

**Goal:** Write .planning/research/ddc-mapping-for-alok.md: the 12-agent table (skill path, match strength, what we took from the skill, what we added) and a 3-line message for Ville to send to Alok.
**Requirements**: TBD
**Depends on:** Phase 36
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd:plan-phase 37 to break down)

### Phase 38: Release branch rework (remove MCP and LVI-INFO, apply changes, rebuild, smoke, sweep, counts)

**Goal:** Release branch release/agents-2026-10: remove the MCP-server entries and everything LVI-INFO, apply the changes of phases 31-35, update agent counts in the release notes and PR description, re-run build and smoke, run a confidentiality sweep for MCP or consortium material. No push, no PR.
**Requirements**: TBD
**Depends on:** Phase 37
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd:plan-phase 38 to break down)
