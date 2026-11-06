# Phase 12: Agent Types and Intake Research - Research

**Researched:** 2026-10-12 (all web sources accessed 2026-10-12)
**Domain:** Agent formats and frameworks, multi-agent topology, catalog canonical model, author intake
**Confidence:** MEDIUM (framework formats: HIGH for Oracle AgentSpec, Agent Skills, Claude subagents, LangGraph, CrewAI; MEDIUM for ADK, MS Agent Framework, Pydantic AI; LOW for Flowise export format, Dify file extension, LlamaIndex deploy config)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Use WebSearch/WebFetch for current framework formats (LangGraph, CrewAI, AutoGen/AG2, OpenAI Agents SDK, Google ADK, Semantic Kernel, LlamaIndex, Pydantic AI, smolagents, Claude Agent SDK / skills, MCP servers, Oracle AgentSpec/Open Agent Spec, n8n/Flowise-style workflow agents, A2A, others found). Docs/specs only; cite source URLs; mark date accessed 2026-10-12.
- Reference projects ~/projects/mcp-gen-comparison and -2 are READ-ONLY and relevant only to the MCP-based agent type; never read .env, API keys, Excel or real data; never modify. Synthetic examples only; no invented company/customer data.
- Platform is technology agnostic with first-class adapters where useful; existing canonical model is AgentRecord (src/lib/... and Oracle AgentSpec adapter in the ingest pipeline) - read it to ground the matrix.
- Phase 13 will build behind a flag from the memo; the memo should therefore give a concrete, minimal, additive data-model proposal (each choice with revert story).

### Claude's Discretion
All else.

### Deferred Ideas (OUT OF SCOPE)
None.
</user_constraints>

<phase_requirements>
## Phase Requirements

No REQ-IDs (research phase). It must support ROADMAP success criteria 1-5:

| ID | Description | Research Support |
|----|-------------|-----------------|
| SC-1 | docs/agent-types.md taxonomy | Sections "Proposed Taxonomy", "Per-format findings" |
| SC-2 | Capability matrix | Section "Capability Matrix (draft)" |
| SC-3 | docs/agent-intake-guide.md | Section "Intake Needs" (incl. reply template draft) |
| SC-4 | Decision memo, canonical-model changes, ranked adapters | Sections "Candidate Canonical-Model Changes", "Ranked Adapter List" |
| SC-5 | No real company data | All examples synthetic; see Risks R-9 |
</phase_requirements>

## Summary

The current canonical model (`AgentRecord`, `src/lib/spec/types.ts`) is a single-agent record: one system prompt, one LLM, a flat `toolNames: string[]`, a form-style `inputFields` list, and consortium conventions pulled from AgentSpec `metadata` (category, github_url, maturity, tags, customizable/fixed). The Oracle adapter (`src/lib/spec/oracle-agentspec.ts`) validates with a Zod schema whose `component_type` is `z.literal('Agent')`, so any Flow, Swarm, ManagerWorkers or A2AAgent file is rejected today. Unknown top-level fields are dropped (only `metadata` is `catchall`), and `try_it_out_*` is deliberately DB-only (ingest hardcodes `none`, upsert omits those columns; D-05/D-06/D-07). The DB (`drizzle/schema.ts`) stores arrays as JSON text columns, which is a convenient pattern for additive extension.

The key finding: Oracle AgentSpec itself already models the multi-agent topologies the catalog needs (Swarm, ManagerWorkers, Flow with AgentNode/FlowNode, A2AAgent, MCPToolBox) and has official adapters to LangGraph, CrewAI, AutoGen, Microsoft Agent Framework, OpenAI Agents and the WayFlow runtime. So the ranked strategy is: (1) extend the Oracle adapter to the multi-agent component types first (cheapest, same file format authors may already use), (2) add a thin "catalog manifest" sidecar for everything that is not AgentSpec, and (3) add light, non-executing "detect and extract" adapters for the file-based formats that are real configs (SKILL.md, Claude subagent .md, CrewAI YAML/JSONC, ADK root_agent.yaml, MS Agent Framework declarative YAML, Pydantic AI spec, MCP server.json, A2A Agent Card, langgraph.json). Code-only frameworks (OpenAI Agents SDK, LlamaIndex, LangGraph graph code, AutoGen teams in code, Semantic Kernel code) cannot be ingested from config; they need the manifest plus a repo link. Nothing should ever execute author code in the catalog.

**Primary recommendation:** Add `kind` (`agent` | `system` | `skill` | `mcp-server` | `workflow` | `external-agent`), `framework` and `topology`/`members` as additive, nullable canonical fields behind a flag; extend the Oracle adapter to Swarm/ManagerWorkers/Flow/A2AAgent; define a small `catalog.yaml` manifest as the universal fallback (so "config files or the GitHub repo?" is answered with "repo link plus catalog.yaml; config files only if no repo").

## Standard Stack

No new libraries are required for docs. For Phase 13 (informational):

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| zod | already in repo (v4 syntax used) | New per-format schemas (discriminated union on `component_type`/`kind`) | Already used for AgentSpec; keep one validation lib |
| yaml (or js-yaml, whichever ingest.ts already uses) | existing | Parse YAML/frontmatter | Do not add a second YAML lib |
| drizzle-orm / better-sqlite3 | existing | Additive nullable columns | Existing pattern: JSON text columns |

### Supporting (optional, verify before adding; none needed for Phase 12)
| Library | Purpose | When to use |
|---------|---------|-------------|
| gray-matter or equivalent | Frontmatter for SKILL.md and Claude subagent .md | Only if the existing YAML lib cannot split frontmatter; a 10-line splitter is enough, prefer that |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Per-framework adapters for everything | Single `catalog.yaml` manifest + repo link | Manifest is cheap and universal but author-asserted (not derived from the config). Use both: derive where the format is declarative, manifest where not |
| Importing pyagentspec to convert framework configs | Hand-written TS detectors | pyagentspec is Python and its adapters execute/import the target frameworks; wrong runtime and a security surface. Do not use in the catalog |

**Version verification note:** No npm packages recommended, so no `npm view` needed. Framework versions in findings below are from docs as of 2026-10-12, not from a registry.

## Per-Format Findings

Legend for runnable-ness: **runnable** = catalog could run it in the Try It Out sandbox (today only the pi-runner/OpenAI-compatible single-agent flow exists, see `src/lib/tryItOut.ts`, `docs/job-api-contract.md`); **external** = link out to an author-hosted demo or repo; **not runnable** = display only.

### 1. Oracle Open Agent Spec (AgentSpec) - the canonical format
- Config shape: JSON/YAML; every component has `id`, `name`, `description`, `metadata`; type discriminator is `component_type` in the examples (base definition text says `type`; the spec page is inconsistent, treat `component_type` as what the current repo fixtures use and tolerate `type`). References: `{"$component_ref": "<id>"}`; duplicate ids invalid; specs must not contain executable code. Nightly docs are 26.2.0.dev1, latest release referenced 26.1.0.
- Component types: Agent (system_prompt, llm_config, tools, toolboxes, human_in_the_loop, transforms), SpecializedAgent, Flow (`start_node`, `nodes`, `control_flow_connections`, `data_flow_connections`; nodes include LLMNode, APINode, AgentNode, FlowNode, MapNode, ParallelMapNode, ParallelFlowNode, BranchingNode, ToolNode, CatchExceptionNode), Swarm (`first_agent`, `relationships`, `handoff` = never|optional|always), ManagerWorkers (`group_manager`, `workers`; workers cannot talk to the user), tools (ServerTool, ClientTool, RemoteTool, MCPTool, BuiltinTool; `requires_confirmation`), MCPToolBox (`client_transport`, `tool_filter`), A2AAgent (`agent_url`, `connection_config`, `session_parameters`), RemoteAgent, OciAgent.
- Files an author sends: one YAML/JSON file (possibly with `$component_ref` for shared sub-components, all in one file).
- Multi-agent: first-class (Swarm, ManagerWorkers, Flow+AgentNode).
- Runnable-ness: runnable via WayFlow reference runtime or adapters (LangGraph, AutoGen, CrewAI, Microsoft Agent Framework, OpenAI Agents) but the catalog does not host a runtime; Try It Out = external/none for systems.
- Mapping vs AgentRecord: Agent maps fully (existing adapter). Others currently rejected by Zod literal.
- Caveat: the library's `metadata.input_schema`, `category`, `github_url`, `maturity`, `tags`, `customizable`, `fixed` are AIC consortium conventions in `metadata`, not Oracle fields. Because `metadata` is free-form and present on every component, the same conventions can be placed on a Swarm/ManagerWorkers/Flow root.
- Sources: https://oracle.github.io/agent-spec/development/agentspec/language_spec_nightly.html ; https://oracle.github.io/agent-spec/26.1.0/agentspec/language_spec_26_1_0.html ; https://arxiv.org/html/2510.04173v3 ; https://blogs.oracle.com/ai-and-datascience/introducing-open-agent-specification . Confidence HIGH on component list and field names (two official pages agree); only first 100k of ~320k chars read per page, so exact YAML for `$component_ref` and relationship tuple shape is unverified (needs a fixture from the pyagentspec repo in Phase 13).

### 2. LangGraph
- Config: `langgraph.json` with `graphs` (map id -> `./path/file.py:variable`), `dependencies`, `env`, optional `python_version`, `dockerfile_lines`. Root also has `requirements.txt`/`pyproject.toml` (Python) or `package.json` (JS), optional `.env`. Source: https://docs.langchain.com/langsmith/application-structure
- The topology (nodes/edges, supervisor/swarm) lives in Python/TS code, not in config. `langgraph.json` only lists entry-point graphs, so a catalog cannot derive members or edges from config.
- Authors send: repo (strongly preferred) or the zipped project folder; never `.env`.
- Runnable: external (LangGraph Server/Platform deployment) or not runnable. Oracle has a LangGraph adapter in both directions (listed in AgentSpec docs).
- Mapping: only graph ids, dependency list and entrypoints extractable; everything else needs manifest.

### 3. CrewAI
- Config (current docs): JSONC project: `crew.jsonc`/`crew.json`, `agents/<name>.jsonc|json`, `tools/<name>.py` (`custom:<name>` refs). Classic: `crew.py` (`@CrewBase`), `config/agents.yaml`, `config/tasks.yaml`. Agent fields: `role`, `goal`, `backstory`, `llm`, `tools`; task fields: `name`, `description`, `expected_output`, `agent`, `context`, `output_file`. Process: sequential (default) or hierarchical (`manager_llm` or `manager_agent`). Source: https://docs.crewai.com/en/concepts/crews
- Multi-agent: always (a crew is a team). Topology from process type plus task->agent assignment and `context` dependencies: this is derivable from config.
- Security: JSON crews can run local Python via `custom:` tools and `{"python": "module.attribute"}`; the catalog must parse but never load. (same page)
- Runnable: external/not runnable. Flows (CrewAI's event-driven layer) were not documented on the fetched page: unverified.
- Mapping to AgentSpec: agent -> Agent (role+goal+backstory composes into a system prompt, lossy); crew -> ManagerWorkers (hierarchical) or Flow (sequential). Oracle has a CrewAI adapter.

### 4. AutoGen / AG2 / Microsoft Agent Framework
- AutoGen (microsoft/autogen) is in maintenance mode, community managed; Microsoft points to Microsoft Agent Framework (reported GA 1.0 on 2026-04-02 by third-party sources, MEDIUM). AG2 is a community fork by original creators. Sources: https://github.com/microsoft/autogen ; https://atlan.com/know/ai-agent/what-is-autogen/
- AutoGen config: `dump_component()` JSON with `provider` (dotted import path), `component_type`, `version`, `component_version`, `description`, `config`; nested components inside. Tools serialization "not yet supported"; `selector_func` not serializable; loading can execute code ("only load trusted"). Teams: RoundRobinGroupChat (serializable, shown), Swarm/SelectorGroupChat/GraphFlow exist but docs page showed no serialization example. AutoGen Studio JSON not verified. Source: https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/serialize-components.html
- Microsoft Agent Framework declarative agents: YAML/JSON, `kind: Prompt`, `name`, `displayName`, `description`, `instructions`, `model` (id, connection, options), `outputSchema`; `=Env.X` expressions; Python loader flagged experimental, declarative workflows reported stable (third-party sources). Source: https://learn.microsoft.com/en-gb/agent-framework/agents/declarative ; workflow claims: https://startdebugging.net/2026/08/agent-framework-declarative-yaml-vs-code-first-orchestration/ (MEDIUM/LOW)
- Semantic Kernel: AgentGroupChat no longer maintained, replaced by GroupChatOrchestration; SK is being folded into Agent Framework. YAML spec for SK agents NOT confirmed. Source: https://learn.microsoft.com/he-il/semantic-kernel/support/migration/group-chat-orchestration-migration-guide
- Authors send: AutoGen = repo or the dumped JSON; MAF = the YAML file (+ workflow YAML). Runnable: external/not runnable.
- Oracle adapters exist for AutoGen and Microsoft Agent Framework (per AgentSpec docs sidebar).

### 5. OpenAI Agents SDK
- Code-only: topology via `handoffs` (Agent instances or `handoff()` objects, exposed to the model as `transfer_to_<name>` tools) and `Agent.as_tool()` (agents-as-tools). No declarative config file found. Source: https://openai.github.io/openai-agents-python/handoffs/
- Authors send: repo link. Catalog can only show manifest-supplied info. Oracle has an OpenAI Agents adapter (so an author could export an AgentSpec).
- Runnable: the current Try It Out backend speaks OpenAI-compatible models via pi-runner; a hosted SDK app is external.

### 6. Google ADK
- Agent Config (experimental): `root_agent.yaml` with `name`, `model`, `description`, `instruction`, optional `agent_class` (LlmAgent), `tools` (list of `name`), `sub_agents` (list of `config_path` -> other YAML). LangGraphAgent and A2aAgent not yet supported in config; only Gemini models supported in config; Python required. Source: https://adk.dev/agents/config/ (301 from google.github.io/adk-docs)
- ADK also has Sequential/Parallel/Loop agents in code (not verified on the config page: do not assert they are in YAML).
- Multi-agent: `sub_agents` tree = manager/worker topology derivable from config. Runnable: external. Mapping: LlmAgent -> Agent, sub_agents -> ManagerWorkers/Swarm-like (lossy: no handoff semantics).

### 7. Pydantic AI
- Agent specs: YAML/JSON loaded via `Agent.from_file` / `Agent.from_spec`; fields cover model, instructions, capabilities; template strings with `{{ }}` filled from `deps`; custom capabilities require registration in Python. Known gap: custom OpenAI-compatible endpoints need Python. Sources: https://pydantic.dev/docs/ai/core-concepts/agent-spec/ ; https://github.com/pydantic/pydantic-ai/issues/5471 (MEDIUM; search-result summaries, page not fetched in full)
- Single agent mostly. Runnable: external. Mapping: close to Agent (model, instructions, tools via capabilities).

### 8. smolagents (Hugging Face)
- `agent.save(dir)` writes `agent.json`, `prompt.yaml` (older: `prompts.yaml`), `tools/<name>.py`, `managed_agents/` (sub-agents), `requirements.txt`, `app.py`; `push_to_hub`; `from_folder`/`from_dict` load. Source: https://huggingface.co/docs/smolagents/reference/agents.md (MEDIUM; restore of managed agents unverified).
- Multi-agent via managed_agents (manager/worker). Code-generating agents execute Python: never load in catalog. Runnable: external (HF Space) or not runnable.

### 9. LlamaIndex
- AgentWorkflow: declare agents, `can_handoff_to` controls handoff graph (from a community answer, LOW); orchestrator pattern with sub-agents as tools. Code-only; llama-deploy (Workflows as microservices, Docker/K8s) 2024 announcement; current deploy config not verified. Sources: https://developers.llamaindex.ai/python/framework/understanding/agent/multi_agent/ ; https://llamaindex.ai/blog/introducing-llama-deploy-a-microservice-based-way-to-deploy-llamaindex-workflows
- Authors send: repo + manifest. Not ingestible from config.

### 10. Claude Agent SDK / Claude Code subagents / Agent Skills
- Subagent: Markdown with YAML frontmatter; required `name` (<=256 chars, no `:`), `description`; optional `tools` (comma string or list), `disallowedTools`, `model` (sonnet/opus/haiku/id/inherit), `permissionMode`, `maxTurns`, `skills`, `mcpServers`, `hooks`, `memory`, etc.; body = system prompt; files in `.claude/agents/` or plugin `agents/`. Claude Code silently skips files without name/description or bad frontmatter. Unrecognized fields ignored. Source: https://code.claude.com/docs/en/subagents
- Agent Skills (open spec): directory with `SKILL.md`; frontmatter `name` (<=64, lowercase/digits/hyphens, must match directory), `description` (<=1024), optional `license`, `compatibility` (<=500), `metadata` (string->string), `allowed-tools` (space separated, experimental); optional `scripts/`, `references/`, `assets/`; `skills-ref validate` exists. Source: https://agentskills.io/specification
- Skills are NOT agents: no LLM config, no inputs form; they are instructions packages loaded by a host agent. Subagents map well to Agent (body -> systemPrompt, tools -> toolNames, model -> llm.name; `model: inherit/sonnet` is an alias not a real id).
- Runnable: skills = not runnable standalone (could run via a host); subagents = external/not runnable. Multi-agent: orchestrator = main agent delegating to subagents in the same folder (topology implicit: no explicit edges).

### 11. MCP servers (and MCP-based agents)
- Official registry `server.json`: unique reverse-DNS `name` (e.g. `io.github.user/server-name`), where to find it (npm/PyPI/Docker package or remote URL), execution args/env vars, description, capabilities. Registry is in preview; only public servers; schema at github.com/modelcontextprotocol/registry (docs/reference/server-json/draft/server.schema.json). Source: https://modelcontextprotocol.io/registry/about
- Oracle AgentSpec references MCP via MCPTool/MCPToolBox (so an agent that *uses* an MCP server is expressible; an MCP server as a catalog item is a different thing).
- Distinguish two catalog types: (a) mcp-server (the product: tools exposed, transport, package) and (b) an agent that consumes MCP servers (ordinary Agent with toolboxes).
- Reference projects (read-only skim of README.md only): `mcp-gen-comparison` benchmarks generation strategies ("arms") that all emit FastMCP Python stdio servers wrapping an HTTP catalog API, graded by a shared harness; `mcp-gen-comparison-2` compares a FastMCP+GSD-built server (`stk-mcp`, 2 tools) with a raw JSON-RPC server (5 tools) over a local tabular catalog. Takeaways for the catalog: generated MCP servers are Python/FastMCP stdio, need an env-configured data source (credentials, local data file), and are testable as black boxes by tool name/args. This supports: Try It Out = external or "not runnable" for MCP servers unless Phase 15 platform scoring is used; intake must ask for a test-dataset note (synthetic), never real data. No `.env`, key or data files were read.
- Authors send: repo link + `server.json` (if published) + tool list (can be auto-extracted only by running the server: not done in the catalog; so author lists tools in manifest).

### 12. A2A (Agent2Agent protocol)
- Agent Card: JSON metadata published by an A2A server: identity, capabilities (`streaming`, `pushNotifications`, `extendedAgentCard`), skills (AgentSkill), interfaces (AgentInterface), provider, security schemes, optional signature. Latest spec 1.0.0 (earlier 0.3.0, 0.2.6, 0.1.0); `A2A-Version` header; exact field tables and well-known path were NOT read (specification page truncated). Source: https://a2a-protocol.org/latest/specification/
- A2A is a wire protocol for talking to a remote agent, hence the natural "external" runnable type: the catalog entry is an Agent Card plus endpoint. Oracle `A2AAgent` references it. Treat `kind: external-agent`.

### 13. Workflow/low-code agents (n8n, Flowise, Dify)
- n8n: workflows are JSON, export/import via UI; credentials referenced by name and ID but not exported; HTTP nodes imported from cURL may embed auth headers (strip before sharing); newer-version JSON may fail on older installs. Source: https://docs.n8n.io/build/manage-workflows/export-and-import
- Flowise Agentflow V2: 14 node types (Start, LLM, Agent, Tool, Retriever, HTTP, Condition, Condition Agent, Iteration, Loop, Human Input, Direct Reply, Custom Function, Execute Flow); supervisor/worker pattern; Flow State. Export format NOT verified. Source: https://docs.flowiseai.com/using-flowise/agentflowv2
- Dify: DSL is YAML; export excludes third-party tool API keys, knowledge-base content, logs; Secret-type env vars optionally included on export (warn authors to say no); import checks DSL version. Extension not confirmed. Source: https://docs.dify.ai/en/use-dify/workspace/app-management
- Catalog value: show kind=workflow with node-type counts only if cheap; otherwise manifest-only. Never ingest or display raw export JSON without a secret scan (credentials, headers, tokens). Runnable: external (hosted n8n/Flowise/Dify instance) or not runnable.

## Mapping vs AgentSpec (summary)

| Format | Express natively in AgentSpec | Gap / lossy | Direction |
|--------|------------------------------|-------------|-----------|
| AgentSpec Agent | all | none | existing adapter |
| AgentSpec Swarm / ManagerWorkers / Flow / A2AAgent | native | AgentRecord has no members/topology; Zod rejects | extend adapter (rank 1) |
| Claude subagent .md | Agent (prompt, tools, model) | model aliases, hooks, permission modes, memory | detector |
| SKILL.md | none (not an agent) | whole concept | new kind=skill |
| CrewAI | Agent + ManagerWorkers/Flow | backstory/role/goal merge, tasks | detector (config only) |
| ADK root_agent.yaml | Agent + sub_agents tree | handoff semantics, Gemini-only config | detector |
| MAF declarative YAML | Agent | expression syntax, connection | detector |
| Pydantic AI spec | Agent | capabilities, templates | detector (low priority) |
| LangGraph | none in config | topology in code | manifest only |
| OpenAI Agents SDK, LlamaIndex, SK, AutoGen code | none in config | code-only | manifest only |
| MCP server.json | not an agent; MCPToolBox covers consumption | server identity, package | new kind=mcp-server |
| A2A Agent Card | A2AAgent (remote) | skills list, interfaces | kind=external-agent |
| n8n/Flowise/Dify | Flow (loosely) | node semantics | manifest only (v1) |

## Proposed Taxonomy

Two orthogonal axes, so the catalog stays technology agnostic:

1. **kind** (what it is; drives UI): `agent` (single), `system` (multi-agent), `workflow` (graph/low-code pipeline), `skill` (prompt/instruction package), `mcp-server` (tool provider), `external-agent` (remote, protocol-addressed).
2. **topology** (only for `system`/`workflow`): `swarm` (peer handoff), `manager-workers` (hierarchical), `pipeline` (sequential), `graph` (arbitrary flow), `group-chat` (selector/round-robin), `unknown`.
3. **framework** (free string + known-values list for filters/icons): `oracle-agentspec`, `langgraph`, `crewai`, `autogen`, `ag2`, `ms-agent-framework`, `openai-agents`, `google-adk`, `semantic-kernel`, `llamaindex`, `pydantic-ai`, `smolagents`, `claude-agent-sdk`, `claude-skill`, `mcp`, `a2a`, `n8n`, `flowise`, `dify`, `other`.

Rationale: framework is metadata for filtering, kind is behaviour. A CrewAI crew and an AgentSpec Swarm are both `kind: system`.

## Capability Matrix (draft)

Columns: AgentSpec native = expressible today in the adapter; Needs ext = needs canonical/adapter change; Library stores/displays; Try It Out.

| Type / format | AgentSpec native (today) | Needs extension | Library must store/display | Try It Out |
|---------------|--------------------------|-----------------|----------------------------|------------|
| Single agent, AgentSpec | prompt, llm, tools (names), inputs, HITL | tool detail (descriptions) optional | as today | runnable (via DB flag) |
| Single agent, Claude subagent | prompt, tools, model | model alias handling | as above + framework badge | external/none |
| Single agent, ADK / MAF / Pydantic AI | prompt, model, tools | per-format adapter | as above | external/none |
| Multi-agent: AgentSpec Swarm | spec yes, record no | kind, members, topology, handoff | member cards, handoff graph | external (or runnable if all members runnable: out of scope) |
| Multi-agent: ManagerWorkers (AgentSpec, CrewAI hierarchical, ADK sub_agents, smolagents) | spec yes (AgentSpec) | members with roles (manager/worker) | tree view | external |
| Pipeline / Flow (AgentSpec Flow, CrewAI sequential, n8n, Flowise, Dify) | Flow yes in spec | topology=pipeline/graph, ordered members | ordered steps | external/none |
| Group chat (AutoGen, SK) | no | topology=group-chat | participants list | none |
| Framework-native code-only (LangGraph, OpenAI Agents, LlamaIndex) | no | manifest fields | repo link, framework, declared members | external/none |
| Skill package (SKILL.md) | no | kind=skill, files list | name, description, allowed-tools, bundled scripts flag, compatibility | not runnable |
| MCP server | MCPToolBox (consumer side only) | kind=mcp-server, transport, package, tools | tool list, install snippet, required env var NAMES (not values), data source note | external; Phase 15 black-box scoring later |
| Agent that uses MCP servers | toolboxes (adapter ignores today) | list MCP servers used | "uses" links | per underlying agent |
| A2A external agent | A2AAgent | kind=external-agent, endpoint, card | skills from card, endpoint URL, auth scheme names | external |

## Intake Needs (for docs/agent-intake-guide.md)

Answer to "do you need config files or the GitHub repo?": **The repo link is the default and enough to start; add a `catalog.yaml` (or fill the form) so we can list it; send config files directly only when there is no repo or the repo is private.** Reasons: topology of LangGraph, OpenAI Agents, LlamaIndex, SK lives in code; declarative formats (AgentSpec, CrewAI, ADK, MAF, Claude subagent, SKILL.md) can be read from the repo.

Minimum metadata (maps to existing fields): name, one-paragraph description (summary), category, tags, maturity (production|beta|experimental), repo URL (githubUrl), framework, kind, license, contact/owner, what inputs it expects, what outputs it produces, LLM/model dependency, required tools/MCP servers, human-in-the-loop yes/no. For systems: list of member agents with role, and topology type. For MCP servers: transport, package/install, tool names, required env var names, data-source description.

Test-dataset notes: say what kind of data is needed, where a synthetic sample lives in the repo, and confirm no customer or personal data is included; never send keys or `.env`.

Readiness checklist (draft): license present; README with run instructions; pinned dependencies; example input/output; no secrets in repo history or in exported workflow JSON (n8n/Dify/Flowise: credentials stripped); descriptions written for a non-technical reader; maturity stated; owner contact; for systems, member list and topology stated; for skills, `name` matches directory and `skills-ref validate` passes; for Claude subagents, `name`+`description` present.

Ready-to-send reply template (draft, plain, synthetic):

> Thanks for offering your agent. The simplest thing is a link to the GitHub repository; we do not need the config files separately unless the repo is private. Please also add a short `catalog.yaml` to the repo root (or reply with the answers below): name, one-paragraph description, category and tags, maturity (production/beta/experimental), framework (for example LangGraph, CrewAI, AgentSpec), whether it is a single agent or a multi-agent system (and, if multi-agent, the member agents and how they cooperate), the inputs it needs and outputs it gives, required tools or MCP servers, license, and a contact. If it needs example data, please point to a small synthetic sample and confirm that no customer data, keys or `.env` files are in the repo. If you export a workflow (n8n, Flowise, Dify), please remove credentials before sending.

(Phase 12 doc should keep this under ~120 words in final form.)

## Candidate Canonical-Model Changes (additive, flagged; each with revert)

All fields nullable/defaulted; flag e.g. `AGENT_KINDS=on` (default off). With flag off, adapter keeps `z.literal('Agent')` and ignores new columns.

1. `kind: 'agent'|'system'|'workflow'|'skill'|'mcp-server'|'external-agent'` default `'agent'`. DB: `kind text not null default 'agent'`. Revert: drop column / ignore (SQLite ALTER ADD COLUMN is additive; revert = stop reading it).
2. `framework: string | null`. DB `framework text null`. Free string; known list lives in code for filter labels.
3. `topology: string | null` (enum above). DB text null.
4. `members: AgentMember[]` where `AgentMember = { ref: string (slug or local id), name, role: 'manager'|'worker'|'peer'|'step'|'participant', description: string|null, slug: string|null }`. DB `members text not null default '[]'` JSON. A system's members may be inline (not separate catalog rows) or link to existing slugs; inline first (simpler, no FK).
5. `edges: {from,to,kind}[] | null` (handoff/delegates/sequence). Optional; DB JSON text. Defer if schedule is tight; `members` ordered list plus `topology` covers 80%.
6. `sourceFormat: string | null` (e.g. `oracle-agentspec@26.1`, `crewai-jsonc`, `manifest`), for adapter traceability. DB text null.
7. `extras: Record<string, unknown>` (raw unknown fields preserved, size-capped) DB JSON text default `'{}'`. Satisfies Phase 13 criterion 5 (unknown fields preserved, not dropped). Security: never rendered as HTML, size-capped, secret-scanned.
8. `mcp: { transport, package, toolNames[], envVarNames[] } | null` for kind=mcp-server only (or fold into `extras` v1 to stay minimal; recommend `extras` in v1, promote later).
9. `tryItOut*` unchanged (D-05/D-06/D-07 keep it DB-only). The matrix suitability is a recommendation for the DB value, not an ingest-derived field. For kinds other than `agent`, default mode `none`/`external` only; `runnable` stays restricted to single agents.

Do NOT change: slug as PK; existing column names; embeddings pipeline (extend searchable text with kind/framework/member names only behind the flag so existing hashes do not churn with flag off).

Adapter interface suggestion: `detect(files) -> {format, confidence}` plus `parse(file) -> {record | partial, missingFromAuthor[], unknownFields}`; registry ordered by confidence; unknown format returns `partial` with manifest-required list, never throws (matches Phase 13 criterion 3).

## Ranked Adapter List

| Rank | Adapter | Why | Cost | Trade-off |
|------|---------|-----|------|-----------|
| 1 | Oracle AgentSpec Swarm / ManagerWorkers / Flow / A2AAgent (extend existing) | Canonical format, native topology, zero new format risk | Low | Need real fixtures to confirm `$component_ref` YAML and relationships shape |
| 2 | `catalog.yaml` manifest (universal) | Covers all code-only frameworks and non-declarative types; answers intake question | Low | Author-asserted; can drift from code |
| 3 | SKILL.md and Claude subagent .md | Simple frontmatter, stable open spec, likely relevant to AIC authors using Claude tooling | Low | Skill is not an agent, needs kind=skill UI |
| 4 | CrewAI (crew.jsonc/agents/*.json and config/*.yaml) | Widely used, topology derivable from config | Medium | Two config styles; must never execute `custom:`/`python` refs |
| 5 | MCP server.json | Ties into Phases 14-15, official registry format | Low | Registry in preview; draft schema may change |
| 6 | langgraph.json (detector only) | Very popular; extract graph ids/deps/entrypoints | Low | Little info; topology invisible |
| 7 | Google ADK root_agent.yaml; MS Agent Framework declarative YAML; Pydantic AI spec | Declarative, growing; sub_agents derivable (ADK) | Medium | Experimental/preview formats; churn |
| 8 | A2A Agent Card | External-agent listing | Low | Field tables unverified; spec 1.0 new |
| 9 | AutoGen dump_component JSON | Maintenance-mode project; community only | Medium | Dying format; tools not serializable |
| 10 | n8n/Flowise/Dify exports | Popular with non-developers | High | Secret leakage risk; undocumented/unstable shapes |
| - | OpenAI Agents SDK, LlamaIndex, SK, smolagents | Code-only/executable | - | Manifest only (rank 2) |

## Architecture Patterns

### Recommended Structure for Phase 13 (informational)
```
src/lib/spec/
├── types.ts                 # AgentRecord + optional kind/framework/topology/members (flag-gated reads)
├── oracle-agentspec.ts      # existing; keep single-agent path byte-identical when flag off
├── oracle-systems.ts        # Swarm/ManagerWorkers/Flow/A2AAgent (flag on)
├── formats/                 # one file per detector: skill.ts, claude-subagent.ts, crewai.ts, mcp-server-json.ts, manifest.ts ...
└── registry.ts              # detect/parse ordering, never throws
scripts/validate-submission.ts
```

Pattern: discriminated-union Zod on `component_type` for AgentSpec; per-format "detect then parse" with `partial` results carrying `missingFromAuthor`. Unknown fields go to `extras`.

### Anti-Patterns to Avoid
- Executing or importing author code (CrewAI `custom:`, AutoGen `load_component`, smolagents tools, `.py` entrypoints). Parse text only.
- Converting every framework into a fake AgentSpec Agent (lossy; hides topology). Preserve kind and members.
- Deriving `try_it_out` from ingested files (violates D-05..D-07).
- Treating a Skill as an Agent.
- Displaying raw workflow exports or `extras` without a secret scan.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SKILL.md validation | custom name/description rules | Mirror https://agentskills.io/specification limits (64/1024/500) and suggest `skills-ref validate` to authors | Spec is authoritative |
| Framework-to-framework conversion | converters between LangGraph/CrewAI/etc. | Oracle pyagentspec adapters on the author's side (optional) | Catalog should only read |
| YAML/frontmatter parsing | new parser | existing YAML dependency | no new deps |
| Secret detection in exports | ad hoc regexes per format | one small shared denylist scan (keys like `api_key`, `authorization`, `bearer`, `password`, `token`, `sk-`) in validate-submission | consistent, testable |

## Common Pitfalls

### Pitfall 1: Zod literal rejects systems silently
`component_type: z.literal('Agent')` makes Swarm files fail validation (a 'malformed' count). Warning sign: ingest of a Swarm fixture reports errors, not skipped. Avoid: discriminated union behind flag.

### Pitfall 2: Metadata convention only exists on Agent
`category`, `tags`, `github_url` come from `metadata`; on Swarm/ManagerWorkers roots `metadata` must carry them too. Document in intake guide; validate-submission should report "missing from author".

### Pitfall 3: Spec inconsistency `type` vs `component_type`
The AgentSpec page uses both. Accept both in the discriminator and test with a real pyagentspec-exported fixture.

### Pitfall 4: Secrets in submissions
n8n/Dify/Flowise exports and `.env` in repos. Intake guide must say remove credentials; validator scans.

### Pitfall 5: Experimental formats churn (ADK config, MAF declarative Python loader, Pydantic AI spec, MCP registry preview)
Pin the version in `sourceFormat`, make adapters tolerant (unknown fields -> extras), and rank them below stable ones.

### Pitfall 6: Model aliases (`inherit`, `sonnet`) are not model ids
Store as-is in `llm.name` and display "alias"; never feed into Try It Out.

### Pitfall 7: Embedding hash churn
Adding kind/framework/members to searchable text changes hashes and triggers re-embed of all rows; gate behind the flag.

### Pitfall 8: Search/filters assume single agents
FilterBar, AgentCard, RelatedAgents, detail page need `kind` awareness (badge); keep defaults so flag-off UI is unchanged.

### Pitfall 9 (R-9): Invented or real data
Fixtures and doc examples must be synthetic (e.g., "Acme" style placeholders, fake tool names); never copy from the two reference repos' fixtures or data.

## Code Examples

Synthetic, illustrative manifest (proposed, not an external standard):
```yaml
# catalog.yaml (proposed AIC intake manifest; all values synthetic)
kind: system            # agent | system | workflow | skill | mcp-server | external-agent
framework: crewai
topology: manager-workers
name: Example Scope Review Crew
description: Reviews a project scope document and drafts a checklist.
category: project-management
tags: [review, checklist]
maturity: beta
repo: https://github.com/example-org/example-crew
license: Apache-2.0
members:
  - { name: Manager, role: manager, description: Splits the scope into topics }
  - { name: Reviewer, role: worker, description: Checks one topic against criteria }
inputs:
  - { key: scope_text, label: Scope text, type: textarea, required: true }
tools: [read_document]
mcp_servers: []
test_data: "Synthetic sample at samples/scope.md; contains no customer data."
```

Existing adapter touchpoint (verified in repo): `fromOracleAgentSpec` in `src/lib/spec/oracle-agentspec.ts`, `flattenRecord` in `scripts/ingest.ts`, columns in `drizzle/schema.ts`.

## State of the Art

| Old | Current | When | Impact |
|-----|---------|------|--------|
| AutoGen v0.4 as MS multi-agent framework | AutoGen maintenance mode; Microsoft Agent Framework (reported GA 1.0, 2026-04-02) | 2026 | Rank AutoGen adapter low; MAF declarative higher |
| SK AgentGroupChat | GroupChatOrchestration, then MAF | 2025-2026 | SK not worth an adapter |
| Vendor-specific prompt files | Agent Skills open spec (agentskills.io) and Claude subagent frontmatter | 2025-2026 | SKILL.md detector is cheap and durable |
| Ad hoc agent discovery | A2A 1.0.0 Agent Card; MCP Registry server.json (preview) | 2026 | Both are metadata-first and fit a catalog |
| CrewAI YAML only | JSONC project (`crew.jsonc`, `agents/*.jsonc`) recommended for new projects; classic YAML remains | current docs | Support both |

## Open Questions

1. Exact YAML shape of Swarm `relationships` and `$component_ref` in YAML.
   - Known: JSON form and field names. Unknown: YAML example and tuple form.
   - Recommendation: Phase 13 task 0: obtain one pyagentspec-exported fixture offline (read the GitHub repo docs) before writing the adapter; otherwise write tolerant parser that treats `relationships` as opaque and stores in `extras`.
2. Should system members be separate catalog rows (own slug/detail page) or inline only? Recommend inline v1 with optional `slug` link; human decision.
3. Is `catalog.yaml` an acceptable AIC convention, or should authors fill a web form? (Product decision for Ville.)
4. A2A Agent Card exact fields and well-known path; Flowise export shape; Dify file extension; LlamaIndex deploy config; AutoGen Studio JSON; MAF workflow YAML official status: unverified, only matter if those adapters are promoted.
5. Which frameworks do AIC authors actually use? Ranking should be re-weighted by a quick survey of the 100+ agents; unknown to this research.
6. Should Try It Out ever run systems? Recommend no in v1 (kind != agent means `none` or `external`); human decision.

## Risks

- R-1 Format churn (experimental/preview formats) - mitigate with tolerant adapters, `sourceFormat`.
- R-2 Spec inconsistencies in AgentSpec docs - fixtures first.
- R-3 Author-asserted manifests drift - validate-submission re-checks against repo files where declarative.
- R-4 Security: arbitrary code in configs, secrets in exports, SSRF if A2A/endpoint URLs are fetched - do not fetch author URLs at ingest; render links with `rel=noopener`; no HTML in `extras`.
- R-5 Scope creep into running systems - keep Try It Out flag restricted.
- R-6 Flag-off regressions via schema/embedding changes - additive columns with defaults only; embedding text unchanged when off; run existing tests with flag off in CI.
- R-7 Source quality: several findings rely on search-result summaries or third-party blogs (MAF workflow status, Pydantic AI, smolagents, LlamaIndex can_handoff_to); marked MEDIUM/LOW above.
- R-8 Docs truncated (Oracle and A2A pages >250k chars; only first 100k read).
- R-9 Data hygiene: synthetic only.

## Validation Architecture

Phase 12 produces docs only; validation is document checks, not code tests.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (existing, `vitest.config.ts`) for repo suite; shell checks for docs |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run --reporter=dot` (sanity only; no code changes expected) |
| Full suite command | `npm test` (as defined in package.json) |

### Phase Requirements -> Test Map
| Req | Behavior | Test Type | Automated Command | File Exists? |
|-----|----------|-----------|-------------------|-------------|
| SC-1 | docs/agent-types.md lists single, multi-agent (swarm, manager/worker, pipeline), workflow, skill, MCP, framework-native | grep | `grep -ciE "swarm\|manager\|pipeline\|workflow\|skill\|mcp\|langgraph\|crewai\|autogen" docs/agent-types.md` and each term >= 1 | Wave 0 (doc to create) |
| SC-2 | Matrix has the 4 columns and runnable/external/not runnable values | grep | `grep -E "runnable\|external" docs/agent-types.md` | Wave 0 |
| SC-3 | Intake guide has checklist and reply template | grep | `grep -ciE "checklist\|repo\|catalog.yaml" docs/agent-intake-guide.md` | Wave 0 |
| SC-4 | Decision memo with ranked adapters, open questions | grep | `ls docs/*decision*memo* ; grep -c "Open questions"` | Wave 0 |
| SC-5 | No real data | manual review + grep for `.env`, key patterns, reference-repo fixture names | `grep -rniE "sk-[a-z0-9]{10}\|api[_-]?key=\|LVI_API_KEY" docs/` returns nothing | Wave 0 |

### Sampling Rate
- Per task commit: grep checks above on changed file
- Per wave merge: `npm test` (confirm no accidental code change; `git diff --stat` shows only docs/ and .planning/)
- Phase gate: all greps pass plus `git diff --name-only main... | grep -v '^docs/\|^.planning/'` empty

### Wave 0 Gaps
- [ ] `docs/agent-types.md`, `docs/agent-intake-guide.md`, decision memo (suggest `docs/agent-types-decision-memo.md`) do not exist
- No framework install needed

## Sources

### Primary (HIGH)
- Oracle Agent Spec language spec (nightly and 26.1.0): https://oracle.github.io/agent-spec/development/agentspec/language_spec_nightly.html , https://oracle.github.io/agent-spec/26.1.0/agentspec/language_spec_26_1_0.html
- Agent Skills specification: https://agentskills.io/specification
- Claude Code subagents: https://code.claude.com/docs/en/subagents
- LangGraph application structure: https://docs.langchain.com/langsmith/application-structure
- CrewAI crews: https://docs.crewai.com/en/concepts/crews
- AutoGen serialization: https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/serialize-components.html
- Google ADK Agent Config: https://adk.dev/agents/config/
- OpenAI Agents SDK handoffs: https://openai.github.io/openai-agents-python/handoffs/
- Microsoft Agent Framework declarative agents: https://learn.microsoft.com/en-gb/agent-framework/agents/declarative
- MCP Registry: https://modelcontextprotocol.io/registry/about
- A2A specification: https://a2a-protocol.org/latest/specification/ (partial read)
- Repo code: `src/lib/spec/types.ts`, `src/lib/spec/oracle-agentspec.ts`, `scripts/ingest.ts`, `drizzle/schema.ts`, `src/lib/tryItOut.ts`

### Secondary (MEDIUM)
- Open Agent Specification paper: https://arxiv.org/html/2510.04173v3 ; Oracle blog https://blogs.oracle.com/ai-and-datascience/introducing-open-agent-specification
- AutoGen status: https://github.com/microsoft/autogen ; https://atlan.com/know/ai-agent/what-is-autogen/
- Pydantic AI agent spec: https://pydantic.dev/docs/ai/core-concepts/agent-spec/
- smolagents: https://huggingface.co/docs/smolagents/reference/agents.md
- n8n export/import: https://docs.n8n.io/build/manage-workflows/export-and-import ; Flowise: https://docs.flowiseai.com/using-flowise/agentflowv2 ; Dify: https://docs.dify.ai/en/use-dify/workspace/app-management
- SK migration: https://learn.microsoft.com/he-il/semantic-kernel/support/migration/group-chat-orchestration-migration-guide
- LlamaIndex multi-agent: https://developers.llamaindex.ai/python/framework/understanding/agent/multi_agent/

### Tertiary (LOW)
- MAF declarative workflow status: https://startdebugging.net/2026/08/agent-framework-declarative-yaml-vs-code-first-orchestration/
- LlamaIndex `can_handoff_to`: community forum answer (https://community.llamaindex.ai/troubleshooting-handoff-issues-in-llamaindex-Mv2JvsPDTnHc)
- Local read-only: README.md of ~/projects/mcp-gen-comparison and ~/projects/mcp-gen-comparison-2 (top of file only)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH (no new deps; existing patterns verified in code)
- Architecture: MEDIUM (design proposal; adapter details for AgentSpec YAML unverified)
- Pitfalls: MEDIUM-HIGH (code-grounded plus documented format caveats)
- Per-format facts: see per-format confidence notes

**Research date:** 2026-10-12
**Valid until:** ~14 days for ADK/MAF/Pydantic AI/MCP registry/A2A (fast-moving); ~30 days for AgentSpec, Skills, CrewAI, LangGraph
