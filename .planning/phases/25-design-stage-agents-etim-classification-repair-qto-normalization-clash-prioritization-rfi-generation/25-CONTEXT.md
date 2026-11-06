# Phase 25 Context: Design-stage agents (1-4)

Gathered unattended (auto mode). Recommended options chosen; recorded as assumptions.

## Scope
Agents 1 ETIM & classification repair, 2 QTO normalization, 3 Clash prioritization, 4 RFI generation. Agent 4 builds on the existing partial entries (rfi-triage-assistant, demo-rfi-triage); the existing entries stay unchanged, the new one is a separate entry driven by model/clash findings.

## Done bar per agent (user)
Counted only with (a) complete catalog entry per docs/agent-entry-template.md, validated by `npm run validate-entries` and `validate-submission`; (b) one concrete step run through Try It Out in the Pi container with a real model, smoke-tested, evidence logged in the phase VERIFICATION/UAT files (job id, model, tokens, cost, input label public/synthetic, output excerpt, engineer-review caveat). Otherwise recorded as attempted-not-counted with the reason.

## Assumptions
- A-01: Each agent is `data/agents/<slug>.yaml` + `data/tryitout-prompts/<slug>/SKILL.md` + one synthetic or public sample input in that dir (labelled in the entry `sample_data`). Mirrors demo-rfi-triage.
- A-02: Runnable state: `scripts/set-try-it-out-mode.ts` UPDATES list gets the new slugs (that is the existing mechanism); keep the demo entries as they are.
- A-03: The Pi container has no network except the LLM proxy, so agents cannot call MCP servers (stk-mcp, LVI-INFO) at run time. Catalog data, where needed, is supplied as input text (excerpt) or the SKILL.md states that the catalog lookup is a gap and is done by the engineer. Record as gap in each entry and in docs/consortium-agents-gaps.md.
- A-04: Inputs are text files (IFC property exports as CSV/JSON text, QTO tables as CSV, clash reports as CSV/BCF-like JSON). Real IFC parsing is out of scope; the agent reads textual extracts. Gap recorded.
- A-05: ETIM class data: only public knowledge of ETIM structure is used; the actual ETIM release is licensed/ not redistributed; the sample uses a small synthetic list of made-up-but-plausible class/feature codes labelled synthetic. Never fabricate real ETIM codes as if authoritative: agent must flag uncertain mappings.
- A-06: Real-model runs use the existing harness (Phase 7/8 model, proxy). Budget per run: `PI_JOB_TOKEN_BUDGET=100000`, `PI_JOB_REQUEST_BUDGET=40` (cap $0.50 is met by the default model's price; the harness computes cost from proxy-reported usage and refuses to start a run if the running total + 0.50 would exceed $10).
- A-07: One container run at a time; no Podman while heavy builds (npm run check, vite build) run.
- A-08: Plan 25-01 builds the reusable run harness `scripts/tryout-run.ts` (start/attach to app on a port with AUTH_ENABLED=false, PI_RUNNER settings, submit job via the job API, poll, download artifact, record usage, append to spend ledger `.planning/spend-log.md`, copy result excerpt for the evidence). Later phases reuse it.
- A-09: Agents are built in subagents in worktrees, max two in parallel for file authoring; the container run step is serialized by the orchestrator (main session) one at a time.
- A-10: DDC skills may be used as source of the SKILL.md instructions when a fitting skill exists (MIT, attribution in the entry and docs/third-party-notices.md); otherwise own design.

## Done when
All four agents either counted with evidence in 25-VERIFICATION.md / 25-HUMAN-UAT.md or recorded with reason; gaps list updated; npm run check green; STATE.md spend log updated.

## Corrected 2026-10-15 (Phase 31)

Wrong assumption (text above kept as history): A-03 (superseded) said catalog data would come from stk-mcp / LVI-INFO as the intended source and recorded the missing lookup as a gap. Corrected: the DDC agents have no MCP or LVI-INFO source; where catalog or class data is needed it is a generic synthetic excerpt pasted into the input, and the gap is only "no live register or catalog connection". Gap rows that existed only because of the mixing were removed from docs/consortium-agents-gaps.md in Phase 31 (D-634).
