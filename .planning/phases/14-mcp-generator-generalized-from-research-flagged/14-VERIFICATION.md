---
phase: 14-mcp-generator-generalized-from-research-flagged
status: human_needed
verified: 2026-10-12
---

# Phase 14 Verification

Status: automated evidence complete; live Python runs and browser checks are pending human (`14-HUMAN-UAT.md`). Nothing below was verified in a browser, and no generated Python was ever executed (only syntax-checked with `py_compile` in a temp directory).

`npm run check` exit 0 (131 test files passed, 1 skipped; 1210 tests passed, 1 skipped). `criteria.test.ts` alone: 25 passed. Earlier plans reported load-induced timeouts in unrelated pre-existing tests (`scripts/validate-submission.test.ts` smoke test, `src/routes/api/tryitout/jobs/jobs.test.ts`); each passed on rerun and in the full run, and Phase 14 did not touch them.

## Roadmap success criteria

| # | Criterion | Status | Evidence |
| --- | --- | --- | --- |
| 1 | `RESEARCH-SYNTHESIS.md` exists and is committed before design; design doc and plans cite it | Met (automated) | `RESEARCH-SYNTHESIS.md` in the phase directory; `docs/mcp-generator-design.md` committed alone as fba9807 before any code; `criteria.test.ts` "criterion 1" (design doc cites synthesis 8+ times, all 7 plans mention `RESEARCH-SYNTHESIS`). |
| 2 | Input-adapter architecture: one interface, adding an adapter does not change the core | Met (automated) | `src/lib/mcpgen/types.ts` `InputAdapter`; adapters listed only in `adapters/index.ts` (D-141); `criteria.test.ts` "criterion 2" asserts the adapter id set and that no non-adapter module except `registry.ts` (via `adapters/index`) imports an adapter. Adapters: `openapi`, `tabular-catalog`, `sql-ddl` (CUST-02). Tests: `adapters/*.test.ts`, `registry.test.ts`. |
| 3 | Schema/spec only, never credentials; env-var placeholders | Met (automated) | `credentials.ts` rejects, never echoes (`credentials.test.ts`, D-142); scan runs before any adapter (`registry.ts`); `criteria.test.ts` "criterion 3": runtime-built secret flagged and absent from findings, generated servers contain no URL literal outside comments and read config only through `os.environ.get`; goldens use `<NAME>_*` variable names; CLI refuses `.env*` input and reads one file; no persistence in route, CLI or panel (D-155, D-157, D-158). Live check of the UI rejection alert: pending human. |
| 4 | Deterministic Python FastMCP core, unit tests per adapter, behaviours 1-9 | Met (automated); live run PENDING HUMAN | `plan.ts`, `emit/*`, `generate.ts`; per-adapter tests and goldens (`__golden__/`, `golden.test.ts`, `openapi.golden.test.ts`, `dataset.golden.test.ts`); generated `test_server.py` covers the checklist (task-oriented names, read-only, projection cap 12, clamp, ceiling, honest not-found and empty, structured errors, auth message); `criteria.test.ts` "criterion 4" asserts helpers `_clamp`, `_project`, `_err`, `_no_results` present and no `str(e` or `Traceback` for the three sample models, and the test-name coverage. Generated Python is only py_compiled (`pycompile.test.ts`). Running generated tests, FastMCP pin and `mcp.tool(fn)` registration: PENDING HUMAN. |
| 5 | Documented extension point for synthesized capability; ambiguous/unsupported input reported, never guessed | Met (automated) | `docs/mcp-generator.md` section "Extension point for synthesized capability" with `DerivedTool` worked example; `detectDerivedTools` and `derived-invalid` in `plan.test.ts`; `criteria.test.ts` "criterion 5" (docs heading, detected derived tool, invalid user rule gives `derived-invalid`, garbage gives `unrecognized-input`); adapters emit gaps instead of guesses (`*-bad` fixtures). |
| 6 | Customize menu gains a working "Generate MCP" entry when flag on; flag off leaves placeholder unchanged | Met in jsdom/axe only; browser PENDING HUMAN | `CustomizeMenu.mcp.test.ts` (flag-off DOM equals no-prop DOM), `customize-button.mcp.test.ts` (load key absent when off), `GenerateMcpPanel.test.ts`, `GenerateMcpPanel.a11y.test.ts` (axe, three states), `src/lib/flags.mcp.test.ts`; route 404 when off in the route tests; `criteria.test.ts` "criterion 6" (flag default off, menu gated on `generatorEnabled`). Browser and zip download: `14-HUMAN-UAT.md`. |
| 7 | Decisions with revert notes; no real customer data, keys or fixtures copied from reference projects | Met (automated) | D-140..D-162 in `.planning/AUTONOMOUS-DECISIONS.md`, each with alternatives and revert (14-03..14-06 drafts consolidated here, D-159/D-160 added, D-161/D-162 for the core limitations); `criteria.test.ts` "criterion 7" scans `src/lib/mcpgen` (sources, goldens, fixtures), `docs/mcp-generator.md` and the design doc for the reference-repo name and the study-specific tokens (word boundary, case sensitive) and secret-shaped strings (unit test files excluded from the secret scan because `generate.test.ts` holds a deliberate hostile literal; `credentials.test.ts` builds its secrets at runtime), and checks fixtures are `acme-*` with `.example` hosts only. |

## Guardrails

- Existing tests unmodified: `git diff --name-status <parent of fba9807>..HEAD -- '*.test.ts'` lists 21 entries, all `A` (added); zero `M` or `D`. One golden file (`__golden__/sqlddl.server.py`, a Phase 14 file) was regenerated for D-161.
- No new dependencies: `package.json` only gained the `generate-mcp` script (D-160).
- Reference repos were not read in this plan; fixtures are invented (Acme).
- Flag default off: `mcpGeneratorEnabled()` unset is false; route is 404 when off; detail load has no key when off.

## Known gaps and core limitations

| Gap | Disposition |
| --- | --- |
| The sql and dataset planners ignore `operations`: only `describe_*` and `query_<entity>` are emitted (list/get operations of a DDL model give no separate lookup tool; the dataset backend emits the first entity only, gap `dataset-multiple-entities`) | Not fixed (not cheap or safe without redesigning the dataset/sql tool surface); documented in `docs/mcp-generator.md`; D-162. Lookup by key works through the query filter. |
| SQL `ORDER BY` used only the first primary-key column, so composite-key paging was not fully deterministic (found in 14-04) | Fixed in 14-07 (D-161): all identifier columns are ordered; the sqlddl golden pins it (commit 9b8ce48). |
| Only the `inMemoryFilter` derived kind is accepted from callers and only for http backends; `schemaDiscovery` and `crossFieldSearch` are declared but reported as unsupported | Documented; extension left for a later phase. |
| Write tools are never emitted; `allowWrite` is recorded and reported only (D-143) | By design. |
| The generate route adds no authentication of its own. Whether callers must sign in depends on the global request hook configuration, which was not verified for this route | Documented in `docs/mcp-generator.md` and the UAT; question for Ville. |
| FastMCP pin `fastmcp>=3.4,<4` and `mcp.tool(fn)` registration are UNVERIFIED against PyPI | PENDING HUMAN. |
| Generated `test_server.py` has never been executed | PENDING HUMAN. |
| Deterministic only; LLM-assisted layer deferred | D-159. |

## Pending human

All in `14-HUMAN-UAT.md` with exact commands: CLI generation from each fixture; running a generated `test_server.py` and a stdio launch in a throwaway venv; FastMCP version pin check; dataset/SQL servers on synthetic data; Generate MCP panel and zip download in a browser with `MCP_GENERATOR=1`; flag-off check (placeholder menu and 404); optional questions to the study author.

## Questions for Ville

Defaults chosen (RESEARCH-SYNTHESIS section 6 and design doc section 9) and what to change if wrong:

- Q1 Scope: author downloads and runs a package (zip with `server.py`, `test_server.py`, `requirements.txt`, README, report). If hosting is wanted, wire the zip output into the Phase 8 runtime instead (D-154).
- Q2 Ceilings: optional author-supplied `limits`, otherwise conservative defaults plus a warning gap. Change `DEFAULT_MAX_PAGE_SIZE` / `DEFAULT_MAX_RESPONSE_ITEMS` in `plan.ts`.
- Q3 Tabular input: header, dictionary and at most 5 sample rows (D-150). Change `MAX_SAMPLE_ROWS` to allow more.
- Q4 FastMCP pin `fastmcp>=3.4,<4`: UNVERIFIED. Edit `emit/requirements.ts` and refresh goldens.
- Q5 LLM layer: none (D-159).
- Q6 Study questions for the author: why openapi-mcp-generator scored 0 of 5, and whether `combined` was benchmarked.
- Q8 The reference repos had uncommitted changes when the synthesis was written; committed history may differ for the mcpybarra rows.
- Also: confirm the route's authentication expectations (see Known gaps).

## Handoff note for AUTONOMOUS-SUMMARY.md

Done in this plan: Phase 14 entry, pending-human item and Questions for Ville are already added to `.planning/AUTONOMOUS-SUMMARY.md`. ROADMAP: plan checkboxes 14-01..14-07 marked; the Phase 14 line stays unchecked with a human_needed note, like Phase 13.
