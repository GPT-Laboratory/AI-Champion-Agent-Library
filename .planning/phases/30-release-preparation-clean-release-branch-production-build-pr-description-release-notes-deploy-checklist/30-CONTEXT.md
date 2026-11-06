# Phase 30 Context: Release preparation

Gathered unattended (auto mode). Do NOT push, do NOT open PRs. Ville opens the PR to a different (publishing) repo; someone else publishes from there.

## Scope
1. A clean release branch (name: `release/agents-2026-10` unless the plan finds a convention) derived from the verified working branch with `.planning/`, `.claude/`, AI-session artefacts, `.tryitout-runs/`, spend logs, local overrides and anything confidential/internal filtered out (use the gsd-pr-branch approach: it filters .planning commits; check what else needs to be excluded). MCP generator (MCP_GENERATOR) and MCP test queue (MCP_TESTER) remain in the code but behind their flags and OFF by default; prove it (flag-off golden test, grep of defaults in .env.example/compose/Containerfile).
2. Production build: `npm run build` (check how it is defined) and `npm run smoke` passing on the release branch, run alone (3.7 GB RAM, no Podman or other heavy work in parallel). Record numbers.
3. PR description (docs on release branch NOT needed; produce the text as a file outside the tree or in `.planning/phases/30-*/release/` on the working branch: PR-DESCRIPTION.md, RELEASE-NOTES.md including the agent count, DEPLOY-CHECKLIST.md).
4. Confidentiality sweep of the release diff: no consortium/confidential data, no TUNI slide, no keys/.env, no real STK/LVI-INFO exports, no personal data; internal docs (docs/consortium-agents-inventory.md, docs/consortium-agents-gaps.md, evidence) — decide inclusion, default: exclude the internal inventory and the gaps list from the release branch and keep per-entry `metadata.gaps`/`assumptions`; record the decision as an assumption for Ville. Check entries and samples are labelled synthetic/public.

## Assumptions
- A-01: Agent count for the notes = counted catalog agents: 12 consortium + 4 DDC-derived = 16 new, plus 9 pre-existing entries (incl. demo-rfi-triage) = 25 YAML entries; the 3 mcp-server entries (stk-mcp, stk-catalog-mcp, lvi-info-mcp) are listed only when AGENT_KINDS is on (default off) — state both numbers and let Ville decide whether to enable the AGENT_KINDS flag for the release. Reliability caveat: counted agents passed one rubric run each on synthetic samples (agent 5 counted only for a scoped step; agent 3 after redesign).
- A-02: Try It Out runnable mode for the new agents depends on `npm run tryout:configure` (scripts/set-try-it-out-mode.ts) at build; production needs OPENAI_API_KEY and the Pi runner image; deploy checklist must include these plus the usage endpoint (TRYITOUT_USAGE_ENDPOINT stays unset/off in production).
- A-03: Base for the release branch: origin/main (merge-base 25fa489); the branch contains every non-.planning commit; keep history readable or squash into logical commits (planner decides; prefer gsd-pr-branch behaviour).
- A-04: Local-only artefacts (override.tryitout.yml, .tryitout-runs, db/, .env) must not appear.
