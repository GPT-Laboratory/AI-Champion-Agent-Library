# Agent intake guide: what to send us

For authors who want their agent listed in the catalog. Plain language first, technical notes after. Research date and web sources: accessed 2026-10-12. This guide is research output; the `catalog.yaml` convention and the `validate-submission` check are implemented behind the `AGENT_KINDS` flag (Phase 13).

## 1. The short answer

Do we need config files or the GitHub repo? **The repo link is the default and is enough to start.** Add a short `catalog.yaml` at the repo root (or answer the questions in the reply template below) so we can list it. Send config files directly only when there is no repo or the repo is private.

Why: for LangGraph, the OpenAI Agents SDK, LlamaIndex and Semantic Kernel, the way agents cooperate lives in code, not in a config file. Declarative formats (Oracle AgentSpec, CrewAI, Google ADK, Microsoft Agent Framework, Claude subagent `.md` files, `SKILL.md`) can be read straight from the repo.

## 2. What to send

Kinds are explained in [agent-types.md](agent-types.md).

| Kind | Repo link | Config files | Extras |
|------|-----------|--------------|--------|
| agent (single) | yes | the agent file, if declarative | inputs, outputs, model dependency |
| system (several agents) | yes | the framework config, if declarative | member agents with role, topology (swarm, manager-workers, pipeline, graph, group-chat) |
| workflow (n8n, Flowise, Dify) | yes if any | exported file, only after removing credentials | short description of the steps |
| skill | yes | the whole skill directory | see the skill limits below |
| mcp-server | yes | `server.json` if published | tool list written by you, transport and install command, required environment variable NAMES only |
| external-agent | endpoint description | Agent Card or endpoint description | auth scheme names, skills offered |

Per format:

- **Oracle AgentSpec**: one YAML or JSON file. On the root of a Swarm, ManagerWorkers or Flow, the `metadata` must carry `category`, `tags`, `github_url` and `maturity`, the same way a single Agent does.
- **CrewAI**: `crew.jsonc` plus `agents/*.json`, or `config/agents.yaml` and `config/tasks.yaml`. We read these as text and never run them.
- **Google ADK**: `root_agent.yaml` plus every sub-agent YAML it references.
- **Claude subagent**: the `.md` file (it needs `name` and `description` in its frontmatter).
- **Agent skill**: the whole directory containing `SKILL.md`. The `name` must match the directory name and may use only lowercase letters, digits and hyphens (at most 64 characters). `description` is at most 1024 characters and `compatibility` at most 500. Running `skills-ref validate` before sending is recommended.
- **MCP server**: repo, `server.json` if published, your own list of tool names, transport and install instructions, and the NAMES of required environment variables (never their values).
- **A2A agent**: the Agent Card or a description of the endpoint. (The exact Agent Card fields are unverified in our research, so a plain description is fine.)
- **n8n, Flowise, Dify**: an exported file only after you have removed credentials and authorization headers. For Dify, answer no when asked whether to include Secret environment variables. If in doubt, send the manifest only.
- **LangGraph, OpenAI Agents SDK, LlamaIndex, Semantic Kernel, AutoGen in code**: the repo link plus `catalog.yaml`; we cannot read the topology from config.

Never send API keys, `.env` files, or unstripped workflow exports.

## 3. Minimum metadata

| Item | Maps to |
|------|---------|
| Name | `name` |
| One-paragraph description in plain language | `summary` |
| Category | `category` |
| Tags | `tags` |
| Maturity: production, beta or experimental | `maturity` |
| Repo URL | `githubUrl` (AgentSpec `metadata.github_url`) |
| Framework | `framework` (proposed) |
| Kind | `kind` (proposed) |
| License | license |
| Owner or contact | contact |
| Inputs it expects | `inputFields` (AgentSpec `metadata.input_schema`) |
| Outputs it produces | description of outputs |
| LLM or model dependency | LLM name |
| Required tools or MCP servers | `toolNames` and MCP list |
| Human in the loop: yes or no | human-in-the-loop flag |

For systems, also list the member agents with a role (manager, worker, peer, step, participant) and the topology type. For MCP servers, also give transport, package or install command, tool names, required environment variable names and a data-source description.

`catalog.yaml` is implemented behind `AGENT_KINDS` (Phase 13); a reply with the same answers is equivalent. Supported fields: `name`, `kind`, `summary`, `category`, `tags`, `maturity`, `repo_url`, `link_label`, `framework`, `topology`, `members`, `tools`, `model`; unknown keys are kept as extras. Authors can check a submission with `npm run validate-submission -- <path>` (reports ingestible, partial or missing-from-author; see `docs/phase13-adapters.md`). An illustrative example (all values synthetic):

```yaml
# catalog.yaml (AIC intake manifest; all values synthetic)
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

## 4. Test-dataset notes

If your agent needs example data, say what kind of data it expects and point to a small synthetic sample in the repo (for example `samples/`). Confirm that the sample contains no customer or personal data. Never send keys or `.env` files.

## 5. Readiness checklist

- [ ] A license is present.
- [ ] The README has run instructions.
- [ ] Dependencies are pinned.
- [ ] An example input and output is included.
- [ ] No secrets in the repo history or in exported workflow JSON (n8n, Dify, Flowise: credentials stripped).
- [ ] Descriptions are written for a non-technical reader.
- [ ] Maturity is stated (production, beta or experimental).
- [ ] An owner contact is given.
- [ ] Systems: the member list and topology are stated.
- [ ] Skills: `name` matches the directory and `skills-ref validate` passes.
- [ ] Claude subagents: `name` and `description` are present.

## 6. Reply template

Copy and send (about 100 words):

> Thanks for offering your agent. Please send the GitHub repository link; we only need config files if the repo is private. Add a short catalog.yaml at the repo root, or reply with: name, one-paragraph description, category, tags, maturity (production, beta or experimental), framework, whether it is a single agent or a multi-agent system (members and how they cooperate), inputs, outputs, required tools or MCP servers, license and a contact. If it needs example data, point to a small synthetic sample and confirm no customer data, keys or .env files are included. If you export an n8n, Flowise or Dify workflow, remove credentials first.

## 7. What happens next, and what we will not do

- We read text only. We never run or import author code.
- We do not fetch author-supplied URLs at ingest.
- Try It Out is configured by maintainers; it is not derived from your submission.
- Fields we cannot read from your files are reported back as "missing from author" so you can fill them in.

See [agent-types.md](agent-types.md) for the kinds and frameworks.
