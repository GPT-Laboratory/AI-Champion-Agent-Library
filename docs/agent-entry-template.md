# Agent catalog entry template

Template for consortium agents (Phases 25-29). The entry is one Oracle AgentSpec YAML file in `data/agents/`; extra fields live in `metadata` (see [agent-intake-guide.md](agent-intake-guide.md) and [agent-types.md](agent-types.md) for the base shape).

## How to add an agent

1. Copy [templates/agent-entry.template.yaml](templates/agent-entry.template.yaml) to `data/agents/<slug>.yaml`.
2. Replace every `TEMPLATE` value; keep the comments you find useful, delete the rest.
3. Check the file against the AgentSpec schema: `npm run validate-submission -- data/agents/<slug>.yaml`
4. Check the consortium fields: `npm run validate-entries -- data/agents/<slug>.yaml`. With no argument it checks every top-level file in `data/agents`.
5. Add any gap you found to `metadata.gaps` and to [consortium-agents-gaps.md](consortium-agents-gaps.md).

### validate-entries output and exit codes

```
[OK] docs/templates/agent-entry.template.yaml
1 entry: 0 error(s)
```

Entries without any consortium key (the older agents) print `[SKIPPED]` and are not errors. A failing entry lists the field, for example `- metadata.gaps must be a list of strings (key present, may be empty)`.

Exit codes: 0 all entries ok or skipped, 1 at least one entry has errors, 2 path not found, no entry files found, or an unknown option. The same checks run in `npm test` through `scripts/validate-entries.test.ts`, so they are part of `npm run check`.

## Fields

Base AgentSpec fields (`component_type`, `id`, `name`, `description`, `system_prompt`, `llm_config`, `tools`, `human_in_the_loop`) follow the existing entries. Consortium fields go under `metadata`:

| Key | Required | Meaning | Example |
| --- | --- | --- | --- |
| category | yes (base) | catalog category | `project-management` |
| maturity | yes (base) | production, beta or experimental | `experimental` |
| tags | no | search keywords | `[rfi, bim]` |
| stage | yes | design, sourcing, manufacturing or site-handover | `design` |
| agent_no | yes for the 12 consortium agents and the DDC-derived agents | number 1-12 from the inventory; 13-16 for the DDC-derived agents (Phase 29), 17-20 for the further DDC-derived agents (Phase 35; 17 to 20) | `4` |
| purpose | yes | the one semantic step and who it serves | "Drafts an RFI from a clash finding for the BIM coordinator" |
| inputs | yes | list of what goes in (non-empty) | `["Clash report excerpt"]` |
| outputs | yes | list of what comes out (non-empty), always drafts | `["Draft RFI text"]` |
| data_sources | yes | where facts come from, empty list if none | `["Public IFC sample"]` |
| assumptions | yes | what the agent takes for granted | `["Units are metric"]` |
| gaps | yes | known limits; key present, list may be empty | `["No live model access"]` |
| draft_for_review | yes | must be `true` | `true` |
| sample_data | yes | `kind` (public or synthetic) and `label` | `{kind: synthetic, label: "Invented RFI text"}` |
| attribution | only when adapted from a DDC skill | credit line | "Adapted from DDC skill <exact path>, MIT, (c) 2026 DataDrivenConstruction" |

## Rules

- Every output is a draft for engineer review. The system prompt says so and tells the agent to flag uncertainty.
- Sample data is public or synthetic and labelled through `metadata.sample_data`.
- No consortium or confidential data in any entry, prompt or sample. The source slide is not in the repo.
- Entries adapted from a DDC skill set `metadata.attribution` and get a row in [third-party-notices.md](third-party-notices.md). Never copy the DDC book or CWICR data.
- Gaps go into both `metadata.gaps` and the combined list.

## MCP-server entries

MCP servers are a different shape: a directory `<slug>/catalog.yaml` with `kind: mcp-server`. They are ingested only with `AGENT_KINDS=on` (see [phase13-adapters.md](phase13-adapters.md)). The three existing examples live in `data/agents-local/` and are read only when `LOCAL_MCP_AGENTS` is on; see [local-mcp-agent.md](local-mcp-agent.md).
