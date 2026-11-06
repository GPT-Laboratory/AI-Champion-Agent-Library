# 22-02 Comparison: baseline vs proposal-assisted (Acme OpenAPI fixture)

Date: 2026-10-15. Proposal: `src/lib/mcpgen/proposals/real/acme-openapi.proposals.json` (9 ops: 2 rename_tool, 2 describe_tool, 2 describe_arg, set_arg_default, hide_tool, composite_tool). Baseline tools `filter_part_by_features, lookup_part_by_id, search_part`; proposal tools `find_part_details, find_parts, get_part`.

Spend: 0 USD. No model call was made by the platform or by this plan (`.planning/spend-log.md` untouched).

## 1. Phase 15 scorer, generator-side (`mcp-propose-eval`, reruns 3)

Command: `npm run mcp-propose-eval -- src/lib/mcpgen/testing/fixtures/acme-openapi.yaml --proposals src/lib/mcpgen/proposals/real/acme-openapi.proposals.json --reruns 3 --format markdown --write-packages <scratch>/pkgs`. Exit code 0 ("no regression").

|  | baseline | proposed |
| --- | --- | --- |
| Tier 1 gate (runner) | not_run | not_run |
| Tier 1 generator-side gate | pass | pass |
| Headline score (runner) | n/a | n/a |
| Generator-side pass rate % | 100 | 100 |
| Blocker flags | 0 | 0 |
| Warnings | 0 | 0 |
| verdict | INCOMPLETE | INCOMPLETE |

Per-check deltas: none. The "INCOMPLETE" verdict is the script's normal reading for generator subjects (the real-server cells are not run there).

## 2. Local runtime, `mcp-test --allow-local-exec` (python 3.12 venv with fastmcp 3.4.8 + httpx in the scratchpad, deleted afterwards)

Command (one run per package, run sequentially):

```
npm run mcp-test -- --subject cmd:"<venv>/bin/python <pkgs>/<baseline|proposed>/server.py" --env-base-url ACME_PARTS_BASE_URL --env-api-key ACME_PARTS_API_KEY --allow-local-exec --reruns 2 --format markdown --out <scratch>/<name>.json
```

The scorer fills the two env vars with its own offline mock URL and a canary key; no `.env` and no credentials involved. Both runs exit 1.

| | baseline | proposed |
| --- | --- | --- |
| verdict | DISQUALIFIED | DISQUALIFIED |
| Tier 1 gate | fail | fail |
| headline score | none (gate failed) | none (gate failed) |
| cases run / applicable | 3 / 3 (others NA for this input kind) | 3 / 3 |
| blocker / warning flags | 0 / 0 | 0 / 0 |
| check results over the 3 run cases (PASS / FAIL) | 18 / 33 | 20 / 31 |
| bindings by explicit / hint / none | 29 / 0 / 22 | 28 / 3 / 20 |
| reruns reproducible | yes | yes |

Both packages fail Tier 1 in the same way, for the same reason: they were generated from the Acme fixture, but the scorer's mock upstream serves the suite's own synthetic catalogue (item ids `ACM-000001`, field `id`, other routes). Typical failures in both: `field_present: missing id`, `field_value: id != expected value`, `empty_with_message`, `clean_not_found`, `profile.required_tools: missing tools: lookup_item, search_items`. These are mismatches between the fixture spec and the mock, not defects of either server and not a property of the proposal. So this run **does not give a meaningful absolute score for either package**, and it cannot rank them. It does confirm that both servers start, speak MCP over stdio with the local runtime, list tools, and respond reproducibly.

### Per-check differences (the only ones)

1. `T2-CATALOG-API / derived_filter`: baseline FAIL ("missing 16 of 16 expected ids", the tool existed and was called); proposed FAIL ("no tool", because the proposal hid `filter_part_by_features`). Same verdict, but it shows the cost of `hide_tool`: the proposed server no longer offers the feature filter at all. This is the intended, flagged trade-off in op `hide-filter`.
2. `T3-LARGE-RESP / tool_exists_category`: FAIL -> PASS; `category_huge_body`: FAIL -> PASS; `large_response`: FAIL in both ("tool returned an error for the bulk query" in the proposed run). Cause, read from the report: the suite's `tool_hint` for these checks is the regex `category`, matched against tool text; the generated binding file has no entry for these checks, so the scorer falls back to the hint (`boundBy: hint`). The proposed `find_parts` description mentions "category" ("Returns part code, name, category and features by default"), so the hint resolved to it; the baseline descriptions do not contain it, so nothing bound. This is a regex-hint accident, not evidence that the proposal behaves better. It also shows the scorer reacts to description wording through name hints, so description edits can move scores for reasons unrelated to quality.
3. Everything else is identical, including the renamed tools binding correctly through `mcptest-binding.json` (`boundBy: explicit` for lookup, search, auth, pagination, projection and fault checks). No ERROR or ambiguous-binding result occurred, so the rename and composite did not break the binding.

The composite `find_part_details` is not exercised by any suite check, so its behaviour at runtime is untested by this comparison.

## 3. What this comparison shows, and what it does not

Shows:
- No regression from the scorer's point of view: generator-side Tier 1 gate stays pass, pass rate stays 100 percent, no new flags, no new binding errors; the renamed/hidden/composite package generates, starts and serves under the local runtime exactly as far as the baseline does.
- The proposal's tool renames survive the Phase 15 binding via `mcptest-binding.json`.
- One real capability cost (feature filter hidden) is visible to the scorer.

Does not show:
- That the proposal-assisted package is better. Names and descriptions are advisory in the score (docs/mcp-generator-proposals.md), and the one observed improvement (item 2) is a hint-regex coincidence.
- That the descriptions help an agent pick the right tool or arguments. That needs a selection evaluation with an agent client; none was run (no model calls by design).
- Absolute server quality. Both packages are DISQUALIFIED against a mock that does not match the Acme fixture. A fair local-exec number needs a mock upstream whose routes and field names match the spec the package was generated from, which the platform does not provide for arbitrary input specs. This is recorded as a limitation, not fixed here (the scorer was not altered).
- Anything about the composite tool or the default page size 10 at runtime.

## 4. Cleanup

Scratch venv, packages, context pack, probe files and result JSONs are in the session scratchpad outside the repo and were deleted after writing this file. Re-run commands are in 22-HUMAN-UAT.md.
