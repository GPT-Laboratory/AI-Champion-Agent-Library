# AIC Agent Library v. 0.1

A browse-and-discovery catalog for the AI agents produced for the AI Champion (AIC) consortium. It is one of the main WP5 outputs. This repository does not contain the agents themselves, but the code for the website presenting and showcasing them. With the catalog, tech evaluators and engineers can find the right agent for their use case. One can filter by discipline, read an executive summary, expand technical details when needed, and follow a link straight to the GitHub implementation.

---

## What it does

The AIC consortium produces AI agents that automate workflows across engineering, operations, and project management. This library is the front door to that catalog — a fast, searchable index where you can:

- **Search** with natural language or keywords (hybrid keyword + local-embedding search)
- **Browse** agents by category, LLM, and maturity status
- **Read** a plain-language summary of what each agent does and when to use it
- **Inspect** the technical specification (LLM config, tools, human-in-the-loop requirements) when you need the details
- **See** which fields are tailorable for your environment before you open the GitHub repo
- **Try out** selected demo agents and find **related agents** on each detail page

The platform is a discovery tool, not a runtime. Agents live in GitHub; this library helps you find the right one.

---

## How it works

Each agent is described in a YAML file using the Oracle AgentSpec format. On startup, the platform ingests those files into a local catalog database and serves a SvelteKit web app.

![Data flow: YAML files → ingest → SQLite → catalog → detail → GitHub](docs/images/data-flow.png)

---

## Getting started

**Prerequisites:** Node.js 22 (the container images use Node 22; the Try It Out runner images need >= 22.19)

```bash
# 1. Clone and install
git clone https://github.com/mikauran/AI-Champion-Agent-Library
cd AI-Champion-Agent-Library
ONNXRUNTIME_NODE_INSTALL_CUDA=skip npm install   # the variable avoids a hanging CUDA download (see Search)

# 2. Configure access and email delivery
cp .env.example .env
# Edit .env: add allowed addresses and either Brevo settings or SMTP_SERVER.

# 3. Start the development server
#    (runs db schema push, ingests agent files, starts the web app)
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) — you land on the catalog automatically.

For a production build:

```bash
npm run build
npm run preview
```

### Search / embeddings

Catalog search uses local sentence embeddings (`@huggingface/transformers`, no external API) next to keyword search.

- Install with `ONNXRUNTIME_NODE_INSTALL_CUDA=skip npm install` (or `npm ci`); without it the onnxruntime-node postinstall hangs on a CUDA download.
- The first ingest downloads the ~90 MB model once (about 90 s) into `HF_CACHE_DIR` (default `./db/models`).
- `SEARCH_EMBEDDINGS=off` forces keyword-only (BM25) search and skips the model entirely.
- Offline or model unavailable: ingest logs a warning and search falls back to BM25 only.
- Tests never download or load a model (`SEARCH_EMBEDDINGS=off` is set in the vitest config).

---

## Adding agents

Drop a YAML file into `data/agents/` and restart the server. The ingest step runs automatically on `npm run dev` and `npm run build`.

A minimal agent file looks like this:

```yaml
component_type: Agent
id: "your-org-agent-001"
name: "Your Agent Name"
description: "One sentence describing what this agent does."
metadata:
  category: "mechanical"        # discipline or domain
  maturity: "experimental"      # experimental | beta | production
  tags:
    - "your-tag"
  input_schema:
    - key: "project_name"
      label: "Project name"
      type: "text"               # text | textarea | number | select
      required: true
      description: "Project to process"
    - key: "building_type"
      label: "Building type"
      type: "select"
      required: true
      options:
        - value: "office"
          label: "Office"
        - value: "residential"
          label: "Residential"
system_prompt: "You are a ..."
llm_config:
  name: "claude-sonnet-4-6"
  default_generation_parameters:
    max_tokens: 2048
    temperature: 0.2
tools:
  - name: "tool_name"
    description: "What this tool does"
human_in_the_loop: false
```

Re-running ingest on an existing agent ID updates the record — it never creates duplicates.

---

## Using the catalog

![User journey: browse → filter → read summary → expand details → GitHub](docs/images/user-journey.png)

**Catalog page** (`/catalog`)
- Cards display each agent's name, summary, category, maturity badge, and tags
- Three filter dropdowns — **Category**, **Model**, and **Status** — narrow the list instantly without a page reload
- Pagination handles large catalogs without layout degradation

**Detail page** (`/agents/<slug>`)
- The executive summary (name, purpose, GitHub link) is visible by default
- Click **Technical Specification** to expand LLM config, tools, and system prompt details
- The **Customization Options** panel lists which fields of the agent are tailorable for your environment

### Multi-agent and multi-format hosting (flagged)

Off by default. Set `AGENT_KINDS=on` and re-run `npm run ingest` to host multi-agent systems, skills, MCP servers and other formats (Oracle AgentSpec systems, `catalog.yaml`, SKILL.md, CrewAI, MCP `server.json`, `langgraph.json`) alongside normal agents. Authors can check a submission with `npm run validate-submission -- <path>`. Directories named `fixtures` are never ingested. Details: `docs/phase13-adapters.md`.


### MCP generator (flagged)

Off by default. Set `MCP_GENERATOR=1` to enable a "Generate MCP" entry in the Customize menu and the `POST /api/mcp-generate` route. The route is rate limited per client and capped on concurrency (`MCP_GENERATOR_RATE_MAX`, `MCP_GENERATOR_RATE_WINDOW_SEC`, `MCP_GENERATOR_MAX_CONCURRENT`; see the environment table). Authors can also run `npm run generate-mcp -- --adapter <openapi|tabular-catalog|sql-ddl|prisma|odata|auto> <input-file> --out <dir>` (works without the flag). It turns an OpenAPI 3.x spec, a tabular catalog header, `CREATE TABLE` DDL (also pg_dump, SQLite and mysqldump output) a Prisma schema or OData `$metadata` (CSDL JSON or EDMX XML) into a Python FastMCP stdio server package with generated tests; schema or spec only, never credentials or data. Details: `docs/mcp-generator.md`.

The generated server can be improved by a data-only proposal file written by an external agent session or a person (`--proposals <file>`, `--validate-only` for a review summary, `--context-pack <dir>` to hand an agent the spec, samples, docs and the deterministic baseline, `npm run mcp-propose-eval` to compare baseline and proposal-assisted packages). No model is called by the platform, every proposal passes deterministic gates, and a person reviews the result before it is published. Details: `docs/mcp-generator-proposals.md`.

### MCP test platform (flagged)

Off by default. Set `MCP_TESTER=1` to enable the `/mcp-test` page, the `POST /api/mcp-test/runs` routes and a Customize menu entry. Authors can score a server from the command line without the flag: `npm run mcp-test -- --list`, `npm run mcp-test -- --subject fake:good`. It runs 12 synthetic cases against an offline mock upstream and writes a report (JSON plus a text summary); no real API or credential is ever used. Real FastMCP servers and the container runner image (`MCP_TESTER_RUNTIME=container`, `Containerfile.mcp-test-runner`) have not been run yet and are listed as pending human. Details: `docs/mcp-test-platform.md` (port fidelity: `docs/mcp-test-port-fidelity.md`).

---

## npm scripts

| Script | What it does |
|--------|--------------|
| `npm run dev` | `db:push`, `ingest`, `tryout:configure`, then the Vite dev server (port 5173) |
| `npm run build` | `db:push`, `ingest`, `tryout:configure`, then `vite build` (see `docs/deploy-runbook.md`) |
| `npm run preview` | `node build` (serve the production build) |
| `npm run check` | `svelte-kit sync && tsc --noEmit && vitest run`: the one command that must exit 0 |
| `npm test` | `vitest run` only |
| `npm run db:push` | `drizzle-kit push`: apply `drizzle/schema.ts` to `db/catalog.db` |
| `npm run ingest` | Ingest `data/agents/` into SQLite (+ embeddings unless `SEARCH_EMBEDDINGS=off`) |
| `npm run tryout:configure` | Set `try_it_out_mode` for the demo agents (`demo-rfi-triage` runnable, `hvac-load-calculator` none); run after ingest |
| `npm run fixtures:scale` | Write 150 synthetic agent YAMLs to `data/fixtures-scale/` (gitignored); `SCALE_COUNT`, `SCALE_SEED`, `SCALE_OUT_DIR` override |
| `npm run validate-submission -- <path>` | Check an agent submission folder or file against the format adapters (read-only, works without `AGENT_KINDS`) |
| `npm run generate-mcp -- --adapter <id> <input> --out <dir>` | MCP generator CLI (works without `MCP_GENERATOR`) |
| `npm run mcp-test -- --list` / `--subject fake:good` | MCP test platform CLI (works without `MCP_TESTER`) |
| `npm run mcp-propose-eval -- <input> --proposals <file>` | Baseline versus proposal-assisted package through the test runner; exits 1 on a regression (not part of `npm run check`) |

## Configuration reference

Variables are read from the environment (`.env` for local runs and compose). Defaults and the full table, including every `PI_*` and `MCPTEST_*` knob, are in `docs/deploy-runbook.md` section 3; `.env.example` has the commented list.

| Variable | Default | Purpose |
|----------|---------|---------|
| `AGENT_KINDS` | off | Feature flag: multi-agent and multi-format hosting (Phase 13) |
| `AGENT_COMPARE` | off | Feature flag: side-by-side `/compare?agents=a,b` page and compare checkboxes on catalog cards |
| `UI_SPEC_VIEWER` | off | Feature flag: read-only raw spec viewer on the agent detail page |
| `UI_DARK_MODE` | off | Feature flag: dark/light theme toggle in the header |
| `MCPTEST_ALLOW_OPEN_EGRESS` | n/a | Refused: `true` or `1` makes the MCP test runner config throw (the runner never gets egress) |
| `TRYOUT_STORAGE_PATH` | `./runtime/try-out-sessions` | Storage directory of the legacy `/api/try-out` route (also `TRYOUT_TEMPLATE_PATH`) |
| `MCP_GENERATOR` | off | Feature flag: Generate MCP panel and `POST /api/mcp-generate` (Phase 14) |
| `MCP_GENERATOR_RATE_MAX` | `20` | `POST /api/mcp-generate`: requests per client per window (`0` = unlimited); over the cap answers 429 `{ message }` |
| `MCP_GENERATOR_RATE_WINDOW_SEC` | `600` | Window of that limit, in seconds |
| `MCP_GENERATOR_MAX_CONCURRENT` | `2` | `POST /api/mcp-generate`: simultaneous generations (`0` = unlimited); over the cap answers 429 `{ message }` |
| `MCP_TESTER` | off | Feature flag: `/mcp-test` page and `/api/mcp-test/runs` (Phase 15) |
| `MCP_TESTER_RUNTIME` | unset | `container` runs the MCP tester in the runner image instead of in-process fakes |
| `SEARCH_EMBEDDINGS` | on | `off` = keyword-only search, no model |
| `SEARCH_REAL_EMBEDDINGS` | unset | Test only: `1` enables the real-model accuracy test (downloads the model) |
| `HF_CACHE_DIR` | `./db/models` | Embedding model cache |
| `APP_INSTANCE_NAME` | `aic-agent-library` in `podman-compose.yml` (hostname if unset elsewhere) | Owner label for Try It Out containers; makes the orphan sweep safe |
| `MCPTEST_JOB_TIMEOUT_MS` | 300000 | Job timeout of the MCP test runner container (also `MCPTEST_MEMORY_MB`, `MCPTEST_NETWORK`, `MCPTEST_RUNNER_IMAGE`) |
| `CATALOG_DB_PATH`, `INGEST_DATA_DIR`, `INGEST_DB_PATH` | `./db/catalog.db`, `./data/agents`, `./db/catalog.db` | Database and source locations |
| `OPENAI_API_KEY`, `PI_*` | see `.env.example` | Try It Out (direct call and container runner) |
| `AUTH_*`, `BREVO_API_KEY`, `SMTP_*`, `ORIGIN` | see below | Sign-in and mail |

Flags accept `1`, `true`, `on` or `yes`. Toggling `AGENT_KINDS` (either way) needs a re-run of `npm run ingest` for the semantic search leg, because embedding hashes include the kind text.

## Tests

Prerequisite: `src/routes/api/tryitout/jobs/jobs.test.ts` reads a pre-built `./db/catalog.db` that contains `demo-rfi-triage`. On a fresh checkout run `mkdir -p db`, `npm run db:push`, `npm run ingest` and `npm run tryout:configure` first, or that file fails.

`npm run check` is the gate (type check plus the whole Vitest suite, about 2 minutes: 208 files, 2087 tests at the time of writing). Strategy:

- Everything runs offline. No test loads an embedding model (`SEARCH_EMBEDDINGS=off` in `vitest.config.ts`), calls OpenAI or talks to a container engine: the container runtime, LLM upstream and MCP servers are replaced by fakes, fake timers and loopback mocks.
- Component tests (`src/lib/components/**`) run in jsdom; accessibility is checked with axe-core in jsdom (`*.a11y.test.ts`) plus a dependency-free contrast calculator; everything else runs in Node.
- Search quality: a 46-query labeled set on the 150-agent synthetic corpus (BM25 hit@3 enforced); the real-model variant is skipped unless `SEARCH_REAL_EMBEDDINGS=1`.
- Flag safety: `scripts/flag-off.golden.test.ts` and `scripts/flag-regression.test.ts` pin that flag-off output is byte-identical; golden files under `src/lib/mcpgen/__golden__` pin generator output (`UPDATE_GOLDEN=1` regenerates them); `criteria.test.ts` files pin architectural invariants.
- Chaos tests for the Try It Out lease, proxy and reaper (`src/lib/server/tryitout/chaos.*.test.ts`) use seeded interleavings and fakes.
- What tests cannot show lives in `*-HUMAN-UAT.md` files (browser, screen reader, live Podman, real model). `npm run check` does not run `vite build`.

## Repository map

| Path | Contents |
|------|----------|
| `src/routes/` | SvelteKit pages and APIs: `catalog`, `agents/[slug]`, `login`, `logout`, `health`, `mcp-test`, `api/search`, `api/tryitout/jobs`, `api/try-out`, `api/llm/v1` (proxy), `api/mcp-generate`, `api/mcp-test/runs` |
| `src/lib/spec/` | Spec shim: canonical `AgentRecord`, Oracle AgentSpec adapter, multi-format registry and adapters (Phase 13) |
| `src/lib/server/` | DB singleton, auth and mail, search (`search/`: BM25, embeddings, hybrid, related), Try It Out (`tryitout/`: lease manager, container runtime, LLM proxy, Pi runner), MCP test service (`mcptest/`) |
| `src/lib/mcpgen/` | MCP generator (adapters, planner, Python emitter, credential scanner) |
| `src/lib/mcptest/` | MCP test platform (client, mock upstream, fakes, suite, scoring, driver) |
| `src/lib/components/` | Svelte components and their tests |
| `src/lib/flags.ts` | Feature flag readers |
| `scripts/` | CLIs (`ingest`, `set-try-it-out-mode`, `validate-submission`, `generate-mcp`, `mcp-test`), scale-fixture generator, `smoke-pi-runner.ts` and `probe-openai-model.ts` (manual, not in any script) |
| `drizzle/schema.ts` | Tables `agents`, `agent_embeddings`, `agent_kinds` |
| `data/` | `agents/` (YAML source), `tryitout-prompts/`, `try-out/` |
| `fixtures/submissions/` | Sample submissions for `validate-submission` |
| `docs/` | Design docs, research, `deploy-runbook.md`, `dependency-health.md` |
| `.planning/` | GSD planning state, per-phase plans, verification and human-UAT checklists, autonomous-run decisions |
| `Containerfile*`, `podman-compose.yml` | App image, Pi runner image, MCP test runner image (definition only), compose stack |

## Operations

Deploying, environment table, backups, health check, rollback and the list of pending live checks: [docs/deploy-runbook.md](docs/deploy-runbook.md). Dependency audit status: [docs/dependency-health.md](docs/dependency-health.md).

`vite build` was verified to succeed on this branch (an earlier route-export failure, B-002, is fixed and guarded by `src/routes/routeExports.test.ts`).

---

## Deploying with Podman

The repo includes a `Containerfile`, `.containerignore`, and `podman-compose.yml`
for running the built server in a container.

```bash
# Build the image (multi-stage: installs deps, runs the full build
# pipeline — schema push, YAML ingest, vite build — then copies the
# result into a slim runtime image)
podman build -t aic-agent-library -f Containerfile .

# Run it
./deploy.sh

# Deployment checks, health verification and rollback: see docs/autodeploy.md
```

Open [http://localhost:3000](http://localhost:3000).

The catalog data is baked into the image at build time from `data/agents/`.
To pick up new or changed agent YAML files, rebuild the image.

Before starting with Podman, copy `.env.example` to `.env` and replace its
placeholder values. `podman-compose` loads this gitignored file at runtime; it
is not copied into the image.

### Passwordless consortium access

All catalog, agent and Try out routes require a passwordless sign-in. Access is
limited to the exact addresses listed in `AUTH_ALLOWED_EMAILS` and addresses in
the domains listed in `AUTH_ALLOWED_EMAIL_DOMAINS`. A whitelisted user receives
a six-digit, single-use code through Brevo by default. If
`SMTP_SERVER` is configured, the code is sent through that unauthenticated SMTP
relay instead. Codes expire after 10 minutes and lock after five failed attempts.
Code requests are limited to three per email address in a 15-minute window.
Every address to which a code was successfully sent is retained in the
`login_code_recipients` table of the authentication database, along with the
first and latest send timestamps and the total send count.

Authentication is enabled by default. To allow access without signing in, set
`AUTH_ENABLED=false` in `.env` and restart the application. When authentication
is disabled, the email whitelist and email transport settings are not used.

Authentication variables in `.env`:

| Variable | Purpose |
|----------|---------|
| `AUTH_ENABLED` | Optional; set to `false` to disable authentication (default: enabled) |
| `AUTH_ALLOWED_EMAILS` | Comma-separated list of exact allowed addresses |
| `AUTH_ALLOWED_EMAIL_DOMAINS` | Optional comma-separated list of allowed domains, e.g. `example.org,partner.example.org` |
| `BREVO_API_KEY` | Brevo API key used by default; not required when `SMTP_SERVER` is set |
| `SMTP_SERVER` | Optional hostname for an unauthenticated plain-TCP SMTP relay; overrides Brevo |
| `SMTP_PORT` | Optional SMTP relay port (default: `25`) |
| `AUTH_EMAIL_FROM` | Sender address; must be verified in Brevo when Brevo is used |
| `AUTH_EMAIL_FROM_NAME` | Display name for the sender |
| `ORIGIN` | Public base URL, e.g. `http://localhost:3000` locally or the production HTTPS URL |
| `AUTH_COOKIE_SECURE` | `false` for local HTTP, `true` for production HTTPS |

Authenticated sessions last seven days. Only a random session token is stored
in an HttpOnly, SameSite=Lax cookie; the server database stores its SHA-256
hash. With `podman-compose`, login state and rate-limit data persist in the
separate `auth-data` volume. The public `/health` endpoint remains available for
container health checks; it answers 503 `{ message }` when the database is unreachable or the schema is missing. API errors use `{ message }`, and an unexpected server error shows a `Reference` id that matches the server log.

Other env vars the container respects: `PORT` (default `3000`),
`CATALOG_DB_PATH`, `AUTH_DB_PATH`, `TRYITOUT_WORK_DIR`,
`TRYITOUT_PROMPTS_DIR`, and the `PI_*` runner knobs (see `.env.example`).

### Trying out an agent

Agents configured with `try_it_out_mode = 'runnable'` show the runnable Try it out panel.
The build configures the `demo-rfi-triage` agent for this mode. Opening a runnable
agent's page warms a per-session Pi container (from the generic `pi-runner` image).
A user supplies a task and an optional text file; jobs run `pi --mode json` inside
that container, progress (including Pi tool calls) streams to the feed through
`/api/tryitout/jobs/*`, and the download is a zip of the job's `output/` directory.

Pi's LLM calls go through the app's `/api/llm` proxy using a per-lease token; the
real `OPENAI_API_KEY` stays in the app and is never given to a container. If the
container engine is unreachable or a container fails to start, the job falls back
to the direct model call (never when the runner is merely busy). Toggle with
`PI_FALLBACK_ENABLED`. All `PI_*` knobs are documented in `.env.example`.

Set `OPENAI_API_KEY` in `.env` before starting the application. Job metadata is
kept in memory, so active and completed job links do not survive an application
restart.

#### Setting up the Pi runner

Run these steps as the dedicated, non-root deployment user (without `sudo`).
Compose always mounts the socket, even when `PI_RUNNER_ENABLED=false`.

1. Prepare and check the user socket:
   ```sh
   export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
   systemctl --user enable --now podman.socket
   test -S "$XDG_RUNTIME_DIR/podman/podman.sock"
   ```
   Continue only if all three commands succeed. If the user bus is unavailable,
   log in directly over SSH as the deployment user. See the
   [deployment runbook](docs/deploy-runbook.md#4-containers) for troubleshooting
   and unattended startup.
2. Build the image: `podman build -t localhost/pi-runner:latest -f Containerfile.pi-runner .`
3. Start the app: `podman-compose up -d --build`. The compose file mounts the host
   Podman socket into the app, and attaches it to the internal network
   `aic-pi-internal` (alias `aic-agent-library`); Pi containers get no external egress.
4. Check the host with the smoke script: `npx tsx scripts/smoke-pi-runner.ts`
   (add `--proxy-host aic-agent-library` once the app is running). It prints the
   `PI_RUNNER_FS_MODE` to use (`tmpfs` preferred, `layer` if the host needs it).

Local development with `npm run dev` (verified on rootless Podman 4.9.3, Ubuntu 24.04): the
socket comes from `$XDG_RUNTIME_DIR`; set `PI_RUNNER_NETWORK=podman`,
`PI_RUNNER_ALLOW_OPEN_EGRESS=true` and
`PI_LLM_PROXY_URL=http://host.containers.internal:5173/api/llm/v1`, and start Vite with
`npm run dev -- --host` (it binds all interfaces so containers can reach it;
`vite.config.ts` allows the `host.containers.internal` Host header in dev).

Operational notes: run a single app replica per engine user (orphaned containers are
cleaned up at start-up on that assumption). Mounting the socket gives the app control
over that user's containers, so use a dedicated host user. A dedicated runner user
would need a relay container and only `PI_LLM_PROXY_URL` changes; that variant is not
built in this phase. Resource limits need cgroup v2 delegation for rootless Podman.

Hardening notes (Phase 9): set `APP_INSTANCE_NAME` (for example `aic-prod`) in compose
deployments. Pi containers are labelled with it (`aic.owner`) and the start-up orphan
sweep only removes leftovers with the same owner, so a dev server and the compose stack can
share one Podman socket; without it the container hostname is used and changes whenever the
container is recreated, so leftovers are not swept. Built-in limits (not env-configurable):
every proxied model call is capped at 4096 completion tokens (and charged that amount when
the provider reports no usage), a job keeps at most 2000 progress events, a Pi output line
over 1 MiB is skipped, and a hung engine call is abandoned after 15 s (container remove) or
60 s (job staging and output fetch).

The runtime image only ships production dependencies (`npm prune --omit=dev`
after the build) — build-only tooling like `vite`'s CLI, `drizzle-kit`, and
`tsx` never reaches the running container.

---

## Technical documentation

For stack choices, data model, ingestion pipeline, component structure, and contribution guidelines, see [TECHNICAL_DOCUMENTATION.md](TECHNICAL_DOCUMENTATION.md).

### Agent types and intake

Research output from Phase 12. Hosting of multi-agent systems and other formats is implemented behind `AGENT_KINDS` (Phase 13, default off; see `docs/phase13-adapters.md`).

- [docs/agent-types.md](docs/agent-types.md): taxonomy of agent kinds, topologies and frameworks with per-format findings.
- [docs/agent-capability-matrix.md](docs/agent-capability-matrix.md): what each type needs, stores and shows, and Try It Out suitability.
- [docs/agent-intake-guide.md](docs/agent-intake-guide.md): what authors should send, readiness checklist and a reply template.
- [docs/agent-hosting-decision-memo.md](docs/agent-hosting-decision-memo.md): recommended model changes, ranked adapters and open questions.

---

*Part of the AI Champion (AIC) consortium project.*

Production deployment and signed-tag polling: [deployment guide](docs/autodeploy.md).
