# Decision memo: hosting more agent types in the catalog

Status: research output (Phase 12), recommendations only, nothing implemented. Research date and web sources: accessed 2026-10-12. Addressed to Ville and to the Phase 13 implementer.

## 1. Context and decision requested

The catalog stores one kind of thing: a single agent. Authors have started to offer multi-agent systems, workflows, skills, MCP servers and remote agents, built with many frameworks. This memo recommends a minimal, additive, flag-gated extension of the canonical model and a ranked list of adapters, so Phase 13 can build behind a flag. Decision requested: approve the Phase 13 proposal in section 5 and answer (or accept the defaults for) the open questions in section 6.

Background: [agent-types.md](agent-types.md) (taxonomy and per-format findings), [agent-capability-matrix.md](agent-capability-matrix.md), [agent-intake-guide.md](agent-intake-guide.md).

## 2. Findings that drive the recommendation

- `AgentRecord` (`src/lib/spec/types.ts`) is a single-agent record: one prompt, one LLM, flat tool names, a form-style inputs list.
- The Oracle adapter's Zod schema uses `component_type: z.literal('Agent')`, so Swarm, ManagerWorkers, Flow and A2AAgent files are rejected today.
- Unknown top-level fields are dropped (only `metadata` is a catchall), so nothing a new format adds survives ingest.
- Oracle AgentSpec already models Swarm, ManagerWorkers, Flow and A2AAgent, with official adapters to LangGraph, CrewAI, AutoGen, Microsoft Agent Framework and OpenAI Agents. Extending the existing adapter is the cheapest first step.
- Code-only frameworks (LangGraph graph code, OpenAI Agents SDK, LlamaIndex, Semantic Kernel, AutoGen in code) cannot be derived from config; they need a manifest plus a repo link.
- `try_it_out` is DB-only by D-05..D-07; it must never be derived from ingested files.

## 3. Recommended canonical-model changes

All new fields are nullable or defaulted, read only when the flag `AGENT_KINDS` is on (default off). With the flag off the adapter keeps `z.literal('Agent')` and ignores the new columns. SQLite `ALTER TABLE ADD COLUMN` is additive, so the generic revert for every column below is: stop reading it and leave it, or drop it later through a new migration. With the flag off nothing reads it.

### 3.1 `kind`

- Type: `'agent' | 'system' | 'workflow' | 'skill' | 'mcp-server' | 'external-agent'`. DB: `kind text not null default 'agent'`.
- Pros: drives UI and Try It Out limits; one cheap field. Cons: UI surfaces (FilterBar, AgentCard, RelatedAgents, detail page) need kind awareness.
- Revert: stop reading the column (existing rows default to `agent`); optionally drop it in a later migration.
- Recommendation: adopt in Phase 13.

### 3.2 `framework`

- Type: `string | null`. DB: `framework text null`. The known-value list lives in code for filter labels.
- Pros: technology agnostic, free string. Cons: drift in spelling; mitigated by the known list.
- Revert: stop reading the column; drop later if wanted.
- Recommendation: adopt.

### 3.3 `topology`

- Type: `string | null` (swarm, manager-workers, pipeline, graph, group-chat, unknown). DB: `topology text null`.
- Pros: separates behaviour from framework. Cons: author-asserted for code-only frameworks.
- Revert: stop reading the column.
- Recommendation: adopt.

### 3.4 `members`

- Type: `AgentMember[]` where `AgentMember = { ref, name, role: 'manager'|'worker'|'peer'|'step'|'participant', description: string|null, slug: string|null }`. DB: `members text not null default '[]'` (JSON text, matching existing array columns).
- Pros: members inline first means no foreign keys and a simple ingest; optional `slug` links to an existing catalog row. Cons: inline members have no detail page of their own (see open question 1).
- Revert: stop reading the column; rows keep `'[]'`.
- Recommendation: adopt, inline first.

### 3.5 `edges`

- Type: `{from, to, kind}[] | null` (handoff, delegates, sequence). DB: JSON text, nullable.
- Pros: exact handoff graph. Cons: needs the AgentSpec `relationships` shape, which is unverified; an ordered `members` list plus `topology` covers about 80 percent.
- Revert: not applicable until built; a later column can be ignored or dropped.
- Recommendation: defer (not in Phase 13 v1).

### 3.6 `sourceFormat`

- Type: `string | null` (for example `oracle-agentspec@26.1`, `crewai-jsonc`, `manifest`). DB: `source_format text null`.
- Pros: adapter traceability and version pinning for churn-prone formats. Cons: one more field.
- Revert: stop reading the column.
- Recommendation: adopt.

### 3.7 `extras`

- Type: `Record<string, unknown>`, size-capped, secret-scanned, never rendered as HTML. DB: `extras text not null default '{}'`.
- Pros: unknown fields are preserved instead of dropped (Phase 13 criterion 5); also holds the raw `relationships` if its shape is unclear. Cons: must be capped and scanned.
- Revert: stop reading the column; contents are disposable.
- Recommendation: adopt.

### 3.8 `mcp` details

- Type: `{ transport, package, toolNames[], envVarNames[] }` for `mcp-server` only.
- Pros: folding into `extras` in v1 keeps the schema minimal. Cons: not queryable until promoted.
- Revert: remove the keys from `extras`; no schema change was made.
- Recommendation: fold into `extras` in v1, promote to columns later.

### 3.9 `tryItOut*` unchanged

- D-05..D-07 keep Try It Out DB-only. For any kind other than `agent`, the default mode is `none` or `external`; `runnable` stays restricted to single agents.
- Revert: nothing to revert (no change).
- Recommendation: do not change.

### 3.10 Do NOT change

- The slug as primary key.
- Existing column names.
- The embeddings pipeline text when the flag is off. Adding kind, framework or member names to searchable text changes content hashes and triggers re-embedding of every row (hash churn pitfall), so do it only behind the flag.

## 4. Ranked adapter list

| Rank | Adapter | Why | Cost | Trade-off | Relies on unverified facts? |
|------|---------|-----|------|-----------|-----------------------------|
| 1 | Oracle AgentSpec Swarm / ManagerWorkers / Flow / A2AAgent (extend existing) | Canonical format, native topology, no new format risk | Low | Needs real fixtures | Yes: YAML shape of `$component_ref` and `relationships`, `type` vs `component_type` |
| 2 | `catalog.yaml` manifest (universal) | Covers code-only frameworks; answers the intake question | Low | Author-asserted, can drift from code | No (our own convention) |
| 3 | SKILL.md and Claude subagent .md | Simple frontmatter, stable open spec | Low | Skill is not an agent; needs `kind=skill` UI | No (HIGH) |
| 4 | CrewAI (`crew.jsonc`, `agents/*.json`, `config/*.yaml`) | Widely used; topology derivable | Medium | Two config styles; never execute `custom:` or `python` refs | Partly: CrewAI Flows undocumented on the fetched page |
| 5 | MCP `server.json` | Official registry format; ties into Phases 14-15 | Low | Registry in preview; draft schema may change | Partly: preview schema |
| 6 | `langgraph.json` (detector only) | Very popular; graph ids, deps, entry points | Low | Little information; topology invisible | No (HIGH) |
| 7 | Google ADK `root_agent.yaml`; MS Agent Framework declarative YAML; Pydantic AI spec | Declarative and growing; ADK `sub_agents` derivable | Medium | Experimental or preview formats; churn | Yes: experimental, MAF workflow status LOW, Pydantic AI from summaries |
| 8 | A2A Agent Card | External-agent listing | Low | Spec 1.0 is new | Yes: field tables and well-known path unread |
| 9 | AutoGen `dump_component` JSON | Community-only project | Medium | Dying format; tools not serializable | Partly: Studio JSON unverified |
| 10 | n8n / Flowise / Dify exports | Popular with non-developers | High | Secret leakage; unstable shapes | Yes: Flowise export and Dify extension unverified |
| - | OpenAI Agents SDK, LlamaIndex, Semantic Kernel, smolagents | Code-only or executable | - | Manifest only (rank 2) | LlamaIndex handoff LOW |

Adapter interface (proposal): `detect(files) -> { format, confidence }` and `parse(file) -> { record | partial, missingFromAuthor[], unknownFields }`. A registry tries detectors ordered by confidence. An unknown format returns `partial` with the list of fields the author must supply; the registry never throws.

Security rules for every adapter:

- Parse text only; never execute or import author code.
- Do not fetch author-supplied URLs at ingest (SSRF risk); render links with `rel=noopener`.
- Never render `extras` as HTML.
- Run a small shared secret denylist scan (`api_key`, `authorization`, `bearer`, `password`, `token`, `sk-`) before storing or displaying exports.
- Cap sizes of files and of `extras`.
- Do not use the pyagentspec Python adapters in the catalog (wrong runtime; they import and execute target frameworks).

## 5. Concrete minimal proposal for Phase 13

1. Flag `AGENT_KINDS`, default off. With it off, behaviour, schema output and existing tests are unchanged.
2. New fields on the record and DB: `kind` (default `'agent'`), `framework` (null), `topology` (null), `members` (JSON text, default `'[]'`; `AgentMember` has `ref`, `name`, `role`, `description`, `slug`; inline first), `sourceFormat` (null), `extras` (JSON text, default `'{}'`, size-capped). `edges` is deferred and `mcp` details live in `extras`.
3. Migration: SQLite `ALTER TABLE ... ADD COLUMN` statements only, each nullable or with a default.
4. Zod: a discriminated union on `component_type` (tolerating `type`) behind the flag. The `z.literal('Agent')` path stays byte-identical when the flag is off. Task 0: obtain a pyagentspec-exported fixture shape offline; otherwise treat `relationships` as opaque and keep it in `extras`.
5. Adapters for Phase 13: ranks 1 to 6 (AgentSpec systems, `catalog.yaml`, SKILL.md and Claude subagent, CrewAI, MCP `server.json`, `langgraph.json` detector). Ranks 7 and beyond are explicitly out of scope.
6. `validate-submission` CLI: reads a path, reports per file `ingestible`, `partial` or `missing from author`, lists unknown fields, and never throws.
7. UI: kind badge, members list and topology on the detail page; flag-off UI unchanged.
8. Embedding text: kind, framework and member names are added only when the flag is on.
9. Try It Out for kind other than `agent` is limited to `none` or `external`.
10. Proof that flag-off is unchanged: the existing test suite passes unmodified with the flag off, and a schema output diff (drizzle migration and generated types) is empty for the flag-off path.

## 6. Open questions for the human

Addressed to Ville. All questions in this section were answered on 2026-10-14 (decisions D-467..D-478 in `.planning/AUTONOMOUS-DECISIONS.md`); the recommended defaults were accepted.

1. Should system members be separate catalog rows (own slug and detail page) or inline only? **Answered: inline in v1 with an optional `slug` link** (D-467).
2. Is `catalog.yaml` an acceptable AIC convention, or should authors fill a web form? **Answered: `catalog.yaml` plus the reply-with-answers equivalent** (D-468).
3. Should Try It Out ever run systems? **Answered: no; kinds other than `agent` get `none` or `external`** (D-469).
4. Which frameworks do AIC authors actually use? **Answered: keep the ranking in section 4** (accepted as the default; a survey of the 100+ agents can re-weight it later) (D-478).
5. Unverified facts that only matter if those adapters are promoted (A2A Agent Card, Flowise, Dify, LlamaIndex, AutoGen Studio, MAF, AgentSpec YAML shape). **Answered: do not build adapters that depend on them in Phase 13** (D-478).
6. Should `edges` ship in v1? **Answered: no handoff edges in v1** (D-470).

## 7. Risks and unverified assumptions

- R-1 Format churn (experimental or preview formats): tolerant adapters and `sourceFormat`.
- R-2 AgentSpec docs inconsistencies: fixtures first.
- R-3 Author-asserted manifests drift: `validate-submission` rechecks against repo files where the format is declarative.
- R-4 Security: arbitrary code in configs, secrets in exports, SSRF through endpoint URLs.
- R-5 Scope creep into running systems: keep Try It Out restricted.
- R-6 Flag-off regressions through schema or embedding changes: additive columns with defaults only; embedding text unchanged when off; run existing tests with the flag off.
- R-7 Source quality: several findings come from search-result summaries or third-party blogs (MAF workflow status, Pydantic AI, smolagents, LlamaIndex `can_handoff_to`), labelled MEDIUM or LOW.
- R-8 Truncated docs: Oracle and A2A pages exceeded 250k characters and only the first 100k were read.
- R-9 Data hygiene: all examples and fixtures must be synthetic.

Validity windows: ADK, MAF, Pydantic AI, the MCP registry and A2A are valid about 14 days from 2026-10-12; AgentSpec, Skills, CrewAI and LangGraph about 30 days. Re-check ADK, MAF, Pydantic AI, the MCP registry and A2A before implementing those adapters.

## 8. Decision log hooks

Phase 13 must log each decision in `.planning/AUTONOMOUS-DECISIONS.md` with revert text reusable from section 3:

- `kind` (revert: stop reading the column).
- `framework` (revert: stop reading the column).
- `topology` (revert: stop reading the column).
- `members` inline JSON (revert: stop reading the column; rows keep `'[]'`).
- `sourceFormat` (revert: stop reading the column).
- `extras` including MCP details (revert: stop reading the column).
- `edges` deferred (no revert needed).
- Embedding text gated by the flag (revert: remove the flag branch; hashes revert to the old text).
- Zod discriminated union behind the flag (revert: restore the single literal path).

## 9. Phase 13 outcome

Implemented behind `AGENT_KINDS` (default off); see `docs/phase13-adapters.md`. One deviation from section 3 and step 3 of section 5: kind data lives in a new sidecar table `agent_kinds` instead of `ALTER TABLE agents ADD COLUMN` (D-033), so SQL, row shapes and legacy test DDL stay identical with the flag off. Adapters 1 to 6 shipped, plus `validate-submission`; ranks 7 and beyond remain deferred.
