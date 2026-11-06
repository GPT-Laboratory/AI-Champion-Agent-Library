# Technical Documentation — AIC Agent Library

> For a non-technical overview and getting-started guide, see [README.md](README.md).

---

## Contents

1. [Tech Stack](#tech-stack)
2. [Project Structure](#project-structure)
3. [Architecture Overview](#architecture-overview)
4. [Data Model](#data-model)
5. [Spec Shim Layer](#spec-shim-layer)
6. [Ingestion Pipeline](#ingestion-pipeline)
7. [Database](#database)
8. [SvelteKit Routes](#sveltekit-routes)
9. [Components](#components)
10. [Tests](#tests)
11. [Build Pipeline](#build-pipeline)
12. [Configuration Files](#configuration-files)
13. [Adding a New Agent Spec Format](#adding-a-new-agent-spec-format)

Added after v0.1: [Feature flags](#feature-flags), [Search](#search), [Authentication](#authentication), [Try It Out](#try-it-out), [Deploy](#deploy), [MCP Generator](#mcp-generator-flagged-phase-14), [MCP Test Platform](#mcp-test-platform-flagged-phase-15).

---

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Frontend framework | SvelteKit 2 + Svelte 5 | `^2.70.3` / `^5.57.2` |
| CSS | Tailwind CSS v4 (Vite plugin) | `^4.3.3` |
| Build tool | Vite | `^8.3.4` |
| ORM | Drizzle ORM | `^0.45.4` |
| Database | SQLite via better-sqlite3 | `^12.11.1` |
| Schema validation | Zod 4 | `^4.6.7` |
| YAML parsing | yaml | `^2.9.1` |
| Script runner | tsx | `^4.23.15` |
| Test framework | Vitest | `^4.1.0` (4.1.11 allowed, blocked by an npm bug, see `docs/dependency-health.md`) |
| Component testing | @testing-library/svelte | `^5.4.2` |
| Production adapter | @sveltejs/adapter-node | `^5.5.7` |
| Language | TypeScript 5 (strict) | `^5.9.3` |
| Local embeddings | @huggingface/transformers (Xenova/all-MiniLM-L6-v2) | `^4.3.1` |
| Container engine client | dockerode (Podman socket) | `^5.0.1` |
| LLM client | openai | `^7.32.0` |
| Accessibility tests | axe-core (dev) | `^4.14.0` |

Exact versions: `package.json` / `package-lock.json`; audit status: `docs/dependency-health.md`.

**Node.js requirement:** 22 (container images use `node:22-bookworm-slim`; Pi and MCP test runner images need >= 22.19). Install with `ONNXRUNTIME_NODE_INSTALL_CUDA=skip`.

---

## Project Structure

```
├── src/
│   ├── app.css                          # Global Tailwind import
│   ├── lib/
│   │   ├── components/                  # Reusable Svelte components
│   │   │   ├── AgentCard.svelte
│   │   │   ├── FilterBar.svelte
│   │   │   ├── Pagination.svelte
│   │   │   ├── TechAccordion.svelte
│   │   │   └── CustomizationPanel.svelte
│   │   ├── config/
│   │   │   └── tailorable-fields.ts     # Fields users can customize per-agent
│   │   ├── server/
│   │   │   └── db.ts                    # Database singleton (server-only)
│   │   └── spec/                        # Spec shim: format detection & normalization
│   │       ├── types.ts                 # AgentRecord type + slugify()
│   │       ├── oracle-agentspec.ts      # Zod schema + Oracle AgentSpec adapter
│   │       └── index.ts                 # detectFormat() + normalize() entry point
│   └── routes/
│       ├── +layout.svelte               # Root layout (header + wrapper)
│       ├── +page.server.ts              # Redirect / → /catalog
│       ├── catalog/
│       │   ├── +page.server.ts          # Load: paginated agent list + filter options
│       │   └── +page.svelte             # Catalog UI: grid, filters, pagination
│       └── agents/[slug]/
│           ├── +page.server.ts          # Load: single agent by slug, 404 on miss
│           └── +page.svelte             # Detail UI: summary + accordion + panel
├── scripts/
│   ├── ingest.ts                        # Ingestion pipeline (CLI)
│   └── ingest.test.ts
├── drizzle/
│   └── schema.ts                        # SQLite table definition
├── data/
│   └── agents/                          # Agent YAML source files
│       └── fixtures/                    # Test fixtures (never ingested: flag-on ingest skips any `fixtures` directory, D-466)
├── db/
│   └── catalog.db                       # SQLite database (generated at build time)
├── docs/
│   ├── *.mmd                            # Mermaid diagram sources
│   └── images/                          # Generated diagram PNGs
├── fixtures/submissions/                # Sample submissions for validate-submission
├── Containerfile, Containerfile.pi-runner, Containerfile.mcp-test-runner, podman-compose.yml
├── drizzle.config.ts
├── vite.config.ts
├── svelte.config.js
├── tsconfig.json
└── vitest.config.ts
```

The tree above is the original v0.1 core. Added since:

```
src/
├── hooks.server.ts                      # auth gate, starts Try It Out service, warms search
├── lib/
│   ├── flags.ts                         # AGENT_KINDS, MCP_GENERATOR, MCP_TESTER, UI_SPEC_VIEWER readers (AGENT_COMPARE, UI_DARK_MODE re-exported)
│   ├── a11y/                            # contrast calculator (test support)
│   ├── components/                      # + SearchBar, CustomizeMenu, TryItOutPanel, RelatedAgents,
│   │                                    #   KindBadge, SystemMembers, GenerateMcpPanel, McpTestPanel
│   ├── spec/                            # + registry, scan, security, kinds, formats/ (Phase 13 adapters)
│   ├── server/
│   │   ├── auth*.ts, mail.ts, brevo.ts, smtp.ts   # passwordless sign-in
│   │   ├── search/                      # BM25, embedder, hybrid RRF, related agents
│   │   ├── tryitout/                    # lease manager, container runtime, LLM proxy, Pi runner
│   │   ├── mcptest/                     # run store, container run, service for the MCP tester
│   │   └── tryItOut*.ts, try-out*.ts    # direct-model job backend and legacy /api/try-out
│   ├── mcpgen/                          # MCP generator
│   ├── mcptest/                         # MCP test platform
│   └── testing/                         # axe helper, fake job API
└── routes/
    ├── login, logout, health, mcp-test
    └── api/ search, tryitout/jobs, try-out, llm/v1/chat/completions, mcp-generate, mcp-test/runs
scripts/                                 # ingest, set-try-it-out-mode, validate-submission, generate-mcp,
                                         # mcp-test, fixtures/generate-scale, smoke-pi-runner, probe-openai-model
data/                                    # agents/, tryitout-prompts/, try-out/
```

---

## Architecture Overview

The platform has three distinct stages: **ingest** (build time), **serve** (request time), and **render** (client).

![Architecture diagram](docs/images/architecture.png)

- **Ingest** runs once at build time (or dev server start). It reads YAML files, validates them, converts to the internal `AgentRecord` type, and writes to SQLite.
- **Serve** runs per request. SvelteKit load functions query SQLite via Drizzle ORM and pass typed data to components.
- **Render** runs in the browser. Svelte 5 components handle display and client-side filter state. Search (`/api/search`) and the Try It Out job routes are the only calls made after page load.

---

## Data Model

### AgentRecord (internal canonical type)

Defined in `src/lib/spec/types.ts`. All UI code works against this type — never against Oracle AgentSpec directly.

```typescript
interface AgentLlm {
  name: string
  temperature: number | null
  maxTokens: number | null
  topP: number | null
}

interface AgentRecord {
  slug: string                  // Primary key, URL-safe (derived from name)
  title: string                 // Human-readable agent name
  specId: string | null         // Original AgentSpec id field, if present
  summary: string               // Plain-language description
  systemPrompt: string
  llm: AgentLlm
  toolNames: string[]
  requiresHumanApproval: boolean
  category: string | null
  githubUrl: string | null
  maturityStatus: 'production' | 'beta' | 'experimental'
  tags: string[]
  lastIngestedAt: string        // ISO-8601
}
```

### SQLite Schema (`drizzle/schema.ts`)

Table: `agents`

| Column | Type | Notes |
|--------|------|-------|
| `slug` | TEXT PRIMARY KEY | URL-safe identifier |
| `title` | TEXT NOT NULL | |
| `summary` | TEXT NOT NULL | |
| `system_prompt` | TEXT NOT NULL | |
| `llm_name` | TEXT NOT NULL | |
| `llm_temperature` | REAL | nullable |
| `llm_max_tokens` | INTEGER | nullable |
| `llm_top_p` | REAL | nullable |
| `tool_names` | TEXT NOT NULL | JSON-serialized `string[]` |
| `requires_human_approval` | INTEGER NOT NULL | Boolean (0/1) |
| `category` | TEXT | nullable |
| `github_url` | TEXT | nullable |
| `maturity_status` | TEXT NOT NULL | `experimental` \| `beta` \| `production` |
| `tags` | TEXT NOT NULL | JSON-serialized `string[]` |
| `spec_id` | TEXT | nullable |
| `input_schema` | TEXT NOT NULL | JSON-serialized input field list, default `[]` |
| `link_label` | TEXT | nullable |
| `customizable_fields` | TEXT | JSON `string[]`; null = all fields |
| `fixed_note`, `fixed_fields` | TEXT | note and JSON `string[]` of non-tailorable fields |
| `try_it_out_mode` | TEXT NOT NULL | `none` (default), `external` or `runnable`; set by `npm run tryout:configure`, not overwritten by ingest |
| `try_it_out_url`, `try_it_out_task_template` | TEXT | nullable |
| `last_ingested_at` | TEXT NOT NULL | ISO-8601, default `strftime(...)` |

Additional tables (both cascade on `agents.slug`):

| Table | Purpose |
|-------|---------|
| `agent_embeddings` | `slug`, `model`, `content_hash`, `vector` (384-d float blob), `updated_at`; written by ingest unless `SEARCH_EMBEDDINGS=off`, skipped when the hash is unchanged |
| `agent_kinds` | Phase 13 sidecar: `kind`, `framework`, `topology`, `members` (JSON), `source_format`, `extras` (JSON, capped), `updated_at`; only written and read with `AGENT_KINDS` on. DDL is duplicated in `src/lib/spec/kinds-ddl.ts` (a test keeps both in sync) |

The authentication database is separate (`AUTH_DB_PATH`, default `runtime/auth/auth.db`).

`toolNames` and `tags` are stored as JSON strings and deserialized in load functions before being passed to components.

---

## Spec Shim Layer

The shim layer decouples the rest of the codebase from Oracle AgentSpec's field names. If the consortium adopts a different spec language, only the shim needs to change.

![Spec shim layer](docs/images/spec-shim.png)

### Files

**`src/lib/spec/types.ts`**
Defines `AgentRecord` and `AgentLlm`. Also exports `slugify(name)` — lowercases, replaces non-alphanumeric characters with hyphens, collapses consecutive hyphens.

**`src/lib/spec/oracle-agentspec.ts`**
- `OracleAgentSpecSchema` — Zod 4 schema that validates raw YAML/JSON against the Oracle AgentSpec structure
- `fromOracleAgentSpec(raw)` — adapter function that maps Oracle AgentSpec fields to `AgentRecord`

> **Design constraint:** Oracle AgentSpec field names (`llm_config`, `human_in_the_loop`, `component_type`, etc.) appear **only** in this file. All other code uses `AgentRecord` field names.

**`src/lib/spec/index.ts`**
- `detectFormat(raw)` — inspects the raw object for `component_type === 'Agent'`; throws if unrecognized
- `normalize(formatId, raw)` — validates with Zod, calls the appropriate adapter, returns `AgentRecord`

### Adding support for a new spec format

1. Create `src/lib/spec/my-format.ts` with a Zod schema and adapter function
2. Add the format ID to the `FormatId` union in `index.ts`
3. Add a `detectFormat` branch and `normalize` case
4. Add YAML fixtures and tests

---

## Ingestion Pipeline

**Entry point:** `scripts/ingest.ts`
**Triggered by:** `npm run ingest` (runs as part of `npm run dev` and `npm run build`)

### Flow

```
data/agents/*.yaml
  → YAML.parse()
  → detectFormat()         # identify spec type
  → normalize()            # Zod validate + adapter → AgentRecord
  → flattenRecord()        # AgentRecord → NewAgentRow (serialize arrays to JSON)
  → db.insert().onConflictDoUpdate()   # upsert by slug
```

- Files that fail validation are skipped with a `[SKIP]` log — they don't abort the pipeline
- Ingestion is **idempotent**: re-running the same files updates `last_ingested_at` but does not create duplicates
- Data directory and DB path are overrideable via environment variables:
  - `INGEST_DATA_DIR` (default: `./data/agents`)
  - `INGEST_DB_PATH` (default: `./db/catalog.db`)
- After the upsert, an embedding step writes vectors for new or changed agents (skipped with `SEARCH_EMBEDDINGS=off`; BM25-only when no model is available)
- With `AGENT_KINDS` on, ingest also reads sub-directories and other formats through the adapter registry and writes `agent_kinds` rows

---

## Database

`src/lib/server/db.ts` exports a singleton Drizzle ORM instance and the `agents` table reference.

```typescript
const DB_PATH = process.env.CATALOG_DB_PATH ?? './db/catalog.db'
const sqlite = new Database(DB_PATH)
sqlite.pragma('journal_mode = WAL')      // Write-Ahead Log: concurrent reads
export const db = drizzle(sqlite)
export { agents }
```

- **WAL mode** allows multiple concurrent reads alongside a single writer, suitable for a web app serving catalog queries
- The file lives in `src/lib/server/` — SvelteKit enforces that nothing outside load functions or server routes can import from this path
- Override the DB path with `CATALOG_DB_PATH` for staging/testing environments

---

## SvelteKit Routes

### `GET /` → redirect to `/catalog`
`src/routes/+page.server.ts` — immediate 302 redirect.

### `GET /catalog`
`src/routes/catalog/+page.server.ts`

Load function accepts URL search params: `page`, `category`, `llm`, `maturity`, `q` (ranked search through the search service) and, with `AGENT_KINDS` on, `kind`.

- Pagination: 24 agents per page (`PAGE_SIZE`), offset calculated from `page`
- Filters applied as Drizzle `eq()` / `and()` conditions
- Returns: agent list, total count, current page, total pages, distinct filter options (categories, LLMs, maturity statuses), active filter values
- `toolNames` and `tags` JSON strings are deserialized before return

`src/routes/catalog/+page.svelte`

- Filter state held as Svelte 5 runes (`$state`)
- `$derived.by` computes the filtered view client-side (no roundtrip on filter change)
- Filter changes update URL params via `goto()` with `replaceState: true` (no browser history entry)

### `GET /agents/[slug]`
`src/routes/agents/[slug]/+page.server.ts`

- Queries single agent by slug
- Returns `error(404)` for unknown slugs
- Deserializes JSON fields before return

`src/routes/agents/[slug]/+page.svelte`

- Two-column desktop layout: `lg:grid-cols-[2fr_1fr]`
- Left column: executive summary, tags, GitHub link, TechAccordion
- Right column: CustomizationPanel (sticky)

---

## Components

### AgentCard
**Props:** `{ slug, title, summary, category, maturityStatus, tags }`
Renders a card link to the agent detail page. Maturity badge is color-coded. Shows first 3 tags. Hover and focus ring states.

### FilterBar
**Props:** filter options arrays + selected value strings + change/clear callbacks
Three `<select>` dropdowns (Category, Model, Status). "Clear filters" button appears only when at least one filter is active.

### Pagination
**Props:** `{ currentPage, totalPages }`
Previous/Next buttons. Preserves existing URL params when navigating pages. Buttons disabled at boundaries.

### TechAccordion
**Props:** LLM config fields + tools + requiresHumanApproval + systemPrompt
Native `<details>`/`<summary>` element — collapsed by default (no `open` attribute). No JavaScript required for expand/collapse.

### CustomizationPanel
No props — imports `TAILORABLE_FIELDS` directly from config.
Renders a static list of 4 tailorable fields with labels, descriptions, and "Customizable" badges. Placeholder for Phase 4 wizard flows.

---

## Tests

### Test environment

- **Component tests** (`src/lib/components/*.test.ts`): `jsdom` environment (DOM rendering)
- **All other tests**: Node.js environment

### Coverage

| File | What it tests |
|------|---------------|
| `src/lib/spec/types.test.ts` | `slugify()`, field name isolation (AgentRecord never leaks AgentSpec names) |
| `src/lib/spec/oracle-agentspec.test.ts` | Zod schema validation, `fromOracleAgentSpec()`, minimal + malformed inputs |
| `src/lib/components/FilterBar.test.ts` | Dropdowns render, callbacks fire, clear button visibility |
| `src/lib/components/TechAccordion.test.ts` | `<details>` closed by default, content display |
| `src/lib/components/CustomizationPanel.test.ts` | Heading, 4 fields rendered, badge count |
| `src/routes/catalog/catalog.test.ts` | Pagination offset, 3-attribute filtering, distinct values, JSON deserialization |
| `src/routes/agents/detail.test.ts` | Single agent query, 404 on unknown slug, JSON deserialization |
| `scripts/ingest.test.ts` | Fixture ingestion, idempotency, skip on malformed, `last_ingested_at` updates |

The table above lists the original core tests. The suite now covers every module with colocated `*.test.ts` files (208 files, 2087 tests; `npm run check` is the gate). Strategy:

- **Offline by construction.** Embeddings are off in tests (`SEARCH_EMBEDDINGS=off` in `vitest.config.ts`); OpenAI, the container engine and MCP servers are replaced by fakes (`runtimeFake.ts`, `embedder.fake.ts`, `src/lib/mcptest/fake/`, a loopback mock upstream). Timeouts are generous (30 s) because the full run is CPU-starved.
- **Accessibility:** `*.a11y.test.ts` files run axe-core in jsdom; `src/lib/a11y/contrast.test.ts` enforces token contrast pairs.
- **Search quality:** `accuracy.test.ts` (46 labeled queries on the 150-agent scale corpus, BM25 hit@3 gate) and `related.validation.test.ts`; `accuracy.real.test.ts` needs `SEARCH_REAL_EMBEDDINGS=1`.
- **Flag safety:** `scripts/flag-off.golden.test.ts`, `scripts/flag-regression.test.ts`; generator golden files in `src/lib/mcpgen/__golden__` (`UPDATE_GOLDEN=1` rewrites them); `criteria.test.ts` in `mcpgen` and `mcptest` pin invariants.
- **Robustness:** `chaos.*.test.ts` under `src/lib/server/tryitout/` (seeded lease interleavings, hung engine, reaper timing, proxy budgets, malformed Pi output), `*.hardening.test.ts` and `*.reviewfix.test.ts` for review findings.
- **Not covered by tests:** browser behaviour, screen readers, live Podman, real embedding quality, real FastMCP servers, and `vite build` (see `.planning/phases/*/*-HUMAN-UAT.md` and `docs/deploy-runbook.md`).

Run tests:
```bash
npm run check             # svelte-kit sync + tsc --noEmit + vitest run (exit 0 required)
npm test                  # vitest run only
npm test -- --watch       # watch mode
```

---

## Build Pipeline

```bash
# Development
npm run dev
#  1. drizzle-kit push                    apply schema changes to db/catalog.db
#  2. tsx scripts/ingest.ts               ingest data/agents/*.yaml (+ embeddings) into SQLite
#  3. tsx scripts/set-try-it-out-mode.ts  demo agents' try_it_out_mode
#  4. vite dev                            dev server on :5173 with HMR

# Production
npm run build
#  steps 1-3 as above, then vite build: bundle to build/ (client + Node.js server)

npm run preview           # node build
```

The built output in `build/` is a Node.js server (adapter-node). Run it with `node build`.

Environment variables: the complete table with defaults (flags, auth, Try It Out, MCP test runner) is in `docs/deploy-runbook.md` section 3. Core ones: `CATALOG_DB_PATH`, `INGEST_DATA_DIR`, `INGEST_DB_PATH`, `PORT`, `HF_CACHE_DIR`, `SEARCH_EMBEDDINGS`.

### npm scripts

`dev`, `build`, `preview`, `test`, `check`, `ingest`, `fixtures:scale`, `validate-submission`, `generate-mcp`, `mcp-test`, `tryout:configure`, `db:push` (definitions in `package.json`; descriptions in README "npm scripts").

---

## Feature flags

Defined in `src/lib/flags.ts` (plain `process.env`, read at call time; truthy values `1`, `true`, `on`, `yes`). All default off, and flag-off output is pinned byte-identical.

| Flag | Gates |
|------|-------|
| `AGENT_KINDS` | multi-format ingest, `agent_kinds` reads, kind badge, Type filter, `?kind=`, system detail page, kind checks in Try It Out routes |
| `AGENT_COMPARE` | `/compare` route (404 when off, loader in `src/routes/compare/+page.server.ts`, helpers in `src/lib/compare.ts`) and the compare checkboxes on catalog cards; with `AGENT_KINDS` on the compare rows add kind and framework and use `effectiveTryItOutMode` |
| `UI_SPEC_VIEWER` | `specViewer` key in the `/agents/[slug]` load data and the `SpecViewer` component (escaped text only) |
| `UI_DARK_MODE` | theme toggle in the layout header and the dark palette (`src/lib/themeFlag.ts`) |
| `MCP_GENERATOR` | `POST /api/mcp-generate`, "Generate MCP" panel |
| `MCP_TESTER` | `/mcp-test`, `/api/mcp-test/runs*`, Customize entry |

Toggling `AGENT_KINDS` requires a re-ingest for the semantic search leg: embedding hashes include the kind text.

Other environment variables: `TRYOUT_STORAGE_PATH` (default `./runtime/try-out-sessions`, legacy `/api/try-out` storage, read in `src/lib/server/try-out.ts`) and `MCPTEST_ALLOW_OPEN_EGRESS` (never honoured: `true` or `1` makes the runner config throw, `src/lib/server/mcptest/containerRun.ts`).

Related non-flag switches: `MCP_TESTER_RUNTIME=container`, `SEARCH_EMBEDDINGS=off`, `PI_RUNNER_ENABLED=false`, `AUTH_ENABLED=false`.

## Search

`src/lib/server/search/`: a lazy, refreshable service (`index.ts`) combining in-TypeScript BM25 with prefix matching (`bm25.ts`) and cosine similarity over stored embeddings (`embedder.ts`, model Xenova/all-MiniLM-L6-v2 cached in `HF_CACHE_DIR`), merged by weighted reciprocal-rank fusion (`hybrid.ts`). BM25 is never blocked by model load; without a model search is BM25-only. `related.ts` ranks related agents by embedding distance with a tag/category/tools fallback. Entry points: `GET /api/search`, `/catalog?q=`, `SearchService.related()` on the detail page.

## Authentication

`src/hooks.server.ts` gates every route except `/login`, `/health` and `/api/llm/*` (the proxy uses per-lease bearer tokens). It also covers `/api/mcp-generate` and `/api/mcp-test/*` when `AUTH_ENABLED=true` (D-476). An unauthenticated API call gets 401 `{ message: 'Authentication required' }`; all API error bodies use `message` (D-461). `handleError` in the same file logs unexpected errors with a redacted detail under a short reference id and returns `{ message: 'Internal Error', ref }`; `+error.svelte` shows `Reference: <ref>` for 5xx (D-462). `/health` is a readiness check: 503 `{ message }` when the database or the `agents` table is unavailable (D-460). Passwordless six-digit codes by Brevo or SMTP, allow-lists `AUTH_ALLOWED_EMAILS` and `AUTH_ALLOWED_EMAIL_DOMAINS`, sessions in the auth database (`AUTH_DB_PATH`), `AUTH_ENABLED=false` disables the gate. Details: README "Passwordless consortium access".

## Try It Out

Modes `none | external | runnable` per agent. Runnable agents use the job API in `docs/job-api-contract.md` (`/api/tryitout/jobs`). Backends: the container-backed Pi runner (`src/lib/server/tryitout/`: `leaseManager`, `runtimeDockerode`, `llmProxy`, `piRunner`, `service`, configured by `runnerConfig.ts` and the `PI_*` variables) with fallback to the direct model call (`tryItOutRunner.ts`, `OPENAI_API_KEY`). The real API key never enters a container; containers call `/api/llm/v1` with a per-lease token. Containers carry the label `aic.owner` (`APP_INSTANCE_NAME`) for the start-up orphan sweep.

## Deploy

Container files, compose stack, backups, health check and rollback: `docs/deploy-runbook.md`.

---

## Configuration Files

### `drizzle.config.ts`
Points Drizzle Kit at `drizzle/schema.ts` and `db/catalog.db`. Used by `npm run db:push` to apply schema changes.

### `svelte.config.js`
- Preprocessor: `vitePreprocess()` (Svelte 5 + TypeScript support)
- Adapter: `adapter-node` (Node.js production server)
- Alias: `$lib` → `src/lib`

### `vite.config.ts`
Two plugins: `@tailwindcss/vite` (Tailwind v4 JIT) and `sveltekit()`.

### `tsconfig.json`
Extends `.svelte-kit/tsconfig.json`. Strict mode enabled. Includes `src/`, `scripts/`, `drizzle/`.

### `vitest.config.ts`
Configures `sveltekit()` and `svelteTesting()` plugins. Routes component test files to jsdom, everything else to Node.

---

## Adding a New Agent Spec Format

1. **Add a Zod schema and adapter** in `src/lib/spec/<format-name>.ts`:
   ```typescript
   export const MyFormatSchema = z.object({ ... })
   export function fromMyFormat(raw: MyFormat): AgentRecord { ... }
   ```

2. **Register it** in `src/lib/spec/index.ts`:
   ```typescript
   // In detectFormat():
   if (raw.some_identifying_field) return 'my-format'

   // In normalize():
   case 'my-format':
     return fromMyFormat(MyFormatSchema.parse(raw))
   ```

3. **Add test fixtures** to `data/agents/fixtures/` and test cases to `src/lib/spec/<format-name>.test.ts`.

No other files need to change.

---

*Last updated: 2026-10-13 (core sections date from 2026-03-19; later sections added with Phases 3-15)*

## MCP Generator (flagged, Phase 14)

`src/lib/mcpgen/` holds a deterministic generator that turns a schema or specification (OpenAPI 3.x, tabular catalog header text, SQL DDL) into a Python FastMCP stdio package. Input adapters sit behind one `InputAdapter` interface and are listed only in `src/lib/mcpgen/adapters/index.ts`; the core planner and emitters never import an adapter. It is exposed through `npm run generate-mcp`, the `MCP_GENERATOR`-gated `POST /api/mcp-generate` route and a flag-gated Customize menu panel. The route has a per-client rate limit and a concurrency cap (`MCP_GENERATOR_RATE_MAX`, `MCP_GENERATOR_RATE_WINDOW_SEC`, `MCP_GENERATOR_MAX_CONCURRENT`, D-465), and the OpenAPI adapter reports a response example that contradicts its schema as gap `example-schema-mismatch` (D-463). Full documentation, including the extension point for synthesized tools: `docs/mcp-generator.md` (design: `docs/mcp-generator-design.md`).

## MCP Test Platform (flagged, Phase 15)

`src/lib/mcptest/` is a black-box scorer for MCP servers: a minimal MCP client (stdio and Streamable HTTP, `core/transports/`), a loopback mock upstream with seeded data and fault injection (`mock/`), in-process fake servers used only as scorer fixtures (`fake/`), 12 synthetic cases in the source-compatible `case.yaml` / `golden.jsonl` / `rubric.yaml` formats (`suite/`), scoring and a `mcptest-report/1` report (`core/`). `core/`, `mock/` and `fake/` import nothing from `$lib` or Svelte; only `core/transports/stdio.ts` imports `child_process`. It is exposed through `npm run mcp-test`, the `MCP_TESTER`-gated `/api/mcp-test/runs` routes (in-memory TTL run store in `src/lib/server/mcptest/`) and a flag-gated `/mcp-test` page. With `MCP_TESTER_RUNTIME=container` the run happens in a sandboxed runner image through the Phase 8 container runtime, driven by `src/lib/mcptest/driver.ts` with a request validated by the shared `driverRequest.ts`. Invariants are pinned by `src/lib/mcptest/criteria.test.ts`. Full documentation: `docs/mcp-test-platform.md`; port fidelity: `docs/mcp-test-port-fidelity.md`.
