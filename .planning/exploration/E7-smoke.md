# E7 runtime smoke test

Tool: `npm run smoke` (`scripts/smoke.ts`, D-420, docs/smoke-test.md). Result on this branch: 104/104 checks pass (8 configs x 13 probes).

| Config | Flags on | Checks | Result |
|---|---|---|---|
| all-off | none | 13/13 | pass |
| AGENT_KINDS | AGENT_KINDS | 13/13 | pass |
| AGENT_COMPARE | AGENT_COMPARE (/compare 200) | 13/13 | pass |
| UI_SPEC_VIEWER | UI_SPEC_VIEWER | 13/13 | pass |
| UI_DARK_MODE | UI_DARK_MODE | 13/13 | pass |
| MCP_GENERATOR | MCP_GENERATOR (zip 200) | 13/13 | pass |
| MCP_TESTER | MCP_TESTER (/mcp-test 200) | 13/13 | pass |
| all-on | all six | 13/13 | pass |

## Findings

No product defects: build succeeds, no 500s, no stack traces or `node_modules` in any body, flagged routes 404 when off. The first run's 12 failures were wrong expectations in the script (fixed there): `/` redirects 302 to /catalog; `GET /api/mcp-test/runs` is a POST-only route (405 with the flag on); my first invented OpenAPI doc lacked a response schema (correct 422).
