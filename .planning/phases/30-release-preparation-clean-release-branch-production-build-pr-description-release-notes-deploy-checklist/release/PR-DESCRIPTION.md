# Add 25 catalog agents, runnable Try It Out, and flagged MCP tooling

## Summary
This PR brings the AIC Agent Library up to the October 2026 state:

- Agent catalog: 16 new agent entries (12 consortium agents, 4 derived from public DDC skills) plus the existing entries, 25 agent YAML files in total. Three MCP server entries (STK MCP, STK Catalog MCP, LVI-INFO MCP) are listed only when `AGENT_KINDS` is on.
- Multi-format hosting behind `AGENT_KINDS`: spec shim with adapters for Oracle AgentSpec, `catalog.yaml`, SKILL.md and Claude subagent files, CrewAI, LangGraph and MCP `server.json`; kind badge and Type filter.
- Try It Out: container-backed runner (Pi) and direct model call, with per-agent prompts and synthetic samples.
- Sign-in with e-mail codes, `/health`, error references, input limits and secret redaction.
- MCP generator (`MCP_GENERATOR`) and MCP test queue (`MCP_TESTER`), both OFF by default.
- Catalog UI work: accessibility, related agents, compare view, spec viewer, dark mode (flags below).

Diffstat against origin/main: 765 files changed, 89380 insertions, 936 deletions (five logical commits plus two cleanup commits). Most of the line count is tests, adapters and the MCP generator and test suites.

## Feature flags (all default OFF; none is set in `.env.example`, `podman-compose.yml` or the Containerfiles)
| Flag | Effect |
|---|---|
| `AGENT_KINDS` | Multi-agent and multi-format hosting; lists the 3 MCP server entries (28 entries instead of 25). Needs a re-ingest. |
| `AGENT_COMPARE` | `/compare` page and compare checkboxes |
| `UI_SPEC_VIEWER` | Read-only spec viewer on agent pages |
| `UI_DARK_MODE` | Dark theme toggle |
| `MCP_GENERATOR` | "Generate MCP" panel and `POST /api/mcp-generate` |
| `MCP_TESTER` | `/mcp-test` and `/api/mcp-test/runs` |

With all flags off, `/mcp-test`, `POST /api/mcp-generate` and `/api/mcp-test/runs` answer 404, and a golden test pins flag-off behaviour.

## Not included
- The internal agent inventory and gaps documents (`docs/consortium-agents-inventory.md`, `docs/consortium-agents-gaps.md`). Per-entry `metadata.gaps` and assumptions stay.
- Planning files, tool configuration, local overrides, run logs, databases, `.env`.
- No real consortium data, no slide material, no real STK or LVI-INFO exports; all samples are synthetic or public. A repository sweep for secrets, personal data and company names found nothing blocking.

## Tests, build and smoke
- Build record on the final release tip (f9ef5d0): `npm ci` ok; `SEARCH_EMBEDDINGS=off npm run build` exit 0, 19 s, 25 agents ingested, 0 failed; `npm run smoke` exit 0, 104/104 checks over 8 flag configurations (35 s).
- Full `npm run check` in the release tree (svelte-kit sync, tsc, vitest): exit 0, 271 test files passed (1 skipped), 3075 tests passed (1 skipped). The two criteria tests that read `.planning/` are not part of the release.
- Not run: the container image builds (`Containerfile`, `Containerfile.pi-runner`, `Containerfile.mcp-test-runner`), live Podman checks, browser and screen-reader checks (see `docs/human-verification-guide.md`).
- Known build gotcha: a fresh checkout needs `mkdir -p db` before `npm run build` (the Containerfile does this).

## Reviewer notes
- Review order: `data/agents/` and `data/tryitout-prompts/` (content), `src/lib/server/` and `src/hooks.server.ts` (auth, Try It Out, hardening), `src/lib/spec/` (adapters), then flagged `src/lib/mcpgen/` and `src/lib/mcptest/`.
- Agent outputs are drafts. Counted agents passed one rubric run each on synthetic samples; agent 5 (Product Sourcing MBOM) is counted for a scoped step only; agent 3 (Clash Prioritization) passed after a redesign.
- One entry has an assumption to confirm: "D2" is read as the Finnish National Building Code part D2 (indoor climate and ventilation).
- Decisions pending before publishing: enable `AGENT_KINDS` or not; personal repo URL in two MCP entries.

## Rollback
Revert the merge commit and redeploy. The database is rebuilt from `data/agents/` by ingest; schema changes are additive. Features can also be switched off individually (unset the flags, `PI_RUNNER_ENABLED=false`, `SEARCH_EMBEDDINGS=off`); see `docs/deploy-runbook.md` section 8.
