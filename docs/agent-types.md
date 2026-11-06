# Agent types and formats: taxonomy and per-format findings

Purpose: give the catalog a technology-agnostic vocabulary for "what kind of agent is this" and record, per framework or file format, what an author's config looks like, what can be read from it, and what cannot.

Audience: maintainers and the Phase 13 implementer.

Research date: all web sources were accessed 2026-10-12.

Status: research output, not implemented. Formats move fast. Findings for Google ADK, Microsoft Agent Framework (MAF), Pydantic AI, the MCP registry and A2A are valid for about 14 days. Findings for Oracle AgentSpec, Agent Skills, CrewAI and LangGraph are valid for about 30 days. Re-check before building an adapter after that.

Related documents:

- [Capability matrix](agent-capability-matrix.md): per type, what AgentSpec expresses today, what needs extension, what the library must store and display, and Try It Out suitability.
- [Author intake guide](agent-intake-guide.md): what authors should send.
- [Decision memo](agent-hosting-decision-memo.md): recommended canonical-model changes, ranked adapters, open questions.

Confidence labels used below: HIGH (two or more official pages agree, or verified in repo code), MEDIUM (one official page, or third-party sources), LOW (search summaries, community answers, or not confirmed). Anything marked "unverified" was not confirmed and must not be treated as fact.

## 1. Taxonomy

The catalog classifies an entry along three orthogonal axes. Keeping them separate is what keeps the platform technology agnostic.

### 1.1 Axis one: kind (what it is, drives the UI)

| kind | What it is | What it drives in the UI |
|------|------------|--------------------------|
| `agent` | A single agent: one prompt, one model, some tools. | Today's card and detail page. Try It Out may be `runnable`. |
| `system` | A multi-agent system: several cooperating agents. | Members list, topology label, no inline run. |
| `workflow` | A graph or low-code pipeline (n8n, Flowise, Dify, AgentSpec Flow). | Ordered steps or node summary, link out. |
| `skill` | A prompt or instruction package loaded by a host agent (SKILL.md). Not an agent. | Skill badge, description, allowed tools, bundled-scripts flag. Not runnable. |
| `mcp-server` | A tool provider speaking the Model Context Protocol. A product, not an agent. | Transport, install snippet, tool list, required env var names. |
| `external-agent` | A remote agent addressed by protocol (A2A Agent Card plus endpoint). | Endpoint, skills from the card, auth scheme names. Link out. |

### 1.2 Axis two: topology (only for `system` and `workflow`)

| topology | Meaning | Typical sources |
|----------|---------|-----------------|
| `swarm` | Peer agents handing control to one another. | AgentSpec Swarm, OpenAI Agents SDK handoffs |
| `manager-workers` | A manager delegates to workers (hierarchical). | AgentSpec ManagerWorkers, CrewAI hierarchical, ADK `sub_agents`, smolagents `managed_agents` |
| `pipeline` | Sequential steps. | CrewAI sequential, AgentSpec Flow, n8n |
| `graph` | Arbitrary control-flow graph. | AgentSpec Flow, LangGraph, Flowise, Dify |
| `group-chat` | Selector or round-robin conversation among participants. | AutoGen teams, Semantic Kernel group chat |
| `unknown` | Multi-agent but the topology could not be determined. | Code-only frameworks without a manifest |

### 1.3 Axis three: framework (metadata for filtering)

A free string with a known-value list used for filter labels and icons: `oracle-agentspec`, `langgraph`, `crewai`, `autogen`, `ag2`, `ms-agent-framework`, `openai-agents`, `google-adk`, `semantic-kernel`, `llamaindex`, `pydantic-ai`, `smolagents`, `claude-agent-sdk`, `claude-skill`, `mcp`, `a2a`, `n8n`, `flowise`, `dify`, `other`.

### 1.4 Rationale

Framework is metadata for filtering; kind is behaviour. A CrewAI crew and an AgentSpec Swarm are both `kind: system`, so the UI treats them the same way and only the framework badge differs.

### 1.5 Coverage of the types the roadmap asks for

- Single agents: `kind: agent` (AgentSpec Agent, Claude subagent, ADK LlmAgent, MAF declarative agent, Pydantic AI agent).
- Multi-agent systems: `kind: system` with topology `swarm`, `manager-workers`, `pipeline` or `group-chat`.
- Workflow agents: `kind: workflow` (graph or low-code flows).
- Skill and prompt packages: `kind: skill`.
- MCP-based agents. Two different things must not be confused:
  - an `mcp-server` is a product that exposes tools; it is a catalog item of its own kind;
  - an agent that consumes MCP servers is an ordinary `agent` (or `system`) that lists the servers it uses (AgentSpec expresses this with MCPTool and MCPToolBox).
- Framework-native agents (LangGraph, CrewAI, AutoGen and others): any kind, with the framework axis set; often code-only, in which case a manifest supplies the facts.

## 2. Security rule for all formats

The catalog parses text only. It never executes, imports or loads author code, and it does not fetch author-supplied URLs at ingest. Several formats can run code on load (CrewAI `custom:` tools and `{"python": ...}` references, AutoGen `load_component`, smolagents tools, `.py` entry points). Raw workflow exports (n8n, Flowise, Dify) can contain credentials and must be secret-scanned before display. `.env` files are never accepted.

## 3. Per-format findings

Runnable-ness legend (see the [capability matrix](agent-capability-matrix.md)): `runnable` means the catalog could run it in Try It Out (today only the single-agent pi-runner / OpenAI-compatible flow exists, see `src/lib/tryItOut.ts` and `docs/job-api-contract.md`); `external` means link out to an author-hosted demo or repo; `not runnable` means display only.

### 3.1 Oracle Open Agent Spec (AgentSpec), the canonical format (confidence HIGH on component list and field names)

- Config shape: JSON or YAML. Every component has `id`, `name`, `description`, `metadata`. The type discriminator is `component_type` in the examples, but the base-definition text on the spec page says `type`. The spec page is inconsistent; treat `component_type` as what current repo fixtures use and tolerate `type`. References use `{"$component_ref": "<id>"}`; duplicate ids are invalid; specs must not contain executable code. Nightly docs are 26.2.0.dev1; the latest release referenced is 26.1.0.
- Component types: Agent (system_prompt, llm_config, tools, toolboxes, human_in_the_loop, transforms), SpecializedAgent, Flow (`start_node`, `nodes`, `control_flow_connections`, `data_flow_connections`; node types include LLMNode, APINode, AgentNode, FlowNode, MapNode, ParallelMapNode, ParallelFlowNode, BranchingNode, ToolNode, CatchExceptionNode), Swarm (`first_agent`, `relationships`, `handoff` = never | optional | always), ManagerWorkers (`group_manager`, `workers`; workers cannot talk to the user), tools (ServerTool, ClientTool, RemoteTool, MCPTool, BuiltinTool; `requires_confirmation`), MCPToolBox (`client_transport`, `tool_filter`), A2AAgent (`agent_url`, `connection_config`, `session_parameters`), RemoteAgent, OciAgent.
- Files authors send: one YAML or JSON file, possibly with `$component_ref` for shared sub-components in the same file.
- Multi-agent: first-class (Swarm, ManagerWorkers, Flow with AgentNode). Topology is derivable from config.
- Runnable-ness: runnable through the WayFlow reference runtime or official adapters (LangGraph, AutoGen, CrewAI, Microsoft Agent Framework, OpenAI Agents), but the catalog hosts no runtime. Try It Out for systems is `external` or none.
- Caveat: `metadata.input_schema`, `category`, `github_url`, `maturity`, `tags`, `customizable` and `fixed` are AIC consortium conventions in `metadata`, not Oracle fields. Because `metadata` is free-form and present on every component, the same conventions can be placed on a Swarm, ManagerWorkers or Flow root.
- Unverified: only the first 100k of roughly 320k characters of each spec page were read. The exact YAML for `$component_ref` and the tuple shape of Swarm `relationships` are unverified; a real pyagentspec-exported fixture is needed in Phase 13.
- Sources (accessed 2026-10-12): https://oracle.github.io/agent-spec/development/agentspec/language_spec_nightly.html ; https://oracle.github.io/agent-spec/26.1.0/agentspec/language_spec_26_1_0.html ; https://arxiv.org/html/2510.04173v3 ; https://blogs.oracle.com/ai-and-datascience/introducing-open-agent-specification

### 3.2 LangGraph (HIGH)

- Config: `langgraph.json` with `graphs` (map of id to `./path/file.py:variable`), `dependencies`, `env`, optional `python_version` and `dockerfile_lines`. The project root also has `requirements.txt` or `pyproject.toml` (Python) or `package.json` (JS), and an optional `.env` (never to be sent).
- Topology (nodes, edges, supervisor or swarm patterns) lives in Python or TypeScript code, not in config. A catalog cannot derive members or edges from `langgraph.json`; it only lists entry-point graphs.
- Authors send: the repo (strongly preferred) or the zipped project folder, never `.env`.
- Runnable: `external` (LangGraph Server or Platform deployment) or `not runnable`. Oracle has a LangGraph adapter in both directions.
- Extractable: graph ids, dependency list, entry points. Everything else needs a manifest.
- Source (accessed 2026-10-12): https://docs.langchain.com/langsmith/application-structure

### 3.3 CrewAI (HIGH, with gaps)

- Config (current docs): a JSONC project with `crew.jsonc` or `crew.json`, `agents/<name>.jsonc|json`, and `tools/<name>.py` (referenced as `custom:<name>`). Classic style: `crew.py` (`@CrewBase`), `config/agents.yaml`, `config/tasks.yaml`. Agent fields: `role`, `goal`, `backstory`, `llm`, `tools`. Task fields: `name`, `description`, `expected_output`, `agent`, `context`, `output_file`. Process is sequential (default) or hierarchical (`manager_llm` or `manager_agent`).
- Multi-agent: always (a crew is a team). Topology is derivable from config: process type plus task-to-agent assignment plus `context` dependencies.
- Security: JSON crews can run local Python through `custom:` tools and `{"python": "module.attribute"}`. The catalog must parse but never load.
- Runnable: `external` or `not runnable`.
- Unverified: CrewAI Flows (the event-driven layer) were not documented on the fetched page.
- Mapping to AgentSpec: agent to Agent (role, goal and backstory compose into a system prompt, lossy); crew to ManagerWorkers (hierarchical) or Flow (sequential). Oracle has a CrewAI adapter.
- Source (accessed 2026-10-12): https://docs.crewai.com/en/concepts/crews

### 3.4 AutoGen, AG2, Microsoft Agent Framework and Semantic Kernel (MIXED: HIGH for AutoGen serialization, MEDIUM for MAF, LOW for MAF workflows)

- Status: AutoGen (microsoft/autogen) is in maintenance mode, community managed. Microsoft points to Microsoft Agent Framework, reported GA 1.0 on 2026-04-02 by third-party sources (MEDIUM). AG2 is a community fork by the original creators.
- AutoGen config: `dump_component()` JSON with `provider` (dotted import path), `component_type`, `version`, `component_version`, `description`, `config`, with nested components. Tool serialization is "not yet supported" and `selector_func` is not serializable. Loading can execute code ("only load trusted"). RoundRobinGroupChat is serializable (shown); Swarm, SelectorGroupChat and GraphFlow exist but the docs page showed no serialization example. Group chat topology (`group-chat`).
- Unverified: AutoGen Studio JSON format.
- Microsoft Agent Framework declarative agents: YAML or JSON with `kind: Prompt`, `name`, `displayName`, `description`, `instructions`, `model` (id, connection, options), `outputSchema`; `=Env.X` expressions. The Python loader is flagged experimental; declarative workflows are reported stable by third-party sources (LOW to MEDIUM, official status unverified).
- Semantic Kernel: AgentGroupChat is no longer maintained and was replaced by GroupChatOrchestration; SK is being folded into Agent Framework. A YAML spec for SK agents is not confirmed (unverified).
- Authors send: AutoGen = repo or the dumped JSON; MAF = the YAML file (plus workflow YAML). Runnable: `external` or `not runnable`.
- Oracle has adapters for AutoGen and Microsoft Agent Framework (per the AgentSpec docs sidebar).
- Sources (accessed 2026-10-12): https://github.com/microsoft/autogen ; https://atlan.com/know/ai-agent/what-is-autogen/ ; https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/serialize-components.html ; https://learn.microsoft.com/en-gb/agent-framework/agents/declarative ; https://startdebugging.net/2026/08/agent-framework-declarative-yaml-vs-code-first-orchestration/ (LOW) ; https://learn.microsoft.com/he-il/semantic-kernel/support/migration/group-chat-orchestration-migration-guide

### 3.5 OpenAI Agents SDK (HIGH on handoffs, no config format found)

- Code-only. Topology is expressed by `handoffs` (Agent instances or `handoff()` objects, exposed to the model as `transfer_to_<name>` tools) and `Agent.as_tool()` (agents as tools). No declarative config file was found.
- Authors send: a repo link. The catalog can only show manifest-supplied information. Oracle has an OpenAI Agents adapter, so an author could export an AgentSpec.
- Runnable: the current Try It Out backend speaks OpenAI-compatible models via pi-runner, but a hosted SDK app is `external`.
- Source (accessed 2026-10-12): https://openai.github.io/openai-agents-python/handoffs/

### 3.6 Google ADK (MEDIUM, experimental config)

- Agent Config (experimental): `root_agent.yaml` with `name`, `model`, `description`, `instruction`, optional `agent_class` (LlmAgent), `tools` (list of `name`), and `sub_agents` (list of `config_path` pointing to other YAML files). LangGraphAgent and A2aAgent are not yet supported in config; only Gemini models are supported in config; Python is required.
- ADK also has Sequential, Parallel and Loop agents in code; this was not verified on the config page, so do not assert they are expressible in YAML.
- Multi-agent: the `sub_agents` tree gives a manager/worker topology derivable from config. Runnable: `external`.
- Mapping: LlmAgent to Agent; `sub_agents` to ManagerWorkers or Swarm-like (lossy: no handoff semantics).
- Source (accessed 2026-10-12): https://adk.dev/agents/config/ (301 redirect from google.github.io/adk-docs)

### 3.7 Pydantic AI (MEDIUM)

- Agent specs: YAML or JSON loaded with `Agent.from_file` or `Agent.from_spec`; fields cover model, instructions and capabilities; template strings with `{{ }}` are filled from `deps`; custom capabilities need registration in Python. Known gap: custom OpenAI-compatible endpoints need Python.
- Source quality: based on search-result summaries; the pages were not fetched in full.
- Mostly single agent. Runnable: `external`. Mapping: close to Agent (model, instructions, tools via capabilities).
- Sources (accessed 2026-10-12): https://pydantic.dev/docs/ai/core-concepts/agent-spec/ ; https://github.com/pydantic/pydantic-ai/issues/5471

### 3.8 smolagents (Hugging Face) (MEDIUM)

- `agent.save(dir)` writes `agent.json`, `prompt.yaml` (older: `prompts.yaml`), `tools/<name>.py`, `managed_agents/` (sub-agents), `requirements.txt` and `app.py`. `push_to_hub`, `from_folder` and `from_dict` load it. Restore of managed agents is unverified.
- Multi-agent through `managed_agents` (manager/worker). Code-generating agents execute Python, so the catalog must never load them. Runnable: `external` (Hugging Face Space) or `not runnable`.
- Source (accessed 2026-10-12): https://huggingface.co/docs/smolagents/reference/agents.md

### 3.9 LlamaIndex (LOW for handoff config)

- AgentWorkflow: agents are declared in code and `can_handoff_to` controls the handoff graph (this comes from a community answer, LOW). An orchestrator pattern uses sub-agents as tools. Code-only. llama-deploy (Workflows as microservices on Docker or Kubernetes) was announced in 2024; the current deploy config is unverified.
- Authors send: repo plus manifest. Not ingestible from config.
- Sources (accessed 2026-10-12): https://developers.llamaindex.ai/python/framework/understanding/agent/multi_agent/ ; https://llamaindex.ai/blog/introducing-llama-deploy-a-microservice-based-way-to-deploy-llamaindex-workflows ; https://community.llamaindex.ai/troubleshooting-handoff-issues-in-llamaindex-Mv2JvsPDTnHc (LOW)

### 3.10 Claude subagents and Agent Skills (HIGH)

- Subagent: a Markdown file with YAML frontmatter. Required: `name` (at most 256 characters, no `:`) and `description`. Optional: `tools` (comma string or list), `disallowedTools`, `model` (sonnet, opus, haiku, a model id, or `inherit`), `permissionMode`, `maxTurns`, `skills`, `mcpServers`, `hooks`, `memory`, and others. The body is the system prompt. Files live in `.claude/agents/` or a plugin `agents/` directory. Claude Code silently skips files without name and description or with bad frontmatter, and ignores unrecognized fields. Source (accessed 2026-10-12): https://code.claude.com/docs/en/subagents
- Agent Skills (open spec): a directory with `SKILL.md`. Frontmatter: `name` (at most 64 characters, lowercase letters, digits and hyphens, must match the directory name), `description` (at most 1024), optional `license`, `compatibility` (at most 500), `metadata` (string to string), `allowed-tools` (space separated, experimental). Optional `scripts/`, `references/`, `assets/`. A `skills-ref validate` tool exists. Source (accessed 2026-10-12): https://agentskills.io/specification
- Skills are not agents: no LLM config and no inputs form; they are instruction packages loaded by a host agent. Subagents map well to Agent (body to system prompt, tools to tool names, model to llm name). `model: inherit` and `sonnet` are aliases, not real model ids, and must never feed Try It Out.
- Runnable: skills `not runnable` standalone (could run through a host); subagents `external` or `not runnable`. Multi-agent: an orchestrator main agent delegates to subagents in the same folder; topology is implicit, with no explicit edges.

### 3.11 MCP servers and MCP-based agents (HIGH on registry format, registry in preview)

- Official registry `server.json`: unique reverse-DNS `name` (for example `io.github.user/server-name`), where to find it (npm, PyPI or Docker package, or a remote URL), execution arguments and env vars, description, capabilities. The registry is in preview and lists only public servers. The schema is at github.com/modelcontextprotocol/registry (docs/reference/server-json/draft/server.schema.json); a draft schema may change.
- Two catalog types: (a) `mcp-server` (the product: tools exposed, transport, package) and (b) an agent that consumes MCP servers (ordinary Agent with toolboxes; AgentSpec MCPTool and MCPToolBox express this, but the current adapter ignores toolboxes).
- Local reference projects (takeaways only): generated MCP servers are Python and FastMCP stdio servers, need an environment-configured data source (credentials, a local data file), and are testable as black boxes by tool name and arguments. This supports Try It Out being `external` or `not runnable` for MCP servers, and intake asking for a synthetic test-dataset note, never real data.
- Authors send: a repo link, `server.json` if published, and an author-written tool list. Tools can be auto-extracted only by running the server, which the catalog does not do, so the author lists tools in the manifest.
- Source (accessed 2026-10-12): https://modelcontextprotocol.io/registry/about

### 3.12 A2A (Agent2Agent protocol) (MEDIUM, partly read)

- An Agent Card is JSON metadata published by an A2A server: identity, capabilities (`streaming`, `pushNotifications`, `extendedAgentCard`), skills (AgentSkill), interfaces (AgentInterface), provider, security schemes, optional signature. The latest spec is 1.0.0 (earlier 0.3.0, 0.2.6, 0.1.0); there is an `A2A-Version` header.
- Unverified: the exact field tables and the well-known path were not read (the specification page was truncated; only the first ~100k characters were read).
- A2A is a wire protocol for talking to a remote agent, so it is the natural `external` type: a catalog entry is an Agent Card plus an endpoint. Oracle `A2AAgent` references it. Treat as `kind: external-agent`.
- Source (accessed 2026-10-12): https://a2a-protocol.org/latest/specification/

### 3.13 Workflow and low-code agents: n8n, Flowise, Dify (n8n and Dify MEDIUM, Flowise export LOW)

- n8n: workflows are JSON, exported and imported through the UI. Credentials are referenced by name and id but not exported. HTTP nodes imported from cURL may embed auth headers (strip them before sharing). JSON from a newer version may fail on older installs. Source (accessed 2026-10-12): https://docs.n8n.io/build/manage-workflows/export-and-import
- Flowise Agentflow V2: 14 node types (Start, LLM, Agent, Tool, Retriever, HTTP, Condition, Condition Agent, Iteration, Loop, Human Input, Direct Reply, Custom Function, Execute Flow), a supervisor/worker pattern and Flow State. Unverified: the export format. Source (accessed 2026-10-12): https://docs.flowiseai.com/using-flowise/agentflowv2
- Dify: the DSL is YAML. Export excludes third-party tool API keys, knowledge-base content and logs; Secret-type environment variables can optionally be included (warn authors to say no); import checks the DSL version. Unverified: the file extension. Source (accessed 2026-10-12): https://docs.dify.ai/en/use-dify/workspace/app-management
- Catalog value: show `kind: workflow` with node-type counts only if cheap; otherwise manifest-only. Never ingest or display a raw export without a secret scan (credentials, headers, tokens). Runnable: `external` (hosted instance) or `not runnable`.

## 4. Mapping versus AgentSpec

| Format | Expressible natively in AgentSpec | Gap or lossy | Direction |
|--------|-----------------------------------|--------------|-----------|
| AgentSpec Agent | all | none | existing adapter |
| AgentSpec Swarm, ManagerWorkers, Flow, A2AAgent | native | AgentRecord has no members or topology; Zod rejects them | extend adapter (rank 1) |
| Claude subagent .md | Agent (prompt, tools, model) | model aliases, hooks, permission modes, memory | detector |
| SKILL.md | none (not an agent) | whole concept | new kind `skill` |
| CrewAI | Agent plus ManagerWorkers or Flow | backstory, role and goal merge; tasks | detector (config only) |
| ADK root_agent.yaml | Agent plus `sub_agents` tree | handoff semantics, Gemini-only config | detector |
| MAF declarative YAML | Agent | expression syntax, connection | detector |
| Pydantic AI spec | Agent | capabilities, templates | detector (low priority) |
| LangGraph | none in config | topology in code | manifest only |
| OpenAI Agents SDK, LlamaIndex, Semantic Kernel, AutoGen code | none in config | code-only | manifest only |
| MCP `server.json` | not an agent; MCPToolBox covers consumption | server identity, package | new kind `mcp-server` |
| A2A Agent Card | A2AAgent (remote) | skills list, interfaces | kind `external-agent` |
| n8n, Flowise, Dify | Flow (loosely) | node semantics | manifest only (v1) |

## 5. The canonical model today

Verified in the repo (read-only):

- `src/lib/spec/types.ts` defines `AgentRecord`, a single-agent record: one system prompt, one LLM, a flat `toolNames` list, a form-style `inputFields` list, and consortium conventions (category, github_url, maturity, tags, customizable, fixed) taken from AgentSpec `metadata`.
- `src/lib/spec/oracle-agentspec.ts` validates with a Zod schema where `component_type` is `z.literal('Agent')`. Swarm, ManagerWorkers, Flow and A2AAgent files are rejected today. Only `metadata` is a catchall, so unknown top-level fields are dropped.
- `scripts/ingest.ts` hardcodes Try It Out to none; decisions D-05, D-06 and D-07 keep Try It Out DB-only, never derived from ingested files.
- `drizzle/schema.ts` stores arrays as JSON text columns, a convenient pattern for additive extension.

## 6. Unverified and known gaps (collected)

- AgentSpec: exact YAML for `$component_ref` and the shape of Swarm `relationships`; the `type` versus `component_type` inconsistency on the spec page; only the first ~100k of ~320k characters of each spec page read.
- A2A: Agent Card field tables and the well-known path unread; the spec page was truncated (only first ~100k characters read).
- CrewAI Flows: not documented on the fetched page.
- AutoGen Studio JSON: unverified. AutoGen Swarm, SelectorGroupChat and GraphFlow serialization: no example seen.
- Microsoft Agent Framework: declarative workflow status is LOW to MEDIUM (third-party sources); GA date is from third-party sources.
- Semantic Kernel: YAML agent spec not confirmed.
- Google ADK: Sequential, Parallel and Loop agents in YAML not verified; config is experimental.
- Pydantic AI: based on search-result summaries.
- smolagents: restore of managed agents unverified.
- LlamaIndex: `can_handoff_to` is LOW (community answer); current deploy config unverified.
- Flowise: export format unverified. Dify: file extension unverified.
- MCP registry is in preview; the draft schema may change.
- Which frameworks AIC authors actually use is unknown to this research.

## 7. Illustrative catalog.yaml (synthetic)

This is a proposed AIC convention, not an external standard, and it is not implemented yet (Phase 13). All values are synthetic.

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

## 8. See also

- [Capability matrix](agent-capability-matrix.md)
- [Author intake guide](agent-intake-guide.md)
- [Decision memo](agent-hosting-decision-memo.md)
