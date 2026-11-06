# Phase 13: multi-agent and multi-format hosting (flagged)

Everything here is behind the `AGENT_KINDS` flag, default off. With the flag off, ingest, search, the catalog and the detail page behave exactly as before (proved by `scripts/flag-off.golden.test.ts` and `scripts/flag-regression.test.ts`).

The three `mcp-server` catalog entries (stk-mcp, stk-catalog-mcp, lvi-info-mcp) are not in `data/agents`; they live in `data/agents-local/` and are ingested only when `LOCAL_MCP_AGENTS` is on as well (see [local-mcp-agent.md](local-mcp-agent.md)).

## How to enable

```bash
AGENT_KINDS=on npm run ingest      # also accepts 1, true, yes (case-insensitive)
AGENT_KINDS=on npm run dev         # or npm run build / start
```

`npm run db:push` is optional: ingest creates the `agent_kinds` table with `CREATE TABLE IF NOT EXISTS`, so an existing database works unchanged. To turn it off, unset the flag. The `agents` table is never altered; the sidecar table can stay in place unused.

Note: with the flag on, ingest also scans sub-directories of the data directory as submissions (D-039), except directories named `fixtures` (case-insensitive, at any depth), which are test data and are skipped (D-466, decided by Ville). `data/agents/fixtures/minimal-agent` therefore no longer appears in the catalog. `npm run validate-submission` is unaffected: it validates whatever path it is given.

## Data model

A new sidecar table `agent_kinds` (D-033), one row per `agents` row:

| Column | Meaning |
| --- | --- |
| `slug` | primary key, references `agents.slug`, `ON DELETE CASCADE` |
| `kind` | `agent`, `system`, `workflow`, `skill`, `mcp-server`, `external-agent` |
| `framework` | free text, for example `crewai`, `langgraph`, `mcp`, `agent-skills` |
| `topology` | `swarm`, `manager-workers`, `pipeline`, `graph` or null |
| `members` | JSON list of `{ref, name, role, description, slug}`, max 50 |
| `source_format` | adapter id that parsed the submission |
| `extras` | JSON, capped at 16 KiB, secrets redacted |
| `updated_at` | set on every ingest |

Why a sidecar and not `ALTER TABLE agents ADD COLUMN` (the memo's proposal): every reader does `select().from(agents)` and many tests hand-write `agents` DDL or mock query chains, so new columns would change SQL and row shapes with the flag off. Non-agent kinds still get an `agents` row (needed for slug, title, search, links) with placeholders `systemPrompt ''` and `llm.name 'n/a'` (D-037); the UI hides them.

## Adapters

All adapters are pure functions over file text. Nothing from a submission is executed, imported, fetched or rendered as HTML. The registry (`src/lib/spec/formats/index.ts`) picks the highest-confidence adapter and never throws; unknown input yields an "unrecognized" outcome.

| Rank | Adapter id | Detects | Confidence | Kind | 
| --- | --- | --- | --- | --- |
| 1 | `oracle-agentspec` (`oracle-systems.ts`) | `component_type`/`type` Swarm, ManagerWorkers, Flow, A2AAgent, Agent | high | system, external-agent, agent |
| 2 | `catalog-manifest` | `catalog.yaml` / `catalog.yml` | 0.9 | any |
| 3 | `skill` | `SKILL.md` (0.8), Claude subagent `.md` with front matter (0.6) | 0.6 to 0.8 | skill, agent |
| 4 | `crewai` | `crew.jsonc|json` + `agents/*`, or `config/agents.yaml` + `tasks.yaml` | medium | system |
| 5 | `mcp-server-json` | MCP registry `server.json` | medium | mcp-server |
| 6 | `langgraph` | `langgraph.json` | 0.5 | system (partial) |

### Oracle AgentSpec systems
Assumptions (unverified offline, D-036): the `relationships` tuple shape is kept opaque in `extras`; `$component_ref` resolves to any same-file component with a matching `id`, otherwise stays as text with a warning. A single `Agent` delegates to the original strict parser. Unknown fields go to `extras`.

### catalog.yaml (our own convention)
Fields: `name` (required), `kind`, `summary`, `category`, `tags`, `maturity`, `repo_url` (http/https only), `link_label`, `framework`, `topology`, `members`, `tools`, `model`. Invalid `kind`/`maturity`/role fall back with a warning; unknown keys go to `extras`; for `mcp-server` only env variable names are kept. It is author-asserted, so it cannot be verified for code-only frameworks.

### SKILL.md and Claude subagent
Skill spec limits only warn. `scripts/`, `references/`, `assets/` are listed by path, never read. Subagent `model` aliases (`inherit`, `sonnet`, `opus`, `haiku`) are stored in `extras.modelAlias`, never as `llm.name`, so they cannot reach Try It Out. Subagent results are always `partial`.

### CrewAI
Hierarchical (`process: hierarchical` or manager keys) becomes `manager-workers`, otherwise `pipeline`. The YAML style has no `process` key, so it is assumed sequential, with a warning. Python tool references (`custom:*`, `{python: ...}`) are kept as text in `extras.unloadedToolRefs`. JSONC comments and trailing commas are handled by a local stripper (no dependency).

### MCP server.json
Slug is the full reverse-DNS name. Only environment variable names are stored (never values or defaults). Preview schema churn is tolerated; unknown keys go under `extras.unknown`. Tool list and category are reported as missing from the author.

### langgraph.json
Low-confidence detector (0.5, below the manifest). Records graph ids, entrypoints and dependencies as text; an object `env` is never stored. Always `partial`; the warning tells the author to add a `catalog.yaml`.

### Unknown-field behaviour
Every adapter preserves unknown fields in `extras` (redacted, clamped) and lists them in the validator output; none rejects a submission because of an unknown field.

## Security rules

- No code execution, no `import`, no network fetch, no symlink following, `.env` files and binaries skipped.
- Caps: scanner file and size limits, 50 members, 16 KiB extras, 300-character printed strings.
- Secret denylist: values under keys matching api key, authorization, bearer, password, secret or token are replaced with `[redacted]`; strings starting with `sk-` too, and (since 13-09) `sk-` tokens embedded inside longer strings.
- `extras` is never sent to the client (the detail load strips it) and never rendered as HTML.
- Systems are never runnable in Try It Out (mode is coerced to `none` unless `external`).

## validate-submission

```bash
npm run validate-submission -- path/to/submission [--json] [--strict]
```

Read-only; works with the flag unset. Sample (synthetic fixtures):

```
[INGESTIBLE] oracle-swarm (oracle-agentspec, system, oracle-agentspec)
  topology: swarm, members: 3
[PARTIAL] skill-example (agent-skill, skill, agent-skills)
  missing from author:
    - category
13 submission(s): 7 ingestible, 6 partial, 0 missing-from-author
```

Exit codes: 2 usage error; 1 only with `--strict` when any item is not ingestible; otherwise 0.

## Reverting

Per-decision revert steps are in `.planning/AUTONOMOUS-DECISIONS.md` (D-033..D-040, D-050, D-051, D-060..D-062, D-070..D-073, D-080, D-081, D-090, D-100..D-102). Shortest path: stop setting `AGENT_KINDS` (everything is inert), and optionally `DROP TABLE agent_kinds`. Full removal: revert the Phase 13 commits.

## Deferred

- Handoff edges (graph), a separate catalog row per member.
- Adapters ranked 7 and below: Google ADK, Microsoft Agent Framework, Pydantic AI, A2A agent cards, AutoGen, n8n/Flowise/Dify. The roadmap goal mentions AutoGen configs, but the Phase 12 memo ranks AutoGen 9 and CONTEXT locked ranks 1 to 6, so it stays deferred.
- Try It Out for systems.
- Browser verification (see `13-HUMAN-UAT.md`).
