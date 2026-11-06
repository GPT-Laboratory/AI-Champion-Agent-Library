---
status: pending human
phase: 22-proposal-layer-follow-ups
updated: 2026-10-15
---

# Phase 22 Human UAT

Interim evidence only: the schema validation and the five automated gates (strict mode, 0 rejected ops), plus `src/lib/mcpgen/proposals/real/real.test.ts`. These do not replace the human review required by the design (D-580). Nothing below is ticked.

## 1. Review by Ville of the first real proposal

- [ ] Reviewed `src/lib/mcpgen/proposals/real/acme-openapi.proposals.json` and accept it (or note changes)

Commands (from the repo root):

```
npm run generate-mcp -- src/lib/mcpgen/testing/fixtures/acme-openapi.yaml --proposals src/lib/mcpgen/proposals/real/acme-openapi.proposals.json --validate-only
npm run generate-mcp -- src/lib/mcpgen/testing/fixtures/acme-openapi.yaml --out /tmp/acme-baseline
npm run generate-mcp -- src/lib/mcpgen/testing/fixtures/acme-openapi.yaml --out /tmp/acme-proposed --proposals src/lib/mcpgen/proposals/real/acme-openapi.proposals.json
diff -ru /tmp/acme-baseline /tmp/acme-proposed
```

Look for: tool names and descriptions are sensible and accurate; no text claims the server writes or changes anything; each op `reason` is true; the hidden tool (`filter_part_by_features`) is an acceptable loss; the composite `find_part_details` returns what its description says (default fields of the first match); the default page size 10 is acceptable.

## 2. Sign-off on the baseline vs proposal-assisted comparison (plan 02)

- [ ] Read `22-COMPARISON.md` and accept the interpretation: no regression (generator-side gate pass, 100 percent, no deltas); local-exec run DISQUALIFIED for both packages because the scorer mock does not match the Acme fixture; the only differences are the hidden filter tool and a description-hint binding accident; nothing shows the proposal helps an agent choose tools.

Result recorded by the autonomous run: both commands below ran (exit 0 and exit 1/1). Re-run commands (needs python3 with `fastmcp==3.4.8 httpx` in a throwaway venv):

```
npm run mcp-propose-eval -- src/lib/mcpgen/testing/fixtures/acme-openapi.yaml --proposals src/lib/mcpgen/proposals/real/acme-openapi.proposals.json --reruns 3 --format markdown --write-packages /tmp/acme-pkgs
python3 -m venv /tmp/acme-venv && /tmp/acme-venv/bin/pip install fastmcp==3.4.8 httpx
npm run mcp-test -- --subject cmd:"/tmp/acme-venv/bin/python /tmp/acme-pkgs/baseline/server.py" --env-base-url ACME_PARTS_BASE_URL --env-api-key ACME_PARTS_API_KEY --allow-local-exec --reruns 2 --format markdown
npm run mcp-test -- --subject cmd:"/tmp/acme-venv/bin/python /tmp/acme-pkgs/proposed/server.py" --env-base-url ACME_PARTS_BASE_URL --env-api-key ACME_PARTS_API_KEY --allow-local-exec --reruns 2 --format markdown
```

## 3. Not done and not claimable without a human or agent client

- [ ] A selection evaluation with an agent client (does the renamed and described surface help an agent pick tools?). Not run; no model calls by design.
- [ ] A local-exec run against a mock that matches the Acme fixture (the current scorer mock is the suite's own catalogue).
