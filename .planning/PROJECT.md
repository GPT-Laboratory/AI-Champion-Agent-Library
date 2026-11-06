# AIC Agent Library

## What This Is

A web-based showcase and discovery platform for the 100+ AI agents produced by the AI Champion (AIC) consortium project. Tech evaluators and executives from member companies can browse, search, and explore the agent catalog to find agents relevant to their needs, with links out to GitHub for implementation details and optional lightweight customization flows for well-defined use cases.

## Core Value

Tech evaluators and executives can find the right AI agent for their use case within seconds — through semantic search or category browsing — and understand what it does, how it works, and how to get it.

## Requirements

### Validated

- [x] Oracle AgentSpec as the canonical agent description format, with a shim layer for future spec language support — *Validated in Phase 01: data-pipeline*
- [x] Agent data sourced from structured files in GitHub (hybrid admin+deploy ingestion model) — *Validated in Phase 01: data-pipeline*

### Built since (automated-test green; some live checks pending human, see STATE.md "Deferred Verification")

- [x] Public catalog with browse and hybrid search (BM25 + local sentence embeddings, no external vector DB) — Phases 2, 3
- [x] Agent detail pages with executive summary first and collapsible technical specs — Phase 2
- [x] Lightweight customization entry point (Customize menu) — Phase 4; MCP generator behind `MCP_GENERATOR` (CUST-02) — Phase 14
- [x] Try It Out: optional per-agent mode, mock then real backend, container-backed Pi runner warmed on visit, hardened — Phases 5-9
- [x] Accessibility (WCAG AA targets, UI-03) — Phase 10; related agents (DISC-01) — Phase 11
- [x] Multi-agent and multi-format hosting behind `AGENT_KINDS` (default off) — Phase 13; MCP test platform behind `MCP_TESTER` (default off) — Phase 15
- [x] Optional UI features behind default-off flags: spec viewer `UI_SPEC_VIEWER`, compare `AGENT_COMPARE`, dark mode `UI_DARK_MODE` (UI-04, DISC-02, UI-02) — Phase 17; browser checks pending human
- [x] MCP generator input kinds: OpenAPI 3.x/3.1/3.2, Swagger 2.0 (OAuth2 bearer from env), SQL DDL and dialects (pg_dump, SQLite, mysqldump), Prisma, OData (CSDL JSON, EDMX XML), tabular catalog — Phases 14, 19; data-only proposal layer and context pack for an external agent session — Phase 20
- [x] Review and hardening, live verification: Phases 16 and 18 (Phases 16-20 were executed outside the normal GSD flow; see STATE.md)
- [x] Simple, modern web stack — SvelteKit, SQLite, Drizzle; later phases added `@huggingface/transformers` (local embeddings), `dockerode`/`tar-stream`/`fflate`/`openai` (Try It Out, generator) and `axe-core` (dev, accessibility tests); see `package.json`

### Active

- [ ] Human verification of Phase 2 (02-04) and the pending-human checks of Phases 3, 4, 9-11, 13-15 and 16-19 (list: STATE.md "Pending on Ville"; guide: `docs/human-verification-guide.md`)
- [ ] Planned: Phase 21 generator stage 0, Phase 22 proposal-layer follow-ups, Phase 23 code review of the new generator code
- [ ] Deferred (v2, no phase): GraphQL (introspection JSON only), core POST-for-reads transport, later gRPC/OpenRPC inputs
- Production build works again (B-002 resolved, D-258; `routeExports.test.ts` guards it)
- [ ] Registration-gated deployment features (AUTH-02, DEPL-01) remain deferred; authentication exists as passwordless allow-list sign-in (`AUTH_ENABLED`, default on)

### Out of Scope

- Agent runtime execution of the catalog agents — not in scope; link to GitHub for implementation (the flagged Try It Out demo runs only configured demo agents in sandboxed containers)
- User registration and account-based features — deferred (a passwordless allow-list sign-in gate exists, see `README.md`)
- Deployment functionality — deferred to post-v1
- Dedicated vector database — scale doesn't warrant it (few hundred agents)
- Real-time GitHub sync — hybrid file-based ingestion is sufficient

## Context

- Part of the AI Champion (AIC) consortium project, producing 100+ AI agents
- No declarative agent language has been finalized yet; Oracle AgentSpec is the current choice with a planned shim to support other formats (e.g. future consortium standard)
- Agents are "80% specified" — the remaining 20% is company-specific tailoring; the platform surfaces what's configurable and may assist with simple customization workflows
- Audience is dual: technical evaluators (primary) and executives (must be legible to both — executive summary first, technical details on demand)
- Agent pages link to GitHub for full implementation; platform is the front door, not the runtime

## Research docs

Phase 12 research on agent types and intake (implemented in Phase 13 behind `AGENT_KINDS`, default off; see also `../docs/phase13-adapters.md`): [agent-types](../docs/agent-types.md), [capability matrix](../docs/agent-capability-matrix.md), [intake guide](../docs/agent-intake-guide.md), [decision memo](../docs/agent-hosting-decision-memo.md).

## Constraints

- **Tech Stack**: Modern frameworks only — prefer solutions with minimal dependency surface (e.g. SvelteKit, Astro); avoid vanilla JS/CSS sprawl or npm dependency explosions
- **Scale**: ~100-300 agents; in-memory or SQLite-backed semantic search is sufficient
- **Format**: Oracle AgentSpec as primary; architecture must support shim for alternative spec languages
- **Dependencies**: no new runtime dependency except `sax@1.6.1` (exact pin), used only for OData EDMX XML and hardened (pre-check rejects DOCTYPE/ENTITY/other `<!` and processing instructions, size and depth caps, no external entities, dynamic import). The Prisma reader is hand-rolled. No `@modelcontextprotocol/sdk` (D-475, D-560)
- **Environment**: the development machine has 3.7 GB RAM: do not run Podman checks alongside heavy agents or full test runs
- **Generator**: deterministic only; no model calls inside the platform (proposals come from an external agent session, D-580); generated servers pin `fastmcp>=3.4,<5` (D-479)
- **Scope**: v1 = catalog (browse, search, view), behind an allow-list sign-in that can be switched off; no registration, no deployment. Later phases add Try It Out and three default-off feature flags

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Oracle AgentSpec as canonical format | No consortium standard finalized yet; Oracle AgentSpec is well-defined and available | Good: Phase 1 shipped it; Phase 13 adds other formats via adapters |
| Shim architecture for spec languages | Future-proofs against consortium adopting a different declarative agent language | Good: Phase 13 adapters plug in behind the same boundary |
| In-memory/SQLite semantic search | Scale (~hundreds of agents) doesn't justify an external vector DB | Built in Phase 3 (embeddings in SQLite, in-TS BM25 + cosine); real-model quality run pending human |
| v1 = public catalog only, no auth | Fastest path to value; auth complexity deferred until deployment features are needed | Revised: an allow-list passwordless sign-in was added later (`AUTH_ENABLED`, default on) |
| Hybrid agent data ingestion | Structured files in GitHub edited by admins, ingested at deploy time | Good: `npm run ingest` at build time, idempotent |
| Feature flags default off for every new capability (Phases 13-17) | Keep flag-off behaviour byte-identical; additive DB changes only | Pinned by `scripts/flag-off.golden.test.ts`; `npm run smoke` covers 8 flag configurations; decisions in `.planning/AUTONOMOUS-DECISIONS.md` |
| FastMCP pin `>=3.4,<5` | PyPI latest is 4.1.0, 3.x still patched; generated suites pass on both | Good: D-479, verified live 2026-10-14 |
| Keep all-MiniLM-L6-v2 with hybrid search (BM25 + embeddings, RRF) | Real run: real 9 agents hit@3 1.00; scale corpus hit@3 0.88; paraphrases beat BM25 | Good: D-009..D-014, `03-HUMAN-UAT.md`; SIM_FLOOR 0.25 not retuned |
| Error bodies `{message}`, `handleError` with an 8-hex reference id, `/health` readiness (503 when DB is down) | Uniform errors; support can correlate a 5xx page with a log line | Good: D-460..D-462 |
| `APP_INSTANCE_NAME` set in `podman-compose.yml` | Orphan sweep needs a stable owner id | Good: D-445 |
| Sidecar `agent_kinds` table, no `ALTER TABLE agents` | Flag-off SQL and row shapes stay identical | Good: D-033, D-471 |
| Deterministic generator; proposals produced by an external agent session (no in-platform model calls) | Reproducible output; the Phase 15 scorer is the gate | Built (stages 1-2): D-159, D-475, D-580..D-596 |
| `sax` as the only new dependency (EDMX only) | OData XML needs a parser; hand-rolling XML is riskier | Good: D-560 |
| Core POST-for-reads transport deferred | Generator core stays frozen | Deferred (CUST-05) |
| Auth hook: with `AUTH_ENABLED=true` everything except `/login`, `/health` and `/api/llm/*` needs a session | One global rule, no per-route auth code | Good: D-476; live 401 check on the UAT list |

---
*Last updated: 2026-10-14 — Phases 16-20 recorded (outside the GSD flow), Phases 21-23 planned, constraints and cross-phase decisions added (see STATE.md). Previous: 2026-10-13 — synced after the autonomous run (Phases 2.1-15 built). Previous: 2026-08-20 — Phase 07 complete: real (no-container) SvelteKit demo backend for Try It Out, replacing Phase 6's mock — three job routes, a single real OpenAI call, and `?job=` refresh persistence, human-verified live against the deployed API*
