# Requirements: AIC Agent Library

**Defined:** 2026-03-19
**Core Value:** Tech evaluators and executives can find the right AI agent for their use case within seconds — through semantic search or category browsing — and understand what it does, how it works, and how to get it.

## v1 Requirements

### Data Pipeline

- [x] **PIPE-01**: Ingest pipeline parses Oracle AgentSpec YAML/JSON files into structured records using Zod schema validation
- [x] **PIPE-02**: Canonical `AgentRecord` type decouples all UI components from Oracle AgentSpec field names (shim/adapter layer)
- [x] **PIPE-03**: Ingestion is idempotent — re-running produces the same result; each record carries `last_ingested_at` timestamp
- [x] **PIPE-04**: Ingestion script can be triggered at deploy time from structured agent files in the repository

### Catalog Browse

- [x] **BROW-01**: User can browse agents organized by domain/function category
- [x] **BROW-02**: User can filter the catalog by attributes (LLM, tools, deployment type, tags)
- [x] **BROW-03**: Catalog handles 100+ agents gracefully with pagination or infinite scroll

### Search

- [x] **SRCH-01**: User can search agents using natural language (semantic search via cosine similarity on pre-built embeddings)
- [x] **SRCH-02**: Search combines semantic similarity with keyword/BM25 scoring for reliable short-query results
- [x] **SRCH-03**: Search results update live as the user types (search-as-you-type)

### Agent Detail

- [x] **DETL-01**: Agent detail page shows executive summary by default (name, purpose, use cases, GitHub link)
- [x] **DETL-02**: Technical specification (LLM, tools, memory system, invocation, deployment) is shown in a collapsible section, collapsed by default
- [x] **DETL-03**: Agent detail page shows a customization panel listing which fields of the agent are tailorable (the 20%)

### Customization (Placeholder)

- [x] **CUST-01**: Agent detail page has a "Customize" button that opens a menu — menu items are visible but non-functional in v1 (placeholder for future wizard flows)

### UI / UX

- [x] **UI-01**: Platform is responsive and usable on desktop and tablet viewports

### Try It Out (delivered outside the v1 REQ-ID system — Phases 5-7)

Added mid-project (see STATE.md "Roadmap Evolution") as a self-contained initiative branching off Phase 2. Scope was defined directly by each phase's CONTEXT.md decisions and ROADMAP.md's numbered Success Criteria rather than by pre-assigned REQ-IDs, so these are recorded here for traceability rather than folded into the numbered list above.

- [x] **Phase 5 — Try It Out Field**: optional `try_it_out` mode (none/external/runnable) threaded through schema, ingest, and the agent detail page — complete 2026-08-19 (05-CONTEXT.md, 5 success criteria, all met)
- [x] **Phase 6 — Runnable Try It Out Flow (mock-backed)**: frozen `submitJob`/`subscribeProgress`/`downloadArtifact` client contract (`docs/job-api-contract.md`) + `TryItOutPanel.svelte`, demoable end-to-end with no real backend — complete 2026-08-19 (06-CONTEXT.md, 6 success criteria, all met)
- [x] **Phase 7 — No-Container Demo Backend for Try It Out**: real SvelteKit server routes calling an LLM, replacing the mock; `?job=` refresh persistence; human-verified live against the real OpenAI API — complete 2026-08-20 (07-CONTEXT.md, 9 success criteria, all met)

## v2 Requirements

### Customization (Functional)

- [x] **CUST-02** *(Phase 14, flagged `MCP_GENERATOR`, default off; live checks pending human)*: MCP generator — user provides a database schema (SQL DDL), OpenAPI spec or tabular catalog header, platform generates a Python FastMCP package. As built it takes schema or spec only and rejects anything that looks like a credential (never stores credentials or data); SQL DDL is one adapter among three
- **CUST-03**: Additional customization wizard flows for other well-defined agent types
- **CUST-04** *(deferred, no phase)*: GraphQL input for the MCP generator, from introspection JSON only (no SDL parser)
- **CUST-05** *(deferred, no phase)*: core POST-for-reads transport for the generator (the generator core stays frozen until then)
- **CUST-06** *(deferred, no phase)*: later input kinds gRPC and OpenRPC for the MCP generator

### Discovery Enhancements

- [x] **DISC-01** *(Phase 11; browser check pending human)*: Related agents panel on detail page (similar agents by embedding distance)
- [x] **DISC-02** *(Phase 17, flagged `AGENT_COMPARE`, default off; browser check pending human)*: Side-by-side agent comparison view
- **DISC-03**: Agent collections / curated bundles

### Auth & Deployment

- **AUTH-01**: User can register for an account
- **AUTH-02**: Registered users can initiate agent deployment flows
- **DEPL-01**: Platform supports deployment of agents to consortium member environments

### UI Polish

- [x] **UI-02** *(Phase 17, flagged `UI_DARK_MODE`, default off; browser check pending human)*: Dark / light mode theme toggle
- [x] **UI-03** *(Phase 10; keyboard/screen-reader/zoom checks pending human, `10-HUMAN-UAT.md`)*: WCAG AA accessibility (keyboard nav, screen reader labels)
- [x] **UI-04** *(Phase 17, flagged `UI_SPEC_VIEWER`, default off; browser check pending human)*: AgentSpec raw viewer (re-serialised stored record, redacted and size-capped; not syntax-highlighted)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Agent runtime execution | Not in scope; platform links to GitHub — no runtime environment |
| Real-time GitHub sync | Hybrid deploy-time ingestion is sufficient; real-time sync adds complexity without value at this scale |
| Dedicated vector database | ~300 agents; SQLite + in-memory cosine similarity is sufficient |
| User ratings / reviews | Closed consortium context; no audience for public social proof |
| Execution sandbox / demo | Requires runtime infrastructure; explicitly out of scope |
| Mobile-optimized layout | Desktop/tablet primary audience; mobile deferred |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| PIPE-01 | Phase 1 | Complete |
| PIPE-02 | Phase 1 | Complete |
| PIPE-03 | Phase 1 | Complete |
| PIPE-04 | Phase 1 | Complete |
| BROW-01 | Phase 2 | Complete (code) — human checkpoint 02-04 not yet executed |
| BROW-02 | Phase 2 | Complete (code) — human checkpoint 02-04 not yet executed |
| BROW-03 | Phase 2 | Complete (code) — human checkpoint 02-04 not yet executed |
| DETL-01 | Phase 2 | Complete (code) — human checkpoint 02-04 not yet executed |
| DETL-02 | Phase 2 | Complete (code) — human checkpoint 02-04 not yet executed |
| DETL-03 | Phase 2 | Complete (code) — human checkpoint 02-04 not yet executed |
| UI-01 | Phase 2 | Complete (code) — human checkpoint 02-04 not yet executed |
| SRCH-01 | Phase 3 | Complete (code); real-model quality run pending human (03-HUMAN-UAT.md) |
| SRCH-02 | Phase 3 | Complete (code) |
| SRCH-03 | Phase 3 | Complete (code); live-typing feel pending human (03-HUMAN-UAT.md) |
| CUST-01 | Phase 4 | Complete (04-01); browser check of the menu pending human (04-HUMAN-UAT.md) |
| CUST-02 | Phase 14 | Complete (code), behind flag `MCP_GENERATOR` (default off); live checks pending human (14-HUMAN-UAT.md) |
| DISC-02 | Phase 17 | Delivered (code), behind flag `AGENT_COMPARE` (default off); browser check pending human (see 17-VERIFICATION.md) |
| UI-02 | Phase 17 | Delivered (code), behind flag `UI_DARK_MODE` (default off); browser check pending human (17-VERIFICATION.md) |
| UI-04 | Phase 17 | Delivered (code), behind flag `UI_SPEC_VIEWER` (default off); browser check pending human (17-VERIFICATION.md) |
| DISC-01 | Phase 11 | Complete (code); browser check pending human (11-HUMAN-UAT.md) |
| UI-03 | Phase 10 | Complete (code and jsdom/axe checks); keyboard, screen-reader, zoom and contrast checks pending human (10-HUMAN-UAT.md) |

Phases 16-20 were executed outside the normal GSD flow (no PLAN files; records in their `*-SUMMARY.md` and `*-VERIFICATION.md`): Phase 17 carries UI-02, UI-04 and DISC-02; Phases 19 and 20 extend CUST-02; Phases 16 and 18 have no REQ-IDs. Phases 21-23 (planned, not started) extend or harden CUST-02. CUST-04..CUST-06 are deferred v2 items without a phase.

Phases 12 (research docs), 13 (multi-agent and multi-format hosting, flag `AGENT_KINDS`) and 15 (MCP test platform, flag `MCP_TESTER`) were added by the autonomous run without REQ-IDs; they are tracked by their ROADMAP success criteria and the `*-VERIFICATION.md` files (status `human_needed` for 13 and 15, `passed` for 12). Phases 2.1 and 2.2 (green baseline, scale data) likewise have no REQ-IDs (`passed`).

**Coverage:**
- v1 requirements: 15 total (all implemented in code; human checks still pending for the seven Phase 2 rows, SRCH-01, SRCH-03 and CUST-01)
- Mapped to phases: 15 (plus v2 items CUST-02, DISC-01, UI-03, UI-02, UI-04, DISC-02 now delivered by Phases 14, 11, 10, 17; all 21 delivered requirements are tracked above)
- Unmapped: 0 ✓
- Phase 2 status (NOT verified, not marked complete): the ONLY remaining Phase 2 item is the human checkpoint 02-04 (pending human). All code is done; Phase 2 is intentionally not marked complete.
- Note (added 2026-08-20 during a phase-consistency pass): 02-04-PLAN.md is Phase 2's single human-verification checkpoint for the seven rows above (`requirements:` frontmatter lists exactly BROW-01/02/03, DETL-01/02/03, UI-01) and has never been executed — no 02-04-SUMMARY.md exists. The underlying code shipped and is unit-tested (02-01/02/02/02/03), but browser-level sign-off is outstanding. See STATE.md "Missing / Open Work".
- The Try It Out initiative (Phases 5-7, all complete) is tracked separately above under "Try It Out (delivered outside the v1 REQ-ID system)" rather than in this table, since it was never assigned REQ-IDs.

---
*Requirements defined: 2026-03-19*
*Last updated: 2026-10-14 — UI-02, UI-04, DISC-02 delivered flagged in Phase 17; deferred CUST-04..CUST-06 added; Phase 2 deliberately not marked verified*
