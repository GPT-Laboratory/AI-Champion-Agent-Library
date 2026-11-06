# Agent capability matrix

This matrix shows, per agent type or format, what the catalog can express today, what needs an extension, what the library must store and display, and whether Try It Out can apply. It is derived from the research in [agent-types.md](agent-types.md). Research date and web sources: accessed 2026-10-12. Research output only; nothing here is implemented.

## Legend

- **AgentSpec native (today)**: expressible by the current adapter (`src/lib/spec/oracle-agentspec.ts`), not merely by the AgentSpec language.
- **Needs extension**: requires a canonical-model or adapter change (see the [decision memo](agent-hosting-decision-memo.md)).
- **Library must store/display**: what the catalog should keep and show for this type.
- **Try It Out** values (exactly three):
  - `runnable`: the catalog could run it in Try It Out. Today only the single-agent pi-runner / OpenAI-compatible flow in `src/lib/tryItOut.ts` exists.
  - `external`: link out to an author-hosted demo or repo.
  - `not runnable`: display only.
- Where research could not confirm something, the cell says "unverified".

## Matrix

| Type / format | AgentSpec native (today) | Needs extension | Library must store/display | Try It Out | Confidence / notes |
|---------------|--------------------------|-----------------|----------------------------|------------|--------------------|
| Single agent, AgentSpec | prompt, llm, tools (names), inputs, human-in-the-loop | tool detail (descriptions), optional | as today | `runnable` (via DB flag only) | HIGH. Repo verified. |
| Single agent, Claude subagent | prompt, tools, model | model alias handling (`inherit`, `sonnet` are not ids) | as above plus framework badge | `external` or none | HIGH. |
| Single agent, ADK / MAF / Pydantic AI | prompt, model, tools | per-format adapter | as above | `external` or none | MEDIUM. Experimental or preview formats; MAF workflow status unverified. |
| Multi-agent: AgentSpec Swarm | spec yes, record no | kind, members, topology, handoff | member cards, handoff graph | `external` (running when all members are runnable is out of scope) | HIGH on component list; `relationships` YAML shape unverified. |
| Multi-agent: ManagerWorkers (AgentSpec, CrewAI hierarchical, ADK `sub_agents`, smolagents) | spec yes (AgentSpec only) | members with roles (manager, worker) | tree view | `external` | AgentSpec and CrewAI HIGH; ADK config experimental; smolagents MEDIUM. |
| Pipeline / Flow (AgentSpec Flow, CrewAI sequential, n8n, Flowise, Dify) | Flow yes in spec; not in the record | topology `pipeline` or `graph`, ordered members | ordered steps | `external` or none | Flowise export and Dify extension unverified; CrewAI Flows undocumented on the fetched page. |
| Group chat (AutoGen, Semantic Kernel) | no | topology `group-chat` | participants list | none (`not runnable`) | AutoGen in maintenance mode; Studio JSON unverified; SK YAML unconfirmed. |
| Framework-native code-only (LangGraph, OpenAI Agents SDK, LlamaIndex) | no | manifest fields | repo link, framework, declared members | `external` or none | LangGraph HIGH; LlamaIndex `can_handoff_to` LOW. |
| Skill package (SKILL.md) | no | `kind: skill`, files list | name, description, allowed-tools, bundled-scripts flag, compatibility | `not runnable` | HIGH (open spec). |
| MCP server | MCPToolBox (consumer side only) | `kind: mcp-server`, transport, package, tools | tool list, install snippet, required env var NAMES (not values), data-source note | `external`; Phase 15 black-box scoring later | Registry in preview; draft schema may change. |
| Agent that uses MCP servers | toolboxes (the adapter ignores them today) | list of MCP servers used | "uses" links | per underlying agent | HIGH on AgentSpec MCPTool/MCPToolBox. |
| A2A external agent | A2AAgent (in spec; rejected by the current Zod literal) | `kind: external-agent`, endpoint, card | skills from the card, endpoint URL, auth scheme names | `external` | Card field tables and well-known path unverified. |

## Per-format ingestibility

| Format | Topology derivable from config? | What can be extracted | What needs a `catalog.yaml` manifest |
|--------|---------------------------------|-----------------------|--------------------------------------|
| AgentSpec Agent | n/a (single) | everything the adapter reads today | consortium metadata if missing |
| AgentSpec Swarm, ManagerWorkers, Flow, A2AAgent | yes | members, topology, handoff (shape of `relationships` unverified) | category, tags, maturity, github_url if absent from root `metadata` |
| Claude subagent .md | implicit only | name, description, tools, model, prompt | category, tags, maturity, inputs |
| SKILL.md | n/a | name, description, license, compatibility, allowed-tools | category, tags, maturity |
| CrewAI (JSONC or YAML) | yes (process, task assignment, context) | agents, tasks, process type | inputs, maturity, category |
| ADK `root_agent.yaml` | yes (`sub_agents` tree) | name, model, instruction, tools, sub-agent paths | category, tags, maturity |
| MAF declarative YAML | single agent: n/a; workflows unverified | name, instructions, model | everything else |
| Pydantic AI spec | n/a (mostly single) | model, instructions, capabilities | everything else |
| LangGraph | no (lives in code) | graph ids, dependencies, entry points | members, topology, description |
| OpenAI Agents SDK, LlamaIndex, Semantic Kernel, AutoGen code | no | nothing | everything (manifest plus repo link) |
| MCP `server.json` | n/a | name, package, args, env var names, description | tool list, data-source note |
| A2A Agent Card | n/a | identity, skills, interfaces (field tables unverified) | category, tags, maturity |
| n8n, Flowise, Dify exports | partly (nodes) but unstable shapes | node types (only after a secret scan) | everything, v1 manifest-only |

## Try It Out rules

- Decisions D-05, D-06 and D-07 keep `try_it_out` DB-only. It is set by maintainers and never derived from ingested files. The Try It Out column above is a recommendation for the DB value.
- For any `kind` other than `agent`, the allowed modes are `none` or `external`. `runnable` stays restricted to single agents.
- Model aliases (`inherit`, `sonnet`) are not model ids. They are stored as written, displayed as an alias, and never feed Try It Out.
- Open question for the human (Ville): should Try It Out ever run systems? The recommendation is no for v1.

See [agent-types.md](agent-types.md) for the taxonomy and per-format findings.
