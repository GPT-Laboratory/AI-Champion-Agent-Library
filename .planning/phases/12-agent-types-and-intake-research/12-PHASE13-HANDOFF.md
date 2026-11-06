# Phase 13 handoff (from Phase 12 research)

Read first: `docs/agent-hosting-decision-memo.md`, section "Concrete minimal proposal for Phase 13".

## Task 0

- Obtain the shape of a pyagentspec-exported Swarm, ManagerWorkers and Flow offline from the repo docs (no web at execution time unless allowed). Confirm the YAML for `$component_ref` and the tuple form of Swarm `relationships`.
- If that is not possible, parse `relationships` as opaque and keep it in `extras`.
- Accept both `type` and `component_type` as the discriminator (the spec page is inconsistent).

## Traps

- `component_type: z.literal('Agent')` rejects every system file today; use a discriminated union behind `AGENT_KINDS` and keep the flag-off path byte-identical.
- Embedding hash churn: add kind, framework and member names to searchable text only with the flag on.
- FilterBar, AgentCard, RelatedAgents and the detail page need kind awareness; flag-off UI must not change.
- The consortium `metadata` conventions (category, tags, github_url, maturity) must also be read from the root of Swarm, ManagerWorkers and Flow.
- Model aliases (`inherit`, `sonnet`) are not model ids; never feed them to Try It Out.
- Never execute or import author code; never fetch author URLs at ingest; never render `extras` as HTML; run the secret denylist scan; cap sizes.

## Defaults to assume (open questions, until Ville answers)

- Members inline with an optional `slug` link.
- `catalog.yaml` is an acceptable convention (reply-with-answers is equivalent).
- Try It Out for kinds other than `agent` is `none` or `external`.
- `edges` deferred; MCP details live in `extras`.
- Adapters in scope: ranks 1 to 6 only.

## Process reminders

- Log every data-model decision with revert steps in `.planning/AUTONOMOUS-DECISIONS.md` (hooks are listed in memo section 8; Phase 12 used D-029 to D-032).
- Fixtures must be synthetic ("Example"/"Acme" placeholders); do not copy from the reference repos.
- Re-check ADK, MAF, Pydantic AI, MCP registry and A2A facts before building those adapters (14-day validity from 2026-10-12).
