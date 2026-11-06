# Release notes: AIC Agent Library, October 2026

## Agent count
- 25 agents are listed by default: 16 new entries plus 9 existing entries (AIRO, Demo RFI Triage, Electrical Panel Scheduler, Energy Model Data Sync, HVAC Load Calculator, MEP Scope Planner, MEP Submittal Review Router, Plumbing Fixture Unit Counter, RFI Triage Assistant). The demo entry is a Try It Out demo, not a production agent.
- 28 are listed when `AGENT_KINDS` is on: the same 25 plus three MCP server entries (STK MCP, STK Catalog MCP, LVI-INFO MCP).
- Decision pending: enable `AGENT_KINDS` for release? Default is off, which gives 25.

Note for diffs: against origin/main, `airo.yaml` and `demo-rfi-triage.yaml` also show as added, so the diff adds 18 agent YAML files; 16 of them are the new agents below.

## New agents by stage
Design (IFC/BIM)
- 1 ETIM & Classification Repair
- 2 QTO Normalization
- 3 Clash Prioritization
- 4 RFI Generation from Findings

Sourcing (LVI-INFO catalog)
- 5 Product Sourcing MBOM
- 6 Quote Comparison
- 7 Carbon EPD Enrichment

Manufacturing (prefab and cut sheets)
- 8 Cut-sheet QA
- 9 Spooling and Cutting

Site and handover
- 10 D2 Code Validation
- 11 OM Completeness
- 12 BMS Digital Twin
- 13 Daily Report Cross Check
- 14 Punch List Closure Check
- 15 Change Order Consistency Check
- 16 Safety Observation Classification

Agents 13 to 16 are derived from public skills (MIT-licensed DDC skills repository) and rewritten as one-step agents.

## Reliability caveats
- Each counted agent passed one rubric run on synthetic samples. That shows the pattern works on invented inputs, not that it works on real project data.
- Agent 5 (Product Sourcing MBOM) is counted for a scoped step only, not the full workflow.
- Agent 3 (Clash Prioritization) is counted after a redesign.
- D2 interpretation assumption: "D2" is read as the Finnish National Building Code part D2 (indoor climate and ventilation); the task text does not define it. To be confirmed.
- No consortium data was used. Every sample is synthetic or public.
- Outputs are drafts for professional review; agents do lookups and checks, not engineering or safety decisions.

## Other changes
- Runnable Try It Out for the demo agent and agents with prompts, via per-session containers or a direct model call.
- Multi-format agent hosting, MCP server generator and MCP test queue exist in the code but are off by default (`AGENT_KINDS`, `MCP_GENERATOR`, `MCP_TESTER`).
- E-mail code sign-in, `/health`, error references, secret redaction, abuse limits.
- Optional features behind flags: compare view, spec viewer, dark mode.

## Known limitations
- Try It Out runnable mode needs `OPENAI_API_KEY`, the Pi runner image built from `Containerfile.pi-runner`, and `npm run tryout:configure` at build.
- The first build downloads the embeddings model (about 90 MB) unless `SEARCH_EMBEDDINGS=off`; without it search is keyword-only.
- Container images have not been built or run end to end; browser, screen-reader and live Podman checks are listed in `docs/human-verification-guide.md`.
- MCP generator and test queue are not enabled in production.
