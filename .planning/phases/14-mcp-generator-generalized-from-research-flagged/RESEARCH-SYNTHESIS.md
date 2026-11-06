# Phase 14 Research Synthesis: what the MCP generator comparison tells us

**Written:** 2026-10-12 (branch `autonomous/overnight-improvements`)
**Status:** Mandatory first deliverable of Phase 14. The design doc and every plan in this phase MUST cite this file.
**Sources (read-only, text/docs/code only; no data files, no `.env`, nothing executed):**

- `~/projects/mcp-gen-comparison/` (project 1): `README.md`, `CLAUDE.md`, `brief.txt`, `wp5-mcp-generator-test-suite.md`, `harness/harness.py` + `harness/expected.py` (logic only), `results/results.csv` (scores only), `wp5-bench/{base,runner,report,leak_guard}.py`, `wp5-bench/arms/registry.yaml` + `arms/*/adapter.py`, `wp5-bench/suite/T2-STK-API/{case,rubric}.yaml` + `golden.jsonl`, `wp5-bench/results/*.json` (statuses only), `arms/gsd/arm_info.json`, `arms/mcpybarra/server.py` (tool signatures only).
- `~/projects/mcp-gen-comparison-2/` (project 2): `README.md`, `gsd-only/CLAUDE.md`, `gsd-only/last steps`, `gsd-only/stk_mcp/{server,models,data_access}.py` (structure only), `codex/mcp_test/README.md`.

Nothing from those projects (real catalog values, fixtures, product numbers, keys) is reproduced here. Where a concrete value would help I describe its shape instead.

Confidence: HIGH for scores and structures quoted (read directly from files). MEDIUM for causal "why" statements (inferred from code and notes, not re-run). Items I could not verify are marked UNVERIFIED.

---

## 0. Headline findings

1. A hand-authored server that follows a small set of design behaviours scored 9/9 scored checks. Every automated arm scored 6 or less on the final run. The gap is almost entirely about behaviours, not about wrapping endpoints.
2. A deterministic OpenAPI converter reproduces the "mirror the API" half perfectly and instantly (4/9) but gets zero of the synthesized/defensive behaviours. An LLM arm with a spec-driven workflow (gsd, 5/9) "understood the hard problems and under-implemented all three".
3. The discriminating capability is "synthesize what the API lacks" (in-memory filtering over nested data). No automated arm produced it in a harness-passing form. A deterministic generator can still emit it if it is expressed as a structural rule, not as domain knowledge.
4. The study never scored non-OpenAPI inputs. Docs-only, data-dump, repo and profile inputs were designed (suite doc) but have no fixtures, golden files or working arms. The Excel/TTxxx catalog server in project 2 was built twice (FastMCP+GSD, raw JSON-RPC by Codex) but never put through any shared harness.
5. The two "install failed" arms were never actually attempted (source not cloned, fixture not authored) and one arm has no public code. They are not evidence about those generators.

---

## 1. Which approaches scored best, and why

### 1.1 Definitions (from `wp5-mcp-generator-test-suite.md`)

| Dim | Name | Type | What it measures |
|-----|------|------|------------------|
| D1 | Buildable | binary | Generates, installs, starts under stdio and the declared transport |
| D2 | Functional correctness | % | Golden query set: each tool returns the correct result |
| D3 | Contract fidelity | 0-3 | Tool names/params/types/descriptions match the source spec or profile |
| D4 | Robustness | % | Injected faults: empty sets, upstream errors, oversized payloads, bad input |
| D5 | Code quality | 0-3 | Typing, FastMCP idioms, error handling, tests present, no secret leakage |
| D6 | Process | measured | Wall-clock, tokens/cost, reproducibility over 3 reruns, human interventions |

Tiering: Tier 1 is a gate (fail = disqualified for that source). Tier 2 + Tier 3 carry the score. Tier 4 yields risk flags (a leak or a spurious write tool is a blocker regardless of score).

### 1.2 Important caveat: `results.csv` does NOT contain D1-D6

`results/results.csv` records the LVI-INFO harness's 10 checks (`harness/harness.py`), not the suite's D1-D6. The harness predates the suite doc. I map the 10 checks onto the dimensions as follows (my mapping, not in the source):

| Harness check | Approx. dimension | Note |
|---------------|-------------------|------|
| (server launches, lists tools) | D1 | Implicit: a launch failure turns every check into FAIL |
| `lookup_by_lvi`, `lookup_by_link`, `supplier_filter`, `etim_filter` | D2 | `etim_filter` is the synthesis discriminator |
| `projection` (<= 12 fields on a product object) | D2/D3/D5 blend | Trimmed responses |
| `pagesize_clamp`, `pagination_ceiling`, `bad_input`, `empty_vs_error`, `auth_fail` | D4 | `pagination_ceiling` is NA for every arm (bound supplier too small to trigger the ceiling) |
| tool count and names (`n_tools`, `tool_names`) | D3 signal only | No numeric D3 score was ever recorded |
| `arms/gsd/arm_info.json` | D6 (manual) | Only gsd has recorded cost; others unlogged |
| D5 code quality | not measured | Only the unrun T2-STK-API rubric (`suite/T2-STK-API/rubric.yaml`) defines it |

So: D3 and D5 have no scores anywhere; D6 is recorded for gsd only (about 16 min, about 10.1M tokens mostly cache reads, about $4.60, model "sonnet-5" per `arms/gsd/arm_info.json`). Phase 15 must say this plainly.

### 1.3 Scores per arm (latest/representative rows of `results/results.csv`; max 9 because `pagination_ceiling` is NA)

D2-ish = 5 checks (lookup x2, supplier, etim, projection). D4-ish = 4 scored checks (clamp, bad_input, empty_vs_error, auth).

| Arm | Latest total | D2-ish | D4-ish | Tools | Stability across rows | Failure signature |
|-----|-------------|--------|--------|-------|-----------------------|-------------------|
| handauthored | 9 (also 9, 8, 9 earlier) | 5/5 | 4/4 | 7 task-oriented | 8 once (`bad_input` flaky) | none in best runs |
| plain (single prompt) | 6 (earlier 2, then 6 twice) | 4/5 | 2/4 | 7 | 2 early run was a harness alias gap, fixed by widening aliases in `harness/expected.py` | no ETIM tool; empty/bad input unhandled |
| gsd (spec-driven, LLM) | 5 (identical in 4 rows) | 3/5 | 2/4 | 6 | very stable | no ETIM tool, projection keeps all fields, empty envelope passed through |
| from_openapi (FastMCP.from_openapi) | 4 (identical in 3 rows) | 3/5 | 1/4 | 5 (1:1 endpoints) | fully deterministic | no ETIM, no projection, no clamp-or-error mapping, no auth message |
| openapi-mcp-generator (npm, deterministic, TS output) | 2 (2 rows) | 0/5 | 2/4 | 5 (names like `...UsingGET`) | stable | D2 checks all FAIL (cause UNVERIFIED: binding/arg-name mismatch vs a real defect; needs a rerun) |
| mcpybarra (agentic gen+QA+refine) | 1 to 2 (best 2; final row 1) | 0/5 | 0-1/4 | 1 (`get_lvi_info`) then 6 | unstable, 0 to 2 across ~10 runs | one mega-tool early; later 6 tools but `filter_by_etim_class` takes a `products: list` argument instead of fetching itself |
| mcpybarra-v1 | 0 then 3 | 0/5 | 3/4 | 5 | unstable | |

Best approach per dimension, honestly stated:

- **D2 functional:** handauthored (only arm with a working ETIM tool and trimmed output). Among automated arms: plain (4/5) > gsd = from_openapi (3/5).
- **D4 robustness:** handauthored (4/4). Automated arms top out at 2/4. `auth_fail` is the one D4 check LLM arms (gsd, plain) pass and the raw converter fails.
- **D1/D6 buildable and cheap:** from_openapi (0.08-0.15 s, zero LLM, bit-for-bit reproducible, `wp5-bench/results/T2-STK-API_20260804T181308.json`). openapi-mcp-generator takes about 9 s including a TS build.
- **Where deterministic wins:** reproducibility and build reliability. In the offline mock case (`T2-STK-API`) both deterministic converters scored 9/9 on 3 reruns each, but that golden set only asks for search/get/not-found/empty/page-2/auth. It does not test projection, clamping, or synthesis, so it does not discriminate (see 4.4).

### 1.4 Why the best arm won (the transferable lesson)

`README.md` (project 1) lists handauthored's design decisions. They are exactly the behaviours the harness rewards, and each can be stated as a rule:

1. Tools named for tasks, not endpoints (`lookup_by_*`, `search_*`, `filter_by_*`).
2. Responses projected to a few identifying fields plus the nested data that matters (harness limit: at most 12 fields).
3. One synthesized tool (in-memory filter) that paginates candidates, narrows by supplier/identifier, and reports coverage honestly when the candidate set was too large to scan.
4. Page size always clamped to the documented range before sending.
5. Every tool catches upstream failures and returns a structured, explained result, never the raw `{timestamp, status, error, path}` envelope.

gsd's notes in `arms/gsd/arm_info.json` show the failure mode of LLM arms: they noticed (wrote an ETIM reshaping helper, documented empty-vs-error in a docstring) but did not turn the insight into behaviour. Prompting for the behaviours in `brief.txt` (which explicitly demands the ETIM tool, clamping, no-results message) still produced 5 to 6, so "tell the model" is not enough. Deterministic emission of the behaviours is the direct fix.

---

## 2. Input types covered, per arm

| Input type | Where it appears | Arms/approaches | Outcome |
|------------|------------------|-----------------|---------|
| OpenAPI spec, live API (LVI-INFO) | project 1 `arms/from_openapi/openapi.json` | from_openapi, openapi-mcp-generator | Scored (4 and 2 of 9); mirrors endpoints only |
| Prose API brief, live API | `brief.txt` | plain, gsd, mcpybarra (handauthored written by a human) | Scored (6, 5, 1-2, 9). Note the brief states the ETIM requirement and edge behaviours explicitly |
| OpenAPI spec, offline mock (T2-STK-API) | `wp5-bench/suite/T2-STK-API/fixture/spec/` (spec + mock HTTP server) | openapi-mcp-generator, from_openapi | 9/9 on 3 reruns each (mock golden is lenient, see 4.4). Only fixture that exists |
| Docs-only (HTML/PDF/manual) | suite cases T3-RT-DOCS; fixture dir `fixture/docs/` | bioinfomcp (DOCS modality) | Designed only. Fixture dir empty; arm `install_failed` (source never cloned) |
| Raw data dump (XML/CSV/JSON) | suite case T2-LVI-DUMP; `fixture/dump/` | none | Designed only; fixture empty; no arm in the registry accepts DATA_DUMP |
| Code repository | modality `CODE_REPO` | code2mcp | Designed; case marked "not planned"; arm `install_failed` (source never cloned) |
| OpenAPI with automated spec repair | paper arXiv 2507.16044 (as cited in `registry.yaml`) | automcp | UNAVAILABLE: no public code as of 2026-08-04 (per registry; not re-checked here) |
| Data standard / profile conformance | suite cases T3-TATE-PROFILE, T1-STD-CATALOG | none | Designed only |
| Composite cross-source | T3-COMPOSITE | none | Designed only |
| Excel catalog with TTxxx field codes (project 2) | `gsd-only/`, `codex/mcp_test/` | FastMCP+GSD (pandas/openpyxl), Codex raw JSON-RPC (openpyxl) | Both built. No shared harness, no scored results. GSD side has 5 pytest suites; Codex side has none (per project 2 README) |
| Combined (deterministic backbone + agent layer) | planned arm; `combined/` and `mcpybarra-only/` are empty placeholders | none | Not built |

Registry facts worth keeping (`wp5-bench/arms/registry.yaml`, `wp5-bench/base.py`): the arm adapter contract is `generate(fixture_dir, run_dir) -> GenerateResult(server_path, status, error, generation_s, notes)` that never raises; modality enum is `spec | docs | dump | repo | any`; run states are kept distinct (`NA_MODALITY`, `SKIPPED_FIXTURE`, `UNAVAILABLE`, `INSTALL_FAILED`, `GEN_FAILED`, `PASS`, `FAIL`, `ERROR`) so "could not run" is never conflated with "failed".

### 2.1 Project 2: Excel/TTxxx catalog server (structure and behaviour only)

- Input shape (from README): workbook with a product sheet (row 1 TT-codes, rows 2-3 skipped, data from row 4) and a field-dictionary sheet (code to Finnish label). 183 columns in the Codex README example.
- GSD/FastMCP version (`gsd-only/stk_mcp/`): data-access layer isolated in one module (`data_access.py`) so a live REST backend can replace Excel later; pydantic v2 response envelope `data` + `meta{source, source_version, retrieved_at, validation_state, gaps[], capped}`; `search_products` hard-capped at 20 with `meta.capped`; `get_product` reports `gaps` for absent fields and is forbidden to fabricate missing data (project constraint in `gsd-only/CLAUDE.md`); startup self-check via env var; identifier columns coerced to strings.
- Codex version (`codex/mcp_test/README.md`): 5 tools shaped for agents: `catalog_overview`, `search_fields` (schema discovery over field codes/names/descriptions), `search_products`, `get_product`, `query_products` (filters with equals/contains/startsWith, bounded limit, caller-selected `fields`). This is the richer generic design for tabular data.
- Lessons recorded in `gsd-only/last steps`: partial module state if the label sheet fails to load (load both before assigning globals), NaN/dtype issues (int/float columns becoming "1000.0"), and a code review that found these only after the fact. Tabular adapters need these as built-in templates and tests.
- Nits: the GSD project doc says three tools while two are implemented; `ErrorEnvelope` puts `str(exception)` into `meta.gaps`, which can leak internals (see 4.3).

---

## 3. The "synthesize what the API lacks" discriminator, and what generated servers must include

### 3.1 The discriminator

The LVI-INFO API has no query parameter for ETIM technical data (nested array `etimFeatureValues` of class/feature/value/unit objects on each product). A raw OpenAPI conversion cannot expose it. `harness/harness.py` check `etim_filter` requires a tool that (a) fetches candidate pages, (b) filters the nested array in memory by class (optionally feature), (c) returns the matching products. Only the hand-written server did this end to end. Structural characterisation usable by a generator without domain knowledge:

- the response schema contains an array of objects with a "class id", "feature id" and value-like fields, and
- no declared request parameter filters on those fields.

General pattern: "response field X is filterable client-side but not server-side" gives a derived tool `filter_by_<x>` that pages through a bounded candidate set, filters locally, and reports scan coverage (pages scanned, whether truncated). The Excel server analogue is `query_products` over any column.

### 3.2 Behaviours the harness rewards (checklist for the emitter and for the generated unit tests)

| # | Behaviour | Harness check and exact criterion (`harness/harness.py`) | Emitter rule |
|---|-----------|-----------------------------------------------------------|--------------|
| 1 | Task-oriented tool names and a synthesized filter tool | `etim_filter` (response must contain the expected products; no tool = FAIL) and n_tools/names recorded | Name from intent (`lookup_*`, `search_*`, `filter_by_*`, `list_*`), not operationId. Add derived filter tools where 3.1 pattern is detected |
| 2 | Trimmed responses | `projection`: product object has at most 12 fields (`PROJECTION_MAX_FIELDS = 12`) | Default projection list per entity (identifier, name, grouping/class, nested data of interest); `fields` argument to widen; never forward raw upstream objects |
| 3 | Page-size clamp | `pagesize_clamp`: request 5x the documented max; PASS if rejected cleanly or result count within max; FAIL on leaked error | Clamp to `[1, maximum]` from the spec's `maximum`; document clamping in the tool description |
| 4 | Ceiling warning | `pagination_ceiling`: deep page must not leak a raw upstream error (NA unless a large source is bound) | Spec rarely declares the ceiling; take it from adapter options (`limits.resultCeiling`). When `page * pageSize` would exceed it, return a structured warning and suggest narrowing by a partition filter |
| 5 | Honest not-found | `bad_input`: PASS if `is_error` or text matches `not found|no product|no match|does not exist` and no leak | Map 404 and empty single lookups to "No <entity> found for <id>" |
| 6 | Honest empty results | `empty_vs_error`: zero products AND text matching `no match|no product|no result|0 result|zero result|empty` | A 200 with zero rows returns `{"results": [], "message": "No matches ..."}`; never a bare empty envelope |
| 7 | Structured errors, no raw envelopes or secrets | `looks_like_leaked_error`: FAIL on `Traceback (most recent call last)`, `httpx.`, `all shards failed`, `requests.exceptions`, `ConnectionError`, `JSONDecodeError`, or on 3 or more of the words `timestamp`, `status`, `error`, `path` anywhere in the lowercased output | Catch all exceptions in every tool; map status to a short category message; do not echo upstream body or exception text. PITFALL: our own error shape must not contain 3 of those four words, so use keys like `ok`, `kind`, `message`, `hint` |
| 8 | Auth failure is surfaced as an auth message | `auth_fail`: relaunch with a deliberately wrong key; output must match `auth|api key|unauthorized|forbidden|invalid key|401|403` with no leak | 401/403 maps to "Authentication failed: check the API key configured in <ENV_VAR>" (name the env var, never the value) |
| 9 | Read-only default | Tier 4 `T4-SEC-SECRETS` (suite doc): no write tools from a read-only source; any spurious write tool is a blocker | Emit GET/SELECT only. Drop POST/PUT/PATCH/DELETE operations and list them in the generation report. Write tools only with an explicit opt-in per operation |

Also from the suite doc (T4): retry/backoff on 429/5xx; malformed JSON from upstream becomes an honest tool error, never a confident wrong answer; keys never in logs or tool output; query params validated/escaped; domain codes validated (checksum/format) rather than treated as free text (for example GTIN length/checksum).

---

## 4. Known failure modes

### 4.1 Arm and tooling failures

- **code2mcp, bioinfomcp: `install_failed`** in `registry.yaml` and in `wp5-bench/results/T2-STK-API_20260804T181334.json`. The recorded reasons are "source not cloned into `wp5-bench/arms/<arm>/src/`" plus "fixture for that modality not authored". So these are setup gaps, not evidence that the generators fail. Both need an LLM key (code2mcp: provider-specific; bioinfomcp: OpenAI) and network egress rules; code2mcp fetches a repo URL and must be pointed at a local path.
- **automcp: unavailable** (paper only, no code as of 2026-08-04 per the registry).
- **openapi-mcp-generator** emits a TypeScript/Node server (npm install and build step) while the study target is Python FastMCP. The adapter copies `node_modules` from another arm to avoid a 30 s install, which is an environment-coupling hack. Its harness run scored 2/9 with all functional checks failing (cause not established; UNVERIFIED).
- **mcpybarra:** the arm file imports the official `mcp` SDK (`mcp.server.fastmcp`) and `python-dotenv` `load_dotenv()` rather than the standalone `fastmcp` package used elsewhere, and needed a fix commit ("correct import, API env vars, and binding" in git log). Output quality was erratic: a single catch-all `get_lvi_info` tool for about 10 runs, then 6 tools whose ETIM tool took a caller-supplied product list (so the "in-memory filter" cannot fetch anything). The harness `binding.json` mechanism hides such shape mismatches as FAIL.
- **plain:** first scored 2/9 due to a harness alias gap (field names differ from the TT codes), fixed by broadening aliases. Lesson: scorers must be field-name agnostic or configured per case.

### 4.2 Server-quality failure modes (seen in scored runs)

- Mirroring raw upstream payloads (30 to 40 fields; gsd's `_reshape_product` kept all 38).
- Passing a raw empty envelope through, or documenting empty handling only in a docstring.
- No clamp, no ceiling handling: upstream HTTP 500 "all shards failed" reaches the caller.
- Raw 403 JSON envelope returned on bad key.
- ETIM-style capability recognised but not exposed as a tool.
- Flakiness: handauthored once failed `bad_input` (8/9), and mcpybarra varied 0 to 2 across identical runs. Reproducibility must be measured, not assumed (suite doc requires 3 reruns; only the T2 mock runs did 3).

### 4.3 Security and leak failure modes

- Real key in a `.env` used by the harness, passed through the full process environment to the subprocess. Project rules forbid committing it; the generator must never read or embed one.
- `leak_guard.py` exists because of solution leakage: generators with network access could pull the real baseline server from public repos or the real API host. It asserts that no golden answer string occurs in fixture files and generates hosts-file blocks (documentation only; enforcement is manual OS-level).
- Project 2 `ErrorEnvelope` copies `str(exception)` into the response, which can expose paths and library internals (the Codex README also hardcodes personal Windows paths in config examples; do not copy such examples).
- Excel inputs contain real catalogs; the reference repos sit next to them. Our rule: no real catalogs, no fixtures from them, synthetic only.

### 4.4 Benchmark-design weaknesses to avoid inheriting

- `wp5-bench/runner.py` `clean_not_found` evaluation passes when `no_crash or has_signal`, which is lenient: a response that merely lacks the words "Error:", "null" etc. passes. Phase 15 should tighten it (require an explicit not-found signal as `harness.py` does).
- The T2-STK-API golden set (9 checks) has no projection, clamp-oversize, ceiling, or synthesis check; both converters hit 9/9. It cannot discriminate arms.
- Tool resolution by regex over tool names and descriptions (`_find_tool`) can bind the wrong tool silently.
- Only 1 of 12 designed cases has fixtures. 11 are designed-only (as ROADMAP Phase 15 already notes).
- Harness is wired to one API (live key, real values, TT alias lists): not portable as-is.

---

## 5. Implications for the TypeScript platform (generator emits Python FastMCP stdio)

### 5.1 Recommended input-adapter set

Rank by evidence. v1 adapters (all deterministic):

| Adapter | Evidence it matters | v1 scope |
|---------|---------------------|----------|
| `openapi` (3.x JSON/YAML) | Most-tested input; deterministic converters exist; behaviours still missing from them | Full: operations, params (min/max/enum), response schemas, security schemes. GET-only by default |
| `tabular-catalog` (CSV/XLSX-style header + dictionary sheet) | Project 2 built it twice; our sample is schema only | Column names, labels, types, identifier columns; no row data accepted beyond a few synthetic sample rows in tests |
| `sql-ddl` (CUST-02) | Required by roadmap; same shape as tabular (entities, columns, keys) | `CREATE TABLE` with PKs/FKs/types; read-only SELECT tools |

Deferred (document as unsupported, report rather than guess; the study has no data on them): docs-only (needs grounding discipline; hallucination risk is the whole game per suite T3-RT-DOCS), data dump inference beyond tabular headers, profile conformance (needs the real profile spec), code repository, composite/cross-source.

### 5.2 Core/adapter interface

Adapters translate a source into one canonical model; the core never sees the source format. Sketch (names are proposals for the design doc):

```ts
interface SourceModel {
  name: string;
  backend: { kind: 'http' | 'dataset' | 'sql'; baseUrlEnv?: string; datasetPathEnv?: string; dsnEnv?: string };
  auth: { scheme: 'none' | 'apiKeyHeader' | 'apiKeyQuery' | 'bearer'; paramName?: string; envVar: string }; // names only, never values
  entities: Entity[];            // fields, types, identifier fields, nested collections, labels (fi/sv/en)
  operations: Operation[];       // read ops: params with bounds, response entity, pagination style
  limits: { maxPageSize?: number; resultCeiling?: number; maxResponseItems: number };
  gaps: Gap[];                   // ambiguous/unsupported/dropped (writes), each with a reason
}
interface InputAdapter {
  id: string;
  detect(input: RawInput): number;                       // confidence 0..1, no side effects
  parse(input: RawInput): { model: SourceModel } | { rejected: Gap[] };
}
```

Core pipeline: `SourceModel` to `ServerPlan` (tool list from deterministic synthesis rules) to Python text via templates to generated pytest files and a generation report (tools emitted, tools dropped, gaps, assumptions). Adding an adapter means registering one `InputAdapter`; the core and templates stay unchanged (roadmap success criterion 2). `ServerPlan` should be the extension point for synthesized capability (success criterion 5): a list of `DerivedTool` rules (in-memory filter, cross-field search, schema discovery) that adapters or the user can add, each with declared inputs and coverage-reporting behaviour.

### 5.3 Deterministic versus LLM-assisted (this phase: deterministic only; no paid APIs)

| Concern | Deterministic core (build now) | LLM-assisted (leave as optional, off, clearly marked) |
|---------|-------------------------------|--------------------------------------------------------|
| Parsing, canonical model | Yes | no |
| Tool naming | Rule-based verbs from HTTP method plus path/entity; collisions resolved by suffix; descriptions from spec text | Better naming, task-oriented descriptions |
| Projection field choice | Identifier fields, name-like fields, type/class fields, up to the 12-field cap; user override | Choosing "fields that matter" by domain |
| Clamp, ceiling, empty/not-found/auth/error mapping | Yes, template-fixed | no |
| Derived filters (3.1) | Structural detection: nested array of objects with key/id-like fields and no matching request param | Recognising domain semantics beyond structure |
| Tabular tools | `catalog_overview`, `search_fields`, `search_*`, `get_*`, `query_*` with equals/contains/startsWith and bounded limit (Codex design), numeric-aware filters | no |
| Docs-only, profile, ambiguous input | Not supported; report | Where an LLM would be needed, only after a human opt-in and never with raw secrets |

Reproducibility: same input must give byte-identical output (the from_openapi arm's best property); add a golden-output test per adapter.

### 5.4 Safety constraints (carry into the design as invariants)

1. Schema/spec only. Inputs that contain credentials are rejected or redacted with a report: scan for key-like values in examples, `?apiKey=` style literals, bearer tokens, `.env` content; never store, log, or echo them. Generated config uses env-var placeholders only (`<NAME>_API_KEY`, base URL env), including for `.mcp.json`-style snippets.
2. No real data. Tabular and DDL adapters accept headers/types/dictionary, not catalogs; tests and docs use synthetic fixtures. Do not import project-1/2 fixtures, product numbers or supplier numbers.
3. Read-only by default: no write tools unless the author opts in per operation; the report lists everything dropped.
4. Generated server hygiene: all params validated and escaped before use in URLs or SQL (parameterised queries only; identifier names allow-listed from the model), upstream text treated as untrusted data, no raw exception or upstream body in output, timeouts and bounded retries on 429/5xx, response size cap.
5. Never guess: ambiguous or unsupported constructs (oneOf without discriminator, missing types, undocumented required params) go to `gaps` and the generation report, and the affected tool is omitted or marked, matching suite T4-PARTIAL-SPEC.
6. Python target: FastMCP stdio (`from fastmcp import FastMCP`; study versions pinned around 3.4.x, see Open Questions). Generate `pyproject`/requirements pins and an env-var table; run nothing outside the sandbox. The platform treats generated servers as black boxes (AUTONOMOUS-RUN.md).
7. Feature flag default off; flag off leaves the Phase 4 placeholder untouched.
8. Server generation must itself make no network calls.

### 5.5 What Phase 15 can reuse (for cross-reference)

Reusable patterns: offline mock upstream plus fault injection, golden isolation gate (`leak_guard.check_golden_isolation`), adapter contract with distinct run states, field-name-agnostic value search in validators, the leak detector rules in 3.2 row 7, stdio black-box client. The generator should emit its own pytest tests that assert behaviours 1-9 against a mock, which doubles as seed cases for Phase 15.

---

## 6. Open questions for the human (Ville)

1. **Product scope of "Generate MCP":** is the generated output meant for authors to download and run themselves, or for the platform to host (Phase 8 container runtime)? This changes whether generated code needs to be single-file (as the brief required) or a small package with tests.
2. **Ceiling configuration:** OpenAPI rarely declares result ceilings (the 15000-index limit came from observation). Is an author-supplied `limits` block acceptable in the Generate form, or must the generator infer/default (for example conservative defaults plus a warning)?
3. **Tabular adapter input:** may authors upload a header-only/schema-only file, or should the UI only accept pasted column definitions? The study's Excel files held real catalogs; we must not ingest rows.
4. **Which FastMCP version to pin?** Project 1 requirements mention `fastmcp>=3.4.4`, project 2 pins `3.4.2`. I did not verify these against PyPI (out of scope for this read-only synthesis; the reference repos must not be run). Needs a check at implementation time.
5. **LLM-assisted layer:** is there any appetite for an opt-in LLM step later (naming, descriptions, docs-only inputs), or should the generator stay purely deterministic permanently? The evidence says LLM arms under-implement behaviours, so a hybrid ("combined" arm: deterministic backbone plus agent layer) was the study's own untested hypothesis.
6. **Unresolved study questions that would sharpen the design:** why openapi-mcp-generator scored 0/5 on functional checks (binding vs real defect), and whether the unfinished `combined` arm (the closest analogue to what we are building) was ever intended to be benchmarked. Worth asking the study's author.
7. **Naming conflict risk:** harness scoring keys on field aliases (`TT020` and similar). For generated servers over arbitrary sources, Phase 15 needs a per-case alias/binding config. Should that config live next to the generated server (emitted by the generator) or with the test case?
8. **Reference repos have uncommitted changes** (per AUTONOMOUS-RUN.md: `brief.txt`, `results.csv`, `arms/mcpybarra`). I read the working-tree versions. If the committed versions differ, the mcpybarra rows above may not match the published history.

---

## 7. Metadata

**Confidence breakdown**

- Score table and definitions: HIGH (read directly from `results.csv` and the suite doc; per-dimension grouping is my mapping).
- Input coverage matrix: HIGH for what exists; "designed only" is HIGH (empty fixture directories, registry statuses).
- Causal explanations (why arms lose): MEDIUM (from arm notes and code structure, no reruns).
- Generator design implications: MEDIUM (reasoned from evidence; not validated by building).

**Not examined (by the rules or by cost):** any `.env`, xlsx/csv data, `data/` directories, fixtures with real data, `arms/*/server.py` bodies beyond signatures, `harness/` internals beyond check logic, `codex/mcp_test/server.py` body (README only), the mock `stk_api.yaml`/`mock_server.py`.
