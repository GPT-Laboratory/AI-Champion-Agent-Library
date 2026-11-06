# Phase 22 Context: Proposal Layer Follow-ups

Gathered unattended (auto mode). Working branch only (release branch already cut). No pushes, no PRs.

## Scope
ROADMAP Phase 22: (1) a first real proposal from an agent session; (2) baseline vs proposal-assisted package run through `mcp-test --allow-local-exec` and compared with the Phase 15 scorer; (3) hygiene false positives (D-585) tuned from real proposals; (4) `derived_filter` on OData supported or its limitation documented as final.

## Assumptions
- A-01: "Real proposal from an agent session": this autonomous session (a Claude agent) acts as the proposing agent, using the context pack export on a public/synthetic spec (the repo's fixtures, e.g. the T2-STK-API OpenAPI fixture in ~/projects/mcp-gen-comparison/wp5-bench/suite, only if non-confidential; otherwise repo fixtures). The review by Ville is criterion 1: record as pending in 22-HUMAN-UAT.md; automated checks (schema validation, hygiene) are the evidence in the meantime.
- A-02: The comparison run uses mcp-test with the local runtime (--allow-local-exec, no container) and no real-model calls in the platform (design rule: no model calls inside the platform). If the scorer needs a model, cap spend at $0.50 and log to the spend log (.planning/spend-log.md; $10 total, ~$1.0 used).
- A-03: derived_filter on OData: try to support it if it is a small, well-bounded change with tests; otherwise document the limitation as final in docs and the decision log. Pick by the effort you find (< ~half a day of work equivalent); record the decision as D-nnn assumption.
- A-04: Hygiene tuning is data-driven from the real proposal; do not weaken security checks (credential-shaped text stays blocked); only reduce false positives with tests for both directions.
